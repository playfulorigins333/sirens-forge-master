// app/api/generate/route.ts
// PRODUCTION — Submit generation job via FastAPI gateway

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import {
  parseGenerationRequest,
  type GenerationRequest,
} from "@/lib/generation/contract";
import { resolveLoraStack } from "@/lib/generation/lora-resolver";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// IMPORTANT: this is the RunPod proxy base (port 3000)
const RUNPOD_BASE = process.env.RUNPOD_COMFY_WEBHOOK || "";

const IMAGE_MODES: GenerationRequest["mode"][] = ["txt2img", "img2img"];

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function json(
  status: number,
  body: Record<string, any>
): NextResponse {
  return NextResponse.json(body, { status });
}

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
  const requestId = crypto.randomUUID();

  try {
    // ---------- ENV GUARD ----------
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, {
        success: false,
        error: "env_missing",
        requestId,
      });
    }

    if (!RUNPOD_BASE) {
      return json(500, {
        success: false,
        error: "env_missing",
        detail: "RUNPOD_COMFY_WEBHOOK not set",
        requestId,
      });
    }

    // ---------- BODY ----------
    let raw: any;
    try {
      raw = await req.json();
    } catch {
      return json(400, {
        success: false,
        error: "invalid_json",
        requestId,
      });
    }

    let request: GenerationRequest;
    try {
      request = parseGenerationRequest(raw);
    } catch (e: any) {
      return json(400, {
        success: false,
        error: "invalid_request",
        detail: e?.message,
        requestId,
      });
    }

    if (!IMAGE_MODES.includes(request.mode)) {
      return json(400, {
        success: false,
        error: "unsupported_mode",
        requestId,
      });
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
      return json(401, {
        success: false,
        error: "not_authenticated",
        requestId,
      });
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
      return json(402, {
        success: false,
        error: "subscription_required",
        requestId,
      });
    }

    // ---------- BUILD WORKFLOW ----------
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

    let payload: any;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok || !payload?.job_id) {
      return json(502, {
        success: false,
        error: "gateway_failed",
        upstream: payload,
        requestId,
      });
    }

    // ✅ SUCCESS
    return json(200, {
      success: true,
      job_id: payload.job_id,
      requestId,
    });
  } catch (err: any) {
    return json(500, {
      success: false,
      error: "internal_error",
      detail: err?.message,
      requestId,
    });
  }
}
