import "server-only"
import crypto from "crypto"

export type FanvueAdapterResultKind =
  | "NOT_CONFIGURED"
  | "UNSUPPORTED"
  | "FAILED"
  | "SCHEDULED_CREATED"
  | "POSTED_READY_FOR_PROOF"

export type FanvuePostRequest = {
  method: "POST"
  path: "/posts"
  headers: {
    authorization: string
    "content-type": "application/json"
    "X-Fanvue-API-Version": string
  }
  body: {
    text: string
    publishAt?: string
    mediaUuids?: string[]
  }
}

export type FanvueProofCandidate = {
  platform: "fanvue"
  provider_post_uuid: string
  provider_publish_at: string | null
  provider_published_at: string | null
  content_hash: string
  api_version: string
  verification_needed: true
  result_kind: Extract<FanvueAdapterResultKind, "SCHEDULED_CREATED" | "POSTED_READY_FOR_PROOF">
}

export type FanvueAdapterFailure = {
  ok: false
  kind: Exclude<FanvueAdapterResultKind, "SCHEDULED_CREATED" | "POSTED_READY_FOR_PROOF">
  error_code: string
  error_message: string
}

export type FanvueAdapterPreparedResult =
  | {
      ok: true
      kind: "SCHEDULED_CREATED" | "POSTED_READY_FOR_PROOF"
      proof_candidate: FanvueProofCandidate
    }
  | FanvueAdapterFailure

export type FanvuePostRequestInput = {
  access_token: string
  api_version: string
  text?: unknown
  requested_publish_at?: unknown
  fanvue_media_uuids?: unknown
  source_asset_ids?: unknown
  source_asset_urls?: unknown
}

const FANVUE_TEXT_MAX_LENGTH = 5000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > 0 ? text : null
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

function normalizeDraftTimestamp(value: unknown) {
  const text = normalizeText(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function hashContent(input: { text: string; publishAt: string | null; mediaUuids: string[] }) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex")
}

export function isFanvueAdapterDispatchEnabled() {
  return process.env.FANVUE_RUN_DISPATCH_ENABLED === "true"
}

export function buildFanvueTextPostRequest(input: FanvuePostRequestInput):
  | { ok: true; request: FanvuePostRequest; content_hash: string }
  | FanvueAdapterFailure {
  if (!isFanvueAdapterDispatchEnabled()) {
    return failure("NOT_CONFIGURED", "FANVUE_RUN_DISPATCH_DISABLED", "Fanvue adapter dispatch is disabled.")
  }

  const accessToken = normalizeText(input.access_token)
  if (!accessToken) {
    return failure("NOT_CONFIGURED", "FANVUE_ACCESS_TOKEN_REQUIRED", "Fanvue adapter requires an in-memory access token.")
  }

  const apiVersion = normalizeText(input.api_version)
  if (!apiVersion) {
    return failure("NOT_CONFIGURED", "FANVUE_API_VERSION_REQUIRED", "Fanvue API version is required.")
  }

  const text = normalizeText(input.text)
  if (!text) {
    return failure("FAILED", "EMPTY_FANVUE_TEXT", "Fanvue text content is required.")
  }

  if (Array.from(text).length > FANVUE_TEXT_MAX_LENGTH) {
    return failure("FAILED", "FANVUE_TEXT_TOO_LONG", "Fanvue text content exceeds the local draft limit.")
  }

  const localAssetIds = stringArray(input.source_asset_ids)
  const localAssetUrls = stringArray(input.source_asset_urls)
  const mediaUuids = stringArray(input.fanvue_media_uuids)
  if ((localAssetIds.length > 0 || localAssetUrls.length > 0) && mediaUuids.length === 0) {
    return failure("UNSUPPORTED", "FANVUE_MEDIA_UPLOAD_DEFERRED", "Local media references cannot be used as Fanvue media UUIDs in FV-6.")
  }

  if (mediaUuids.some((uuid) => !UUID_RE.test(uuid))) {
    return failure("FAILED", "FANVUE_MEDIA_UUID_INVALID", "Fanvue media UUIDs must be official provider UUIDs.")
  }

  const publishAt = normalizeDraftTimestamp(input.requested_publish_at)
  const body: FanvuePostRequest["body"] = { text }
  if (publishAt) body.publishAt = publishAt
  if (mediaUuids.length > 0) body.mediaUuids = Array.from(new Set(mediaUuids))

  return {
    ok: true,
    request: {
      method: "POST",
      path: "/posts",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "X-Fanvue-API-Version": apiVersion,
      },
      body,
    },
    content_hash: hashContent({ text, publishAt, mediaUuids: body.mediaUuids ?? [] }),
  }
}

export function normalizeFanvueCreatePostResponse(input: {
  response_body: unknown
  content_hash: string
  api_version: string
}): FanvueAdapterPreparedResult {
  const body = input.response_body && typeof input.response_body === "object" && !Array.isArray(input.response_body)
    ? (input.response_body as Record<string, unknown>)
    : null
  const providerPostUuid = normalizeText(body?.uuid ?? body?.id)
  if (!providerPostUuid) {
    return failure("FAILED", "FANVUE_POST_UUID_MISSING", "Fanvue response did not include an official post UUID.")
  }

  const publishAt = normalizeDraftTimestamp(body?.publishAt)
  const publishedAt = normalizeDraftTimestamp(body?.publishedAt)
  const resultKind = publishAt && !publishedAt ? "SCHEDULED_CREATED" : "POSTED_READY_FOR_PROOF"

  return {
    ok: true,
    kind: resultKind,
    proof_candidate: {
      platform: "fanvue",
      provider_post_uuid: providerPostUuid,
      provider_publish_at: publishAt,
      provider_published_at: publishedAt,
      content_hash: input.content_hash,
      api_version: input.api_version,
      verification_needed: true,
      result_kind: resultKind,
    },
  }
}

function failure(kind: FanvueAdapterFailure["kind"], error_code: string, error_message: string): FanvueAdapterFailure {
  return { ok: false, kind, error_code, error_message }
}
