// app/api/generate_v2/route.ts
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
// POST /api/generate_v2
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    // ---------------- ENV ----------------
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "env_missing", requestId },
        { status: 500 }
      );
    }

    if (!RUNPOD_BASE) {
      return NextResponse.json(
        { error: "RUNPOD_COMFY_WEBHOOK missing", requestId },
        { status: 500 }
      );
    }

    // ---------------- BODY ----------------
    const raw = await req.json();
    const request = parseGenerationRequest(raw);

    if (!IMAGE_MODES.includes(request.mode)) {
      return NextResponse.json(
        { error: "unsupported_mode", requestId },
        { status: 400 }
      );
    }

    // ---------------- COOKIES ----------------
    const store = await cookies();

    // ---------------- AUTH ----------------
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
          setAll() {
            /* no-op */
          },
        },
      }
    );

    const {
      data: { user },
      error: authErr,
    } = await supabaseAuth.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json(
        { error: "not_authenticated", requestId },
        { status: 401 }
      );
    }

    // ---------------- SUBSCRIPTION ----------------
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
          setAll() {
            /* no-op */
          },
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
        { error: "subscription_required", requestId },
        { status: 402 }
      );
    }

    // ---------------- DEFERRED IMPORTS ----------------
    const { resolveLoraStack } = await import(
      "@/lib/generation/lora-resolver"
    );
    const { buildWorkflow } = await import(
      "@/lib/comfy/buildWorkflow"
    );

    // ---------------- WORKFLOW ----------------
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

    // ---------------- FASTAPI ----------------
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
          error: "gateway_failed",
          detail: payload,
          requestId,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { job_id: payload.job_id },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "internal_error",
        detail: err?.message,
        requestId,
      },
      { status: 500 }
    );
  }
}

// Explicitly block other methods
export async function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed" },
    { status: 405 }
  );
}
