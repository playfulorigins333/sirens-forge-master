// ------------------------------------------------------------
// /app/api/generate/route.ts
// FULL FILE — LAUNCH-SAFE JSON GENERATION (BigLust base + body LoRA optional + ONE user LoRA optional)
// - Accepts application/json only
// - Enforces: at most 1 user LoRA at launch
// - Does NOT do DNA/multipart here (archived earlier)
// ------------------------------------------------------------

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";
import { BaseModelKey } from "@/lib/lora/lora-routing";

export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------
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
    // minors
    "child",
    "minor",
    "teen",
    "schoolgirl",
    "schoolboy",
    "underage",
    "young girl",
    "young boy",

    // impersonation/public figures
    "celebrity",
    "famous",
    "public figure",
    "politician",

    // deepfake / face swap / "look like X"
    "deepfake",
    "face swap",
    "faceswap",
    "look like",
    "make her look like",
    "make him look like",
  ];

  for (const p of banned) {
    if (text.includes(p)) throw new Error("Prompt violates safety rules.");
  }
}

function parseResolution(res?: string) {
  const m = res?.toLowerCase().match(/^(\d{3,4})x(\d{3,4})$/);
  if (!m) return { width: 1024, height: 1024 };
  return {
    width: Math.max(256, Math.min(2048, parseInt(m[1], 10))),
    height: Math.max(256, Math.min(2048, parseInt(m[2], 10))),
  };
}

// Launch rule: only ONE user LoRA max
function normalizeLoraSelection(body: any): string | null {
  const selected = body?.loraSelection?.selected;

  if (!Array.isArray(selected)) return null;

  const cleaned = selected.filter((x: any) => typeof x === "string" && x.length);

  if (cleaned.length > 1) {
    throw new Error("Launch rule: only one LoRA allowed.");
  }

  // If UI has "createNew" in selection block, we hard reject here.
  if (body?.loraSelection?.createNew) {
    throw new Error("Train LoRAs first using the training flow.");
  }

  return cleaned[0] || null;
}

function comfyLoraNameFromStoragePath(path: string) {
  // We symlinked: /workspace/ComfyUI/models/loras/sirensforge_cache -> /workspace/cache/loras
  // Comfy resolves lora_name relative to models/loras, so we want:
  // "sirensforge_cache/<filename>.safetensors"
  const filename = path.split("/").pop() || path;
  return `sirensforge_cache/${filename}`;
}

// ------------------------------------------------------------
// POST /api/generate
// ------------------------------------------------------------
export async function POST(req: Request) {
  try {
    // ENV check
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !COMFY_ENDPOINT) {
      return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    }

    // Require JSON
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return NextResponse.json({ error: "expected_json" }, { status: 400 });
    }

    // AUTH
    const cookieStore = await cookies();
    const token = cookieStore.get("sb-access-token")?.value;
    if (!token) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const {
      data: { user },
      error: userErr,
    } = await auth.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    // SUBSCRIPTION
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("status, tier")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    if (!sub) return NextResponse.json({ error: "subscription_required" }, { status: 402 });

    // BODY
    const body = await req.json();
    if (!body?.prompt) return NextResponse.json({ error: "missing_prompt" }, { status: 400 });

    validateSafety(body);

    const { width, height } = parseResolution(body.resolution);

    const seed =
      typeof body.seed === "number" ? body.seed : Math.floor(Math.random() * 1_000_000_000);

    const steps = typeof body.steps === "number" ? body.steps : 30;
    const cfg = typeof body.guidance === "number" ? body.guidance : 7;

    const baseModel: BaseModelKey = (body.baseModel || "feminine") as BaseModelKey;

    // Optional single user LoRA (must be "completed" and owned by user)
    const loraId = normalizeLoraSelection(body);

    let resolvedComfyLoraName: string | null = null;

    if (loraId) {
      const { data: loraRow } = await supabase
        .from("user_loras")
        .select("id,status,artifact_storage_path,artifact_path")
        .eq("id", loraId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!loraRow || loraRow.status !== "completed") {
        return NextResponse.json({ error: "lora_not_ready" }, { status: 409 });
      }

      const storagePath = (loraRow.artifact_storage_path || loraRow.artifact_path || "").trim();
      if (!storagePath) {
        return NextResponse.json({ error: "lora_missing_artifact_path" }, { status: 409 });
      }

      // This is what buildWorkflow expects as loraPath input
      // (it will format it as sirensforge_cache/<filename> internally OR you can pass full name)
      resolvedComfyLoraName = comfyLoraNameFromStoragePath(storagePath);
    }

    // WORKFLOW
    const workflow = buildWorkflow({
      prompt: body.prompt,
      negative: body.negativePrompt || "",
      seed,
      steps,
      cfg,
      width,
      height,
      baseModel,
      loraPath: resolvedComfyLoraName, // ✅ optional user lora (Comfy lora_name)
      dnaImageNames: [], // launch: no DNA here
      fluxLock: null,
    });

    // COMFY RUN
    const res = await fetch(COMFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, stream: false }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: "comfyui_failed", detail }, { status: 500 });
    }

    const result = await res.json();

    return NextResponse.json({
      success: true,
      seed,
      lora: resolvedComfyLoraName,
      result,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "internal_error" }, { status: 400 });
  }
}
