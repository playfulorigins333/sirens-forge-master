import "server-only"

export type CreatorPublishingMediaAccessMode = "preview" | "download"

export type CreatorPublishingSignedMediaUrl = {
  mediaAssetId: string
  signedUrl: string
  expiresIn: number
  mode: CreatorPublishingMediaAccessMode
}

export type CreatorPublishingMediaAccessErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_MODE"
  | "NOT_FOUND"
  | "STORAGE_KEY_MISSING"
  | "SIGNING_FAILED"

export type CreatorPublishingMediaAccessResult =
  | { ok: true; value: CreatorPublishingSignedMediaUrl }
  | { ok: false; status: 400 | 401 | 404 | 500; code: CreatorPublishingMediaAccessErrorCode }
