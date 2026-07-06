import { decryptAutopostToken } from "./tokenCryptoCore"
import { createFanvueMediaPost, deleteFanvuePost, completeFanvueUploadSession, createFanvueCreatorUploadSession, getFanvueCreatorUploadPartUrl, uploadFanvueSignedPart, waitForFanvueMediaReady, type FanvueApiClientConfig, type FanvueApiFailure, type FanvueFetch, type FanvueSignedPartUploader } from "./fanvueApiClientCore"
import { authorizeFanvueUploadDiagnosticRequest, FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER, type FanvueUploadDiagnosticAuthInput, type FanvueUploadDiagnosticAuthErrorCode } from "./fanvueUploadDiagnosticAuth"
import { type FanvueIdentityFetch, type FanvueUploadDiagnosticAccount } from "./fanvueUploadDiagnostic"
import { FANVUE_MEDIA_READINESS_BACKOFF_BASE_MS, FANVUE_MEDIA_READINESS_DIAGNOSTIC_FILENAME, FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG, FANVUE_MEDIA_READINESS_MAX_ATTEMPTS, FANVUE_MEDIA_READINESS_MAX_DELAY_MS } from "./fanvueMediaReadinessDiagnostic"
import { refreshFanvueAccessToken, type FanvueTokenRefreshResult } from "./fanvueTokenRefresh"

export const FANVUE_MEDIA_POST_DIAGNOSTIC_ROUTE = "/api/admin/autopost/fanvue/media-post-diagnostic" as const
export const FANVUE_MEDIA_POST_DIAGNOSTIC_OPERATION = "fanvue_media_post_diagnostic_create_delete_one_upload_no_price_no_schedule_no_dispatch" as const
export const FANVUE_MEDIA_POST_DIAGNOSTIC_CONFIRMATION = "REQUEST_FANVUE_MEDIA_POST_DIAGNOSTIC_CREATE_DELETE_ONLY_ONE_UPLOAD_NO_PRICE_NO_SCHEDULE_NO_DISPATCH" as const
export const FANVUE_MEDIA_POST_DIAGNOSTIC_TEXT = "SF_FANVUE_MEDIA_POST_DIAGNOSTIC_CREATE_DELETE_DO_NOT_REUSE" as const
export const FANVUE_MEDIA_POST_DIAGNOSTIC_AUDIENCE = "subscribers" as const
export const FANVUE_MEDIA_POST_DIAGNOSTIC_SECRET_HEADER = FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER

type StatusClass = "not_attempted" | "2xx" | "4xx" | "5xx" | "unknown"
type RefreshStatusClass = StatusClass | "blocked"

export type FanvueMediaPostDiagnosticAccount = FanvueUploadDiagnosticAccount

export type FanvueMediaPostDiagnosticResult = {
  ok: boolean
  safe_code: string
  live_attempted: boolean
  token_refresh_attempted: boolean
  token_refresh_status_class: RefreshStatusClass
  upload_attempted: boolean
  upload_session_status_class: StatusClass
  signed_url_status_class: StatusClass
  byte_upload_status_class: StatusClass
  finalize_status_class: StatusClass
  readiness_checked: boolean
  readiness_ready: boolean
  provider_media_uuid_present: boolean
  create_attempted: boolean
  create_status_class: StatusClass
  provider_post_uuid_present: boolean
  cleanup_attempted: boolean
  cleanup_status_class: StatusClass
  cleanup_ok: boolean
  media_attempted: boolean
  price_used: false
  publishAt_used: false
  dispatch_attempted: false
  schedule_attempted: false
  supabase_mutated: boolean
  platform_registry_changed: false
  uploaded_media_cleanup_supported: false
  uploaded_media_may_remain_in_creator_media_library: boolean
}

export type FanvueMediaPostDiagnosticRouteBody = FanvueMediaPostDiagnosticResult | { ok: false; error_code: FanvueUploadDiagnosticAuthErrorCode | "METHOD_NOT_ALLOWED" | "INVALID_BODY" | "INVALID_OPERATION" | "INVALID_CONFIRMATION" | "INVALID_TARGET_USER_ID" | "CALLER_SUPPLIED_FORBIDDEN_FIELD" }
export type FanvueMediaPostDiagnosticRouteResponse = { status: number; body: FanvueMediaPostDiagnosticRouteBody }

export type FanvueMediaPostDiagnosticRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: FanvueUploadDiagnosticAuthInput["getAuthenticatedUserId"]
  createLoadAccount: () => (userId: string) => Promise<FanvueMediaPostDiagnosticAccount | null>
  fetchIdentity: FanvueIdentityFetch
  fanvueFetch: FanvueFetch
  signedPartUploader: FanvueSignedPartUploader
  apiBaseUrl: string
  apiVersion: string
  decryptAccessToken?: (encryptedToken: string) => string
  refreshAccessToken?: (account: FanvueMediaPostDiagnosticAccount) => Promise<FanvueTokenRefreshResult>
  now?: () => Date
  waitForMediaReady?: typeof waitForFanvueMediaReady
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FORBIDDEN_FIELDS = new Set(["text", "audience", "mediaUuid", "mediaUuids", "mediaPreviewUuid", "price", "amount", "currency", "paywall", "publishAt", "publish_at", "expiresAt", "expires_at", "collectionUuids", "collection_uuids", "postUuid", "post_uuid", "providerPostUuid", "provider_post_uuid", "uuid", "uploadId", "upload_id", "upload", "media", "file", "fileBytes", "fileUrl", "file_url", "bytes", "url", "schedule", "scheduled", "dispatch", "job", "queue", "platform", "public_ui", "platform_registry"])

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
function statusClass(status: number | null | undefined): StatusClass { if (typeof status !== "number") return "unknown"; if (status >= 200 && status < 300) return "2xx"; if (status >= 400 && status < 500) return "4xx"; if (status >= 500) return "5xx"; return "unknown" }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
function tokenFresh(account: FanvueMediaPostDiagnosticAccount, now: Date) { if (!account.token_expires_at) return false; const expires = Date.parse(account.token_expires_at); return Number.isFinite(expires) && expires > now.getTime() + 60_000 }
function scopeList(scopes: unknown) { if (Array.isArray(scopes)) return scopes.filter((scope): scope is string => typeof scope === "string"); if (typeof scopes === "string") return scopes.split(/\s+/).filter(Boolean); return [] }

function baseResult(overrides: Partial<FanvueMediaPostDiagnosticResult> = {}): FanvueMediaPostDiagnosticResult {
  return { ok: false, safe_code: "FANVUE_MEDIA_POST_DIAGNOSTIC_PREFLIGHT_NO_PROVIDER_CALL", live_attempted: false, token_refresh_attempted: false, token_refresh_status_class: "not_attempted", upload_attempted: false, upload_session_status_class: "not_attempted", signed_url_status_class: "not_attempted", byte_upload_status_class: "not_attempted", finalize_status_class: "not_attempted", readiness_checked: false, readiness_ready: false, provider_media_uuid_present: false, create_attempted: false, create_status_class: "not_attempted", provider_post_uuid_present: false, cleanup_attempted: false, cleanup_status_class: "not_attempted", cleanup_ok: false, media_attempted: false, price_used: false, publishAt_used: false, dispatch_attempted: false, schedule_attempted: false, supabase_mutated: false, platform_registry_changed: false, uploaded_media_cleanup_supported: false, uploaded_media_may_remain_in_creator_media_library: false, ...overrides }
}

function validateBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, error_code: "INVALID_BODY" as const }
  for (const key of Object.keys(body)) if (FORBIDDEN_FIELDS.has(key)) return { ok: false as const, error_code: "CALLER_SUPPLIED_FORBIDDEN_FIELD" as const }
  if (body.operation !== FANVUE_MEDIA_POST_DIAGNOSTIC_OPERATION) return { ok: false as const, error_code: "INVALID_OPERATION" as const }
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : ""
  if (!UUID_RE.test(userId)) return { ok: false as const, error_code: "INVALID_TARGET_USER_ID" as const }
  const preflight = body.preflight !== false
  if (!preflight && body.confirm !== FANVUE_MEDIA_POST_DIAGNOSTIC_CONFIRMATION) return { ok: false as const, error_code: "INVALID_CONFIRMATION" as const }
  return { ok: true as const, userId, preflight }
}

async function resolveCreatorUuid(dependencies: FanvueMediaPostDiagnosticRouteDependencies, accessToken: string) {
  const response = await dependencies.fetchIdentity(`${dependencies.apiBaseUrl.replace(/\/+$/, "")}/users/account`, { method: "GET", headers: { authorization: `Bearer ${accessToken}`, "X-Fanvue-API-Version": dependencies.apiVersion } })
  if (!response.ok) return { ok: false as const, safe_code: "FANVUE_MEDIA_POST_IDENTITY_PROVIDER_FAILED" }
  const body = await response.json().catch(() => null)
  if (!isRecord(body) || body.isCreator !== true || !nonEmptyString(body.uuid) || !UUID_RE.test(body.uuid)) return { ok: false as const, safe_code: "FANVUE_MEDIA_POST_CREATOR_UUID_UNAVAILABLE" }
  return { ok: true as const, creatorUserUuid: body.uuid.trim() }
}

