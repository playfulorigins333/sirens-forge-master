import zlib from "zlib"
import { decryptAutopostToken } from "./tokenCryptoCore"
import {
  completeFanvueUploadSession,
  createFanvueCreatorUploadSession,
  getFanvueCreatorUploadPartUrl,
  uploadFanvueSignedPart,
  type FanvueApiClientConfig,
  type FanvueApiFailure,
  type FanvueFetch,
  type FanvueFetchResponse,
  type FanvueSignedPartUploader,
} from "./fanvueApiClientCore"
import type { FanvueUploadDiagnosticAccount, FanvueIdentityFetch } from "./fanvueUploadDiagnostic"

export const FANVUE_MEDIA_READINESS_DIAGNOSTIC_GATE = "FV-40DN" as const
export const FANVUE_MEDIA_READINESS_DIAGNOSTIC_MODE = "fanvue_media_readiness_followup_diagnostic_no_post" as const
export const FANVUE_MEDIA_READINESS_DIAGNOSTIC_OPERATION = "fanvue_media_readiness_followup_diagnostic_no_post" as const
export const FANVUE_MEDIA_READINESS_DIAGNOSTIC_CONFIRMATION = "RUN_FANVUE_MEDIA_READINESS_FOLLOWUP_DIAGNOSTIC_ONLY_NO_POST_NO_DISPATCH_NO_SCHEDULE_NO_PUBLIC_EXPOSURE" as const
export const FANVUE_MEDIA_READINESS_DIAGNOSTIC_ASSET_PROFILE = "safe_static_image_v1" as const
export const FANVUE_MEDIA_READINESS_DIAGNOSTIC_READINESS_PROFILE = "bounded_extended_v1" as const
export const FANVUE_MEDIA_READINESS_DIAGNOSTIC_FILENAME = "fanvue-media-readiness-diagnostic-safe-static-v1.png" as const
export const FANVUE_MEDIA_READINESS_MAX_ATTEMPTS = 6 as const
export const FANVUE_MEDIA_READINESS_BACKOFF_BASE_MS = 5_000 as const
export const FANVUE_MEDIA_READINESS_MAX_DELAY_MS = 5_000 as const

export type FanvueMediaReadinessClass =
  | "ready"
  | "processing_timeout"
  | "terminal_provider_error"
  | "read_route_forbidden"
  | "read_route_not_found"
  | "route_or_id_mismatch_suspected"
  | "malformed_readback"
  | "rate_limited"
  | "transient_provider_failure"
  | "unknown_provider_failure"

