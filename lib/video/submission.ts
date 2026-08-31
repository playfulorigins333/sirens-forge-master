import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { VideoRequest } from "./contract";
import { videoRequestFingerprint } from "./contract";
export class VideoSubmissionError extends Error { constructor(public readonly code: "IDEMPOTENCY_CONFLICT" | "INVALID_VIDEO_REQUEST" | "VIDEO_SOURCE_INVALID" | "VIDEO_GENERATION_UNAVAILABLE") { super(code); } }
export async function submitVideoProject(input: { ownerId: string; request: VideoRequest; idempotencyKey: string; tier: "standard" | "og" }) {
  const { data, error } = await getSupabaseAdmin().rpc("submit_video_project_compute_jobs", { p_owner_id: input.ownerId, p_identity_id: input.request.identity_id, p_source_generation_asset_id: input.request.source_generation_asset_id, p_idempotency_key: input.idempotencyKey, p_request_fingerprint: videoRequestFingerprint(input.request), p_request_payload: input.request, p_priority_class: input.tier });
  if (error) {
    const message = error.message;
    if (message.includes("IDEMPOTENCY_CONFLICT")) throw new VideoSubmissionError("IDEMPOTENCY_CONFLICT");
    if (message.includes("VIDEO_SOURCE_INVALID")) throw new VideoSubmissionError("VIDEO_SOURCE_INVALID");
    if (/INVALID|_REQUIRED|_NOT_READY|_TIER_/.test(message)) throw new VideoSubmissionError("INVALID_VIDEO_REQUEST");
    throw new VideoSubmissionError("VIDEO_GENERATION_UNAVAILABLE");
  }
  return Array.isArray(data) ? data[0] : data;
}
