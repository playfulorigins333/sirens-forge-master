import { decryptAutopostToken } from "./tokenCryptoCore"
import { createFanvueTextPost, deleteFanvuePost, type FanvueApiClientConfig, type FanvueApiFailure, type FanvueFetch } from "./fanvueApiClientCore"
import { authorizeFanvueUploadDiagnosticRequest, FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER, type FanvueUploadDiagnosticAuthInput, type FanvueUploadDiagnosticAuthErrorCode } from "./fanvueUploadDiagnosticAuth"
import { refreshFanvueAccessToken, type FanvueTokenRefreshResult } from "./fanvueTokenRefresh"

export const FANVUE_ONE_TEXT_POST_DIAGNOSTIC_ROUTE = "/api/admin/autopost/fanvue/one-text-post-diagnostic" as const
export const FANVUE_ONE_TEXT_POST_DIAGNOSTIC_OPERATION = "fanvue_one_text_post_diagnostic_create_and_delete_no_upload_no_media_no_price_no_schedule_no_dispatch" as const
export const FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CONFIRMATION = "REQUEST_FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CREATE_AND_DELETE_ONLY_NO_UPLOAD_NO_MEDIA_NO_PRICE_NO_SCHEDULE_NO_DISPATCH" as const
export const FANVUE_ONE_TEXT_POST_DIAGNOSTIC_TEXT = "SF_FANVUE_TEXT_DIAGNOSTIC_CREATE_DELETE_DO_NOT_REUSE" as const
export const FANVUE_ONE_TEXT_POST_DIAGNOSTIC_AUDIENCE = "subscribers" as const
export const FANVUE_ONE_TEXT_POST_DIAGNOSTIC_SECRET_HEADER = FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER

type StatusClass = "not_attempted" | "2xx" | "4xx" | "5xx" | "unknown"

export type FanvueOneTextPostDiagnosticAccount = {
  user_id?: string | null
  platform?: string | null
  connection_status?: string | null
  encrypted_access_token?: string | null
  encrypted_refresh_token?: string | null
  token_expires_at?: string | null
  token_type?: string | null
  token_key_version?: number | null
  scopes?: string[] | string | null
}

export type FanvueOneTextPostDiagnosticResult = {
  ok: boolean
  safe_code: string
  live_attempted: boolean
  create_attempted: boolean
  create_status_class: StatusClass
  provider_post_uuid_present: boolean
  cleanup_attempted: boolean
  cleanup_status_class: StatusClass
  cleanup_ok: boolean
  upload_attempted: false
  media_attempted: false
  price_used: false
  publishAt_used: false
  dispatch_attempted: false
  schedule_attempted: false
  supabase_mutated: boolean
  platform_registry_changed: false
}

export type FanvueOneTextPostDiagnosticRouteBody =
  | FanvueOneTextPostDiagnosticResult
  | { ok: false; error_code: FanvueUploadDiagnosticAuthErrorCode | "METHOD_NOT_ALLOWED" | "INVALID_BODY" | "INVALID_OPERATION" | "INVALID_CONFIRMATION" | "INVALID_TARGET_USER_ID" | "CALLER_SUPPLIED_FORBIDDEN_FIELD" }

export type FanvueOneTextPostDiagnosticRouteResponse = { status: number; body: FanvueOneTextPostDiagnosticRouteBody }

export type FanvueOneTextPostDiagnosticRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: FanvueUploadDiagnosticAuthInput["getAuthenticatedUserId"]
  createLoadAccount: () => (userId: string) => Promise<FanvueOneTextPostDiagnosticAccount | null>
  apiBaseUrl: string
  apiVersion: string
  fanvueFetch: FanvueFetch
  decryptAccessToken?: (encryptedToken: string) => string
  refreshAccessToken?: (account: FanvueOneTextPostDiagnosticAccount) => Promise<FanvueTokenRefreshResult>
  now?: () => Date
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FORBIDDEN_FIELDS = new Set(["text", "audience", "mediaUuid", "mediaUuids", "mediaPreviewUuid", "price", "amount", "currency", "paywall", "publishAt", "publish_at", "expiresAt", "expires_at", "collectionUuids", "collection_uuids", "postUuid", "post_uuid", "providerPostUuid", "provider_post_uuid", "uuid", "uploadId", "upload_id", "upload", "media", "schedule", "scheduled", "dispatch", "job", "queue"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function statusClass(status: number | null | undefined): StatusClass {
  if (typeof status !== "number") return "unknown"
  if (status >= 200 && status < 300) return "2xx"
  if (status >= 400 && status < 500) return "4xx"
  if (status >= 500) return "5xx"
  return "unknown"
}

function tokenFresh(account: FanvueOneTextPostDiagnosticAccount, now: Date) {
  if (typeof account.token_expires_at !== "string") return false
  const expiresAt = Date.parse(account.token_expires_at)
  return Number.isFinite(expiresAt) && expiresAt > now.getTime() + 60_000
}

function baseResult(overrides: Partial<FanvueOneTextPostDiagnosticResult> = {}): FanvueOneTextPostDiagnosticResult {
  return {
    ok: false,
    safe_code: "FANVUE_ONE_TEXT_POST_DIAGNOSTIC_PREFLIGHT_NO_PROVIDER_CALL",
    live_attempted: false,
    create_attempted: false,
    create_status_class: "not_attempted",
    provider_post_uuid_present: false,
    cleanup_attempted: false,
    cleanup_status_class: "not_attempted",
    cleanup_ok: false,
    upload_attempted: false,
    media_attempted: false,
    price_used: false,
    publishAt_used: false,
    dispatch_attempted: false,
    schedule_attempted: false,
    supabase_mutated: false,
    platform_registry_changed: false,
    ...overrides,
  }
}

function validateBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, error_code: "INVALID_BODY" as const }
  for (const key of Object.keys(body)) if (FORBIDDEN_FIELDS.has(key)) return { ok: false as const, error_code: "CALLER_SUPPLIED_FORBIDDEN_FIELD" as const }
  if (body.operation !== FANVUE_ONE_TEXT_POST_DIAGNOSTIC_OPERATION) return { ok: false as const, error_code: "INVALID_OPERATION" as const }
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : ""
  if (!UUID_RE.test(userId)) return { ok: false as const, error_code: "INVALID_TARGET_USER_ID" as const }
  const preflight = body.preflight !== false
  if (!preflight && body.confirm !== FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CONFIRMATION) return { ok: false as const, error_code: "INVALID_CONFIRMATION" as const }
  return { ok: true as const, userId, preflight }
}