export type FanvueMediaReadinessDiagnosticDependencies = {
  loadAccount: (userId: string) => Promise<FanvueUploadDiagnosticAccount | null>
  fetchIdentity: FanvueIdentityFetch
  fanvueFetch: FanvueFetch
  signedPartUploader: FanvueSignedPartUploader
  apiBaseUrl: string
  apiVersion: string
  decryptAccessToken?: (encryptedToken: string) => string
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

export type FanvueMediaReadinessDiagnosticInput = { userId: string }

export type FanvueMediaReadinessDiagnosticResult = {
  ok: boolean
  gate: typeof FANVUE_MEDIA_READINESS_DIAGNOSTIC_GATE
  mode: typeof FANVUE_MEDIA_READINESS_DIAGNOSTIC_MODE
  account_row_present: boolean
  connection_status_connected: boolean
  scopes_include_read_media: boolean
  scopes_include_write_media: boolean
  scopes_include_write_creator: boolean
  identity_layer_reached: boolean
  identity_provider_status_class: "2xx" | "4xx" | "5xx" | null
  identity_is_creator_true: boolean
  candidate_creator_user_uuid_source: "top_level_uuid" | "top_level_uuid_confirmed_for_diagnostic_use" | null
  candidate_creator_user_uuid_present: boolean
  candidate_creator_user_uuid_format_valid: boolean
  candidate_creator_user_uuid_used: boolean
  upload_session_attempted: boolean
  upload_session_provider_status_class: "2xx" | "4xx" | "5xx" | null
  signed_upload_url_attempted: boolean
  signed_upload_url_provider_status_class: "2xx" | "4xx" | "5xx" | null
  byte_upload_attempted: boolean
  byte_upload_status_class: "2xx" | "4xx" | "5xx" | null
  media_finalize_attempted: boolean
  media_finalize_provider_status_class: "2xx" | "4xx" | "5xx" | null
  media_finalize_status_class: "created" | "processing" | "ready" | "error" | "invalid" | null
  media_lookup_attempted: boolean
  media_lookup_route_family: "general_media_uuid" | "creator_scoped_media_uuid" | "not_attempted"
  creator_scoped_read_route_supported_by_source: false
  readiness_attempts: number
  readiness_elapsed_class: "none" | "short" | "bounded_extended"
  media_readiness_class: FanvueMediaReadinessClass | null
  post_attempted: false
  dispatch_attempted: false
  scheduled: false
  public_exposure_attempted: false
  platform_registry_changed: false
  safe_code: string
  blockers: string[]
}

type MediaReadback = { uuid: string; status: "created" | "processing" | "ready" | "error"; mediaType: string | null; name: string | null }
type ReadAttemptResult =
  | { ok: true; media: MediaReadback }
  | { ok: false; status: number | null; code: string; class: Exclude<FanvueMediaReadinessClass, "ready" | "processing_timeout" | "terminal_provider_error">; retryable: boolean }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_FRESHNESS_BUFFER_MS = 5 * 60 * 1000

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii")
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function createSafeStaticPng() {
  const width = 64
  const height = 64
  const rawRows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4)
    row[0] = 0
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 4
      const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0
      row[offset] = light ? 238 : 82
      row[offset + 1] = light ? 242 : 96
      row[offset + 2] = light ? 255 : 128
      row[offset + 3] = 255
    }
    rawRows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows), { level: 0 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

export const FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG = createSafeStaticPng()

function baseResult(overrides: Partial<FanvueMediaReadinessDiagnosticResult> = {}): FanvueMediaReadinessDiagnosticResult {
  return {
    ok: false,
    gate: FANVUE_MEDIA_READINESS_DIAGNOSTIC_GATE,
    mode: FANVUE_MEDIA_READINESS_DIAGNOSTIC_MODE,
    account_row_present: false,
    connection_status_connected: false,
    scopes_include_read_media: false,
    scopes_include_write_media: false,
    scopes_include_write_creator: false,
    identity_layer_reached: false,
    identity_provider_status_class: null,
    identity_is_creator_true: false,
    candidate_creator_user_uuid_source: null,
    candidate_creator_user_uuid_present: false,
    candidate_creator_user_uuid_format_valid: false,
    candidate_creator_user_uuid_used: false,
    upload_session_attempted: false,
    upload_session_provider_status_class: null,
    signed_upload_url_attempted: false,
    signed_upload_url_provider_status_class: null,
    byte_upload_attempted: false,
    byte_upload_status_class: null,
    media_finalize_attempted: false,
    media_finalize_provider_status_class: null,
    media_finalize_status_class: null,
    media_lookup_attempted: false,
    media_lookup_route_family: "not_attempted",
    creator_scoped_read_route_supported_by_source: false,
    readiness_attempts: 0,
    readiness_elapsed_class: "none",
    media_readiness_class: null,
    post_attempted: false,
    dispatch_attempted: false,
    scheduled: false,
    public_exposure_attempted: false,
    platform_registry_changed: false,
    safe_code: "FANVUE_MEDIA_READINESS_DIAGNOSTIC_BLOCKED",
    blockers: [],
    ...overrides,
  }
}

function block(safeCode: string, blockers: string[], overrides: Partial<FanvueMediaReadinessDiagnosticResult> = {}) {
  return baseResult({ safe_code: safeCode, blockers, ...overrides })
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function scopeList(scopes: unknown) {
  if (Array.isArray(scopes)) return scopes.filter((scope): scope is string => typeof scope === "string").map((scope) => scope.trim()).filter(Boolean)
  if (typeof scopes === "string") return scopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
  return []
}

function statusClass(status: number | null | undefined): "2xx" | "4xx" | "5xx" | null {
  if (typeof status !== "number") return null
  if (status >= 200 && status < 300) return "2xx"
  if (status >= 400 && status < 500) return "4xx"
  if (status >= 500 && status < 600) return "5xx"
  return null
}

function apiFailureStatusClass(result: FanvueApiFailure): "4xx" | "5xx" | null {
  return statusClass(result.status) as "4xx" | "5xx" | null
}

function tokenFresh(account: FanvueUploadDiagnosticAccount, now: Date) {
  if (!account.token_expires_at) return false
  const expires = new Date(account.token_expires_at).getTime()
  return Number.isFinite(expires) && expires > now.getTime() + TOKEN_FRESHNESS_BUFFER_MS
}

function readTopLevelUuid(identity: unknown) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null
  const record = identity as Record<string, unknown>
  return { uuid: clean(record.uuid), isCreatorTrue: record.isCreator === true }
}

function safeProviderFailureCode(prefix: string, status: number) {
  if (status === 401) return `${prefix}_UNAUTHORIZED`
  if (status === 403) return `${prefix}_FORBIDDEN`
  if (status === 429) return `${prefix}_RATE_LIMITED`
  if (status >= 500) return `${prefix}_SERVER_ERROR`
  return `${prefix}_REQUEST_FAILED`
}

function headers(config: FanvueApiClientConfig) {
  return { authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json", "X-Fanvue-API-Version": config.apiVersion }
}

function endpoint(config: FanvueApiClientConfig, path: string) {
  return `${config.apiBaseUrl.replace(/\/+$/, "")}${path}`
}

async function safeJson(response: FanvueFetchResponse) {
  try {
    return { ok: true as const, data: await response.json() }
  } catch {
    return { ok: false as const }
  }
}

function normalizeMedia(data: unknown, expectedUuid: string): ReadAttemptResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, status: 200, code: "FANVUE_MEDIA_READINESS_READBACK_MALFORMED", class: "malformed_readback", retryable: false }
  const record = data as Record<string, unknown>
  const uuid = clean(record.uuid)
  const status = clean(record.status)
  if (!uuid || !UUID_RE.test(uuid)) return { ok: false, status: 200, code: "FANVUE_MEDIA_READINESS_READBACK_MALFORMED", class: "malformed_readback", retryable: false }
  if (uuid !== expectedUuid) return { ok: false, status: 200, code: "FANVUE_MEDIA_READINESS_ROUTE_OR_ID_MISMATCH_SUSPECTED", class: "route_or_id_mismatch_suspected", retryable: false }
  if (status !== "created" && status !== "processing" && status !== "ready" && status !== "error") return { ok: false, status: 200, code: "FANVUE_MEDIA_READINESS_READBACK_MALFORMED", class: "malformed_readback", retryable: false }
  return { ok: true, media: { uuid, status, mediaType: clean(record.mediaType), name: clean(record.name) } }
}

