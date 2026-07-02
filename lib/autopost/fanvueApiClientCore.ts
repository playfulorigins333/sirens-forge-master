import { buildFanvueProofCandidateFromReadback, validateFanvueLivePostProof, type FanvueProofValidationResult } from "./fanvueProof"

export type FanvueFetch = (url: string, init: { method: "GET" | "POST" | "PATCH"; headers: Record<string, string>; body?: string }) => Promise<FanvueFetchResponse>

export type FanvueFetchResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text?: () => Promise<string>
  headers?: { get: (name: string) => string | null }
}

export type FanvueApiClientConfig = {
  accessToken: string
  apiBaseUrl: string
  apiVersion: string
  fetch: FanvueFetch
}

export type FanvueCreateTextPostInput = {
  text: string
  audience: string
  publishAt?: string | null
}

export type FanvueCreateMediaPostInput = {
  text?: string | null
  audience: string
  mediaUuids: string[]
  mediaPreviewUuid?: string | null
  publishAt?: string | null
  expiresAt?: string | null
  collectionUuids?: string[] | null
}

export type FanvueReadPostInput = {
  uuid: string
  expectedText: string
  expectedAudience: string
  expectedContentHash?: string | null
  jobId?: string | null
  ruleId?: string | null
  userId?: string | null
  scheduledFor?: string | null
  expectedMediaUuids?: string[] | null
}

export type FanvueMediaStatus = "created" | "processing" | "ready" | "error"

export type FanvueUploadPart = {
  ETag: string
  PartNumber: number
}

export type FanvueCreateUploadSessionInput = {
  name: string
  filename: string
  mediaType: "image" | "video"
}

export type FanvueUploadSession = {
  mediaUuid: string
  uploadId: string
}

export type FanvueMediaReadback = {
  uuid: string
  status: FanvueMediaStatus
  mediaType: string | null
  name: string | null
}

export type FanvueSignedPartUploader = (input: { signedUrl: string; partNumber: number; body: unknown }) => Promise<{ ETag: string }>

export type NormalizedPost = {
  uuid: string
  text: string | null
  audience: string | null
  publishAt: string | null
  publishedAt: string | null
  createdAt: string | null
  mediaUuids: string[]
}

export type FanvueApiFailureKind = "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED" | "SERVER_ERROR" | "MALFORMED_JSON" | "FAILED"

export type FanvueApiFailure = {
  ok: false
  kind: FanvueApiFailureKind
  status: number | null
  error_code: string
  safe_error_message: string
  retry_after_ms?: number | null
}

export type FanvueCreatePostResult =
  | {
      ok: true
      result_kind: "SCHEDULED_CREATED"
      post: Pick<NormalizedPost, "uuid" | "publishAt" | "publishedAt">
      posted_proof: false
    }
  | FanvueApiFailure

export type FanvueUploadSessionResult = ({ ok: true } & FanvueUploadSession) | FanvueApiFailure
export type FanvueSignedUrlResult = { ok: true; signed_url: string; persisted: false } | FanvueApiFailure
export type FanvueCompleteUploadResult = { ok: true; status: FanvueMediaStatus } | FanvueApiFailure
export type FanvueReadMediaResult = { ok: true; media: FanvueMediaReadback; ready: boolean; terminal_failure: boolean } | FanvueApiFailure
export type FanvueUploadPartResult = { ok: true; part: FanvueUploadPart; proof: false } | FanvueApiFailure
export type FanvueMediaReadyResult =
  | { ok: true; media: FanvueMediaReadback; attempts: number; proof: "MEDIA_READY_READBACK" }
  | (FanvueApiFailure & { attempts?: number; retryable?: boolean })

export type FanvueReadPostResult =
  | {
      ok: true
      result_kind: "POSTED_READY_FOR_PROOF" | "SCHEDULED_CREATED"
      post: NormalizedPost
      proof_candidate: ReturnType<typeof buildFanvueProofCandidateFromReadback> | null
      proof_validation: FanvueProofValidationResult
    }
  | FanvueApiFailure

