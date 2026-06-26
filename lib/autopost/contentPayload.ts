import type { PlatformId } from "./types"

const X_TEXT_MAX_LENGTH = 280

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
