import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isVideoSubmissionReady } from "@/lib/video/availability";
import { isVideoSourceUploadReady, promoteClaimedSource, signStagingUpload, validateSourceMetadata, VIDEO_SOURCE_UPLOAD_TTL_SECONDS } from "@/lib/video/sourceUpload";
import { UUID_RE } from "@/lib/video/contract";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ error: "VIDEO_SOURCE_UPLOAD_UNAVAILABLE" }, { status: 503, headers });

export async function POST(req: NextRequest) {
  const auth = await ensureActiveSubscription();
  if (!auth.ok || !auth.user) return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status, headers });
  if (!isVideoSubmissionReady() || !isVideoSourceUploadReady()) return unavailable();
  let mime: string, size: number;
  try { const body = await req.json(); if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "content_type,size_bytes") throw new Error(); mime = body.content_type; size = body.size_bytes; validateSourceMetadata(mime, size); }
  catch { return NextResponse.json({ error: "INVALID_VIDEO_SOURCE_UPLOAD" }, { status: 400, headers }); }
  try {
    const signed = await signStagingUpload({ ownerId: auth.user.id, mime, size });
    const { error } = await getSupabaseAdmin().rpc("create_video_source_upload", { p_upload_id: signed.uploadId, p_owner_id: auth.user.id, p_staging_bucket: signed.bucket, p_staging_key: signed.stagingKey, p_final_bucket: signed.bucket, p_final_key: signed.finalKey, p_expected_mime: mime, p_expected_size: size, p_expires_at: new Date(Date.now() + VIDEO_SOURCE_UPLOAD_TTL_SECONDS * 1000).toISOString() });
    if (error) return unavailable();
    return NextResponse.json({ upload_id: signed.uploadId, upload_url: signed.uploadUrl, content_type: mime, expires_in: VIDEO_SOURCE_UPLOAD_TTL_SECONDS }, { status: 201, headers });
  } catch { return unavailable(); }
}

export async function PATCH(req: NextRequest) {
  const auth = await ensureActiveSubscription();
  if (!auth.ok || !auth.user) return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status, headers });
  let id: string;
  try { const body = await req.json(); if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join(",") !== "upload_id") throw new Error(); id = String(body.upload_id).trim().toLowerCase(); if (!UUID_RE.test(id)) throw new Error(); }
  catch { return NextResponse.json({ error: "INVALID_VIDEO_SOURCE_UPLOAD" }, { status: 400, headers }); }
  const admin = getSupabaseAdmin(), claimToken = randomUUID();
  const claim = await admin.rpc("claim_video_source_upload_finalization", { p_upload_id: id, p_owner_id: auth.user.id, p_claim_token: claimToken });
  if (claim.error) return claim.error.message.includes("NOT_FOUND") || claim.error.message.includes("EXPIRED") ? NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers }) : unavailable();
  const row = Array.isArray(claim.data) ? claim.data[0] : claim.data;
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers });
  if (row.generation_asset_id) return NextResponse.json({ upload_id: id, generation_id: row.generation_id, generation_asset_id: row.generation_asset_id }, { headers });
  if (row.claimed !== true) return NextResponse.json({ error: "VIDEO_SOURCE_FINALIZATION_IN_PROGRESS" }, { status: 409, headers });
  try {
    const verified = await promoteClaimedSource({ stagingKey: row.staging_key, finalKey: row.final_key, mime: row.expected_mime_type, size: Number(row.expected_size_bytes) });
    const finalized = await admin.rpc("finalize_video_source_upload", { p_upload_id: id, p_owner_id: auth.user.id, p_claim_token: claimToken, p_mime_type: verified.mimeType, p_size_bytes: verified.sizeBytes, p_sha256: verified.sha256 });
    if (finalized.error) return unavailable();
    void verified.cleanup().catch(() => undefined);
    const result = Array.isArray(finalized.data) ? finalized.data[0] : finalized.data;
    return NextResponse.json({ upload_id: id, generation_id: result.generation_id, generation_asset_id: result.generation_asset_id }, { headers });
  } catch { return unavailable(); }
}
