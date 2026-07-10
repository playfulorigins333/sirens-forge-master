import { getCreatorPublishingMediaBucket } from "./core"
import { CREATOR_PUBLISHING_ALLOWED_UPLOAD_SOURCES, CREATOR_PUBLISHING_MEDIA_MAX_UPLOAD_BYTES, CREATOR_PUBLISHING_MEDIA_UPLOAD_EXPIRES_IN_SECONDS, extensionForCreatorPublishingMime, type CreatorPublishingUploadErrorCode, type RegisteredMediaAsset, type Result, type UploadIntentInput, type UploadIntentValue } from "./uploadShared"
export { CREATOR_PUBLISHING_ALLOWED_UPLOAD_SOURCES, CREATOR_PUBLISHING_MEDIA_EXTENSION_BY_MIME, CREATOR_PUBLISHING_MEDIA_MAX_UPLOAD_BYTES, CREATOR_PUBLISHING_MEDIA_UPLOAD_EXPIRES_IN_SECONDS, extensionForCreatorPublishingMime } from "./uploadShared"

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const shaRe = /^[0-9a-f]{64}$/
export function getCreatorPublishingMaxUploadBytes(env: Record<string, string | undefined> = process.env) { const n = Number(env.CREATOR_PUBLISHING_MEDIA_MAX_UPLOAD_BYTES); return Number.isFinite(n) && n > 0 ? Math.floor(n) : CREATOR_PUBLISHING_MEDIA_MAX_UPLOAD_BYTES }
export function validateCreatorPublishingUploadInput(input: any, max = getCreatorPublishingMaxUploadBytes()): { ok: true; value: UploadIntentInput; extension: string } | { ok: false; status: 400; code: CreatorPublishingUploadErrorCode } {
  if (!input || typeof input !== "object" || !uuidRe.test(String(input.contentPackageId ?? ""))) return { ok: false, status: 400, code: "INVALID_REQUEST" }
  const extension = extensionForCreatorPublishingMime(String(input.mimeType ?? "")); if (!extension) return { ok: false, status: 400, code: "INVALID_MIME_TYPE" }
  const sizeBytes = Number(input.sizeBytes); if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > max) return { ok: false, status: 400, code: "INVALID_FILE_SIZE" }
  const sha256 = String(input.sha256 ?? ""); if (!shaRe.test(sha256)) return { ok: false, status: 400, code: "INVALID_SHA256" }
  const source = String(input.source ?? ""); if (!(CREATOR_PUBLISHING_ALLOWED_UPLOAD_SOURCES as readonly string[]).includes(source)) return { ok: false, status: 400, code: "INVALID_SOURCE" }
  return { ok: true, value: { contentPackageId: input.contentPackageId, mimeType: input.mimeType, sizeBytes, sha256, source }, extension }
}
export function buildCreatorPublishingStorageKey(creatorId: string, packageId: string, mediaAssetId: string, extension: string) { return `${creatorId}/${packageId}/${mediaAssetId}.${extension}` }
function mapAsset(row: any): RegisteredMediaAsset { return { id: row.id, contentPackageId: row.content_package_id, storageKey: row.storage_key, mimeType: row.mime_type, sha256: row.sha256, source: row.source, aiGenerationMetadata: row.ai_generation_metadata ?? {}, createdAt: row.created_at } }
async function packageAllowed(admin: any, contentPackageId: string, creatorId: string) {
  const { data, error } = await admin.from("creator_publishing_content_packages").select("id,creator_id,target_platform,creator_approval_status").eq("id", contentPackageId).eq("creator_id", creatorId).neq("target_platform", "fanvue").maybeSingle()
  if (error) throw error; if (!data) return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const }
  if (data.target_platform === "fanvue" || data.creator_id !== creatorId) return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const }
  if (data.creator_approval_status === "approved") return { ok: false as const, status: 409 as const, code: "PACKAGE_LOCKED" as const }
  const tasks = await admin.from("creator_publishing_queue_tasks").select("id").eq("content_package_id", contentPackageId).neq("status", "archived").limit(1)
  if (tasks.error) throw tasks.error; if (tasks.data?.length) return { ok: false as const, status: 409 as const, code: "PACKAGE_LOCKED" as const }
  return { ok: true as const }
}
async function markIntentFailed(admin: any, intentId: string, code: string) { await admin.from("creator_publishing_media_upload_intents").update({ status: "failed", failed_at: new Date().toISOString(), failure_code: code }).eq("id", intentId).eq("status", "pending") }
export async function createCreatorPublishingMediaUploadIntent(input: any, deps: { supabaseAdmin: any; creatorId: string; crypto?: Pick<Crypto,"randomUUID">; now?: () => Date; bucket?: string; maxUploadBytes?: number }): Promise<Result<UploadIntentValue>> {
  const parsed = validateCreatorPublishingUploadInput(input, deps.maxUploadBytes); if (!parsed.ok) { const failure = parsed as Extract<typeof parsed, { ok: false }>; return { ok: false, status: failure.status, code: failure.code } }
  let uploadIntentId: string | null = null
  try { const allowed = await packageAllowed(deps.supabaseAdmin, parsed.value.contentPackageId, deps.creatorId); if (!allowed.ok) return { ok: false, status: allowed.status, code: allowed.code }
    const c = deps.crypto ?? crypto; uploadIntentId = c.randomUUID(); const mediaAssetId = c.randomUUID(); const storageKey = buildCreatorPublishingStorageKey(deps.creatorId, parsed.value.contentPackageId, mediaAssetId, parsed.extension); const expiresAt = new Date((deps.now?.() ?? new Date()).getTime() + CREATOR_PUBLISHING_MEDIA_UPLOAD_EXPIRES_IN_SECONDS * 1000).toISOString(); const bucket = deps.bucket ?? getCreatorPublishingMediaBucket()
    const ins = await deps.supabaseAdmin.from("creator_publishing_media_upload_intents").insert({ id: uploadIntentId, reserved_media_asset_id: mediaAssetId, creator_id: deps.creatorId, content_package_id: parsed.value.contentPackageId, bucket_name: bucket, storage_key: storageKey, mime_type: parsed.value.mimeType, expected_size_bytes: parsed.value.sizeBytes, expected_sha256: parsed.value.sha256, source: parsed.value.source, status: "pending", expires_at: expiresAt }).select("id").single(); if (ins.error) throw ins.error
    const signed = await deps.supabaseAdmin.storage.from(bucket).createSignedUploadUrl(storageKey, { upsert: false }); if (signed.error || !signed.data?.signedUrl || !signed.data?.token) { await markIntentFailed(deps.supabaseAdmin, uploadIntentId, "UPLOAD_SIGNING_FAILED"); return { ok: false, status: 500, code: "UPLOAD_SIGNING_FAILED" } }
    return { ok: true, value: { uploadIntentId, mediaAssetId, bucket, storageKey, token: signed.data.token, expiresAt } }
  } catch { if (uploadIntentId) await markIntentFailed(deps.supabaseAdmin, uploadIntentId, "UPLOAD_SIGNING_FAILED"); return { ok: false, status: 500, code: "UPLOAD_SIGNING_FAILED" } }
}
async function failIntent(admin: any, intentId: string, status: "failed"|"expired", code: string) { await admin.from("creator_publishing_media_upload_intents").update({ status, failed_at: new Date().toISOString(), failure_code: code }).eq("id", intentId).in("status", ["pending"]) }
export async function completeCreatorPublishingMediaUpload(input: { uploadIntentId: string }, deps: { supabaseAdmin: any; creatorId: string; now?: () => Date; maxUploadBytes?: number }): Promise<Result<RegisteredMediaAsset>> {
  if (!uuidRe.test(input.uploadIntentId)) return { ok: false, status: 400, code: "INVALID_REQUEST" }
  const max = deps.maxUploadBytes ?? getCreatorPublishingMaxUploadBytes()
  try { const res = await deps.supabaseAdmin.from("creator_publishing_media_upload_intents").select("*").eq("id", input.uploadIntentId).eq("creator_id", deps.creatorId).maybeSingle(); if (res.error) throw res.error; const intent = res.data; if (!intent) return { ok: false, status: 404, code: "NOT_FOUND" }
    const bucket = intent.bucket_name
    if (intent.status === "completed") { const existing = await deps.supabaseAdmin.from("creator_publishing_media_assets").select("*").eq("id", intent.reserved_media_asset_id).maybeSingle(); if (existing.error) throw existing.error; if (existing.data) return { ok: true, value: mapAsset(existing.data) } }
    if (intent.status === "failed") return { ok: false, status: 409, code: "UPLOAD_INTENT_FAILED" }; if (intent.status === "expired" || new Date(intent.expires_at).getTime() <= (deps.now?.() ?? new Date()).getTime()) { await failIntent(deps.supabaseAdmin, intent.id, "expired", "UPLOAD_INTENT_EXPIRED"); await deps.supabaseAdmin.storage.from(bucket).remove([intent.storage_key]); return { ok: false, status: 410, code: "UPLOAD_INTENT_EXPIRED" } }
    const info = await deps.supabaseAdmin.storage.from(bucket).info(intent.storage_key); if (info.error || !info.data) return { ok: false, status: 409, code: "UPLOAD_NOT_FOUND" }
    const size = Number((info.data as any).size ?? (info.data as any).metadata?.size); const contentType = String((info.data as any).contentType ?? (info.data as any).metadata?.mimetype ?? (info.data as any).metadata?.contentType ?? "")
    if (!Number.isFinite(size) || size <= 0 || size !== Number(intent.expected_size_bytes) || size > max || contentType !== intent.mime_type || !extensionForCreatorPublishingMime(contentType)) { await failIntent(deps.supabaseAdmin, intent.id, "failed", "UPLOAD_METADATA_MISMATCH"); await deps.supabaseAdmin.storage.from(bucket).remove([intent.storage_key]); return { ok: false, status: 422, code: "UPLOAD_METADATA_MISMATCH" } }
    const rpc = await deps.supabaseAdmin.rpc("creator_publishing_complete_media_upload", { p_upload_intent_id: intent.id, p_creator_id: deps.creatorId }); if (rpc.error) return { ok: false, status: 500, code: "ASSET_REGISTRATION_FAILED" }; if (rpc.data?.error?.code === "UPLOAD_INTENT_EXPIRED") return { ok: false, status: 410, code: "UPLOAD_INTENT_EXPIRED" }; if (!rpc.data?.media_asset) return { ok: false, status: 500, code: "ASSET_REGISTRATION_FAILED" }
    return { ok: true, value: mapAsset(rpc.data.media_asset) }
  } catch { return { ok: false, status: 500, code: "ASSET_REGISTRATION_FAILED" } }
}
