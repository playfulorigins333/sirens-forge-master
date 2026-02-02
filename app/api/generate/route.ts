// ------------------------------------------------------------
// /app/api/generate/route.ts
// FULL FILE — PRODUCTION, GATEWAY-CORRECT
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
export const runtime = "nodejs";

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// IMPORTANT:
// Base gateway URL (no trailing slash required)
const GATEWAY_BASE = process.env.RUNPOD_COMFY_WEBHOOK || "";

const IMAGE_MODES: GenerationRequest["mode"][] = ["txt2img", "img2img"];
const COMFY_TIMEOUT_MS = 120_000;

// ------------------------------------------------------------
// Cookie adapter
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
// OPTIONS /api/generate
// 🔒 MUST return NO BODY for 204
// ------------------------------------------------------------
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
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
      !GATEWAY_BASE
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

    const loraStack = await resolveLoraStack(
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

    // ---------------- GATEWAY FETCH ----------------
    const base = GATEWAY_BASE.replace(/\/$/, "");
    const targetUrl = `${base}/generate`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COMFY_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow, stream: false }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      return errJson("comfyui_failed", 502, await res.text(), { requestId });
    }

    return NextResponse.json({
      success: true,
      requestId,
      result: await res.json(),
    });
  } catch (e: any) {
    return errJson("internal_error", 500, e?.message || "fetch failed", {
      requestId,
    });
  }
}