export async function handleFanvueOneTextPostDiagnosticRoute(dependencies: FanvueOneTextPostDiagnosticRouteDependencies): Promise<FanvueOneTextPostDiagnosticRouteResponse> {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: { ok: false, error_code: "METHOD_NOT_ALLOWED" } }
  const auth = await authorizeFanvueUploadDiagnosticRequest({ request: dependencies.request, expectedSecret: dependencies.expectedSecret, adminUserIds: dependencies.adminUserIds, getAuthenticatedUserId: dependencies.getAuthenticatedUserId })
  if (auth.ok === false) return { status: auth.status, body: { ok: false, error_code: auth.error_code } }
  const parsedBody = await dependencies.request.json().catch(() => null)
  const validation = validateBody(parsedBody)
  if (!validation.ok) return { status: 400, body: { ok: false, error_code: validation.error_code } }
  if (validation.preflight) return { status: 200, body: baseResult() }

  const loadAccount = dependencies.createLoadAccount()
  let account = await loadAccount(validation.userId)
  if (!account || account.platform !== "fanvue" || account.connection_status !== "CONNECTED" || typeof account.encrypted_access_token !== "string") {
    return { status: 200, body: baseResult({ live_attempted: true, safe_code: "FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CONNECTED_ACCOUNT_REQUIRED" }) }
  }

  let supabaseMutated = false
  if (!tokenFresh(account, dependencies.now?.() ?? new Date())) {
    if (typeof account.encrypted_refresh_token !== "string" || !account.encrypted_refresh_token) {
      return { status: 200, body: baseResult({ live_attempted: true, safe_code: "FANVUE_REFRESH_TOKEN_MISSING" }) }
    }
    const refresh = dependencies.refreshAccessToken ?? ((refreshAccount) => refreshFanvueAccessToken({
      user_id: String(refreshAccount.user_id),
      platform: String(refreshAccount.platform),
      encrypted_refresh_token: String(refreshAccount.encrypted_refresh_token),
      token_expires_at: typeof refreshAccount.token_expires_at === "string" ? refreshAccount.token_expires_at : null,
      token_type: typeof refreshAccount.token_type === "string" ? refreshAccount.token_type : null,
      token_key_version: typeof refreshAccount.token_key_version === "number" ? refreshAccount.token_key_version : null,
      scopes: Array.isArray(refreshAccount.scopes) || typeof refreshAccount.scopes === "string" ? refreshAccount.scopes : null,
    }))
    const refreshResult = await refresh(account)
    if ("blocked" in refreshResult) {
      return { status: 200, body: baseResult({ live_attempted: true, safe_code: refreshResult.error_code }) }
    }
    supabaseMutated = true
    account = await loadAccount(validation.userId)
    if (!account || account.platform !== "fanvue" || account.connection_status !== "CONNECTED" || typeof account.encrypted_access_token !== "string") {
      return { status: 200, body: baseResult({ live_attempted: true, safe_code: "FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CONNECTED_ACCOUNT_REQUIRED", supabase_mutated: supabaseMutated }) }
    }
    if (!tokenFresh(account, dependencies.now?.() ?? new Date())) {
      return { status: 200, body: baseResult({ live_attempted: true, safe_code: "FANVUE_TOKEN_REFRESH_STALE", supabase_mutated: supabaseMutated }) }
    }
  }

  let accessToken = ""
  try {
    accessToken = (dependencies.decryptAccessToken ?? decryptAutopostToken)(account.encrypted_access_token)
  } catch {
    return { status: 200, body: baseResult({ live_attempted: true, safe_code: "FANVUE_ONE_TEXT_POST_DIAGNOSTIC_TOKEN_DECRYPT_FAILED", supabase_mutated: supabaseMutated }) }
  }

  const config: FanvueApiClientConfig = { accessToken, apiBaseUrl: dependencies.apiBaseUrl, apiVersion: dependencies.apiVersion, fetch: dependencies.fanvueFetch }
  const created = await createFanvueTextPost(config, { text: FANVUE_ONE_TEXT_POST_DIAGNOSTIC_TEXT, audience: FANVUE_ONE_TEXT_POST_DIAGNOSTIC_AUDIENCE })
  if (!created.ok) {
    const failure = created as FanvueApiFailure
    return { status: 200, body: baseResult({ live_attempted: true, create_attempted: true, create_status_class: statusClass(failure.status), safe_code: failure.error_code, supabase_mutated: supabaseMutated }) }
  }

  const postUuid = created.post.uuid
  const cleaned = await deleteFanvuePost(config, { uuid: postUuid })
  if (!cleaned.ok) {
    const failure = cleaned as FanvueApiFailure
    return { status: 200, body: baseResult({ live_attempted: true, create_attempted: true, create_status_class: "2xx", provider_post_uuid_present: true, cleanup_attempted: true, cleanup_status_class: statusClass(failure.status), safe_code: failure.error_code, supabase_mutated: supabaseMutated }) }
  }

  return { status: 200, body: baseResult({ ok: true, safe_code: "FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CREATE_DELETE_OK", live_attempted: true, create_attempted: true, create_status_class: "2xx", provider_post_uuid_present: true, cleanup_attempted: true, cleanup_status_class: "2xx", cleanup_ok: true, supabase_mutated: supabaseMutated }) }
}
