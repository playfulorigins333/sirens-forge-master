import crypto from "crypto"
import type { PlatformId } from "./types"

const X_TEXT_MAX_LENGTH = 280
const FANVUE_TEXT_MAX_LENGTH = 5000

const FANVUE_CONTENT_TYPES = new Set(["text", "media", "text_media"])
const FANVUE_AUDIENCE_RE = /^[A-Za-z0-9_-]{1,64}$/

type ContentPayloadInput = Record<string, unknown>

type CaptionDraft = {
  id?: unknown
  caption?: unknown
  hashtags?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    if (typeof value !== "string") return []
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > 0 ? text : null
}

function getCaptionDrafts(value: unknown): CaptionDraft[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is CaptionDraft => Boolean(asRecord(item)))
}

function getFirstCaptionDraft(input: ContentPayloadInput) {
  return getCaptionDrafts(input.caption_drafts)[0] ?? null
}

function getFirstCaptionString(input: ContentPayloadInput) {
  if (!Array.isArray(input.captions)) return null

  for (const caption of input.captions) {
    const normalizedCaption = normalizeText(caption)
    if (normalizedCaption) return normalizedCaption
  }

  return null
}

function getXText(input: ContentPayloadInput) {
  const explicitPayload = asRecord(input.content_payload)
  return (
    normalizeText(explicitPayload?.text) ??
    normalizeText(input.text) ??
    normalizeText(getFirstCaptionDraft(input)?.caption) ??
    getFirstCaptionString(input)
  )
}

function getAssetMetadata(input: ContentPayloadInput) {
  const assets = Array.isArray(input.assets) ? input.assets : []
  const assetIds: string[] = []
  const assetUrls: string[] = []

  for (const asset of assets) {
    const assetRecord = asRecord(asset)
    if (!assetRecord) continue

    const id = normalizeText(assetRecord.id) ?? normalizeText(assetRecord.generation_id)
    const url = normalizeText(assetRecord.url) ?? normalizeText(assetRecord.asset_url)

    if (id) assetIds.push(id)
    if (url) assetUrls.push(url)
  }

  return {
    asset_ids: Array.from(new Set(assetIds)),
    asset_urls: Array.from(new Set(assetUrls)),
  }
}

export function buildXTextContentPayload(input: ContentPayloadInput, now = new Date()) {
  const text = getXText(input)
  if (!text) {
    return { error: "EMPTY_X_TEXT" as const }
  }

  // MVP safety: use simple Unicode code-point length for now. X weighted character
  // counting must be implemented before expanding beyond text-only drafts.
  if (Array.from(text).length > X_TEXT_MAX_LENGTH) {
    return { error: "X_TEXT_TOO_LONG" as const }
  }

  const firstDraft = getFirstCaptionDraft(input)
  const source = normalizeText(input.source) ?? "autopost_builder"
  const explicitPayload = asRecord(input.content_payload)
  const { asset_ids, asset_urls } = getAssetMetadata(input)

  return {
    payload: {
      platform: "x" as PlatformId,
      content_type: "text",
      text,
      source,
      hashtags: normalizeStringArray(explicitPayload?.hashtags ?? firstDraft?.hashtags ?? input.hashtags),
      generation_ids: normalizeStringArray(input.generation_ids),
      caption_draft_id: normalizeText(explicitPayload?.caption_draft_id) ?? normalizeText(firstDraft?.id),
      asset_ids,
      asset_urls,
      media_posting_enabled: false,
      created_at: now.toISOString(),
    },
  }
}

function getFanvueText(input: ContentPayloadInput) {
  const explicitPayload = asRecord(input.content_payload)
  return (
    normalizeText(explicitPayload?.text) ??
    normalizeText(explicitPayload?.caption) ??
    normalizeText(input.text) ??
    normalizeText(input.caption) ??
    normalizeText(getFirstCaptionDraft(input)?.caption) ??
    getFirstCaptionString(input)
  )
}

function normalizeFanvueContentType(value: unknown, hasAssets: boolean) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (FANVUE_CONTENT_TYPES.has(normalized)) return normalized as "text" | "media" | "text_media"
  return hasAssets ? "text_media" : "text"
}

function normalizeFanvueAudience(value: unknown) {
  const normalized = normalizeText(value)
  if (!normalized || !FANVUE_AUDIENCE_RE.test(normalized)) return null
  return normalized
}

