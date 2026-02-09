// lib/generation/contract.ts
import { z } from "zod";

/**
 * SirensForge Generation Contract (LOCKED)
 *
 * Reality check (current production):
 * - App is subscription-gated: if user has no active sub, they don't use the app.
 * - Frontend sends a "flat" payload to /api/generate (Next.js route),
 *   and the server builds the Comfy workflow.
 *
 * This contract remains useful for:
 * - Normalizing inputs
 * - Keeping launch rules (1 body LoRA + optional 1 identity LoRA)
 * - Providing a single internal shape even if callers send legacy payloads
 */

/**
 * Internal tiers used for routing/caps.
 * Since you're subscription-only right now, we default to "subscriber".
 * (OG remains distinct.)
 */
export const TierSchema = z.enum(["subscriber", "og"]).default("subscriber");
export type Tier = z.infer<typeof TierSchema>;

/** Supported generation modes */
export const GenModeSchema = z
  .enum(["txt2img", "img2img", "txt2vid", "img2vid"])
  .default("txt2img");
export type GenMode = z.infer<typeof GenModeSchema>;

/** Body LoRA selector (launch: feminine/masculine; keep mtf/ftm for later without breaking) */
export const BodyModeSchema = z
  .enum(["none", "body_feminine", "body_masculine", "body_mtf", "body_ftm"])
  .default("none");
export type BodyMode = z.infer<typeof BodyModeSchema>;

export const UserLoraSchema = z
  .object({
    /** Server will resolve this id to a cached LoRA file path */
    id: z.string().min(1),
    /** 0.0–1.5 typical. Backend may clamp further. */
    strength: z.number().min(0).max(1.5).default(0.85),
  })
  .strict();

export type UserLora = z.infer<typeof UserLoraSchema>;

/** Shared knobs (image + video) */
export const BaseGenParamsSchema = z
  .object({
    prompt: z.string().min(1),
    negative_prompt: z.string().default(""),
    seed: z.number().int().min(0).optional(),
    steps: z.number().int().min(1).max(200).default(28),
    cfg: z.number().min(0).max(30).default(6.5),

    width: z.number().int().min(256).max(2048).default(1024),
    height: z.number().int().min(256).max(2048).default(1536),

    /** Body modifier (optional) */
    body_mode: BodyModeSchema,

    /**
     * Optional SINGLE user LoRA.
     * Launch rule: only one at a time — enforced by schema shape (no arrays).
     */
    user_lora: UserLoraSchema.optional(),
  })
  .strict();

export type BaseGenParams = z.infer<typeof BaseGenParamsSchema>;

/** Image inputs for img2img / img2vid */
export const InitImageSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export type InitImage = z.infer<typeof InitImageSchema>;

/** Video params (required for *vid modes*, tier-capped) */
export const VideoParamsSchema = z
  .object({
    /** seconds */
    duration: z.number().min(1).max(60),
    fps: z.number().int().min(1).max(60),
    /** 0.0–1.0 */
    motion_strength: z.number().min(0).max(1),
  })
  .strict();

export type VideoParams = z.infer<typeof VideoParamsSchema>;

/**
 * Legacy payload (old contract) shape:
 * {
 *   tier: "subscriber"|"og"
 *   mode: "txt2img"|...
 *   params: { prompt, negative_prompt, body_mode, ... user_lora? }
 *   init_image?
 *   video?
 * }
 */
const LegacyGenerationRequestSchema = z
  .object({
    tier: TierSchema,
    mode: GenModeSchema,
    params: BaseGenParamsSchema,
    init_image: InitImageSchema.optional(),
    video: VideoParamsSchema.optional(),
  })
  .strict();

/**
 * Flat payload (current UI → /api/generate) shape:
 * {
 *   prompt,
 *   negative_prompt,
 *   body_mode,
 *   width,height,steps,cfg,seed,
 *   identity_lora?   // (id string)
 *   // (optionally future: mode, init_image, video)
 * }
 */
const FlatPayloadSchema = z
  .object({
    prompt: z.string().min(1),
    negative_prompt: z.string().optional(),
    body_mode: z.string().optional(), // normalized via preprocess to BodyModeSchema
    width: z.number().optional(),
    height: z.number().optional(),
    steps: z.number().optional(),
    cfg: z.number().optional(),
    seed: z.number().optional(),
    identity_lora: z.string().optional(),
    // optional forward-compat
    mode: z.string().optional(),
    tier: z.string().optional(),
    init_image: InitImageSchema.optional(),
    video: VideoParamsSchema.optional(),
  })
  .passthrough();

/**
 * Full request payload (supports BOTH legacy and flat callers).
 * We preprocess flat inputs into the legacy/internal shape so the rest of the app
 * can rely on { tier, mode, params, ... }.
 *
 * IMPORTANT:
 * - `.strict()` is NOT available on the ZodPipe/ZodEffects returned by `z.preprocess(...)`.
 *   Strictness is enforced by the legacy schema we pipe into (LegacyGenerationRequestSchema).
 */
