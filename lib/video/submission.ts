import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { VideoRequest } from "./contract";
import { videoRequestFingerprint } from "./contract";
export async function submitVideoProject(input: { ownerId: string; request: VideoRequest; idempotencyKey: string; tier: "standard" | "og" }) {
  const { data, error } = await getSupabaseAdmin().rpc("submit_video_project_compute_jobs", { p_owner_id: input.ownerId, p_identity_id: input.request.identity_id, p_source_generation_asset_id: input.request.source_generation_asset_id, p_idempotency_key: input.idempotencyKey, p_request_fingerprint: videoRequestFingerprint(input.request), p_request_payload: input.request, p_priority_class: input.tier });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}
