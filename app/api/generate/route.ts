// ------------------------------------------------------------
// /app/api/generate/route.ts
// FULL FILE — PRODUCTION, CONTRACT-DRIVEN, DETERMINISTIC
// ------------------------------------------------------------

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import {
  parseGenerationRequest,
  type GenerationRequest,
} from "@/lib/generation/contract";
import { resolveLoraStack } from "@/lib/generation/lora-resolver";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";

export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const COMFY_ENDPOINT = process.env.RUNPOD_COMFY_WEBHOOK || "";

const IMAGE_MODES: GenerationRequest["mode"][] = ["txt2img", "img2img"];
const COMFY_TIMEOUT_MS = 120_000;

// ------------------------------------------------------------
// Cookie adapter (async, Next-safe)
// ------------------------------------------------------------
async function getCookieAdapter() {
  const store = await cookies();

  return {
    get: (name: string) => store.get(name)?.value,
    set: (name: string, value: string, options: any) => {
      store.set({ name, value, ...options });
    },
    remove: (name: string, options: any) => {
      store.set({ name, value: "", ...options });
    },
  };
}

// ------------------------------------------------------------
// Error helper
// ------------------------------------------------------------
function errJson(
  error: string,
  status: number,
  detail?: string,
  extra?: Record<string, any>
) {
  return NextResponse.json(
    { success: false, error, ...(detail ? { detail } : {}), ...(extra || {}) },
    { status }
  );
}

// ------------------------------------------------------------
// POST /api/generate
// ------------------------------------------------------------
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !COMFY_ENDPOINT
    ) {
      return errJson("server_not_configured", 500, undefined, { requestId });
    }

    if (!(req.headers.get("content-type") || "").includes("application/json")) {
      return errJson("expected_json", 400, undefined, { requestId });
    }

    // ---------------- AUTH ----------------
    const supabaseAuth = createServerClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { cookies: await getCookieAdapter() }
    );

    const {
      data: { user },
      error: authErr,
    } = await supabaseAuth.auth.getUser();

    if (authErr || !user) {
      return errJson("not_authenticated", 401, undefined, { requestId });
    }

    // ---------------- SUBSCRIPTION ----------------
    const supabaseAdmin = createServerClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { cookies: await getCookieAdapter() }
    );

    const { data: sub } = await supabaseAdmin
      .from("user_subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    if (!sub) {
      return errJson("subscription_required", 402, undefined, { requestId });
    }

    // ---------------- CONTRACT ----------------
    const json = await req.json();
    const request = parseGenerationRequest(json);

    if (!IMAGE_MODES.includes(request.mode)) {
      return errJson("unsupported_mode", 400, undefined, { requestId });
    }

    const loraStack = resolveLoraStack(
      request.params.body_mode,
      request.params.user_lora
    );

    const workflow = buildWorkflow({
      prompt: request.params.prompt,
      negative: request.params.negative_prompt || "",
      seed: request.params.seed ?? 0,
      steps: request.params.steps,
      cfg: request.params.cfg,
      width: request.params.width,
      height: request.params.height,
      loraStack,
      dnaImageNames: [],
      fluxLock: null,
    });

    const res = await fetch(COMFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, stream: false }),
    });

    if (!res.ok) {
      return errJson("comfyui_failed", 502, await res.text(), { requestId });
    }

    return NextResponse.json({
      success: true,
      requestId,
      result: await res.json(),
    });
  } catch (e: any) {
    return errJson("internal_error", 500, e.message, { requestId });
  }
}
