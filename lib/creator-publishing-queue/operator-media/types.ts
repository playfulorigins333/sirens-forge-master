export type OnlyFansOperatorMediaMode = "preview" | "download"
export type OnlyFansOperatorMediaKind = "image" | "video"
export type OnlyFansOperatorMediaSafeErrorCode = "sign_in_required" | "current_claim_required" | "media_unavailable" | "invalid_request" | "service_unavailable"
export type OnlyFansOperatorMediaRecord = { mediaAssetId: string; filename: string; mimeType: string; kind: OnlyFansOperatorMediaKind; createdAt: string; displayOrder: number }
export type OnlyFansOperatorMediaMetadataResult = { ok: true; media: OnlyFansOperatorMediaRecord[] } | { ok: false; code: OnlyFansOperatorMediaSafeErrorCode; message: string }
export type OnlyFansOperatorSignedMediaUrl = { mediaAssetId: string; signedUrl: string; expiresIn: number; mode: OnlyFansOperatorMediaMode; filename: string; mimeType: string; kind: OnlyFansOperatorMediaKind }
export type OnlyFansOperatorSignedMediaResult = { ok: true; value: OnlyFansOperatorSignedMediaUrl } | { ok: false; code: OnlyFansOperatorMediaSafeErrorCode; message: string }
