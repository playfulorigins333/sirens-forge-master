// ------------------------------------------------------------
// /app/api/generate/route.ts
// FULL FILE — MULTI-IMAGE DNA BLENDING @ LAUNCH (3–8 refs)
// - Accepts multipart/form-data
// - payload(JSON) + dna(files[])
// - Uploads DNA refs to ComfyUI /upload/image
// - Builds workflow with DNA batch → FaceID/IPAdapter conditioning
// - Keeps safety gates (no minors, no celebs, no deepfakes)
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

// OPTIONAL but recommended (if your webhook is not same-origin as ComfyUI)
const COMFY_BASE_URL = process.env.RUNPOD_COMFY_BASE_URL || ""; // e.g. http://127.0.0.1:3000 or https://xxxx.runpod.net
const COMFY_UPLOAD_URL = process.env.RUNPOD_COMFY_UPLOAD_URL || ""; // e.g. https://xxxx.runpod.net/upload/image

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
    "dna lock",
    "face lock",
    "identity lock",
  ];
  return phrases.some((p) => text.includes(p));
}

function validateSafety(body: any) {
  const text = `${body.prompt || ""} ${body.negativePrompt || ""}`.toLowerCase();

  // Hard bans — keep it simple and strict
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

    // impersonation / public figures
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

  for (const phrase of banned) {
    if (text.includes(phrase)) {
      throw new Error("Prompt violates safety rules.");
    }
  }
}

function validateDNAAtLaunch(body: any, dnaCount: number) {
  const promptLower = String(body?.prompt || "").toLowerCase();

  const fluxLockEnabled = Boolean(body?.fluxLock?.type);
  const identityRequested = promptImpliesIdentity(promptLower);

  // DNA becomes required if:
  // - user turned on FLUX lock controls OR
  // - prompt is explicitly asking for identity consistency OR
  // - user provided DNA files (we enforce correctness instead of silently ignoring)
  const dnaRequired = fluxLockEnabled || identityRequested || dnaCount > 0;

  if (!dnaRequired) return;

  // ✅ LAUNCH RULE: 3–8 images
  if (dnaCount < 3 || dnaCount > 8) {
    throw new Error("DNA Lock requires 3–8 adult reference photos.");
  }
}

function parseResolution(res: string | undefined) {
  const fallback = { width: 1024, height: 1024 };
  if (!res) return fallback;
  const m = res.toLowerCase().match(/^(\d{3,4})x(\d{3,4})$/);
  if (!m) return fallback;
  const width = Math.max(256, Math.min(2048, parseInt(m[1], 10)));
  const height = Math.max(256, Math.min(2048, parseInt(m[2], 10)));
  return { width, height };
}

/**
 * Best-effort Comfy upload URL resolver:
 * 1) RUNPOD_COMFY_UPLOAD_URL (explicit) wins
 * 2) RUNPOD_COMFY_BASE_URL + /upload/image
 * 3) Derive origin from RUNPOD_COMFY_WEBHOOK and add /upload/image
 */
function resolveComfyUploadUrl(): string {
  if (COMFY_UPLOAD_URL) return COMFY_UPLOAD_URL;
  if (COMFY_BASE_URL) return COMFY_BASE_URL.replace(/\/$/, "") + "/upload/image";

  // Derive from webhook
  try {
    const u = new URL(COMFY_ENDPOINT);
    return `${u.origin}/upload/image`;
  } catch {
    return "";
  }
}

/**
 * Upload a single image file into ComfyUI input folder.
 * Returns the filename Comfy assigns, used by LoadImage node.
 */
