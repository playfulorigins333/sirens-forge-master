import "server-only"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { requireUserId } from "../../supabaseServer"
export { CREATOR_PUBLISHING_MEDIA_DEFAULT_BUCKET, CREATOR_PUBLISHING_MEDIA_SIGNED_URL_EXPIRES_IN_SECONDS, getCreatorPublishingMediaBucket, parseCreatorPublishingMediaAccessMode } from "./core"
import { createCreatorPublishingSignedMediaUrl as createCoreSignedUrl } from "./core"
import type { CreatorPublishingMediaAccessResult, CreatorPublishingMediaAccessMode } from "./types"

function isUnauthenticatedError(error: unknown) {
  return error instanceof Error && error.message === "Unauthorized"
}

export async function createCreatorPublishingSignedMediaUrl(input: {
  mediaAssetId: string
  mode: CreatorPublishingMediaAccessMode
  authenticatedCreatorId?: string
}): Promise<CreatorPublishingMediaAccessResult> {
  let creatorId = input.authenticatedCreatorId
  if (!creatorId) {
    try {
      creatorId = await requireUserId()
    } catch (error) {
      if (isUnauthenticatedError(error)) return { ok: false, status: 401, code: "UNAUTHENTICATED" }
      return { ok: false, status: 500, code: "SIGNING_FAILED" }
    }
  }
  if (!creatorId) return { ok: false, status: 401, code: "UNAUTHENTICATED" }
  try {
    return await createCoreSignedUrl({ ...input, authenticatedCreatorId: creatorId }, { supabaseAdmin: getSupabaseAdmin(), getAuthenticatedCreatorId: async () => creatorId })
  } catch {
    return { ok: false, status: 500, code: "SIGNING_FAILED" }
  }
}