export const GenerationRequestSchema = z
  .preprocess((input) => {
    if (!input || typeof input !== "object") return input;

    const obj: any = input;

    // If caller already sent legacy shape, keep it.
    if (obj.params && typeof obj.params === "object") return obj;

    // Otherwise, attempt to normalize a flat payload.
    const rawMode = String(obj.mode ?? "txt2img");
    const modeMap: Record<string, GenMode> = {
      txt2img: "txt2img",
      img2img: "img2img",
      txt2vid: "txt2vid",
      img2vid: "img2vid",
      // UI labels
      text_to_image: "txt2img",
      image_to_image: "img2img",
      text_to_video: "txt2vid",
      image_to_video: "img2vid",
    };

    const mode: GenMode = modeMap[rawMode] ?? "txt2img";

    const tierRaw = String(obj.tier ?? "subscriber");
    const tier: Tier = tierRaw === "og" ? "og" : "subscriber";

    // identity_lora (flat) → user_lora (internal)
    const user_lora = obj.identity_lora
      ? { id: String(obj.identity_lora), strength: 0.85 }
      : undefined;

    const normalized = {
      tier,
      mode,
      params: {
        prompt: obj.prompt,
        negative_prompt: obj.negative_prompt ?? "",
        seed: obj.seed,
        steps: obj.steps,
        cfg: obj.cfg,
        width: obj.width,
        height: obj.height,
        body_mode: obj.body_mode ?? "none",
        user_lora,
      },
      init_image: obj.init_image,
      video: obj.video,
    };

    return normalized;
  }, LegacyGenerationRequestSchema)
  .superRefine((req, ctx) => {
    const isImgInit = req.mode === "img2img" || req.mode === "img2vid";
    const isVideo = req.mode === "txt2vid" || req.mode === "img2vid";

    if (isImgInit && !req.init_image) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["init_image"],
        message: `init_image is required for mode=${req.mode}`,
      });
    }

    if (!isImgInit && req.init_image) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["init_image"],
        message: `init_image must NOT be provided for mode=${req.mode}`,
      });
    }

    if (isVideo && !req.video) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["video"],
        message: `video is required for mode=${req.mode}`,
      });
    }

    if (!isVideo && req.video) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["video"],
        message: `video must NOT be provided for mode=${req.mode}`,
      });
    }

    // Launch rule guardrails
    if (req.params.user_lora && req.params.user_lora.id.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["params", "user_lora", "id"],
        message: "user_lora.id cannot be empty",
      });
    }

    // Tier-based caps for video modes (still supported; subscriber default)
    if (isVideo && req.video) {
      const caps = getTierVideoCaps(req.tier);

      if (req.video.duration < caps.minDuration || req.video.duration > caps.maxDuration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["video", "duration"],
          message: `duration must be ${caps.minDuration}-${caps.maxDuration} seconds for tier=${req.tier}`,
        });
      }

      if (req.video.fps < caps.minFps || req.video.fps > caps.maxFps) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["video", "fps"],
          message: `fps must be ${caps.minFps}-${caps.maxFps} for tier=${req.tier}`,
        });
      }

      if (req.video.motion_strength < caps.minMotion || req.video.motion_strength > caps.maxMotion) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["video", "motion_strength"],
          message: `motion_strength must be ${caps.minMotion}-${caps.maxMotion} for tier=${req.tier}`,
        });
      }
    }
  });

export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

/** Minimal response contract (pod will expand later with job ids, artifacts, etc.) */
export const GenerationResponseSchema = z
  .object({
    ok: z.boolean(),
    status: z.enum(["queued", "running", "complete", "failed"]),
    job_id: z.string().optional(),
    output: z
      .object({
        url: z.string().url(),
        kind: z.enum(["image", "video"]),
      })
      .optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .optional(),
  })
  .strict();

export type GenerationResponse = z.infer<typeof GenerationResponseSchema>;

/**
 * VIDEO CAPS (kept for forward-compat; subscriber default)
 */
export function getTierVideoCaps(tier: Tier) {
  if (tier === "subscriber") {
    return {
      minDuration: 10,
      maxDuration: 15,
      minFps: 24,
      maxFps: 30,
      minMotion: 0.4,
      maxMotion: 0.8,
      defaultFps: 30,
      defaultMotion: 0.65,
    };
  }

  // og
  return {
    minDuration: 20,
    maxDuration: 25,
    minFps: 24,
    maxFps: 30,
    minMotion: 0.6,
    maxMotion: 1.0,
    defaultFps: 30,
    defaultMotion: 0.8,
  };
}

/** Safe parser for API routes */
export function parseGenerationRequest(input: unknown): GenerationRequest {
  // If the caller sends the flat payload, GenerationRequestSchema will normalize it.
  return GenerationRequestSchema.parse(input);
}

/** Optional: helper for validating ONLY the flat payload (useful in UI/tests) */
export function parseFlatPayload(input: unknown) {
  return FlatPayloadSchema.parse(input);
}