async function uploadToComfy(file: File): Promise<string> {
  const uploadUrl = resolveComfyUploadUrl();
  if (!uploadUrl) {
    throw new Error(
      "Comfy upload URL not configured. Set RUNPOD_COMFY_BASE_URL or RUNPOD_COMFY_UPLOAD_URL."
    );
  }

  const fd = new FormData();
  fd.append("image", file, file.name);
  // These fields are accepted by many ComfyUI builds; harmless if ignored
  fd.append("type", "input");
  fd.append("overwrite", "true");

  const res = await fetch(uploadUrl, { method: "POST", body: fd });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Comfy upload failed (${res.status}): ${txt}`);
  }

  // Common response: { name: "xxx.png", subfolder: "", type: "input" }
  const data: any = await res.json().catch(() => ({}));
  const name = data?.name || data?.filename || null;
  if (!name) {
    // Some builds return plain text
    const txt = JSON.stringify(data);
    throw new Error(`Comfy upload returned no filename: ${txt}`);
  }
  return name;
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
      return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    }

    // ------------------------------------------------------------
    // AUTH (cookies() is async in your Next.js version)
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
      .select("status, tier")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    if (!subscription) {
      return NextResponse.json({ error: "subscription_required" }, { status: 402 });
    }

    // ------------------------------------------------------------
    // MULTIPART PARSE: payload + dna files
    // ------------------------------------------------------------
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "expected_multipart_formdata", hint: "Send payload JSON + dna[] files." },
        { status: 400 }
      );
    }

    const fd = await req.formData();

    const payloadRaw = fd.get("payload");
    if (!payloadRaw || typeof payloadRaw !== "string") {
      return NextResponse.json(
        { error: "missing_payload", hint: "FormData must include payload(JSON string)." },
        { status: 400 }
      );
    }

    let body: any;
    try {
      body = JSON.parse(payloadRaw);
    } catch {
      return NextResponse.json({ error: "invalid_payload_json" }, { status: 400 });
    }

    const dnaFiles = fd.getAll("dna").filter((x) => x instanceof File) as File[];
    const dnaCount = dnaFiles.length;

    if (!body?.prompt) {
      return NextResponse.json({ error: "missing_prompt" }, { status: 400 });
    }

    // ------------------------------------------------------------
    // SAFETY + DNA GATES (LAUNCH RULES)
    // ------------------------------------------------------------
    validateSafety(body);
    validateDNAAtLaunch(body, dnaCount);

    // ------------------------------------------------------------
    // PARAMS (match frontend contract)
    // ------------------------------------------------------------
    const prompt: string = body.prompt;
    const negativePrompt: string = body.negativePrompt || "";
    const baseModel: BaseModelKey = (body.baseModel || "feminine") as BaseModelKey;

    const steps: number = typeof body.steps === "number" ? body.steps : 30;
    const guidance: number = typeof body.guidance === "number" ? body.guidance : 7;

    const { width, height } = parseResolution(body.resolution);

    const finalSeed =
      typeof body.seed === "number" ? body.seed : Math.floor(Math.random() * 1_000_000_000);

    // ------------------------------------------------------------
    // UPLOAD DNA FILES TO COMFY (input folder)
    // ------------------------------------------------------------
    let comfyDnaImageNames: string[] = [];
    if (dnaCount > 0) {
      // hard clamp to 8 just in case
      const files = dnaFiles.slice(0, 8);
      comfyDnaImageNames = await Promise.all(files.map(uploadToComfy));
    }

    // ------------------------------------------------------------
    // WORKFLOW (inject DNA batch → FaceID/IPAdapter)
    // ------------------------------------------------------------
    const workflow = buildWorkflow({
      prompt,
      negative: negativePrompt,
      seed: finalSeed,
      steps,
      cfg: guidance,
      width,
      height,
      baseModel,
      dnaImageNames: comfyDnaImageNames, // 0 or 3–8
      fluxLock: body?.fluxLock || null,  // passed through for future tuning
    });

    // ------------------------------------------------------------
    // COMFYUI RUN
    // ------------------------------------------------------------
    const response = await fetch(COMFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, stream: false }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: "comfyui_failed", detail: text }, { status: 500 });
    }

    const result = await response.json();

    return NextResponse.json(
      {
        success: true,
        seed: finalSeed,
        dna_refs_used: comfyDnaImageNames.length,
        result,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "internal_error" }, { status: 400 });
  }
}
