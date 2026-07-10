import type { CreatorPublishingMediaAccessMode, CreatorPublishingMediaAccessResult } from "./types"

export const CREATOR_PUBLISHING_MEDIA_SIGNED_URL_EXPIRES_IN_SECONDS = 300
export const CREATOR_PUBLISHING_MEDIA_DEFAULT_BUCKET = "creator-publishing-media"

export function getCreatorPublishingMediaBucket(env: Record<string, string | undefined> = process.env) {
  return env.CREATOR_PUBLISHING_MEDIA_BUCKET?.trim() || CREATOR_PUBLISHING_MEDIA_DEFAULT_BUCKET
}

export function parseCreatorPublishingMediaAccessMode(input: string | null | undefined): CreatorPublishingMediaAccessMode | null {
  if (input === "preview" || input === "download") return input
  return null
}

type MediaAssetRow = {
  id: string
  storage_key: string | null
  mime_type?: string | null
  creator_publishing_content_packages?: { id: string; creator_id: string; target_platform: string } | null
}

type SupabaseAdminLike = any

type AccessDeps = {
  supabaseAdmin: SupabaseAdminLike
  getAuthenticatedCreatorId: () => Promise<string | null>
  bucket?: string
}

function safeDownloadName(row: MediaAssetRow) {
  const keyName = (row.storage_key ?? "").split("/").filter(Boolean).pop() || `${row.id}`
  const safe = keyName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)
  return safe || `${row.id}`
}

async function createSignedUrl(admin: any, bucket: string, row: MediaAssetRow, mode: CreatorPublishingMediaAccessMode) {
  const storageKey = row.storage_key?.trim()
  if (!storageKey) return { data: null, error: { message: "missing storage key" } }
  const builder = admin.storage.from(bucket)
  if (mode === "download") {
    return builder.createSignedUrl(storageKey, CREATOR_PUBLISHING_MEDIA_SIGNED_URL_EXPIRES_IN_SECONDS, { download: safeDownloadName(row) })
  }
  return builder.createSignedUrl(storageKey, CREATOR_PUBLISHING_MEDIA_SIGNED_URL_EXPIRES_IN_SECONDS)
}

export async function createCreatorPublishingSignedMediaUrl(input: {
  mediaAssetId: string
  mode: CreatorPublishingMediaAccessMode
  authenticatedCreatorId?: string
}, deps: AccessDeps): Promise<CreatorPublishingMediaAccessResult> {
  const creatorId = input.authenticatedCreatorId ?? await deps.getAuthenticatedCreatorId()
  if (!creatorId) return { ok: false, status: 401, code: "UNAUTHENTICATED" }

  const admin = deps.supabaseAdmin
  const { data, error } = await (admin as any)
    .from("creator_publishing_media_assets")
    .select("id,storage_key,mime_type,creator_publishing_content_packages!inner(id,creator_id,target_platform)")
    .eq("id", input.mediaAssetId)
    .eq("creator_publishing_content_packages.creator_id", creatorId)
    .neq("creator_publishing_content_packages.target_platform", "fanvue")
    .maybeSingle()

  if (error) return { ok: false, status: 500, code: "SIGNING_FAILED" }
  const row = data as MediaAssetRow | null
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND" }
  if (!row.storage_key?.trim()) return { ok: false, status: 404, code: "STORAGE_KEY_MISSING" }

  const signed = await createSignedUrl(admin, deps.bucket ?? getCreatorPublishingMediaBucket(), row, input.mode)
  if (signed.error || !signed.data?.signedUrl) return { ok: false, status: 500, code: "SIGNING_FAILED" }

  return { ok: true, value: { mediaAssetId: row.id, signedUrl: signed.data.signedUrl, expiresIn: CREATOR_PUBLISHING_MEDIA_SIGNED_URL_EXPIRES_IN_SECONDS, mode: input.mode } }
}
