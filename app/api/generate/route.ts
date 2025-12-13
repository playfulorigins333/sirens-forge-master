// ------------------------------------------------------------
// /api/generate/route.ts
// FULL FILE — CONDITIONAL DNA + SAFETY GATE (LAUNCH SAFE)
// + FIX: cookies() is async in this Next.js version
// ------------------------------------------------------------

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";
import { BaseModelKey } from "@/lib/lora/lora-routing";

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const COMFY_ENDPOINT = process.env.RUNPOD_COMFY_WEBHOOK!;

export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
function promptImpliesIdentity(text: string): boolean {
  const phrases = [
    "same woman",
    "same man",
    "same person",
    "identical face",
    "same face",
    "consistent character",
    "same girl",
    "same model as before",
    "keep her face",
    "keep his face",
  ];
  return phrases.some((p) => text.includes(p));
}

function validateSafety(body: any) {
  const text = `${body.prompt || ""} ${body.negativePrompt || ""}`.toLowerCase();

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
    "deepfake",
    "face swap",
    "look like",
  ];

  for (const phrase of banned) {
    if (text.includes(phrase)) {
      throw new Error("Prompt violates safety rules.");
    }
  }
}

function validateDNAIfRequired(body: any) {
  const dna = body?.dnaPack;
  const hasRefs = dna?.hasFiles === true;
  const refCount = typeof dna?.count === "number" ? dna.count : 0;

  const fluxLockEnabled = Boolean(body?.fluxLock?.type);
  const identityRequested = promptImpliesIdentity(
    `${body?.prompt || ""}`.toLowerCase()
  );

  // Only require DNA when identity locking is requested (not for generic txt2img/txt2vid)
  const dnaRequired = fluxLockEnabled || identityRequested;

  if (!dnaRequired) return;

  if (!hasRefs || refCount < 5 || refCount > 8) {
    throw new Error(
      "Identity locking requires 5–8 adult reference photos (DNA Lock)."
    );
  }
}

// ------------------------------------------------------------
// POST /api/generate
// ------------------------------------------------------------
export async function POST(req: Request) {
  try {
    // ------------------------------------------------------------
    // ENV CHECK
    // ------------------------------------------------------------
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !COMFY_ENDPOINT) {
      return NextResponse.json(
        { error: "server_not_configured" },
        { status: 500 }
      );
    }

    // ------------------------------------------------------------
    // AUTH (cookies() is async in this Next.js version)
    // ------------------------------------------------------------
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("sb-access-token")?.value || null;

    if (!accessToken) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userErr || !user) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    // ------------------------------------------------------------
    // SUBSCRIPTION CHECK
    // ------------------------------------------------------------
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: subscription } = await supabase
      .from("user_subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    if (!subscription) {
      return NextResponse.json(
        { error: "subscription_required" },
        { status: 402 }
      );
    }

    // ------------------------------------------------------------
    // BODY
    // ------------------------------------------------------------
    const body = await req.json();

    if (!body?.prompt) {
      return NextResponse.json({ error: "missing_prompt" }, { status: 400 });
    }

    // ------------------------------------------------------------
    // SAFETY + DNA GATES
    // ------------------------------------------------------------
    validateSafety(body);
    validateDNAIfRequired(body);

    // ------------------------------------------------------------
    // PARAMS (match frontend contract)
    // ------------------------------------------------------------
    const prompt: string = body.prompt;
    const negativePrompt: string = body.negativePrompt || "";
    const baseModel: BaseModelKey = (body.baseModel || "feminine") as BaseModelKey;
    const steps: number = typeof body.steps === "number" ? body.steps : 30;
    const guidance: number = typeof body.guidance === "number" ? body.guidance : 7;

    // Seed behavior: if UI sends seed=null when lockSeed is false, generate one.
    const finalSeed =
      typeof body.seed === "number"
        ? body.seed
        : Math.floor(Math.random() * 1_000_000_000);

    // ------------------------------------------------------------
    // WORKFLOW
    // ------------------------------------------------------------
    const workflow = buildWorkflow({
      prompt,
      negative: negativePrompt,
      seed: finalSeed,
      steps,
      cfg: guidance,
      baseModel,
    });

    // ------------------------------------------------------------
    // COMFYUI
    // ------------------------------------------------------------
    const response = await fetch(COMFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, stream: false }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: "comfyui_failed", detail: text },
        { status: 500 }
      );
    }

    const result = await response.json();

    return NextResponse.json(
      { success: true, seed: finalSeed, result },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "internal_error" },
      { status: 400 }
    );
  }
}
