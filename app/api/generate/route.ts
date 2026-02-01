// ------------------------------------------------------------
// /app/api/generate/route.ts
// FULL FILE — PRODUCTION, CONTRACT-DRIVEN, DETERMINISTIC
// Architecture (LOCKED):
// Contract → resolveLoraStack → buildWorkflow → ComfyUI
// ------------------------------------------------------------

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

import {
  parseGenerationRequest,
  type GenerationRequest,
} from "@/lib/generation/contract";
import { resolveLoraStack } from "@/lib/generation/lora-resolver";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";

export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// ENV (server-safe)
// ------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const COMFY_ENDPOINT = process.env.RUNPOD_COMFY_WEBHOOK || "";

// ------------------------------------------------------------
// Phase 1 IMAGE modes (LOCKED)
// ------------------------------------------------------------
const IMAGE_MODES: GenerationRequest["mode"][] = ["txt2img", "img2img"];
const COMFY_TIMEOUT_MS = 120_000;

// ------------------------------------------------------------
// Safety (launch rules)
// ------------------------------------------------------------
function validateSafety(prompt?: string, negative?: string) {
  const text = `${prompt || ""} ${negative || ""}`.toLowerCase();
  const banned = [
    "child",
    "minor",
    "teen",
    "schoolgirl",
    "schoolboy",
    "underage",
    "young girl",
    "young boy",
    "celebrity",
    "famous",
    "public figure",
    "politician",
    "deepfake",
    "face swap",
    "faceswap",
    "look like",
    "make her look like",
    "make him look like",
  ];
  for (const p of banned) {
    if (text.includes(p)) throw new Error("Prompt violates safety rules.");
  }
}

// ------------------------------------------------------------
// Deterministic seed (only when seed not provided)
// ------------------------------------------------------------
function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function deterministicSeedFromRequest(r: GenerationRequest): number {
  const p = r.params;
  const seedMaterial = [
    p.prompt || "",
    p.negative_prompt || "",
    p.body_mode || "",
    p.user_lora || "",
    String(p.width ?? ""),
    String(p.height ?? ""),
    String(p.steps ?? ""),
    String(p.cfg ?? ""),
  ].join("|");

  return fnv1a32(seedMaterial) % 1_000_000_000;
}

// ------------------------------------------------------------
// Consistent error responses
// ------------------------------------------------------------
function errJson(
  error: string,
  status: number,
  detail?: string,
  extra?: Record<string, any>
) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...(detail ? { detail } : {}),
      ...(extra || {}),
    },
    { status }
  );
}

// ------------------------------------------------------------
// Debug: extract any .safetensors strings from workflow JSON
// ------------------------------------------------------------
function extractSafetensorsPaths(obj: any): string[] {
  const out = new Set<string>();

  const walk = (v: any) => {
    if (v == null) return;
    if (typeof v === "string") {
      if (v.toLowerCase().includes(".safetensors")) out.add(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (typeof v === "object") {
      for (const k of Object.keys(v)) walk(v[k]);
    }
  };

  walk(obj);
  return Array.from(out);
}

// ------------------------------------------------------------
// POST /api/generate
// ------------------------------------------------------------
export async function POST(req: Request) {
  const requestId =
    (globalThis.crypto?.randomUUID?.() as string | undefined) ||
    `req_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

  try {
    // ENV sanity
    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !COMFY_ENDPOINT
    ) {
      return errJson("server_not_configured", 500, undefined, { requestId });
    }

    // Require JSON
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return errJson("expected_json", 400, undefined, { requestId });
    }

    // AUTH
    const cookieStore = await cookies();
    const token = cookieStore.get("sb-access-token")?.value;
    if (!token) {
      return errJson("not_authenticated", 401, undefined, { requestId });
    }

    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const {
      data: { user },
      error: userErr,
    } = await auth.auth.getUser(token);

    if (userErr || !user) {
      return errJson("not_authenticated", 401, undefined, { requestId });
    }

    // SUBSCRIPTION
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: sub, error: subErr } = await supabase
      .from("user_subscriptions")
      .select("status, tier")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    if (subErr) {
      return errJson("subscription_lookup_failed", 500, subErr.message, {
        requestId,
      });
    }

    if (!sub) {
      return errJson("subscription_required", 402, undefined, { requestId });
    }

    // CONTRACT
    const json = await req.json().catch(() => null);
    if (!json) {
      return errJson("invalid_json", 400, undefined, { requestId });
    }

    let request: GenerationRequest;
    try {
      request = parseGenerationRequest(json);
    } catch (e: any) {
      return errJson("invalid_contract", 400, e?.message || "invalid_request", {
        requestId,
      });
    }

    // Phase 1 IMAGE gate
    if (!IMAGE_MODES.includes(request.mode)) {
      return errJson(
        "unsupported_mode",
        400,
        "Phase 1 supports IMAGE modes only (txt2img, img2img).",
        { requestId, mode: request.mode }
      );
    }

    validateSafety(request.params.prompt, request.params.negative_prompt);

    // RESOLVE MODEL STACK (UNCHANGED)
    const loraStack = resolveLoraStack(
      request.params.body_mode,
      request.params.user_lora
    );

    // BUILD WORKFLOW (UNCHANGED)
    const seed =
      typeof request.params.seed === "number"
        ? request.params.seed
        : deterministicSeedFromRequest(request);

    const workflow = buildWorkflow({
      prompt: request.params.prompt,
      negative: request.params.negative_prompt || "",
      seed,
      steps: request.params.steps,
      cfg: request.params.cfg,
      width: request.params.width,
      height: request.params.height,
      loraStack,
      dnaImageNames: [],
      fluxLock: null,
    });

    // DEBUG PROOF (SAFE)
    const workflowSafetensors = extractSafetensorsPaths(workflow);

    // COMFY EXECUTION (IMAGE ONLY)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMFY_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(COMFY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow, stream: false }),
        signal: controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timer);
      const msg =
        e?.name === "AbortError"
          ? "ComfyUI request timed out."
          : e?.message || "ComfyUI request failed.";
      return errJson("comfyui_unreachable", 502, msg, { requestId });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return errJson("comfyui_failed", 502, detail || undefined, {
        requestId,
        comfy_status: res.status,
        debug: {
          resolved: {
            body_mode: request.params.body_mode,
            user_lora: request.params.user_lora ?? null,
            loraStack,
          },
          workflowSafetensors,
        },
      });
    }

    const raw = await res.text().catch(() => "");
    let result: any = null;
    try {
      result = raw ? JSON.parse(raw) : null;
    } catch {
      return errJson("comfyui_bad_response", 502, undefined, {
        requestId,
        snippet: raw.slice(0, 2000),
        debug: {
          resolved: {
            body_mode: request.params.body_mode,
            user_lora: request.params.user_lora ?? null,
            loraStack,
          },
          workflowSafetensors,
        },
      });
    }

    return NextResponse.json({
      success: true,
      requestId,
      mode: request.mode,
      seed,
      result,
      debug: {
        resolved: {
          body_mode: request.params.body_mode,
          user_lora: request.params.user_lora ?? null,
          loraStack,
        },
        workflowSafetensors,
      },
    });
  } catch (err: any) {
    const message = err?.message || "internal_error";
    const isClientish =
      message === "Prompt violates safety rules." ||
      message.toLowerCase().includes("safety");

    return errJson(
      isClientish ? "safety_violation" : "internal_error",
      isClientish ? 400 : 500,
      message,
      { requestId }
    );
  }
}
