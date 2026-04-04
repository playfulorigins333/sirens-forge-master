export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "home";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// Real workflow imports remain intentionally disabled until
// the image route is ready to reconnect to the actual builder.
// import { resolveLoraStack } from "@/lib/generation/lora-resolver";
// import { buildWorkflow } from "@/lib/comfy/buildWorkflow";

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

async function getUserIdFromCookies(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!url || !anon) return null;

  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(url, anon, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    return user?.id ?? null;
  } catch (error) {
    console.warn("[generate] Could not resolve authenticated user from cookies.", error);
    return null;
  }
}

async function bestEffortLogGeneration(args: {
  userId: string | null;
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
    stub: boolean;
  };
}): Promise<LoggedGenerationRecord | null> {
  const admin = getAdminClient();
  if (!admin) {
    console.warn("[generate] Skipping generation log: SUPABASE_SERVICE_ROLE_KEY missing.");
    return null;
  }

  const now = new Date().toISOString();
  const status = args.upstream.ok ? "completed" : "failed";

  const isRealCompletedAsset =
    status === "completed" &&
    !args.placeholder &&
    typeof args.imageUrl === "string" &&
    args.imageUrl.trim().length > 0;

  const authoritativeLinkedLora =
    isRealCompletedAsset &&
    typeof args.identityLora === "string" &&
    args.identityLora.trim().length > 0
      ? args.identityLora.trim()
      : null;

  const metadata = {
    engine: "comfyui",
    template: args.upstream.template,
    mode: args.upstream.mode,
    placeholder: args.placeholder,
    output_url: args.imageUrl,
    ...(args.placeholder && args.imageUrl ? { placeholder_url: args.imageUrl } : {}),
    body_mode: args.bodyMode,
    identity_lora: args.identityLora,
    negative_prompt: args.negativePrompt,
    request: args.request,
    upstream: args.upstream,
    logged_at: now,
  };

  const candidates: Record<string, unknown>[] = [
    {
      user_id: args.userId,
      prompt: args.prompt,
      status,
      kind: "image",
      image_url: args.imageUrl,
      output_url: args.imageUrl,
      lora_used: authoritativeLinkedLora,
      metadata,
    },
    {
      user_id: args.userId,
      prompt: args.prompt,
      status,
      kind: "image",
      output_url: args.imageUrl,
      lora_used: authoritativeLinkedLora,
      metadata,
    },
    {
      user_id: args.userId,
      prompt: args.prompt,
      status,
      image_url: args.imageUrl,
      output_url: args.imageUrl,
      lora_used: authoritativeLinkedLora,
      metadata,
    },
    {
      user_id: args.userId,
      prompt: args.prompt,
      status,
      output_url: args.imageUrl,
      lora_used: authoritativeLinkedLora,
      metadata,
    },
    {
      user_id: args.userId,
      prompt: args.prompt,
      status,
      lora_used: authoritativeLinkedLora,
      metadata,
    },
    {
      user_id: args.userId,
      prompt: args.prompt,
      status,
      metadata,
    },
    {
      user_id: args.userId,
      prompt: args.prompt,
      metadata,
    },
    {
      prompt: args.prompt,
      metadata,
    },
  ];

  for (const payload of candidates) {
    const cleaned = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined && value !== null)
    );

    const { data, error } = await admin
      .from("generations")
      .insert(cleaned)
      .select("id")
      .single();

    if (!error) {
      return { id: data?.id };
    }
  }

  console.warn("[generate] Could not insert generation record into generations table.");
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const RUNPOD_BASE_URL = process.env.RUNPOD_BASE_URL;

    if (!RUNPOD_BASE_URL) {
      return NextResponse.json(
        { error: "RUNPOD_BASE_URL_MISSING" },
        { status: 500 }
      );
    }

    const publicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicSupabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!publicSupabaseUrl || !publicSupabaseAnon) {
      return NextResponse.json(
        { error: "SUPABASE_PUBLIC_ENV_MISSING" },
        { status: 500 }
      );
    }

    const supabase = createClient(publicSupabaseUrl, publicSupabaseAnon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json()) as GenerateImageRequest;

    const prompt = String(body.prompt || "").trim();
    const negativePrompt = String(body.negative_prompt || "").trim();
    const bodyMode = String(body.body_mode || "").trim();
    const identityLora =
      typeof body.identity_lora === "string" && body.identity_lora.trim().length > 0
        ? body.identity_lora.trim()
        : null;

    if (!prompt) {
      return NextResponse.json(
        { error: "PROMPT_REQUIRED" },
        { status: 400 }
      );
    }

    const normalized = {
      width: Math.max(256, Math.min(2048, Number(body.width || 1024))),
      height: Math.max(256, Math.min(2048, Number(body.height || 1536))),
      steps: Math.max(1, Math.min(150, Number(body.steps || 28))),
      cfg: Math.max(1, Math.min(30, Number(body.cfg || 7))),
      seed: Number.isFinite(Number(body.seed)) ? Number(body.seed) : 0,
      batch: Math.max(1, Math.min(4, Number(body.batch || 1))),
    };

    let finalPrompt = prompt;

    if (identityLora) {
      const { data } = await supabase
        .from("user_loras")
        .select("trigger_token")
        .eq("id", identityLora)
        .single();

      if (data?.trigger_token) {
        finalPrompt = injectTriggerToken(finalPrompt, data.trigger_token);
      }
    }

    const workflowGraph = {
      stub: true,
      message: "Image route contract is active while real workflow builder is disconnected.",
      inputs: {
        prompt: finalPrompt,
        negative_prompt: negativePrompt,
        body_mode: bodyMode,
        width: normalized.width,
        height: normalized.height,
        steps: normalized.steps,
        cfg: normalized.cfg,
        seed: normalized.seed,
        batch: normalized.batch,
        identity_lora: identityLora,
      },
    };

    const payload = {
      workflow: {
        type: "sirens_generate_v1",
        engine: "comfyui",
        template: "sirens_image_v3_production",
        mode: "txt2img" as const,
        inputs: {
          workflow_json: workflowGraph,
        },
      },
    };

    const userId = await getUserIdFromCookies();

    const upstream = await fetch(`${RUNPOD_BASE_URL}/gateway/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();

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
          stub: true,
        },
      });

      return NextResponse.json(
        {
          error: "UPSTREAM_ERROR",
          status: upstream.status,
          body: text,
          generation_id: logged?.id ?? null,
        },
        { status: upstream.status }
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
          stub: true,
        },
      });

      return NextResponse.json(
        {
          error: "UPSTREAM_INVALID_JSON",
          generation_id: logged?.id ?? null,
          body: text,
        },
        { status: 502 }
      );
    }

    const inferredImageUrl =
      typeof upstreamJson?.image_url === "string"
        ? upstreamJson.image_url
        : typeof upstreamJson?.output_url === "string"
        ? upstreamJson.output_url
        : Array.isArray(upstreamJson?.outputs) &&
          typeof upstreamJson.outputs?.[0]?.url === "string"
        ? upstreamJson.outputs[0].url
        : null;

    const upstreamPlaceholder =
      typeof upstreamJson?.placeholder === "boolean"
        ? upstreamJson.placeholder
        : false;

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
        stub: true,
      },
    });

    const finalImageUrl =
      typeof upstreamJson?.image_url === "string"
        ? upstreamJson.image_url
        : inferredImageUrl;

    const finalOutputs = Array.isArray(upstreamJson?.outputs)
      ? upstreamJson.outputs
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
        ...upstreamJson,
        status:
          typeof upstreamJson?.status === "string" ? upstreamJson.status : "ok",
        generation_id: upstreamJson?.generation_id ?? logged?.id ?? null,
        image_url: finalImageUrl,
        outputs: finalOutputs,
        placeholder: upstreamPlaceholder,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[generate] fatal error:", err);

    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}