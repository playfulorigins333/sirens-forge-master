// app/api/generate/route.ts
import { NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep types local to this route so TS stays happy even if frontend changes later
type GenerationMode = "text_to_image" | "image_to_image" | "image_to_video" | "text_to_video";
type BaseModel = "feminine" | "masculine" | "mtf" | "ftm";
type ContentMode = "sfw" | "nsfw" | "ultra";
type StylePreset =
  | "photorealistic"
  | "cinematic"
  | "editorial"
  | "soft_glam"
  | "artistic"
  | "anime";
type QualityPreset = "fast" | "balanced" | "quality" | "ultra";
type ConsistencyPreset = "low" | "medium" | "high" | "perfect";
type FluxLockType = "face_only" | "body_only" | "face_and_body";
type FluxLockStrength = "subtle" | "balanced" | "strong";

interface DnaPackMeta {
  count: number;
  hasFiles: boolean;
}

interface FluxLockMeta {
  type: FluxLockType;
  strength: FluxLockStrength;
}

interface ImageInputMeta {
  kind: "upload" | "url";
  url?: string | null;
}

interface GenerationRequestPayload {
  mode: GenerationMode;
  prompt: string;
  negativePrompt?: string;

  baseModel: BaseModel;
  contentMode: ContentMode;
  stylePreset: StylePreset;

  qualityPreset: QualityPreset;
  consistencyPreset: ConsistencyPreset;

  resolution: string;
  guidance: number;
  steps: number;

  seed?: number | null;
  lockSeed?: boolean;
  batchSize?: number;

  dnaPack?: DnaPackMeta;
  fluxLock?: FluxLockMeta;
  imageInput?: ImageInputMeta | null;
}

// -----------------------------------------------------------------------------
// GET – simple health check + gate
// -----------------------------------------------------------------------------
export async function GET() {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    return NextResponse.json(
      {
        error: auth.error,
        message: auth.message,
      },
      { status: auth.status ?? 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "SirensForge /api/generate is live, subscription-gated, and ready for job creation.",
  });
}

// -----------------------------------------------------------------------------
// POST – create generation job (Phase 1 = mocked engine, real metadata)
// -----------------------------------------------------------------------------
export async function POST(req: Request) {
  // 1️⃣ Subscription gate
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    return NextResponse.json(
      {
        error: auth.error,
        message: auth.message,
      },
      { status: auth.status ?? 401 }
    );
  }

  // 2️⃣ Parse and validate body
  let body: GenerationRequestPayload;
  try {
    body = (await req.json()) as GenerationRequestPayload;
  } catch (err) {
    console.error("[/api/generate] JSON parse error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
      { status: 400 }
    );
  }

  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: "MISSING_PROMPT",
        message: "Prompt is required to start a generation.",
      },
      { status: 400 }
    );
  }

  const mode: GenerationMode = body.mode || "text_to_image";
  const supportedModes: GenerationMode[] = [
    "text_to_image",
    "image_to_image",
    "image_to_video",
    "text_to_video",
  ];

  if (!supportedModes.includes(mode)) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_MODE",
        message: `Unsupported generation mode: ${mode}`,
      },
      { status: 400 }
    );
  }

  // Normalize a few fields with sane defaults
  const batchSize = Math.max(1, Math.min(body.batchSize ?? 1, 4));
  const seed = body.lockSeed ? body.seed ?? null : null;

  // 3️⃣ Build the engine payload (this is what we'll send to RunPod/Comfy later)
  const enginePayload = {
    mode,
    prompt: body.prompt,
    negative_prompt: body.negativePrompt ?? "",
    base_model: body.baseModel ?? "feminine",
    content_mode: body.contentMode ?? "sfw",
    style_preset: body.stylePreset ?? "photorealistic",

    quality_preset: body.qualityPreset ?? "balanced",
    consistency_preset: body.consistencyPreset ?? "medium",

    resolution: body.resolution ?? "1024x1024",
    guidance: body.guidance ?? 7.5,
    steps: body.steps ?? 30,

    // Seed controls
    seed,
    lock_seed: !!body.lockSeed,
    batch_size: batchSize,

    // DNA / FLUX / image input
    dna_pack: {
      count: body.dnaPack?.count ?? 0,
      has_files: body.dnaPack?.hasFiles ?? false,
    },
    flux_lock: body.fluxLock
      ? {
          type: body.fluxLock.type,
          strength: body.fluxLock.strength,
        }
      : null,
    image_input: body.imageInput
      ? {
          kind: body.imageInput.kind,
          url: body.imageInput.url ?? null,
        }
      : null,
  };

  // 4️⃣ Phase 1 – MOCK ENGINE
  //
  // Later:
  //   const runpodRes = await fetch(RUNPOD_URL, { method: "POST", body: JSON.stringify(enginePayload), ... });
  //   const runpodJson = await runpodRes.json();
  //   const jobId = runpodJson.id;
  //
  // For now we generate a job_id on the server and let /api/status mock the rest.
  const jobId = makeJobId();

  // OPTIONAL (later): insert into `generations` table in Supabase.
  // We do NOT do it now to avoid breaking on missing server client.
  //
  // await supabaseAdmin.from("generations").insert({
  //   user_id: auth.userId,
  //   job_id: jobId,
  //   status: "QUEUED",
  //   mode,
  //   prompt: body.prompt,
  //   content_mode: body.contentMode,
  //   meta: enginePayload,
  // });

  // 5️⃣ Return standard job response
  return NextResponse.json(
    {
      ok: true,
      job_id: jobId,
      status: "QUEUED",
      queued_at: new Date().toISOString(),
      engine: "MOCK_PHASE1",
      meta: enginePayload,
    },
    { status: 202 }
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function makeJobId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sf_job_${ts}_${rand}`;
}