function normalizeDraftTimestamp(value: unknown) {
  const text = normalizeText(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function hashFanvueDraft(input: {
  text: string | null
  content_type: string
  asset_ids: string[]
  generation_ids: string[]
}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
}

export function buildFanvueDraftContentPayload(input: ContentPayloadInput, now = new Date()) {
  const explicitPayload = asRecord(input.content_payload)
  const text = getFanvueText(input)
  const { asset_ids, asset_urls } = getAssetMetadata(input)
  const contentType = normalizeFanvueContentType(explicitPayload?.content_type ?? input.content_type, asset_ids.length > 0 || asset_urls.length > 0)

  if ((contentType === "text" || contentType === "text_media") && !text) {
    return { error: "EMPTY_FANVUE_TEXT" as const }
  }

  if (text && Array.from(text).length > FANVUE_TEXT_MAX_LENGTH) {
    return { error: "FANVUE_TEXT_TOO_LONG" as const }
  }

  if (contentType === "media" && asset_ids.length === 0 && asset_urls.length === 0) {
    return { error: "FANVUE_MEDIA_REFERENCES_REQUIRED" as const }
  }

  const generation_ids = normalizeStringArray(input.generation_ids)
  const requestedPublishAt = normalizeDraftTimestamp(explicitPayload?.requested_publish_at ?? input.requested_publish_at)
  const audience = normalizeFanvueAudience(explicitPayload?.audience ?? input.audience)
  const source = normalizeText(input.source) ?? "autopost_builder"
  const firstDraft = getFirstCaptionDraft(input)

  return {
    payload: {
      platform: "fanvue" as PlatformId,
      content_type: contentType,
      text,
      source,
      caption_draft_id: normalizeText(explicitPayload?.caption_draft_id) ?? normalizeText(firstDraft?.id),
      source_generation_ids: generation_ids,
      source_asset_ids: asset_ids,
      source_asset_urls: asset_urls,
      requested_publish_at: requestedPublishAt,
      audience,
      media_upload_enabled: false,
      native_posting_enabled: false,
      dispatch_enabled: false,
      validation_status: "DRAFT_VALID_NON_RUNNABLE",
      unsupported_features: ["fanvue_native_posting", "fanvue_media_upload", "fanvue_scheduled_execution"],
      content_hash: hashFanvueDraft({
        text,
        content_type: contentType,
        asset_ids,
        generation_ids,
      }),
      created_at: now.toISOString(),
    },
  }
}


export type FanvueTextOnlyPayloadValidationResult =
  | {
      valid: true
      text: string
      audience: string
      requested_publish_at: string | null
      content_hash: string
    }
  | {
      valid: false
      error_code:
        | "CONTENT_PAYLOAD_INVALID"
        | "CONTENT_PLATFORM_MISMATCH"
        | "CONTENT_TYPE_UNSUPPORTED"
        | "EMPTY_FANVUE_TEXT"
        | "FANVUE_TEXT_TOO_LONG"
        | "FANVUE_AUDIENCE_REQUIRED"
        | "FANVUE_MEDIA_UPLOAD_DEFERRED"
        | "FANVUE_NATIVE_POSTING_FLAG_UNSAFE"
      safe_error_message: string
    }

export function validateFanvueTextOnlyContentPayload(contentPayload: unknown): FanvueTextOnlyPayloadValidationResult {
  const payload = asRecord(contentPayload)
  if (!payload) {
    return { valid: false, error_code: "CONTENT_PAYLOAD_INVALID", safe_error_message: "Fanvue content payload is invalid." }
  }

  if (payload.platform !== "fanvue") {
    return { valid: false, error_code: "CONTENT_PLATFORM_MISMATCH", safe_error_message: "Fanvue content payload platform must be fanvue." }
  }

  if (payload.content_type !== "text") {
    return { valid: false, error_code: "CONTENT_TYPE_UNSUPPORTED", safe_error_message: "Only text-only Fanvue payloads are allowed in this readiness gate." }
  }

  if (payload.native_posting_enabled === true || payload.dispatch_enabled === true || payload.media_upload_enabled === true) {
    return { valid: false, error_code: "FANVUE_NATIVE_POSTING_FLAG_UNSAFE", safe_error_message: "Fanvue native posting and media upload flags must remain disabled." }
  }

  const text = normalizeText(payload.text)
  if (!text) {
    return { valid: false, error_code: "EMPTY_FANVUE_TEXT", safe_error_message: "Fanvue text content is required." }
  }

  if (Array.from(text).length > FANVUE_TEXT_MAX_LENGTH) {
    return { valid: false, error_code: "FANVUE_TEXT_TOO_LONG", safe_error_message: "Fanvue text content exceeds the local limit." }
  }

  const audience = normalizeFanvueAudience(payload.audience)
  if (!audience) {
    return { valid: false, error_code: "FANVUE_AUDIENCE_REQUIRED", safe_error_message: "Fanvue text-only payload requires an explicit audience." }
  }

  const assetIds = normalizeStringArray(payload.source_asset_ids)
  const assetUrls = normalizeStringArray(payload.source_asset_urls)
  const mediaUuids = normalizeStringArray(payload.mediaUuids)
  if (assetIds.length > 0 || assetUrls.length > 0 || mediaUuids.length > 0) {
    return { valid: false, error_code: "FANVUE_MEDIA_UPLOAD_DEFERRED", safe_error_message: "Fanvue media upload remains deferred for text-only readiness." }
  }

  return {
    valid: true,
    text,
    audience,
    requested_publish_at: normalizeDraftTimestamp(payload.requested_publish_at),
    content_hash: typeof payload.content_hash === "string" && payload.content_hash.trim()
      ? payload.content_hash.trim()
      : hashFanvueDraft({ text, content_type: "text", asset_ids: [], generation_ids: normalizeStringArray(payload.source_generation_ids) }),
  }
}