export async function handleFanvueMediaPostDiagnosticRoute(dependencies: FanvueMediaPostDiagnosticRouteDependencies): Promise<FanvueMediaPostDiagnosticRouteResponse> {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: { ok: false, error_code: "METHOD_NOT_ALLOWED" } }
  const auth = await authorizeFanvueUploadDiagnosticRequest({ request: dependencies.request, expectedSecret: dependencies.expectedSecret, adminUserIds: dependencies.adminUserIds, getAuthenticatedUserId: dependencies.getAuthenticatedUserId })
  if (auth.ok === false) return { status: auth.status, body: { ok: false, error_code: auth.error_code } }
  const validation = validateBody(await dependencies.request.json().catch(() => null))
  if (!validation.ok) return { status: 400, body: { ok: false, error_code: validation.error_code } }
  if (validation.preflight) return { status: 200, body: baseResult() }

  const loadAccount = dependencies.createLoadAccount()
  let account = await loadAccount(validation.userId)
  const accountValid = (candidate: FanvueMediaPostDiagnosticAccount | null) => candidate?.user_id === validation.userId && candidate.platform === "fanvue" && candidate.connection_status === "CONNECTED" && nonEmptyString(candidate.encrypted_access_token) && scopeList(candidate.scopes).includes("write:media") && scopeList(candidate.scopes).includes("read:media") && scopeList(candidate.scopes).includes("write:creator")
  if (!accountValid(account)) return { status: 200, body: baseResult({ live_attempted: true, safe_code: "FANVUE_MEDIA_POST_DIAGNOSTIC_CONNECTED_ACCOUNT_REQUIRED" }) }

  let supabaseMutated = false
  let refreshAttempted = false
  let refreshStatusClass: RefreshStatusClass = "not_attempted"
  if (!tokenFresh(account!, dependencies.now?.() ?? new Date())) {
    refreshAttempted = true
    if (!nonEmptyString(account!.encrypted_refresh_token)) return { status: 200, body: baseResult({ live_attempted: true, token_refresh_attempted: true, token_refresh_status_class: "blocked", safe_code: "FANVUE_REFRESH_TOKEN_MISSING" }) }
    const refresh = dependencies.refreshAccessToken ?? ((refreshAccount) => refreshFanvueAccessToken({ user_id: refreshAccount.user_id, platform: refreshAccount.platform, encrypted_refresh_token: String(refreshAccount.encrypted_refresh_token), token_expires_at: refreshAccount.token_expires_at ?? null, token_type: refreshAccount.token_type ?? null, token_key_version: refreshAccount.token_key_version ?? null, scopes: refreshAccount.scopes ?? null }))
    const refreshResult = await refresh(account!)
    if ("blocked" in refreshResult) return { status: 200, body: baseResult({ live_attempted: true, token_refresh_attempted: true, token_refresh_status_class: "blocked", safe_code: refreshResult.error_code }) }
    supabaseMutated = true
    refreshStatusClass = "2xx"
    account = await loadAccount(validation.userId)
    if (!accountValid(account) || !tokenFresh(account!, dependencies.now?.() ?? new Date())) return { status: 200, body: baseResult({ live_attempted: true, token_refresh_attempted: true, token_refresh_status_class: refreshStatusClass, safe_code: "FANVUE_TOKEN_REFRESH_STALE", supabase_mutated: supabaseMutated }) }
  }

  let accessToken = ""
  try { accessToken = (dependencies.decryptAccessToken ?? decryptAutopostToken)(String(account!.encrypted_access_token)) } catch { return { status: 200, body: baseResult({ live_attempted: true, token_refresh_attempted: refreshAttempted, token_refresh_status_class: refreshStatusClass, safe_code: "FANVUE_MEDIA_POST_DIAGNOSTIC_TOKEN_DECRYPT_FAILED", supabase_mutated: supabaseMutated }) } }
  const creator = await resolveCreatorUuid(dependencies, accessToken)
  if (!creator.ok) return { status: 200, body: baseResult({ live_attempted: true, token_refresh_attempted: refreshAttempted, token_refresh_status_class: refreshStatusClass, safe_code: creator.safe_code, supabase_mutated: supabaseMutated }) }

  const config: FanvueApiClientConfig = { accessToken, apiBaseUrl: dependencies.apiBaseUrl, apiVersion: dependencies.apiVersion, fetch: dependencies.fanvueFetch }
  const upload = { live_attempted: true, token_refresh_attempted: refreshAttempted, token_refresh_status_class: refreshStatusClass, upload_attempted: true, media_attempted: true, uploaded_media_may_remain_in_creator_media_library: true, supabase_mutated: supabaseMutated }
  const session = await createFanvueCreatorUploadSession(config, { creatorUserUuid: creator.creatorUserUuid, name: FANVUE_MEDIA_READINESS_DIAGNOSTIC_FILENAME, filename: FANVUE_MEDIA_READINESS_DIAGNOSTIC_FILENAME, mediaType: "image" })
  if (!session.ok) { const failure = session as FanvueApiFailure; return { status: 200, body: baseResult({ ...upload, upload_session_status_class: statusClass(failure.status), safe_code: failure.error_code }) } }
  const signed = await getFanvueCreatorUploadPartUrl(config, { creatorUserUuid: creator.creatorUserUuid, uploadId: session.uploadId, partNumber: 1 })
  if (!signed.ok) { const failure = signed as FanvueApiFailure; return { status: 200, body: baseResult({ ...upload, upload_session_status_class: "2xx", signed_url_status_class: statusClass(failure.status), provider_media_uuid_present: true, safe_code: failure.error_code }) } }
  const byteUpload = await uploadFanvueSignedPart({ signedUrl: signed.signed_url, partNumber: 1, body: FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG, uploader: dependencies.signedPartUploader })
  if (!byteUpload.ok) { const failure = byteUpload as FanvueApiFailure; return { status: 200, body: baseResult({ ...upload, upload_session_status_class: "2xx", signed_url_status_class: "2xx", byte_upload_status_class: statusClass(failure.status), provider_media_uuid_present: true, safe_code: failure.error_code }) } }
  const finalized = await completeFanvueUploadSession(config, { uploadId: session.uploadId, parts: [byteUpload.part] })
  if (!finalized.ok) { const failure = finalized as FanvueApiFailure; return { status: 200, body: baseResult({ ...upload, upload_session_status_class: "2xx", signed_url_status_class: "2xx", byte_upload_status_class: "2xx", finalize_status_class: statusClass(failure.status), provider_media_uuid_present: true, safe_code: failure.error_code }) } }
  const ready = await (dependencies.waitForMediaReady ?? waitForFanvueMediaReady)(config, { uuid: session.mediaUuid, maxAttempts: FANVUE_MEDIA_READINESS_MAX_ATTEMPTS, maxDelayMs: FANVUE_MEDIA_READINESS_MAX_DELAY_MS, backoffBaseMs: FANVUE_MEDIA_READINESS_BACKOFF_BASE_MS })
  if (!ready.ok) {
    const failure = ready as FanvueApiFailure
    const safeCode = failure.error_code === "FANVUE_MEDIA_READY_TIMEOUT" ? "FANVUE_MEDIA_NOT_READY_TIMEOUT" : failure.error_code
    return { status: 200, body: baseResult({ ...upload, upload_session_status_class: "2xx", signed_url_status_class: "2xx", byte_upload_status_class: "2xx", finalize_status_class: "2xx", readiness_checked: true, provider_media_uuid_present: true, safe_code: safeCode }) }
  }

  const created = await createFanvueMediaPost(config, { text: FANVUE_MEDIA_POST_DIAGNOSTIC_TEXT, audience: FANVUE_MEDIA_POST_DIAGNOSTIC_AUDIENCE, mediaUuids: [session.mediaUuid] })
  const readyFlags = { ...upload, upload_session_status_class: "2xx" as const, signed_url_status_class: "2xx" as const, byte_upload_status_class: "2xx" as const, finalize_status_class: "2xx" as const, readiness_checked: true, readiness_ready: true, provider_media_uuid_present: true, create_attempted: true }
  if (!created.ok) { const failure = created as FanvueApiFailure; return { status: 200, body: baseResult({ ...readyFlags, create_status_class: statusClass(failure.status), safe_code: failure.error_code }) } }
  const cleaned = await deleteFanvuePost(config, { uuid: created.post.uuid })
  if (!cleaned.ok) { const failure = cleaned as FanvueApiFailure; return { status: 200, body: baseResult({ ...readyFlags, create_status_class: "2xx", provider_post_uuid_present: true, cleanup_attempted: true, cleanup_status_class: statusClass(failure.status), safe_code: failure.error_code }) } }
  return { status: 200, body: baseResult({ ...readyFlags, ok: true, safe_code: "FANVUE_MEDIA_POST_DIAGNOSTIC_CREATE_DELETE_OK", create_status_class: "2xx", provider_post_uuid_present: true, cleanup_attempted: true, cleanup_status_class: "2xx", cleanup_ok: true }) }
}
