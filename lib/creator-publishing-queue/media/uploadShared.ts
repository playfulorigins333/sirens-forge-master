export const CREATOR_PUBLISHING_MEDIA_UPLOAD_EXPIRES_IN_SECONDS = 7200
export const CREATOR_PUBLISHING_MEDIA_MAX_UPLOAD_BYTES = 52_428_800
export const CREATOR_PUBLISHING_ALLOWED_UPLOAD_SOURCES = ["camera_upload", "edited"] as const
export type CreatorPublishingUploadSource = (typeof CREATOR_PUBLISHING_ALLOWED_UPLOAD_SOURCES)[number]

export const CREATOR_PUBLISHING_MEDIA_EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
}

export type CreatorPublishingUploadErrorCode =
  | "UNAUTHENTICATED" | "INVALID_REQUEST" | "INVALID_MIME_TYPE" | "INVALID_FILE_SIZE" | "INVALID_SHA256" | "INVALID_SOURCE" | "NOT_FOUND" | "PACKAGE_LOCKED" | "UPLOAD_INTENT_EXPIRED" | "UPLOAD_INTENT_FAILED" | "UPLOAD_NOT_FOUND" | "UPLOAD_METADATA_MISMATCH" | "UPLOAD_SIGNING_FAILED" | "ASSET_REGISTRATION_FAILED"

export type UploadIntentInput = { contentPackageId: string; mimeType: string; sizeBytes: number; sha256: string; source: string }
export type UploadIntentValue = { uploadIntentId: string; mediaAssetId: string; bucket: string; storageKey: string; token: string; expiresAt: string }
export type RegisteredMediaAsset = { id: string; contentPackageId: string; storageKey: string; mimeType: string; sha256: string; source: CreatorPublishingUploadSource; aiGenerationMetadata: Record<string, never>; createdAt?: string }
export type Result<T> = { ok: true; value: T } | { ok: false; status: 400|401|404|409|410|422|500; code: CreatorPublishingUploadErrorCode }

export function extensionForCreatorPublishingMime(mime: string) { return CREATOR_PUBLISHING_MEDIA_EXTENSION_BY_MIME[mime] ?? null }
