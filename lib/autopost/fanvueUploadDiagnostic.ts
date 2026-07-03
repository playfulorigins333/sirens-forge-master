import { decryptAutopostToken } from "./tokenCryptoCore"
import {
  completeFanvueUploadSession,
  createFanvueCreatorUploadSession,
  getFanvueCreatorUploadPartUrl,
  uploadFanvueSignedPart,
  waitForFanvueMediaReady,
  type FanvueApiClientConfig,
  type FanvueApiFailure,
  type FanvueFetch,
  type FanvueSignedPartUploader,
} from "./fanvueApiClientCore"

export const FANVUE_UPLOAD_DIAGNOSTIC_GATE = "FV-40DG" as const
export const FANVUE_UPLOAD_DIAGNOSTIC_MODE = "fanvue_creator_scoped_upload_diagnostic_no_post" as const
export const FANVUE_UPLOAD_DIAGNOSTIC_OPERATION = "fanvue_creator_scoped_upload_diagnostic_no_post" as const
export const FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION = "RUN_FANVUE_CREATOR_SCOPED_UPLOAD_DIAGNOSTIC_ONLY_NO_POST_NO_DISPATCH_NO_SCHEDULE_NO_PUBLIC_EXPOSURE" as const
export const FANVUE_UPLOAD_DIAGNOSTIC_FILENAME = "fanvue-upload-diagnostic-1x1.png" as const
export const FANVUE_UPLOAD_DIAGNOSTIC_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")

export type FanvueUploadDiagnosticAccount = {
  user_id: string
  platform: string
  connection_status?: string | null
  provider_account_id?: string | null
  scopes?: string[] | string | null
  encrypted_access_token?: string | null
  token_expires_at?: string | null
  token_type?: string | null
  token_key_version?: number | null
  metadata?: Record<string, unknown> | null
}