function classifyReadFailure(responseStatus: number | null, networkFailed = false): ReadAttemptResult {
  if (networkFailed) return { ok: false, status: null, code: "FANVUE_MEDIA_READINESS_TRANSIENT_PROVIDER_FAILURE", class: "transient_provider_failure", retryable: false }
  if (responseStatus === 403) return { ok: false, status: responseStatus, code: "FANVUE_MEDIA_READINESS_READ_FORBIDDEN", class: "read_route_forbidden", retryable: false }
  if (responseStatus === 404) return { ok: false, status: responseStatus, code: "FANVUE_MEDIA_READINESS_READ_NOT_FOUND", class: "read_route_not_found", retryable: true }
  if (responseStatus === 429) return { ok: false, status: responseStatus, code: "FANVUE_MEDIA_READINESS_RATE_LIMITED", class: "rate_limited", retryable: true }
  if (typeof responseStatus === "number" && responseStatus >= 500) return { ok: false, status: responseStatus, code: "FANVUE_MEDIA_READINESS_TRANSIENT_PROVIDER_FAILURE", class: "transient_provider_failure", retryable: false }
  return { ok: false, status: responseStatus, code: "FANVUE_MEDIA_READINESS_UNKNOWN_PROVIDER_FAILURE", class: "unknown_provider_failure", retryable: false }
}

