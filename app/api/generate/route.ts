export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "home";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildWorkflow } from "../../../lib/comfy/buildWorkflow";
import { resolveLoraStack } from "../../../lib/generation/lora-resolver";
import { ensureActiveSubscription } from "../../../lib/subscription-checker";
import type { BodyMode } from "../../../lib/generation/contract";
import {
  requireSirensApiConfig,
  sirensApiFetch,
} from "../../../lib/sirensApi";
import { isGenerationExecutionEnabled } from "../../../lib/generation/executionAvailability";

type GenerateImageRequest = {
  prompt?: string;
  negative_prompt?: string;
  body_mode?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  batch?: number;
  identity_lora?: string | null;
};

type LoggedGenerationRecord = {
  id?: string;
};

function injectTriggerToken(prompt: string, token: string) {
  const trimmedPrompt = (prompt || "").trim();
  const trimmedToken = (token || "").trim();

  if (!trimmedToken) return trimmedPrompt;
  if (!trimmedPrompt) return trimmedToken;

  const re = new RegExp(`(^|\\s)${trimmedToken}(\\s|$)`, "i");
  if (re.test(trimmedPrompt)) return trimmedPrompt;

  return `${trimmedToken} ${trimmedPrompt}`.trim();
}

function getAdminClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRole) return null;

  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function bestEffortLogGeneration(args: {
  userId: string;
  prompt: string;
  negativePrompt: string;
  bodyMode: string;
  identityLora: string | null;
  imageUrl: string | null;
  placeholder: boolean;
  request: {
    width: number;
    height: number;
    steps: number;
    cfg: number;
    seed: number;
    batch: number;
  };
  upstream: {
    status: number | null;
    ok: boolean;
    template: string;
    mode: "txt2img";
    real_workflow: boolean;
  };
  runpodJobId?: string | null;
  errorMessage?: string | null;
  processingTimeMs?: number | null;
  r2Bucket?: string | null;
  r2Key?: string | null;
}): Promise<LoggedGenerationRecord | null> {
  const admin = getAdminClient();
  if (!admin) {
    console.warn(
      "[generate] Skipping generation log: SUPABASE_SERVICE_ROLE_KEY missing.",
    );
    return null;
  }

  const now = new Date().toISOString();
  const status = args.upstream.ok ? "completed" : "failed";

  const hasValidUrl =
    typeof args.imageUrl === "string" && args.imageUrl.trim().length > 0;

  const isRealAsset =
    status === "completed" && !args.placeholder && hasValidUrl;

  const authoritativeLinkedLora =
    isRealAsset &&
    typeof args.identityLora === "string" &&
    args.identityLora.trim().length > 0
      ? args.identityLora.trim()
      : null;

  const metadata = {
    engine: "comfyui",
    template: args.upstream.template,
    mode: args.upstream.mode,
    placeholder: args.placeholder === true,
    output_url: args.imageUrl,
    ...(args.placeholder && args.imageUrl
      ? { placeholder_url: args.imageUrl }
      : {}),
    body_mode: args.bodyMode,
    identity_lora: args.identityLora,
    negative_prompt: args.negativePrompt,
    request: args.request,
    upstream: args.upstream,
    logged_at: now,
  };

  const payload = {
    user_id: args.userId,
    prompt: args.prompt,
    image_url: isRealAsset ? args.imageUrl : null,
    lora_used: authoritativeLinkedLora,
    job_type: "image",
    body_type: args.bodyMode,
    mode: args.upstream.mode,
    status,
    negative_prompt: args.negativePrompt,
    steps: args.request.steps,
    cfg_scale: args.request.cfg,
    seed: args.request.seed,
    width: args.request.width,
    height: args.request.height,
    runpod_job_id: args.runpodJobId,
    error_message: args.errorMessage,
    processing_time_ms: args.processingTimeMs,
    completed_at: isRealAsset ? now : null,
    metadata,
    r2_bucket: args.r2Bucket,
    r2_key: args.r2Key,
    updated_at: now,
  };

  const cleaned = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

  const { data, error } = await admin
    .from("generations")
    .insert(cleaned)
    .select("id")
    .single();

  if (error) {
    console.warn("[generate] Could not insert generation record:", error);
    return null;
  }

  return { id: data?.id };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await ensureActiveSubscription();

    if (!auth.ok) {
      return NextResponse.json(
        {
          error: auth.error,
          message: auth.message,
        },
        { status: auth.status },
      );
    }

    const userId = auth.user.id;
    if (!isGenerationExecutionEnabled()) {
      return NextResponse.json(
        { error: "GENERATION_UNAVAILABLE", message: "Image generation is temporarily unavailable." },
        { status: 503 },
      );
    }
    // Fail closed before parsing input or invoking any privileged generation work.
    const sirensApiConfig = requireSirensApiConfig();

    const publicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicSupabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!publicSupabaseUrl || !publicSupabaseAnon) {
      return NextResponse.json(
        { error: "SUPABASE_PUBLIC_ENV_MISSING" },
        { status: 500 },
      );
    }

    const supabase = getAdminClient();

    if (!supabase) {
      return NextResponse.json(
        { error: "SUPABASE_ADMIN_MISSING" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as GenerateImageRequest;

    const prompt = String(body.prompt || "").trim();
    const negativePrompt = String(body.negative_prompt || "").trim();
    const rawBodyMode = String(body.body_mode || "none").trim();
    const bodyMode: BodyMode =
      rawBodyMode === "body_feminine" || rawBodyMode === "body_masculine"
        ? rawBodyMode
        : "none";
    const identityLora =
      typeof body.identity_lora === "string" &&
      body.identity_lora.trim().length > 0
        ? body.identity_lora.trim()
        : null;

    if (!prompt) {
      return NextResponse.json({ error: "PROMPT_REQUIRED" }, { status: 400 });
    }

    const normalized = {
      width: Math.max(256, Math.min(2048, Number(body.width || 1024))),
      height: Math.max(256, Math.min(2048, Number(body.height || 1536))),
      steps: Math.max(1, Math.min(150, Number(body.steps || 28))),
      cfg: Math.max(1, Math.min(30, Number(body.cfg || 7))),
      seed: Number.isFinite(Number(body.seed)) ? Number(body.seed) : 0,
      batch: Math.max(1, Math.min(4, Number(body.batch || 1))),
    };

    const loraStack = await resolveLoraStack(bodyMode, identityLora, userId);
    const finalPrompt = loraStack.trigger_token
      ? injectTriggerToken(prompt, loraStack.trigger_token)
      : prompt;

    const workflowGraph = buildWorkflow({
      prompt: finalPrompt,
      negative: negativePrompt,
      seed: normalized.seed,
      steps: normalized.steps,
      cfg: normalized.cfg,
      width: normalized.width,
      height: normalized.height,
      batch: normalized.batch,
      loraStack,
      dnaImageNames: [],
      fluxLock: null,
    });

    const payload = {
      workflow: {
        type: "sirens_generate_v1",
        engine: "comfyui",
        template: "sirens_image_v3_production",
        mode: "txt2img" as const,
        inputs: {
          workflow_json: workflowGraph,
          identity_lora: identityLora,
        },
      },
    };

    const startedAt = Date.now();

    const upstream = await sirensApiFetch("/gateway/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, fetch, sirensApiConfig);

    const text = (await upstream.text()).replaceAll(
      sirensApiConfig.internalSecret,
      "[redacted]",
    );

    if (!upstream.ok) {
      const logged = await bestEffortLogGeneration({
        userId,
        prompt: finalPrompt,
        negativePrompt,
        bodyMode,
        identityLora,
        imageUrl: null,
        placeholder: false,
        request: normalized,
        upstream: {
          status: upstream.status,
          ok: false,
          template: "sirens_image_v3_production",
          mode: "txt2img",
          real_workflow: true,
        },
        errorMessage: text || "UPSTREAM_ERROR",
        processingTimeMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          error: "UPSTREAM_ERROR",
          status: upstream.status,
          body: text,
          generation_id: logged?.id ?? null,
        },
        { status: upstream.status },
      );
    }

    let upstreamJson: any = null;

    try {
      upstreamJson = JSON.parse(text);
    } catch {
      const logged = await bestEffortLogGeneration({
        userId,
        prompt: finalPrompt,
        negativePrompt,
        bodyMode,
        identityLora,
        imageUrl: null,
        placeholder: false,
        request: normalized,
        upstream: {
          status: upstream.status,
          ok: true,
          template: "sirens_image_v3_production",
          mode: "txt2img",
          real_workflow: true,
        },
        errorMessage: "UPSTREAM_INVALID_JSON",
        processingTimeMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          error: "UPSTREAM_INVALID_JSON",
          generation_id: logged?.id ?? null,
          body: text,
        },
        { status: 502 },
      );
    }

    const legacyImages = Array.isArray(upstreamJson?.images)
      ? upstreamJson.images.filter((url: unknown) => typeof url === "string")
      : [];

    const normalizedUpstreamJson =
      upstreamJson?.success === true && legacyImages.length > 0
        ? {
            ...upstreamJson,
            image_url: upstreamJson.image_url ?? legacyImages[0],
            outputs:
              upstreamJson.outputs ??
              legacyImages.map((url: string) => ({ kind: "image", url })),
            generation_id: upstreamJson.generation_id ?? upstreamJson.prompt_id,
          }
        : upstreamJson;

    const inferredImageUrl =
      typeof normalizedUpstreamJson?.image_url === "string"
        ? normalizedUpstreamJson.image_url
        : typeof normalizedUpstreamJson?.output_url === "string"
          ? normalizedUpstreamJson.output_url
          : Array.isArray(normalizedUpstreamJson?.outputs) &&
              typeof normalizedUpstreamJson.outputs?.[0]?.url === "string"
            ? normalizedUpstreamJson.outputs[0].url
            : null;

    const upstreamPlaceholder =
      typeof normalizedUpstreamJson?.placeholder === "boolean"
        ? normalizedUpstreamJson.placeholder
        : false;

    const upstreamGenerationId =
      typeof normalizedUpstreamJson?.generation_id === "string"
        ? normalizedUpstreamJson.generation_id
        : typeof normalizedUpstreamJson?.prompt_id === "string"
          ? normalizedUpstreamJson.prompt_id
          : null;
    const r2Bucket =
      typeof normalizedUpstreamJson?.r2_bucket === "string"
        ? normalizedUpstreamJson.r2_bucket
        : null;
    const r2Key =
      typeof normalizedUpstreamJson?.r2_key === "string"
        ? normalizedUpstreamJson.r2_key
        : null;

    const logged = await bestEffortLogGeneration({
      userId,
      prompt: finalPrompt,
      negativePrompt,
      bodyMode,
      identityLora,
      imageUrl: inferredImageUrl,
      placeholder: upstreamPlaceholder,
      request: normalized,
      upstream: {
        status: upstream.status,
        ok: true,
        template: "sirens_image_v3_production",
        mode: "txt2img",
        real_workflow: true,
      },
      runpodJobId: upstreamGenerationId,
      processingTimeMs: Date.now() - startedAt,
      r2Bucket,
      r2Key,
    });

    const finalImageUrl =
      typeof normalizedUpstreamJson?.image_url === "string"
        ? normalizedUpstreamJson.image_url
        : inferredImageUrl;

    const finalOutputs = Array.isArray(normalizedUpstreamJson?.outputs)
      ? normalizedUpstreamJson.outputs
      : finalImageUrl
        ? [
            {
              kind: "image",
              url: finalImageUrl,
            },
          ]
        : [];

    return NextResponse.json(
      {
        ...normalizedUpstreamJson,
        status:
          typeof normalizedUpstreamJson?.status === "string"
            ? normalizedUpstreamJson.status
            : "ok",
        generation_id:
          normalizedUpstreamJson?.generation_id ?? logged?.id ?? null,
        image_url: finalImageUrl,
        outputs: finalOutputs,
        placeholder: upstreamPlaceholder,
      },
      { status: 200 },
    );
  } catch (err: any) {
    const message = err instanceof Error ? err.message : "";

    if (message === "IDENTITY_LORA_UNAVAILABLE") {
      return NextResponse.json(
        {
          error: "IDENTITY_LORA_UNAVAILABLE",
          message: "Selected AI Twin is unavailable.",
        },
        { status: 400 },
      );
    }

    if (
      message === "SIRENS_API_INTERNAL_SECRET_MISSING" ||
      message === "SIRENS_API_BASE_URL_MISSING"
    ) {
      return NextResponse.json({ error: message }, { status: 500 });
    }

    console.error("[generate] fatal error");

    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: "Unknown error",
      },
      { status: 500 },
    );
  }
}