function clean(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function isoOrNull(value: unknown) {
  const text = clean(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function failure(kind: FanvueApiFailureKind, status: number | null, error_code: string, safe_error_message: string): FanvueApiFailure {
  return { ok: false, kind, status, error_code, safe_error_message }
}

function isFanvueApiFailure(value: unknown): value is FanvueApiFailure {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<FanvueApiFailure>
  return record.ok === false && typeof record.error_code === "string" && typeof record.safe_error_message === "string"
}

function retryAfterMs(response: FanvueFetchResponse, maxDelayMs: number) {
  const raw = response.headers?.get("Retry-After")
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxDelayMs)
  const date = Date.parse(raw)
  if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), maxDelayMs)
  return null
}

function withRetryAfter(result: FanvueApiFailure, response: FanvueFetchResponse, maxDelayMs = 30_000): FanvueApiFailure {
  return response.status === 429 ? { ...result, retry_after_ms: retryAfterMs(response, maxDelayMs) } : result
}

function classifyStatus(status: number): FanvueApiFailure {
  if (status === 401) return failure("UNAUTHORIZED", status, "FANVUE_UNAUTHORIZED", "Fanvue rejected the request authorization.")
  if (status === 403) return failure("FORBIDDEN", status, "FANVUE_FORBIDDEN", "Fanvue refused the request permissions.")
  if (status === 429) return failure("RATE_LIMITED", status, "FANVUE_RATE_LIMITED", "Fanvue rate limited the request.")
  if (status >= 500) return failure("SERVER_ERROR", status, "FANVUE_SERVER_ERROR", "Fanvue returned a server error.")
  return failure("FAILED", status, "FANVUE_REQUEST_FAILED", "Fanvue request failed.")
}

async function safeJson(response: FanvueFetchResponse) {
  try {
    return { ok: true as const, data: await response.json() }
  } catch {
    return { ok: false as const, error: failure("MALFORMED_JSON", response.status, "FANVUE_MALFORMED_JSON", "Fanvue returned malformed JSON.") }
  }
}

function requireConfig(config: FanvueApiClientConfig): FanvueApiFailure | null {
  if (!clean(config.accessToken)) return failure("FAILED", null, "FANVUE_ACCESS_TOKEN_REQUIRED", "Fanvue access token is required in memory.")
  if (!clean(config.apiBaseUrl)) return failure("FAILED", null, "FANVUE_API_BASE_URL_REQUIRED", "Fanvue API base URL is required.")
  if (!clean(config.apiVersion)) return failure("FAILED", null, "FANVUE_API_VERSION_REQUIRED", "Fanvue API version is required.")
  if (typeof config.fetch !== "function") return failure("FAILED", null, "FANVUE_FETCH_REQUIRED", "Fanvue fetch implementation is required.")
  return null
}

