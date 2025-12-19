// lib/generation/contract.ts
import { z } from "zod";

/**
 * SirensForge Generation Contract (LOCKED)
 * - BigLust base is always the underlying checkpoint (pod-side).
 * - Exactly ONE body LoRA may be applied at a time (body_*).
 * - Exactly ONE user LoRA may be applied at a time (optional).
 * - Same user LoRA identifier is used for BOTH image + video (path resolved server-side from cache).
 * - Backend enforces tier caps for video params.
 */

/** Tiers used for routing + caps (do NOT rename without updating auth/subscription logic) */
export const TierSchema = z.enum(["token", "subscriber", "og"]);
export type Tier = z.infer<typeof TierSchema>;

/** Supported generation modes (Phase 1: contract only; Phase 2: routing) */
export const GenModeSchema = z.enum(["txt2img", "img2img", "txt2vid", "img2vid"]);
export type GenMode = z.infer<typeof GenModeSchema>;

/** Body LoRA selector (one of 4; optional = no body modifier) */
export const BodyModeSchema = z.enum(["none", "body_feminine", "body_masculine", "body_mtf", "body_ftm"]);
export type BodyMode = z.infer<typeof BodyModeSchema>;

export const UserLoraSchema = z
  .object({
    /** Server will resolve this to: /workspace/cache/loras/<id>.safetensors (or similar mapping) */
    id: z.string().min(1),
    /** 0.0–1.2 typical. Backend may clamp later, but contract validates sane bounds. */
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
    body_mode: BodyModeSchema.default("none"),

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
    /**
     * Must be a URL your backend can fetch (Supabase Storage signed URL, etc.)
     * Do NOT accept raw file upload in this contract object.
     */
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

/** Full request payload */
export const GenerationRequestSchema = z
  .object({
    /**
     * IMPORTANT:
     * Tier is included so the generation pod can enforce caps and route models
     * without any UI dependency or client guessing.
     */
    tier: TierSchema,

    mode: GenModeSchema,

    params: BaseGenParamsSchema,

    /** Required when mode uses an init image */
    init_image: InitImageSchema.optional(),

    /** Required when mode is a video mode */
    video: VideoParamsSchema.optional(),
  })
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

    // Tier-based caps for video modes (LOCKED)
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
  })
  .strict();

export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

/** Minimal response contract (pod will expand later with job ids, artifacts, etc.) */
export const GenerationResponseSchema = z
  .object({
    ok: z.boolean(),
    /** e.g., "queued", "running", "complete", "failed" */
    status: z.enum(["queued", "running", "complete", "failed"]),
    /** present when queued/running */
    job_id: z.string().optional(),
    /** present when complete */
    output: z
      .object({
        /** image/video artifact URL (signed) */
        url: z.string().url(),
        /** "image" | "video" */
        kind: z.enum(["image", "video"]),
      })
      .optional(),
    /** present when failed */
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
 * LOCKED VIDEO CAPS (Backend Enforces)
 * Token Users → SDXL I2V (5–10 sec), default 24 fps, motion 0.45
 * Subscribers → Flux Cinematic (10–15 sec), default 30 fps, motion 0.65
 * OG Founders → Sora 1.0 (20–25 sec), default 30 fps, motion 0.8
 */
export function getTierVideoCaps(tier: Tier) {
  if (tier === "token") {
    return {
      minDuration: 5,
      maxDuration: 10,
      minFps: 12,
      maxFps: 24,
      minMotion: 0.2,
      maxMotion: 0.6,
      defaultFps: 24,
      defaultMotion: 0.45,
    };
  }

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
  return GenerationRequestSchema.parse(input);
}
