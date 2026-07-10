import "server-only"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { requireUserId } from "../../supabaseServer"
export { CREATOR_PUBLISHING_MEDIA_DEFAULT_BUCKET, CREATOR_PUBLISHING_MEDIA_SIGNED_URL_EXPIRES_IN_SECONDS, getCreatorPublishingMediaBucket, parseCreatorPublishingMediaAccessMode } from "./core"
import { createCreatorPublishingSignedMediaUrl as createCoreSignedUrl } from "./core"
import type { CreatorPublishingMediaAccessResult, CreatorPublishingMediaAccessMode } from "./types"

export async function createCreatorPublishingSignedMediaUrl(input: {
  mediaAssetId: string
  mode: CreatorPublishingMediaAccessMode
  authenticatedCreatorId?: string
}): Promise<CreatorPublishingMediaAccessResult> {
  const creatorId = input.authenticatedCreatorId ?? await requireUserId()
  if (!creatorId) return { ok: false, status: 401, code: "UNAUTHENTICATED" }
  return createCoreSignedUrl({ ...input, authenticatedCreatorId: creatorId }, { supabaseAdmin: getSupabaseAdmin(), getAuthenticatedCreatorId: async () => creatorId })
}