async function readMedia(config: FanvueApiClientConfig, expectedUuid: string): Promise<ReadAttemptResult> {
  let response: FanvueFetchResponse
  try {
    response = await config.fetch(endpoint(config, `/media/${encodeURIComponent(expectedUuid)}`), { method: "GET", headers: headers(config) })
  } catch {
    return classifyReadFailure(null, true)
  }
  if (!response.ok) return classifyReadFailure(response.status)
  const parsed = await safeJson(response)
  if (!parsed.ok) return { ok: false, status: response.status, code: "FANVUE_MEDIA_READINESS_READBACK_MALFORMED", class: "malformed_readback", retryable: false }
  return normalizeMedia(parsed.data, expectedUuid)
}

async function classifyMediaReadiness(config: FanvueApiClientConfig, uuid: string, sleep: (ms: number) => Promise<void>) {
  let attempts = 0
  let sawNotFound = false
  let sawRateLimited = false
  for (let attempt = 1; attempt <= FANVUE_MEDIA_READINESS_MAX_ATTEMPTS; attempt++) {
    attempts = attempt
    const result = await readMedia(config, uuid)
    if (result.ok) {
      if (result.media.status === "ready") return { ok: true as const, attempts, class: "ready" as const, safeCode: "FANVUE_MEDIA_READINESS_READY", blockers: [] }
      if (result.media.status === "error") return { ok: false as const, attempts, class: "terminal_provider_error" as const, safeCode: "FANVUE_MEDIA_READINESS_TERMINAL_PROVIDER_ERROR", blockers: ["media processing ended in provider error"] }
      if (attempt < FANVUE_MEDIA_READINESS_MAX_ATTEMPTS) await sleep(Math.min(FANVUE_MEDIA_READINESS_MAX_DELAY_MS, attempt * FANVUE_MEDIA_READINESS_BACKOFF_BASE_MS))
      continue
    }
    const failed = result as Extract<ReadAttemptResult, { ok: false }>
    if (failed.class === "read_route_not_found") sawNotFound = true
    if (failed.class === "rate_limited") sawRateLimited = true
    if ((failed.class === "read_route_not_found" || failed.class === "rate_limited") && attempt < FANVUE_MEDIA_READINESS_MAX_ATTEMPTS) {
      await sleep(FANVUE_MEDIA_READINESS_MAX_DELAY_MS)
      continue
    }
    if (failed.class === "read_route_not_found" && sawNotFound) return { ok: false as const, attempts, class: "route_or_id_mismatch_suspected" as const, safeCode: "FANVUE_MEDIA_READINESS_ROUTE_OR_ID_MISMATCH_SUSPECTED", blockers: ["media readback route or identifier mismatch suspected"] }
    return { ok: false as const, attempts, class: failed.class, safeCode: failed.code, blockers: ["media readiness lookup failed safely"] }
  }
  if (sawRateLimited) return { ok: false as const, attempts, class: "rate_limited" as const, safeCode: "FANVUE_MEDIA_READINESS_RATE_LIMITED", blockers: ["media readback was rate limited within bounded retry window"] }
  if (sawNotFound) return { ok: false as const, attempts, class: "route_or_id_mismatch_suspected" as const, safeCode: "FANVUE_MEDIA_READINESS_ROUTE_OR_ID_MISMATCH_SUSPECTED", blockers: ["media readback route or identifier mismatch suspected"] }
  return { ok: false as const, attempts, class: "processing_timeout" as const, safeCode: "FANVUE_MEDIA_READINESS_PROCESSING_TIMEOUT", blockers: ["media remained processing within bounded readiness window"] }
}