function headers(config: FanvueApiClientConfig) {
  return {
    authorization: `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
    "X-Fanvue-API-Version": config.apiVersion,
  }
}

function endpoint(config: FanvueApiClientConfig, path: string) {
  return `${config.apiBaseUrl.replace(/\/+$/, "")}${path}`
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

function normalizePost(data: unknown): NormalizedPost | null {
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  const uuid = clean(record.uuid)
  if (!uuid) return null
  const mediaUuids = stringArray(record.mediaUuids)
  return {
    uuid,
    text: clean(record.text),
    audience: clean(record.audience),
    publishAt: isoOrNull(record.publishAt),
    publishedAt: isoOrNull(record.publishedAt),
    createdAt: isoOrNull(record.createdAt),
    mediaUuids,
  }
}


function normalizeMedia(data: unknown): FanvueMediaReadback | null {
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  const uuid = clean(record.uuid)
  const status = clean(record.status)
  if (!uuid || !isUuid(uuid)) return null
  if (status !== "created" && status !== "processing" && status !== "ready" && status !== "error") return null
  return {
    uuid,
    status,
    mediaType: clean(record.mediaType),
    name: clean(record.name),
  }
}

function requireUuid(value: unknown, code: string, message: string): string | FanvueApiFailure {
  const uuid = clean(value)
  if (!uuid || !isUuid(uuid)) return failure("FAILED", null, code, message)
  return uuid
}

function parseUploadSession(data: unknown): FanvueUploadSession | null {
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  const mediaUuid = clean(record.mediaUuid)
  const uploadId = clean(record.uploadId)
  if (!mediaUuid || !isUuid(mediaUuid) || !uploadId) return null
  return { mediaUuid, uploadId }
}

function parseSignedUrlValue(value: unknown): string | null {
  const signedUrl = clean(value)
  if (!signedUrl) return null
  try {
    const url = new URL(signedUrl)
    return url.protocol === "https:" || url.protocol === "http:" ? signedUrl : null
  } catch {
    return null
  }
}

async function requestSignedUrl(config: FanvueApiClientConfig, path: string) {
  const configError = requireConfig(config)
  if (configError) return { ok: false as const, failure: configError }
  let response: FanvueFetchResponse
  try {
    response = await config.fetch(endpoint(config, path), { method: "GET", headers: headers(config) })
  } catch {
    return { ok: false as const, failure: failure("FAILED", null, "FANVUE_NETWORK_FAILED", "Fanvue request failed.") }
  }
  if (!response.ok) return { ok: false as const, failure: withRetryAfter(classifyStatus(response.status), response), response }

  if (typeof response.text === "function") {
    try {
      const signedUrl = parseSignedUrlValue(await response.text())
      if (!signedUrl) return { ok: false as const, failure: failure("MALFORMED_JSON", response.status, "FANVUE_SIGNED_URL_MISSING", "Fanvue signed upload URL response was empty or unsupported."), response }
      return { ok: true as const, signedUrl, response }
    } catch {
      return { ok: false as const, failure: failure("MALFORMED_JSON", response.status, "FANVUE_SIGNED_URL_MISSING", "Fanvue signed upload URL response was empty or unsupported."), response }
    }
  }

  const parsed = await safeJson(response)
  if (!parsed.ok) return { ok: false as const, failure: parsed.error, response }
  const signedUrl = parseSignedUrlValue(parsed.data)
  if (!signedUrl) return { ok: false as const, failure: failure("MALFORMED_JSON", response.status, "FANVUE_SIGNED_URL_MISSING", "Fanvue signed upload URL response was empty or unsupported."), response }
  return { ok: true as const, signedUrl, response }
}

async function requestJson(config: FanvueApiClientConfig, method: "GET" | "POST" | "PATCH", path: string, body?: Record<string, unknown>) {
  const configError = requireConfig(config)
  if (configError) return { ok: false as const, failure: configError }
  let response: FanvueFetchResponse
  try {
    response = await config.fetch(endpoint(config, path), { method, headers: headers(config), ...(body ? { body: JSON.stringify(body) } : {}) })
  } catch {
    return { ok: false as const, failure: failure("FAILED", null, "FANVUE_NETWORK_FAILED", "Fanvue request failed.") }
  }
  if (!response.ok) return { ok: false as const, failure: withRetryAfter(classifyStatus(response.status), response), response }
  const parsed = await safeJson(response)
  if (!parsed.ok) return { ok: false as const, failure: parsed.error, response }
  return { ok: true as const, data: parsed.data, response }
}

export async function createFanvueUploadSession(config: FanvueApiClientConfig, input: FanvueCreateUploadSessionInput): Promise<FanvueUploadSessionResult> {
  const name = clean(input.name)
  const filename = clean(input.filename)
  if (!name) return failure("FAILED", null, "FANVUE_UPLOAD_NAME_REQUIRED", "Fanvue upload name is required.")
  if (!filename) return failure("FAILED", null, "FANVUE_UPLOAD_FILENAME_REQUIRED", "Fanvue upload filename is required.")
  if (input.mediaType !== "image" && input.mediaType !== "video") return failure("FAILED", null, "FANVUE_UPLOAD_MEDIA_TYPE_UNSUPPORTED", "Fanvue mocked scaffold only accepts image or video media types.")
  const requested = await requestJson(config, "POST", "/media/uploads", { name, filename, mediaType: input.mediaType })
  if (!requested.ok) return requested.failure
  const session = parseUploadSession(requested.data)
  if (!session) return failure("MALFORMED_JSON", requested.response.status, "FANVUE_UPLOAD_SESSION_MALFORMED", "Fanvue upload session response was missing mediaUuid or uploadId.")
  return { ok: true, ...session }
}

export async function getFanvueUploadPartUrl(config: FanvueApiClientConfig, input: { uploadId: string; partNumber: number }): Promise<FanvueSignedUrlResult> {
  const uploadId = clean(input.uploadId)
  if (!uploadId) return failure("FAILED", null, "FANVUE_UPLOAD_ID_REQUIRED", "Fanvue uploadId is required.")
  if (!Number.isInteger(input.partNumber) || input.partNumber < 1) return failure("FAILED", null, "FANVUE_UPLOAD_PART_NUMBER_INVALID", "Fanvue upload part number must be a positive integer.")
  const requested = await requestSignedUrl(config, `/media/uploads/${encodeURIComponent(uploadId)}/parts/${input.partNumber}/url`)
  if (!requested.ok) return requested.failure
  return { ok: true, signed_url: requested.signedUrl, persisted: false }
}

export async function uploadFanvueSignedPart(input: { signedUrl: string; partNumber: number; body: unknown; uploader: FanvueSignedPartUploader }): Promise<FanvueUploadPartResult> {
  const signedUrl = clean(input.signedUrl)
  if (!signedUrl) return failure("FAILED", null, "FANVUE_SIGNED_URL_REQUIRED", "Signed upload URL is required in memory.")
  if (!Number.isInteger(input.partNumber) || input.partNumber < 1) return failure("FAILED", null, "FANVUE_UPLOAD_PART_NUMBER_INVALID", "Fanvue upload part number must be a positive integer.")
  if (typeof input.uploader !== "function") return failure("FAILED", null, "FANVUE_SIGNED_PART_UPLOADER_REQUIRED", "Fanvue signed part uploader must be injected.")
  try {
    const uploaded = await input.uploader({ signedUrl, partNumber: input.partNumber, body: input.body })
    const ETag = clean(uploaded?.ETag)
    if (!ETag) return failure("FAILED", null, "FANVUE_UPLOAD_PART_ETAG_REQUIRED", "Signed upload part response must include an ETag.")
    return { ok: true, part: { ETag, PartNumber: input.partNumber }, proof: false }
  } catch (error) {
    if (isFanvueApiFailure(error)) return error
    return failure("FAILED", null, "FANVUE_SIGNED_PART_UPLOAD_FAILED", "Signed upload part failed.")
  }
}

export async function completeFanvueUploadSession(config: FanvueApiClientConfig, input: { uploadId: string; parts: FanvueUploadPart[] }): Promise<FanvueCompleteUploadResult> {
  const uploadId = clean(input.uploadId)
  if (!uploadId) return failure("FAILED", null, "FANVUE_UPLOAD_ID_REQUIRED", "Fanvue uploadId is required.")
  if (!Array.isArray(input.parts) || input.parts.length === 0) return failure("FAILED", null, "FANVUE_UPLOAD_PARTS_REQUIRED", "Fanvue upload completion requires parts.")
  const parts = input.parts.map((part) => ({ ETag: clean(part?.ETag), PartNumber: Number(part?.PartNumber) }))
  if (parts.some((part) => !part.ETag || !Number.isInteger(part.PartNumber) || part.PartNumber < 1)) {
    return failure("FAILED", null, "FANVUE_UPLOAD_PARTS_INVALID", "Fanvue upload completion requires ETag and positive PartNumber for every part.")
  }
  const requested = await requestJson(config, "PATCH", `/media/uploads/${encodeURIComponent(uploadId)}`, { parts })
  if (!requested.ok) return requested.failure
  const status = clean((requested.data as Record<string, unknown>)?.status)
  if (status !== "created" && status !== "processing" && status !== "ready" && status !== "error") return failure("MALFORMED_JSON", requested.response.status, "FANVUE_UPLOAD_COMPLETE_STATUS_INVALID", "Fanvue upload completion returned an invalid status.")
  return { ok: true, status }
}

export async function readFanvueMedia(config: FanvueApiClientConfig, input: { uuid: string }): Promise<FanvueReadMediaResult> {
  const uuid = requireUuid(input.uuid, "FANVUE_MEDIA_UUID_REQUIRED", "Fanvue media UUID is required.")
  if (typeof uuid !== "string") return uuid
  const requested = await requestJson(config, "GET", `/media/${encodeURIComponent(uuid)}`)
  if (!requested.ok) return requested.failure
  const media = normalizeMedia(requested.data)
  if (!media) return failure("MALFORMED_JSON", requested.response.status, "FANVUE_MEDIA_READBACK_MALFORMED", "Fanvue media read-back response was malformed.")
  if (media.uuid !== uuid) return failure("FAILED", requested.response.status, "FANVUE_MEDIA_UUID_MISMATCH", "Fanvue media read-back UUID did not match.")
  return { ok: true, media, ready: media.status === "ready", terminal_failure: media.status === "error" }
}

export async function waitForFanvueMediaReady(config: FanvueApiClientConfig, input: { uuid: string; maxAttempts: number; maxDelayMs?: number; backoffBaseMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<FanvueMediaReadyResult> {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts))
  const maxDelayMs = Math.max(0, Math.floor(input.maxDelayMs ?? 0))
  const backoffBaseMs = Math.max(0, Math.floor(input.backoffBaseMs ?? 100))
  const sleep = input.sleep ?? (async () => {})
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await readFanvueMedia(config, { uuid: input.uuid })
    if (result.ok) {
      if (result.ready) return { ok: true, media: result.media, attempts: attempt, proof: "MEDIA_READY_READBACK" }
      if (result.terminal_failure) return { ...failure("FAILED", null, "FANVUE_MEDIA_PROCESSING_ERROR", "Fanvue media processing ended in error."), attempts: attempt, retryable: false }
      if (attempt < maxAttempts) await sleep(Math.min(maxDelayMs, attempt * backoffBaseMs))
      continue
    }
    const failed = result as FanvueApiFailure
    if (failed.status === 429 && attempt < maxAttempts) {
      await sleep(Math.min(failed.retry_after_ms ?? maxDelayMs, maxDelayMs))
      continue
    }
    return { ...failed, attempts: attempt, retryable: failed.status === 429 }
  }
  return { ...failure("FAILED", null, "FANVUE_MEDIA_READY_TIMEOUT", "Fanvue upload completed, but media was still processing before the readiness retry limit."), attempts: maxAttempts, retryable: true }
}

export async function createFanvueMediaPost(config: FanvueApiClientConfig, input: FanvueCreateMediaPostInput): Promise<FanvueCreatePostResult> {
  const audience = clean(input.audience)
  if (!audience) return failure("FAILED", null, "FANVUE_AUDIENCE_REQUIRED", "Fanvue audience is required.")
  const mediaUuids = stringArray(input.mediaUuids)
  if (mediaUuids.length === 0) return failure("FAILED", null, "FANVUE_MEDIA_UUIDS_REQUIRED", "Fanvue media post requires mediaUuids.")
  if (mediaUuids.some((uuid) => !isUuid(uuid))) return failure("FAILED", null, "FANVUE_MEDIA_UUID_INVALID", "Fanvue mediaUuids must be UUIDs.")
  const body: Record<string, unknown> = { audience, mediaUuids }
  const text = clean(input.text)
  if (text) body.text = text
  const mediaPreviewUuid = clean(input.mediaPreviewUuid)
  if (mediaPreviewUuid) body.mediaPreviewUuid = mediaPreviewUuid
  const publishAt = isoOrNull(input.publishAt)
  if (publishAt) body.publishAt = publishAt
  const expiresAt = isoOrNull(input.expiresAt)
  if (expiresAt) body.expiresAt = expiresAt
  const collectionUuids = stringArray(input.collectionUuids)
  if (collectionUuids.length > 0) body.collectionUuids = Array.from(new Set(collectionUuids))
  const requested = await requestJson(config, "POST", "/posts", body)
  if (!requested.ok) return requested.failure
  const post = normalizePost(requested.data)
  if (!post) return failure("MALFORMED_JSON", requested.response.status, "FANVUE_POST_UUID_MISSING", "Fanvue response did not include a post UUID.")
  return { ok: true, result_kind: "SCHEDULED_CREATED", post: { uuid: post.uuid, publishAt: post.publishAt, publishedAt: post.publishedAt }, posted_proof: false }
}

export async function createFanvueTextPost(config: FanvueApiClientConfig, input: FanvueCreateTextPostInput): Promise<FanvueCreatePostResult> {
  const configError = requireConfig(config)
  if (configError) return configError
  const text = clean(input.text)
  if (!text) return failure("FAILED", null, "FANVUE_TEXT_REQUIRED", "Fanvue text is required.")
  const audience = clean(input.audience)
  if (!audience) return failure("FAILED", null, "FANVUE_AUDIENCE_REQUIRED", "Fanvue audience is required.")

  const body: Record<string, string> = { text, audience }
  const publishAt = isoOrNull(input.publishAt)
  if (publishAt) body.publishAt = publishAt

  let response: FanvueFetchResponse
  try {
    response = await config.fetch(endpoint(config, "/posts"), { method: "POST", headers: headers(config), body: JSON.stringify(body) })
  } catch {
    return failure("FAILED", null, "FANVUE_NETWORK_FAILED", "Fanvue request failed.")
  }
  if (!response.ok) return classifyStatus(response.status)
  const parsed = await safeJson(response)
  if (!parsed.ok) return parsed.error
  const post = normalizePost(parsed.data)
  if (!post) return failure("MALFORMED_JSON", response.status, "FANVUE_POST_UUID_MISSING", "Fanvue response did not include a post UUID.")
  return { ok: true, result_kind: "SCHEDULED_CREATED", post: { uuid: post.uuid, publishAt: post.publishAt, publishedAt: post.publishedAt }, posted_proof: false }
}

export async function readFanvuePost(config: FanvueApiClientConfig, input: FanvueReadPostInput): Promise<FanvueReadPostResult> {
  const configError = requireConfig(config)
  if (configError) return configError
  const uuid = clean(input.uuid)
  if (!uuid) return failure("FAILED", null, "FANVUE_POST_UUID_REQUIRED", "Fanvue post UUID is required.")
  let response: FanvueFetchResponse
  try {
    response = await config.fetch(endpoint(config, `/posts/${encodeURIComponent(uuid)}`), { method: "GET", headers: headers(config) })
  } catch {
    return failure("FAILED", null, "FANVUE_NETWORK_FAILED", "Fanvue request failed.")
  }
  if (!response.ok) return classifyStatus(response.status)
  const parsed = await safeJson(response)
  if (!parsed.ok) return parsed.error
  const post = normalizePost(parsed.data)
  if (!post) return failure("MALFORMED_JSON", response.status, "FANVUE_POST_UUID_MISSING", "Fanvue response did not include a post UUID.")
  if (post.uuid !== uuid) return failure("FAILED", response.status, "FANVUE_POST_UUID_MISMATCH", "Fanvue read-back UUID did not match.")

  const proofCandidate = post.publishedAt
    ? buildFanvueProofCandidateFromReadback({ post, expected_text: input.expectedText, expected_audience: input.expectedAudience, expected_media_uuids: input.expectedMediaUuids, expected_content_hash: input.expectedContentHash, api_version: config.apiVersion, job_id: input.jobId, rule_id: input.ruleId, user_id: input.userId, scheduled_for: input.scheduledFor })
    : null
  const proofValidation = proofCandidate
    ? validateFanvueLivePostProof(proofCandidate)
    : validateFanvueLivePostProof({ platform: "fanvue", verification_needed: true, result_kind: "SCHEDULED_CREATED", provider_post_uuid: post.uuid, provider_publish_at: post.publishAt, provider_published_at: post.publishedAt, provider_text: post.text, expected_text: input.expectedText, provider_audience: post.audience, expected_audience: input.expectedAudience, api_version: config.apiVersion })
  if (proofCandidate && !proofValidation.posted) return failure("FAILED", response.status, proofValidation.error_code, proofValidation.safe_error_message)
  return { ok: true, result_kind: proofCandidate ? "POSTED_READY_FOR_PROOF" : "SCHEDULED_CREATED", post, proof_candidate: proofCandidate, proof_validation: proofValidation }
}