export type FanvueIdentityFetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> }
export type FanvueIdentityFetch = (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<FanvueIdentityFetchResponse>

export type FanvueUploadDiagnosticDependencies = {
  loadAccount: (userId: string) => Promise<FanvueUploadDiagnosticAccount | null>
  fetchIdentity: FanvueIdentityFetch
  fanvueFetch: FanvueFetch
  signedPartUploader: FanvueSignedPartUploader
  apiBaseUrl: string
  apiVersion: string
  decryptAccessToken?: (encryptedToken: string) => string
  now?: () => Date
  waitForMediaReady?: typeof waitForFanvueMediaReady
}

export type FanvueUploadDiagnosticInput = { userId: string }

export type FanvueUploadDiagnosticResult = {
  ok: boolean
  gate: typeof FANVUE_UPLOAD_DIAGNOSTIC_GATE
  mode: typeof FANVUE_UPLOAD_DIAGNOSTIC_MODE
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
  media_lookup_attempted: boolean
  media_ready_class: "ready" | "processing" | "created" | "error" | "timeout" | "provider_failure" | null
  post_attempted: false
  dispatch_attempted: false
  scheduled: false
  public_exposure_attempted: false
  platform_registry_changed: false
  safe_code: string
  blockers: string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_FRESHNESS_BUFFER_MS = 5 * 60 * 1000

function baseResult(overrides: Partial<FanvueUploadDiagnosticResult> = {}): FanvueUploadDiagnosticResult {
  return {
    ok: false,
    gate: FANVUE_UPLOAD_DIAGNOSTIC_GATE,
    mode: FANVUE_UPLOAD_DIAGNOSTIC_MODE,
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
    media_lookup_attempted: false,
    media_ready_class: null,
    post_attempted: false,
    dispatch_attempted: false,
    scheduled: false,
    public_exposure_attempted: false,
    platform_registry_changed: false,
    safe_code: "FANVUE_UPLOAD_DIAGNOSTIC_BLOCKED",
    blockers: [],
    ...overrides,
  }
}

function block(safeCode: string, blockers: string[], overrides: Partial<FanvueUploadDiagnosticResult> = {}) {
  return baseResult({ safe_code: safeCode, blockers, ...overrides })
}

function scopeList(scopes: unknown) {
  if (Array.isArray(scopes)) return scopes.filter((scope): scope is string => typeof scope === "string").map((scope) => scope.trim()).filter(Boolean)
  if (typeof scopes === "string") return scopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
  return []
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
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
  return {
    uuid: nonEmptyString(record.uuid) ? record.uuid.trim() : null,
    isCreatorTrue: record.isCreator === true,
  }
}

function safeProviderFailureCode(prefix: string, status: number) {
  if (status === 401) return `${prefix}_UNAUTHORIZED`
  if (status === 403) return `${prefix}_FORBIDDEN`
  if (status === 429) return `${prefix}_RATE_LIMITED`
  if (status >= 500) return `${prefix}_SERVER_ERROR`
  return `${prefix}_REQUEST_FAILED`
}

export async function runFanvueUploadDiagnostic(input: FanvueUploadDiagnosticInput, dependencies: FanvueUploadDiagnosticDependencies): Promise<FanvueUploadDiagnosticResult> {
  let account: FanvueUploadDiagnosticAccount | null
  try {
    account = await dependencies.loadAccount(input.userId)
  } catch {
    return block("FANVUE_UPLOAD_ACCOUNT_LOOKUP_FAILED", ["account lookup failed safely"])
  }

  if (!account) return block("FANVUE_UPLOAD_ACCOUNT_NOT_FOUND", ["account row missing"])
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
  if (!nonEmptyString(account.encrypted_access_token)) blockers.push("encrypted access token missing")
  if (!tokenFresh(account, dependencies.now?.() ?? new Date())) blockers.push("access token freshness invalid")
  if (!posture.scopes_include_read_media) blockers.push("read:media scope missing")
  if (!posture.scopes_include_write_media) blockers.push("write:media scope missing")
  if (!posture.scopes_include_write_creator) blockers.push("write:creator scope missing")
  if (account.metadata?.provider !== "fanvue") blockers.push("metadata provider is not fanvue")
  if (account.metadata?.identity_fetched !== true) blockers.push("metadata identity_fetched is not true")
  if (blockers.length > 0) return block("FANVUE_UPLOAD_ACCOUNT_POSTURE_BLOCKED", blockers, posture)

  let accessToken: string
  try {
    accessToken = (dependencies.decryptAccessToken ?? decryptAutopostToken)(String(account.encrypted_access_token))
  } catch {
    return block("FANVUE_UPLOAD_ACCESS_TOKEN_DECRYPT_FAILED", ["access token decrypt failed safely"], posture)
  }
  if (!nonEmptyString(accessToken)) return block("FANVUE_UPLOAD_ACCESS_TOKEN_DECRYPT_FAILED", ["access token decrypt failed safely"], posture)

  const identityUrl = `${dependencies.apiBaseUrl.replace(/\/+$/, "")}/users/account`
  let identityResponse: FanvueIdentityFetchResponse
  try {
    identityResponse = await dependencies.fetchIdentity(identityUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}`, "X-Fanvue-API-Version": dependencies.apiVersion },
    })
  } catch {
    return block("FANVUE_UPLOAD_IDENTITY_PROVIDER_REQUEST_FAILED", ["identity provider request failed safely"], { ...posture, identity_layer_reached: true })
  }
  const identityStatusClass = statusClass(identityResponse.status)
  if (!identityResponse.ok) {
    return block(safeProviderFailureCode("FANVUE_UPLOAD_IDENTITY_PROVIDER", identityResponse.status), ["identity provider request failed safely"], {
      ...posture,
      identity_layer_reached: true,
      identity_provider_status_class: identityStatusClass,
    })
  }

  let identityBody: unknown
  try {
    identityBody = await identityResponse.json()
  } catch {
    return block("FANVUE_UPLOAD_IDENTITY_RESPONSE_MALFORMED", ["identity response malformed"], { ...posture, identity_layer_reached: true, identity_provider_status_class: identityStatusClass })
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
  if (!identity || !identity.isCreatorTrue) return block("FANVUE_UPLOAD_IDENTITY_NOT_CREATOR", ["identity is not a creator"], { ...posture, ...identityFlags })
  if (!identity.uuid || !candidateValid) return block("FANVUE_UPLOAD_CREATOR_UUID_INVALID", ["candidate creator user uuid invalid"], { ...posture, ...identityFlags })
  if (nonEmptyString(account.provider_account_id) && UUID_RE.test(account.provider_account_id.trim()) && account.provider_account_id.trim() !== identity.uuid) {
    return block("FANVUE_UPLOAD_CREATOR_UUID_MISMATCH", ["provider account id did not match identity uuid"], { ...posture, ...identityFlags })
  }

  const config: FanvueApiClientConfig = { accessToken, apiBaseUrl: dependencies.apiBaseUrl, apiVersion: dependencies.apiVersion, fetch: dependencies.fanvueFetch }
  const creatorFlags = {
    ...posture,
    ...identityFlags,
    candidate_creator_user_uuid_source: "top_level_uuid_confirmed_for_diagnostic_use" as const,
    candidate_creator_user_uuid_used: true,
  }

  const uploadSession = await createFanvueCreatorUploadSession(config, { creatorUserUuid: identity.uuid, name: FANVUE_UPLOAD_DIAGNOSTIC_FILENAME, filename: FANVUE_UPLOAD_DIAGNOSTIC_FILENAME, mediaType: "image" })
  if (!uploadSession.ok) {
    const failure = uploadSession as FanvueApiFailure
    return block(failure.error_code, ["creator-scoped upload session failed safely"], { ...creatorFlags, upload_session_attempted: true, upload_session_provider_status_class: apiFailureStatusClass(failure) })
  }

  const signed = await getFanvueCreatorUploadPartUrl(config, { creatorUserUuid: identity.uuid, uploadId: uploadSession.uploadId, partNumber: 1 })
  if (!signed.ok) {
    const failure = signed as FanvueApiFailure
    return block(failure.error_code, ["creator-scoped signed upload URL request failed safely"], { ...creatorFlags, upload_session_attempted: true, upload_session_provider_status_class: "2xx", signed_upload_url_attempted: true, signed_upload_url_provider_status_class: apiFailureStatusClass(failure) })
  }

  const uploaded = await uploadFanvueSignedPart({ signedUrl: signed.signed_url, partNumber: 1, body: FANVUE_UPLOAD_DIAGNOSTIC_PNG, uploader: dependencies.signedPartUploader })
  if (!uploaded.ok) {
    const failure = uploaded as FanvueApiFailure
    return block(failure.error_code, ["signed upload part failed safely"], { ...creatorFlags, upload_session_attempted: true, upload_session_provider_status_class: "2xx", signed_upload_url_attempted: true, signed_upload_url_provider_status_class: "2xx", byte_upload_attempted: true, byte_upload_status_class: apiFailureStatusClass(failure) })
  }

  const completed = await completeFanvueUploadSession(config, { uploadId: uploadSession.uploadId, parts: [uploaded.part] })
  if (!completed.ok) {
    const failure = completed as FanvueApiFailure
    return block(failure.error_code, ["upload finalize failed safely"], { ...creatorFlags, upload_session_attempted: true, upload_session_provider_status_class: "2xx", signed_upload_url_attempted: true, signed_upload_url_provider_status_class: "2xx", byte_upload_attempted: true, byte_upload_status_class: "2xx", media_finalize_attempted: true, media_finalize_provider_status_class: apiFailureStatusClass(failure) })
  }

  const wait = dependencies.waitForMediaReady ?? waitForFanvueMediaReady
  const ready = await wait(config, { uuid: uploadSession.mediaUuid, maxAttempts: 2, maxDelayMs: 0, backoffBaseMs: 0 })
  if (!ready.ok) {
    const failure = ready as FanvueApiFailure & { error_code: string }
    const readyClass = failure.error_code === "FANVUE_MEDIA_READY_TIMEOUT" ? "timeout" : "provider_failure"
    return block(failure.error_code, ["media readiness lookup failed safely"], { ...creatorFlags, upload_session_attempted: true, upload_session_provider_status_class: "2xx", signed_upload_url_attempted: true, signed_upload_url_provider_status_class: "2xx", byte_upload_attempted: true, byte_upload_status_class: "2xx", media_finalize_attempted: true, media_finalize_provider_status_class: "2xx", media_lookup_attempted: true, media_ready_class: readyClass })
  }

  return baseResult({
    ...creatorFlags,
    ok: true,
    upload_session_attempted: true,
    upload_session_provider_status_class: "2xx",
    signed_upload_url_attempted: true,
    signed_upload_url_provider_status_class: "2xx",
    byte_upload_attempted: true,
    byte_upload_status_class: "2xx",
    media_finalize_attempted: true,
    media_finalize_provider_status_class: "2xx",
    media_lookup_attempted: true,
    media_ready_class: ready.media.status,
    safe_code: "FANVUE_UPLOAD_DIAGNOSTIC_OK",
    blockers: [],
  })
}