export async function runFanvueMediaReadinessDiagnostic(input: FanvueMediaReadinessDiagnosticInput, dependencies: FanvueMediaReadinessDiagnosticDependencies): Promise<FanvueMediaReadinessDiagnosticResult> {
  let account: FanvueUploadDiagnosticAccount | null
  try {
    account = await dependencies.loadAccount(input.userId)
  } catch {
    return block("FANVUE_MEDIA_READINESS_ACCOUNT_LOOKUP_FAILED", ["account lookup failed safely"])
  }
  if (!account) return block("FANVUE_MEDIA_READINESS_ACCOUNT_NOT_FOUND", ["account row missing"])

  const scopes = scopeList(account.scopes)
  const posture = {
    account_row_present: true,
    connection_status_connected: account.connection_status === "CONNECTED",
    scopes_include_read_media: scopes.includes("read:media"),
    scopes_include_write_media: scopes.includes("write:media"),
    scopes_include_write_creator: scopes.includes("write:creator"),
  }
  const blockers: string[] = []
  if (account.platform !== "fanvue") blockers.push("account platform is not fanvue")
  if (account.user_id !== input.userId) blockers.push("account user mismatch")
  if (!posture.connection_status_connected) blockers.push("connection_status is not CONNECTED")
  if (!clean(account.encrypted_access_token)) blockers.push("encrypted access token missing")
  if (!tokenFresh(account, dependencies.now?.() ?? new Date())) blockers.push("access token freshness invalid")
  if (!posture.scopes_include_read_media) blockers.push("read:media scope missing")
  if (!posture.scopes_include_write_media) blockers.push("write:media scope missing")
  if (!posture.scopes_include_write_creator) blockers.push("write:creator scope missing")
  if (account.metadata?.provider !== "fanvue") blockers.push("metadata provider is not fanvue")
  if (account.metadata?.identity_fetched !== true) blockers.push("metadata identity_fetched is not true")
  if (blockers.length > 0) return block("FANVUE_MEDIA_READINESS_ACCOUNT_POSTURE_BLOCKED", blockers, posture)

  let accessToken: string
  try {
    accessToken = (dependencies.decryptAccessToken ?? decryptAutopostToken)(String(account.encrypted_access_token))
  } catch {
    return block("FANVUE_MEDIA_READINESS_ACCESS_TOKEN_DECRYPT_FAILED", ["access token decrypt failed safely"], posture)
  }
  if (!clean(accessToken)) return block("FANVUE_MEDIA_READINESS_ACCESS_TOKEN_DECRYPT_FAILED", ["access token decrypt failed safely"], posture)

  const identityUrl = `${dependencies.apiBaseUrl.replace(/\/+$/, "")}/users/account`
  let identityResponse
  try {
    identityResponse = await dependencies.fetchIdentity(identityUrl, { method: "GET", headers: { authorization: `Bearer ${accessToken}`, "X-Fanvue-API-Version": dependencies.apiVersion } })
  } catch {
    return block("FANVUE_MEDIA_READINESS_IDENTITY_PROVIDER_REQUEST_FAILED", ["identity provider request failed safely"], { ...posture, identity_layer_reached: true })
  }
  const identityStatusClass = statusClass(identityResponse.status)
  if (!identityResponse.ok) return block(safeProviderFailureCode("FANVUE_MEDIA_READINESS_IDENTITY_PROVIDER", identityResponse.status), ["identity provider request failed safely"], { ...posture, identity_layer_reached: true, identity_provider_status_class: identityStatusClass })

  let identityBody: unknown
  try {
    identityBody = await identityResponse.json()
  } catch {
    return block("FANVUE_MEDIA_READINESS_IDENTITY_RESPONSE_MALFORMED", ["identity response malformed"], { ...posture, identity_layer_reached: true, identity_provider_status_class: identityStatusClass })
  }
  const identity = readTopLevelUuid(identityBody)
  const candidatePresent = Boolean(identity?.uuid)
  const candidateValid = Boolean(identity?.uuid && UUID_RE.test(identity.uuid))
  const identityFlags = {
    identity_layer_reached: true,
    identity_provider_status_class: identityStatusClass,
    identity_is_creator_true: identity?.isCreatorTrue === true,
    candidate_creator_user_uuid_source: candidatePresent ? "top_level_uuid" as const : null,
    candidate_creator_user_uuid_present: candidatePresent,
    candidate_creator_user_uuid_format_valid: candidateValid,
  }
  if (!identity || !identity.isCreatorTrue) return block("FANVUE_MEDIA_READINESS_IDENTITY_NOT_CREATOR", ["identity is not a creator"], { ...posture, ...identityFlags })
  if (!identity.uuid || !candidateValid) return block("FANVUE_MEDIA_READINESS_CREATOR_UUID_INVALID", ["candidate creator user uuid invalid"], { ...posture, ...identityFlags })
  if (clean(account.provider_account_id) && UUID_RE.test(account.provider_account_id!.trim()) && account.provider_account_id!.trim() !== identity.uuid) {
    return block("FANVUE_MEDIA_READINESS_CREATOR_UUID_MISMATCH", ["provider account id did not match identity uuid"], { ...posture, ...identityFlags })
  }

  const config: FanvueApiClientConfig = { accessToken, apiBaseUrl: dependencies.apiBaseUrl, apiVersion: dependencies.apiVersion, fetch: dependencies.fanvueFetch }
  const creatorFlags = { ...posture, ...identityFlags, candidate_creator_user_uuid_source: "top_level_uuid_confirmed_for_diagnostic_use" as const, candidate_creator_user_uuid_used: true }

  const uploadSession = await createFanvueCreatorUploadSession(config, { creatorUserUuid: identity.uuid, name: FANVUE_MEDIA_READINESS_DIAGNOSTIC_FILENAME, filename: FANVUE_MEDIA_READINESS_DIAGNOSTIC_FILENAME, mediaType: "image" })
  if (!uploadSession.ok) {
    const failure = uploadSession as FanvueApiFailure
    return block(failure.error_code, ["creator-scoped upload session failed safely"], { ...creatorFlags, upload_session_attempted: true, upload_session_provider_status_class: apiFailureStatusClass(failure) })
  }

  const signed = await getFanvueCreatorUploadPartUrl(config, { creatorUserUuid: identity.uuid, uploadId: uploadSession.uploadId, partNumber: 1 })
  if (!signed.ok) {
    const failure = signed as FanvueApiFailure
    return block(failure.error_code, ["creator-scoped signed upload URL request failed safely"], { ...creatorFlags, upload_session_attempted: true, upload_session_provider_status_class: "2xx", signed_upload_url_attempted: true, signed_upload_url_provider_status_class: apiFailureStatusClass(failure) })
  }

  const uploaded = await uploadFanvueSignedPart({ signedUrl: signed.signed_url, partNumber: 1, body: FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG, uploader: dependencies.signedPartUploader })
  if (!uploaded.ok) {
    const failure = uploaded as FanvueApiFailure
    return block(failure.error_code, ["signed upload part failed safely"], { ...creatorFlags, upload_session_attempted: true, upload_session_provider_status_class: "2xx", signed_upload_url_attempted: true, signed_upload_url_provider_status_class: "2xx", byte_upload_attempted: true, byte_upload_status_class: apiFailureStatusClass(failure) })
  }

  const completed = await completeFanvueUploadSession(config, { uploadId: uploadSession.uploadId, parts: [uploaded.part] })
  if (!completed.ok) {
    const failure = completed as FanvueApiFailure
    return block(failure.error_code, ["upload finalize failed safely"], { ...creatorFlags, upload_session_attempted: true, upload_session_provider_status_class: "2xx", signed_upload_url_attempted: true, signed_upload_url_provider_status_class: "2xx", byte_upload_attempted: true, byte_upload_status_class: "2xx", media_finalize_attempted: true, media_finalize_provider_status_class: apiFailureStatusClass(failure) })
  }

  const readiness = await classifyMediaReadiness(config, uploadSession.mediaUuid, dependencies.sleep ?? (async () => {}))
  return baseResult({
    ...creatorFlags,
    ok: readiness.ok,
    upload_session_attempted: true,
    upload_session_provider_status_class: "2xx",
    signed_upload_url_attempted: true,
    signed_upload_url_provider_status_class: "2xx",
    byte_upload_attempted: true,
    byte_upload_status_class: "2xx",
    media_finalize_attempted: true,
    media_finalize_provider_status_class: "2xx",
    media_finalize_status_class: completed.status,
    media_lookup_attempted: true,
    media_lookup_route_family: "general_media_uuid",
    readiness_attempts: readiness.attempts,
    readiness_elapsed_class: readiness.attempts <= 1 ? "none" : "bounded_extended",
    media_readiness_class: readiness.class,
    safe_code: readiness.safeCode,
    blockers: readiness.blockers,
  })
}
