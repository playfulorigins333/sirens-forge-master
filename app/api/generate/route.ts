// app/api/generate/route.ts
// PRODUCTION — Defer heavy imports to prevent App Router 405 at module load

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import {
  parseGenerationRequest,
  type GenerationRequest,
} from "@/lib/generation/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const RUNPOD_BASE = process.env.RUNPOD_COMFY_WEBHOOK || "";

const IMAGE_MODES: GenerationRequest["mode"][] = ["txt2img", "img2img"];

// ------------------------------------------------------------
// OPTIONS
// ------------------------------------------------------------
export async function OPTIONS() {
  return new Response(null, {
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
export async function POST(req: NextRequest) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    // ---------- ENV GUARD ----------
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { success: false, error: "env_missing", requestId },
        { status: 500 }
      );
    }

    if (!RUNPOD_BASE) {
      return NextResponse.json(
        {
          success: false,
          error: "env_missing",
          detail: "RUNPOD_COMFY_WEBHOOK not set",
          requestId,
        },
        { status: 500 }
      );
    }

    // ---------- BODY ----------
    let raw: any;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "invalid_json", requestId },
        { status: 400 }
      );
    }

    let request: GenerationRequest;
    try {
      request = parseGenerationRequest(raw);
    } catch (e: any) {
      return NextResponse.json(
        {
          success: false,
          error: "invalid_request",
          detail: e?.message,
          requestId,
        },
        { status: 400 }
      );
    }

    if (!IMAGE_MODES.includes(request.mode)) {
      return NextResponse.json(
        { success: false, error: "unsupported_mode", requestId },
        { status: 400 }
      );
    }

    // ---------- AUTH ----------
    const store = await cookies();

    const supabaseAuth = createServerClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return store.getAll().map((c) => ({
              name: c.name,
              value: c.value,
            }));
          },
          setAll() {},
        },
      }
    );

    const {
      data: { user },
      error: authErr,
    } = await supabaseAuth.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json(
        { success: false, error: "not_authenticated", requestId },
        { status: 401 }
      );
    }

    // ---------- SUBSCRIPTION ----------
    const supabaseAdmin = createServerClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        cookies: {
          getAll() {
            return store.getAll().map((c) => ({
              name: c.name,
              value: c.value,
            }));
          },
          setAll() {},
        },
      }
    );

    const { data: sub } = await supabaseAdmin
      .from("user_subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    if (!sub) {
      return NextResponse.json(
        { success: false, error: "subscription_required", requestId },
        { status: 402 }
      );
    }

    // ---------- DEFERRED IMPORTS (CRITICAL) ----------
    const { resolveLoraStack } = await import(
      "@/lib/generation/lora-resolver"
    );
    const { buildWorkflow } = await import(
      "@/lib/comfy/buildWorkflow"
    );

    // ---------- WORKFLOW ----------
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

    // ---------- FASTAPI GATEWAY ----------
    const targetUrl = `${RUNPOD_BASE.replace(/\/$/, "")}/gateway/generate`;

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow }),
    });

    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload?.job_id) {
      return NextResponse.json(
        {
          success: false,
          error: "gateway_failed",
          upstream: payload,
          requestId,
        },
        { status: 502 }
      );
    }

    // ✅ SUCCESS
    return NextResponse.json({
      success: true,
      job_id: payload.job_id,
      requestId,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: "internal_error",
        detail: err?.message,
        requestId,
      },
      { status: 500 }
    );
  }
}
