// ------------------------------------------------------------
// /app/api/generate/route.ts
// FULL FILE — LAUNCH-SAFE JSON GENERATION (LoRA OPTIONAL)
// ------------------------------------------------------------

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";
import { BaseModelKey } from "@/lib/lora/lora-routing";
import { resolveLoraToLocalPath } from "@/lib/lora_cache";

export const dynamic = "force-dynamic";

// ENV
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const COMFY_ENDPOINT = process.env.RUNPOD_COMFY_WEBHOOK!;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function validateSafety(body: any) {
  const text = `${body?.prompt || ""} ${body?.negativePrompt || ""}`.toLowerCase();
  const banned = [
    "child","minor","teen","schoolgirl","schoolboy","underage",
    "celebrity","famous","public figure","politician",
    "deepfake","face swap","faceswap","look like"
  ];
  for (const p of banned) {
    if (text.includes(p)) throw new Error("Prompt violates safety rules.");
  }
}

function parseResolution(res?: string) {
  const m = res?.match(/^(\d{3,4})x(\d{3,4})$/);
  if (!m) return { width: 1024, height: 1024 };
  return {
    width: Math.max(256, Math.min(2048, +m[1])),
    height: Math.max(256, Math.min(2048, +m[2])),
  };
}

function normalizeLoraSelection(body: any): string | null {
  const sel = body?.loraSelection?.selected;
  if (!Array.isArray(sel)) return null;
  const cleaned = sel.filter((x) => typeof x === "string" && x.length);
  if (cleaned.length > 1) {
    throw new Error("Launch rule: only one LoRA allowed.");
  }
  if (body?.loraSelection?.createNew) {
    throw new Error("Train LoRAs first using the training flow.");
  }
  return cleaned[0] || null;
}

// ------------------------------------------------------------
// POST
// ------------------------------------------------------------
export async function POST(req: Request) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !COMFY_ENDPOINT) {
      return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    }

    // AUTH
    const cookieStore = await cookies();
    const token = cookieStore.get("sb-access-token")?.value;
    if (!token) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user } } = await auth.auth.getUser(token);
    if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

    // SUBSCRIPTION
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .in("status", ["active","trialing"])
      .maybeSingle();

    if (!sub) return NextResponse.json({ error: "subscription_required" }, { status: 402 });

    // BODY
    if (!req.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json({ error: "expected_json" }, { status: 400 });
    }

    const body = await req.json();
    if (!body?.prompt) return NextResponse.json({ error: "missing_prompt" }, { status: 400 });

    validateSafety(body);

    const { width, height } = parseResolution(body.resolution);
    const seed =
      typeof body.seed === "number" ? body.seed : Math.floor(Math.random() * 1e9);

    // ------------------------------------------------------------
    // LoRA resolution (OPTIONAL, SINGLE)
    // ------------------------------------------------------------
    const loraId = normalizeLoraSelection(body);
    let resolvedLoraPath: string | null = null;

    if (loraId) {
      const { data } = await supabase
        .from("user_loras")
        .select("id,status,artifact_storage_path,artifact_path")
        .eq("id", loraId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!data || data.status !== "completed") {
        return NextResponse.json({ error: "lora_not_ready" }, { status: 409 });
      }

      resolvedLoraPath = await resolveLoraToLocalPath({
        loraId: data.id,
        storagePath: data.artifact_storage_path || data.artifact_path,
      });
    }

    // ------------------------------------------------------------
    // Workflow
    // ------------------------------------------------------------
    const workflow = buildWorkflow({
      prompt: body.prompt,
      negative: body.negativePrompt || "",
      seed,
      steps: body.steps ?? 30,
      cfg: body.guidance ?? 7,
      width,
      height,
      baseModel: body.baseModel as BaseModelKey,
      loraPath: resolvedLoraPath, // ← THE ONLY NEW INPUT
      dnaImageNames: [],
      fluxLock: null,
    });

    const res = await fetch(COMFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, stream: false }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "comfyui_failed" }, { status: 500 });
    }

    const result = await res.json();
    return NextResponse.json({ success: true, seed, lora: resolvedLoraPath, result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "internal_error" }, { status: 400 });
  }
}
