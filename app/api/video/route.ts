// ------------------------------------------------------------
// /app/api/generate/video/route.ts
// PHASE 2 — VIDEO POD (EXECUTION WIRED)
//
// Launch tiers ONLY:
// - subscriber → Flux Cinematic
// - og → Sora 1.0
//
// No token tier exists at launch.
// ------------------------------------------------------------

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

import {
  parseGenerationRequest,
  type GenerationRequest,
} from "@/lib/generation/contract";
import { resolveLoraStack } from "@/lib/generation/lora-resolver";

export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Video backends (wired at pod level)
const FLUX_VIDEO_ENDPOINT = process.env.RUNPOD_FLUX_VIDEO_WEBHOOK || "";
const SORA_VIDEO_ENDPOINT = process.env.RUNPOD_SORA_VIDEO_WEBHOOK || "";

// ------------------------------------------------------------
// Local video param shape (LAUNCH)
// ------------------------------------------------------------
type VideoParams = {
  duration?: number;
  fps?: number;
  motion_strength?: number;
};

// ------------------------------------------------------------
// Tier caps (LAUNCH-ONLY)
// ------------------------------------------------------------
function enforceVideoCaps(tier: string, params: VideoParams) {
  const duration = params.duration ?? 0;
  const fps = params.fps ?? 0;
  const motion = params.motion_strength ?? 0;

  if (tier === "subscriber") {
    if (duration > 15) throw new Error("duration_exceeds_tier_limit");
    if (fps > 30) throw new Error("fps_exceeds_tier_limit");
    if (motion > 0.65) throw new Error("motion_exceeds_tier_limit");
    return "flux";
  }

  if (tier === "og") {
    if (duration > 25) throw new Error("duration_exceeds_tier_limit");
    if (fps > 30) throw new Error("fps_exceeds_tier_limit");
    if (motion > 0.8) throw new Error("motion_exceeds_tier_limit");
    return "sora";
  }

  throw new Error("tier_not_supported_at_launch");
}

// ------------------------------------------------------------
// POST /api/generate/video
// ------------------------------------------------------------
export async function POST(req: Request) {
  try {
    // ENV sanity
    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        { error: "server_not_configured" },
        { status: 500 }
      );
    }

    // Require JSON
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return NextResponse.json({ error: "expected_json" }, { status: 400 });
    }

    // AUTH
    const cookieStore = await cookies();
    const token = cookieStore.get("sb-access-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const {
      data: { user },
      error: userErr,
    } = await auth.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    // SUBSCRIPTION
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("status, tier")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    if (!sub) {
      return NextResponse.json(
        { error: "subscription_required" },
        { status: 402 }
      );
    }

    // CONTRACT
    const json = await req.json();
    const request: GenerationRequest = parseGenerationRequest(json);

    // Narrow video params
    const videoParams: VideoParams = {
      duration: (json as any)?.duration,
      fps: (json as any)?.fps,
      motion_strength: (json as any)?.motion_strength,
    };

    // Enforce tier caps + choose backend
    const backend = enforceVideoCaps(sub.tier, videoParams);

    // ------------------------------------------------------------
    // ⭐⭐⭐ FIXED — USE NORMALIZED CONTRACT ⭐⭐⭐
    // identity_lora (flat payload) → params.user_lora.id
    // ------------------------------------------------------------
    const loraStack = await resolveLoraStack(
      request.params.body_mode,
      request.params.user_lora?.id ?? null
    );

    // ------------------------------------------------------------
    // EXECUTION ROUTING
    // ------------------------------------------------------------
    const endpoint =
      backend === "flux"
        ? FLUX_VIDEO_ENDPOINT
        : backend === "sora"
        ? SORA_VIDEO_ENDPOINT
        : "";

    if (!endpoint) {
      return NextResponse.json(
        { error: "video_backend_not_configured" },
        { status: 500 }
      );
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: backend,
        params: {
          ...request.params,
          ...videoParams,
        },
        loraStack,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "video_backend_failed", detail },
        { status: 500 }
      );
    }

    const result = await res.json();

    return NextResponse.json({
      success: true,
      mode: "video",
      backend,
      result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "internal_error" },
      { status: 400 }
    );
  }
}
