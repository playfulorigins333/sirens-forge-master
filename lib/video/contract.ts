import { createHash } from "node:crypto";

export const VIDEO_TIERS = {
  standard: { min_duration_seconds: 10, max_duration_seconds: 15, min_motion_strength: 0.4, max_motion_strength: 0.8, default_motion_strength: 0.65, segment_count: 2 },
  og: { min_duration_seconds: 20, max_duration_seconds: 25, min_motion_strength: 0.6, max_motion_strength: 1, default_motion_strength: 0.8, segment_count: 3 },
} as const;
export const VIDEO_TARGET_FPS = 30;
export const VIDEO_TARGET_MIN_SHORT_EDGE = 1080;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VideoRequest = { mode: "text_to_video" | "image_to_video"; prompt: string; negative_prompt: string; body_type: "body_feminine" | "body_masculine" | "none"; identity_id: string | null; source_generation_asset_id: string | null; requested_duration_seconds: number; motion_strength: number };

function canonicalUuid(value: unknown, error: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(error);
  const canonical = value.trim().toLowerCase();
  if (!UUID_RE.test(canonical)) throw new Error(error);
  return canonical;
}

export function parseVideoRequest(value: unknown, tier: "standard" | "og"): VideoRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_VIDEO_REQUEST");
  const input = value as Record<string, unknown>;
  const allowed = ["mode","prompt","negative_prompt","body_type","identity_id","source_generation_asset_id","requested_duration_seconds","motion_strength"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error("INVALID_VIDEO_REQUEST");
  const request = input as VideoRequest;
  if (!(["text_to_video","image_to_video"] as unknown[]).includes(request.mode) || typeof request.prompt !== "string" || typeof request.negative_prompt !== "string" || !(["body_feminine","body_masculine","none"] as unknown[]).includes(request.body_type)) throw new Error("INVALID_VIDEO_REQUEST");
  if (request.prompt.length > 4000 || request.negative_prompt.length > 4000 || (request.mode === "text_to_video" && !request.prompt.trim())) throw new Error("INVALID_VIDEO_REQUEST");
  const identityId = canonicalUuid(request.identity_id, "INVALID_VIDEO_IDENTITY");
  const sourceAssetId = canonicalUuid(request.source_generation_asset_id, "INVALID_VIDEO_SOURCE");
  if ((request.mode === "text_to_video") !== (sourceAssetId === null)) throw new Error("INVALID_VIDEO_SOURCE");
  const cap = VIDEO_TIERS[tier];
  if (!Number.isInteger(request.requested_duration_seconds) || request.requested_duration_seconds < cap.min_duration_seconds || request.requested_duration_seconds > cap.max_duration_seconds) throw new Error("VIDEO_DURATION_TIER_INVALID");
  if (typeof request.motion_strength !== "number" || !Number.isFinite(request.motion_strength) || request.motion_strength < cap.min_motion_strength || request.motion_strength > cap.max_motion_strength) throw new Error("VIDEO_MOTION_TIER_INVALID");
  return { ...request, prompt: request.prompt.trim(), negative_prompt: request.negative_prompt.trim(), identity_id: identityId, source_generation_asset_id: sourceAssetId };
}

function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)])); return value; }
export const videoRequestFingerprint = (request: VideoRequest) => createHash("sha256").update(JSON.stringify(canonical(request))).digest("hex");
