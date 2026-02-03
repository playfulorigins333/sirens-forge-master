// app/api/generate/route.ts
// STAGE 4 — FULL GENERATION PATH RESTORED (with cookie adapter fix)
console.log("🔥 /api/generate route module loaded (stage 4)");

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

// Base gateway URL (no trailing slash)
const GATEWAY_BASE = process.env.RUNPOD_COMFY_WEBHOOK || "";

const IMAGE_MODES: GenerationRequest["mode"][] = ["txt2img", "img2img"];
const COMFY_TIMEOUT_MS = 120_000;

// ------------------------------------------------------------
// Cookie adapter (supports both sync + async cookies() typing)
// ------------------------------------------------------------
async function getCookieAdapter() {
  // Next can type cookies() as ReadonlyRequestCookies OR Promise<ReadonlyRequestCookies>
  const maybeStore: any = cookies();
  const store: any =
    maybeStore && typeof maybeStore.then === "function"
      ? await maybeStore
      : maybeStore;

  return {
    get: (name: string) => store?.get?.(name)?.value,
    set: (name: string, value: string, options: any) => {
      // Some runtimes expose .set, some require store.set({ ... })
      try {
        store?.set?.({ name, value, ...options });
      } catch {
        // fallback (very defensive)
        store?.set?.(name, value, options);
      }
    },
    remove: (name: string, options: any) => {
      try {
        store?.set?.({ name, value: "", ...options });
      } catch {
        store?.set?.(name, "", options);
      }
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
// OPTIONS
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
// POST /api/generate — STAGE 4
// ------------------------------------------------------------
export async function POST(req: Request) {
  console.log("🟢 POST /api/generate STAGE 4 invoked");

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    // ---- Hard env guard (prevents Vercel /500 fallback) ----
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return errJson(
        "env_missing",
        500,
        "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
        { requestId }
      );
    }
    if (!GATEWAY_BASE) {
      return errJson(
        "env_missing",
        500,
        "Missing RUNPOD_COMFY_WEBHOOK",
        { requestId }
      );
    }

    // ---------------- AUTH ----------------
    const supabaseAuth = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: await getCookieAdapter(),
    });

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
    const raw = await req.json();
    const request = parseGenerationRequest(raw);

    if (!IMAGE_MODES.includes(request.mode)) {
      return errJson("unsupported_mode", 400, undefined, { requestId });
    }

    // ---------------- LORA RESOLUTION ----------------
    const loraStack = await resolveLoraStack(
      request.params.body_mode,
      request.params.user_lora
    );

    // ---------------- WORKFLOW BUILD ----------------
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

    // ---------------- GATEWAY ----------------
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

    const text = await res.text();

    if (!res.ok) {
      return errJson("comfyui_failed", 502, text, { requestId });
    }

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    return NextResponse.json({
      success: true,
      requestId,
      ...payload,
    });
  } catch (err: any) {
    console.error("❌ generate internal error", err);
    return errJson("internal_error", 500, err?.message || "unknown error", {
      requestId,
    });
  }
}
