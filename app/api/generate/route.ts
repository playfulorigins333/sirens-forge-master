// STAGE 3 RE-ENABLE — guarded LoRA resolution
console.log("🔥 /api/generate route module loaded (stage 3 guarded)");

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import {
  parseGenerationRequest,
  type GenerationRequest,
} from "@/lib/generation/contract";
import { resolveLoraStack } from "@/lib/generation/lora-resolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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
// POST /api/generate — STAGE 3 (GUARDED)
// ------------------------------------------------------------
export async function POST(req: Request) {
  console.log("🟢 POST /api/generate STAGE 3 (guarded) invoked");

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // ---- Auth ----
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
    return NextResponse.json(
      { success: false, error: "not_authenticated", requestId },
      { status: 401 }
    );
  }

  // ---- Subscription ----
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
    return NextResponse.json(
      { success: false, error: "subscription_required", requestId },
      { status: 402 }
    );
  }

  // ---- Request parsing ----
  const raw = await req.json();
  const parsed: GenerationRequest = parseGenerationRequest(raw);

  // ---- LoRA resolution (GUARDED) ----
  let loraStack: unknown;
  try {
    loraStack = await resolveLoraStack(
      parsed.params.body_mode,
      parsed.params.user_lora
    );
  } catch (err: any) {
    console.error("❌ resolveLoraStack failed", err);

    return NextResponse.json(
      {
        success: false,
        stage: 3,
        error: "resolve_lora_stack_failed",
        message: err?.message || String(err),
        requestId,
      },
      { status: 500 }
    );
  }

  // ---- TEMP SUCCESS ----
  return NextResponse.json({
    success: true,
    stage: 3,
    message: "LoRA resolution succeeded",
    requestId,
    hasLoraStack: Boolean(loraStack),
  });
}
