import { decryptAutopostToken } from "./tokenCryptoCore"
import {
  completeFanvueCreatorUploadSession,
  createFanvueCreatorUploadSession,
  createFanvueMediaPost,
  createFanvueTextPost,
  getFanvueCreatorUploadPartUrl,
  uploadFanvueSignedPart,
  waitForFanvueMediaReady,
  type FanvueApiClientConfig,
  type FanvueApiFailure,
  type FanvueFetch,
  type FanvueSignedPartUploader,
} from "./fanvueApiClientCore"
import { refreshFanvueAccessToken, type FanvueTokenRefreshResult } from "./fanvueTokenRefresh"
import { FANVUE_MEDIA_READINESS_BACKOFF_BASE_MS, FANVUE_MEDIA_READINESS_MAX_ATTEMPTS, FANVUE_MEDIA_READINESS_MAX_DELAY_MS, FANVUE_VIDEO_MEDIA_READINESS_BACKOFF_BASE_MS, FANVUE_VIDEO_MEDIA_READINESS_MAX_ATTEMPTS, FANVUE_VIDEO_MEDIA_READINESS_MAX_DELAY_MS } from "./fanvueMediaReadinessDiagnostic"

export const FANVUE_INTERNAL_SINGLE_POST_AUDIENCE = "subscribers" as const
export const FANVUE_INTERNAL_SINGLE_POST_ROUTE = "/api/admin/autopost/fanvue/internal-single-post" as const
export const FANVUE_INTERNAL_SINGLE_POST_OPERATION = "fanvue_internal_single_post_approved_content_no_price_no_schedule_no_dispatch" as const
export const FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION = "REQUEST_FANVUE_INTERNAL_SINGLE_POST_ONLY_APPROVED_CONTENT_NO_PRICE_NO_SCHEDULE_NO_DISPATCH" as const

export type FanvueInternalContentType = "text" | "media"
export type FanvueInternalStatusClass = "not_attempted" | "2xx" | "4xx" | "5xx" | "unknown"
export type FanvueInternalReadinessStatusClass = FanvueInternalStatusClass | "timeout" | "processing" | "not_ready" | "other"
export type FanvueInternalReadinessFinalState = "ready" | "processing" | "error" | "timeout" | "unknown"
export type FanvueInternalRefreshStatusClass = FanvueInternalStatusClass | "blocked"

export type FanvueInternalAccount = {
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

export type FanvueInternalApprovedMedia = {
  filename: string
  mediaType: "image" | "video"
  bytes: BodyInit
  contentType?: string | null
  size?: number | null
}

export type FanvueInternalApprovedContent = {
  platform: "fanvue"
  content_type: FanvueInternalContentType
  text?: string | null
  media?: FanvueInternalApprovedMedia | null
}

export type FanvueInternalPostInput = {
  userId: string
  account: FanvueInternalAccount | null
  content: FanvueInternalApprovedContent
  apiBaseUrl: string
  apiVersion: string
  fanvueFetch: FanvueFetch
  fetchIdentity: FanvueFetch
  signedPartUploader: FanvueSignedPartUploader
  decryptAccessToken?: (encryptedToken: string) => string
  refreshAccessToken?: (account: FanvueInternalAccount) => Promise<FanvueTokenRefreshResult>
  reloadAccountAfterRefresh?: (userId: string) => Promise<FanvueInternalAccount | null>
  now?: () => Date
  waitForMediaReady?: typeof waitForFanvueMediaReady
}

export type FanvueInternalPostResult = {
  ok: boolean
  safe_code: string
  platform: "fanvue"
  live_attempted: boolean
  content_type: FanvueInternalContentType | null
  text_present: boolean
  media_asset_present: boolean
  token_refresh_attempted: boolean
  token_refresh_status_class: FanvueInternalRefreshStatusClass
  upload_attempted: boolean
  upload_session_status_class: FanvueInternalStatusClass
  signed_url_status_class: FanvueInternalStatusClass
  byte_upload_status_class: FanvueInternalStatusClass
  finalize_status_class: FanvueInternalStatusClass
  readiness_checked: boolean
  readiness_ready: boolean
  readiness_status_class: FanvueInternalReadinessStatusClass | null
  readiness_attempts_used: number | null
  readiness_final_state: FanvueInternalReadinessFinalState | null
  create_attempted: boolean
  create_status_class: FanvueInternalStatusClass
  provider_post_uuid_present: boolean
  provider_post_uuid: string | null
  upload_cleanup_supported: false
  uploaded_media_may_remain_in_creator_media_library: boolean
  price_used: false
  publishAt_used: false
  dispatch_attempted: false
  schedule_attempted: false
  platform_registry_changed: false
  public_ui_added: false
  supabase_mutated: boolean
  safe_error_message: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TEXT_MAX = 5000

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function statusClass(status: number | null | undefined): FanvueInternalStatusClass {
  if (typeof status !== "number") return "unknown"
  if (status >= 200 && status < 300) return "2xx"
  if (status >= 400 && status < 500) return "4xx"
  if (status >= 500) return "5xx"
  return "unknown"
}

function scopeList(scopes: unknown) {
  if (Array.isArray(scopes)) return scopes.filter((scope): scope is string => typeof scope === "string")
  if (typeof scopes === "string") return scopes.split(/\s+/).filter(Boolean)
  return []
}

function tokenFresh(account: FanvueInternalAccount, now: Date) {
  if (!account.token_expires_at) return false
  const expires = Date.parse(account.token_expires_at)
  return Number.isFinite(expires) && expires > now.getTime() + 60_000
}

function baseResult(overrides: Partial<FanvueInternalPostResult> = {}): FanvueInternalPostResult {
  return {
    ok: false,
    safe_code: "FANVUE_INTERNAL_SINGLE_POST_NOT_ATTEMPTED",
    platform: "fanvue",
    live_attempted: false,
    content_type: null,
    text_present: false,
    media_asset_present: false,
    token_refresh_attempted: false,
    token_refresh_status_class: "not_attempted",
    upload_attempted: false,
    upload_session_status_class: "not_attempted",
    signed_url_status_class: "not_attempted",
    byte_upload_status_class: "not_attempted",
    finalize_status_class: "not_attempted",
    readiness_checked: false,
    readiness_ready: false,
    readiness_status_class: null,
    readiness_attempts_used: null,
    readiness_final_state: null,
    create_attempted: false,
    create_status_class: "not_attempted",
    provider_post_uuid_present: false,
    provider_post_uuid: null,
    upload_cleanup_supported: false,
    uploaded_media_may_remain_in_creator_media_library: false,
    price_used: false,
    publishAt_used: false,
    dispatch_attempted: false,
    schedule_attempted: false,
    platform_registry_changed: false,
    public_ui_added: false,
    supabase_mutated: false,
    safe_error_message: null,
    ...overrides,
  }
}


function inferContentType(media: FanvueInternalApprovedMedia) {
  const declared = clean(media.contentType)
  if (declared) return declared
  if (media.mediaType === "video") return "video/mp4"
  const filename = clean(media.filename)?.toLowerCase() ?? ""
  if (filename.endsWith(".png")) return "image/png"
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg"
  if (filename.endsWith(".webp")) return "image/webp"
  if (filename.endsWith(".gif")) return "image/gif"
  return null
}

function inferByteSize(media: FanvueInternalApprovedMedia) {
  if (typeof media.size === "number" && Number.isFinite(media.size) && media.size > 0) return Math.floor(media.size)
  const bytes = media.bytes as { size?: unknown; byteLength?: unknown; length?: unknown }
  for (const value of [bytes?.size, bytes?.byteLength, bytes?.length]) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value)
  }
  return null
}

function readinessConfig(mediaType: FanvueInternalApprovedMedia["mediaType"]) {
  if (mediaType === "video") return { maxAttempts: FANVUE_VIDEO_MEDIA_READINESS_MAX_ATTEMPTS, maxDelayMs: FANVUE_VIDEO_MEDIA_READINESS_MAX_DELAY_MS, backoffBaseMs: FANVUE_VIDEO_MEDIA_READINESS_BACKOFF_BASE_MS }
  return { maxAttempts: FANVUE_MEDIA_READINESS_MAX_ATTEMPTS, maxDelayMs: FANVUE_MEDIA_READINESS_MAX_DELAY_MS, backoffBaseMs: FANVUE_MEDIA_READINESS_BACKOFF_BASE_MS }
}

function readinessFailureStatusClass(failure: FanvueApiFailure): FanvueInternalReadinessStatusClass {
  if (failure.error_code === "FANVUE_MEDIA_READY_TIMEOUT") return "timeout"
  if (failure.error_code === "FANVUE_MEDIA_PROCESSING_ERROR") return "not_ready"
  return statusClass(failure.status) === "unknown" ? "other" : statusClass(failure.status)
}

function readinessFailureFinalState(failure: FanvueApiFailure): FanvueInternalReadinessFinalState {
  if (failure.error_code === "FANVUE_MEDIA_READY_TIMEOUT") return "timeout"
  if (failure.error_code === "FANVUE_MEDIA_PROCESSING_ERROR") return "error"
  return "unknown"
}

function accountHasScopes(account: FanvueInternalAccount, contentType: FanvueInternalContentType) {
  const scopes = scopeList(account.scopes)
  if (contentType === "text") return true
  return scopes.includes("write:media") && scopes.includes("read:media") && scopes.includes("write:creator")
}

async function resolveCreatorUuid(input: Pick<FanvueInternalPostInput, "apiBaseUrl" | "apiVersion" | "fetchIdentity">, accessToken: string) {
  let response: Awaited<ReturnType<FanvueFetch>>
  try {
    response = await input.fetchIdentity(`${input.apiBaseUrl.replace(/\/+$/, "")}/users/account`, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}`, "X-Fanvue-API-Version": input.apiVersion },
    })
  } catch {
    return { ok: false as const, safe_code: "FANVUE_INTERNAL_CREATOR_IDENTITY_NETWORK_FAILED" }
  }
  if (!response.ok) return { ok: false as const, safe_code: "FANVUE_INTERNAL_CREATOR_IDENTITY_PROVIDER_FAILED" }
  const body = await response.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false as const, safe_code: "FANVUE_INTERNAL_CREATOR_UUID_UNAVAILABLE" }
  const record = body as Record<string, unknown>
  const uuid = clean(record.uuid)
  if (record.isCreator !== true || !uuid || !UUID_RE.test(uuid)) return { ok: false as const, safe_code: "FANVUE_INTERNAL_CREATOR_UUID_UNAVAILABLE" }
  return { ok: true as const, creatorUserUuid: uuid }
}

function validateContent(content: FanvueInternalApprovedContent) {
  if (content.platform !== "fanvue") return { ok: false as const, safe_code: "FANVUE_INTERNAL_PLATFORM_INVALID" }
  if (content.content_type !== "text" && content.content_type !== "media") return { ok: false as const, safe_code: "FANVUE_INTERNAL_CONTENT_TYPE_UNSUPPORTED" }
  const text = clean(content.text)
  if (content.content_type === "text" && !text) return { ok: false as const, safe_code: "FANVUE_INTERNAL_TEXT_REQUIRED" }
  if (text && Array.from(text).length > TEXT_MAX) return { ok: false as const, safe_code: "FANVUE_INTERNAL_TEXT_TOO_LONG" }
  if (content.content_type === "media" && !content.media) return { ok: false as const, safe_code: "FANVUE_INTERNAL_MEDIA_ASSET_REQUIRED" }
  if (content.media) {
    const filename = clean(content.media.filename)
    if (!filename) return { ok: false as const, safe_code: "FANVUE_INTERNAL_MEDIA_FILENAME_REQUIRED" }
    if (content.media.mediaType !== "image" && content.media.mediaType !== "video") return { ok: false as const, safe_code: "FANVUE_INTERNAL_MEDIA_TYPE_UNSUPPORTED" }
  }
  return { ok: true as const, text }
}

export async function postFanvueInternalSinglePost(input: FanvueInternalPostInput): Promise<FanvueInternalPostResult> {
  const validation = validateContent(input.content)
  const contentFlags = {
    content_type: input.content?.content_type ?? null,
    text_present: nonEmptyString(input.content?.text),
    media_asset_present: Boolean(input.content?.media),
  }
  if (!validation.ok) return baseResult({ ...contentFlags, safe_code: validation.safe_code })

  let account = input.account
  if (!account || account.user_id !== input.userId || account.platform !== "fanvue" || account.connection_status !== "CONNECTED" || !nonEmptyString(account.encrypted_access_token)) {
    return baseResult({ ...contentFlags, live_attempted: true, safe_code: "FANVUE_INTERNAL_CONNECTED_ACCOUNT_REQUIRED" })
  }
  if (!accountHasScopes(account, input.content.content_type)) {
    return baseResult({ ...contentFlags, live_attempted: true, safe_code: "FANVUE_INTERNAL_REQUIRED_SCOPES_MISSING" })
  }

  let refreshAttempted = false
  let refreshStatusClass: FanvueInternalRefreshStatusClass = "not_attempted"
  let supabaseMutated = false
  if (!tokenFresh(account, input.now?.() ?? new Date())) {
    refreshAttempted = true
    if (!nonEmptyString(account.encrypted_refresh_token)) return baseResult({ ...contentFlags, live_attempted: true, token_refresh_attempted: true, token_refresh_status_class: "blocked", safe_code: "FANVUE_REFRESH_TOKEN_MISSING" })
    const refresh = input.refreshAccessToken ?? ((refreshAccount) => refreshFanvueAccessToken({
      user_id: String(refreshAccount.user_id),
      platform: String(refreshAccount.platform),
      encrypted_refresh_token: String(refreshAccount.encrypted_refresh_token),
      token_expires_at: refreshAccount.token_expires_at ?? null,
      token_type: refreshAccount.token_type ?? null,
      token_key_version: refreshAccount.token_key_version ?? null,
      scopes: refreshAccount.scopes ?? null,
    }))
    const refreshResult = await refresh(account)
    if ("blocked" in refreshResult) return baseResult({ ...contentFlags, live_attempted: true, token_refresh_attempted: true, token_refresh_status_class: "blocked", safe_code: refreshResult.error_code, safe_error_message: refreshResult.safe_error_message })
    supabaseMutated = true
    refreshStatusClass = "2xx"
    if (input.reloadAccountAfterRefresh) {
      account = await input.reloadAccountAfterRefresh(input.userId)
      if (!account || account.user_id !== input.userId || account.platform !== "fanvue" || account.connection_status !== "CONNECTED" || !nonEmptyString(account.encrypted_access_token) || !tokenFresh(account, input.now?.() ?? new Date())) {
        return baseResult({ ...contentFlags, live_attempted: true, token_refresh_attempted: true, token_refresh_status_class: refreshStatusClass, supabase_mutated: supabaseMutated, safe_code: "FANVUE_TOKEN_REFRESH_STALE" })
      }
    }
  }

  let accessToken = ""
  try {
    accessToken = (input.decryptAccessToken ?? decryptAutopostToken)(String(account.encrypted_access_token))
  } catch {
    return baseResult({ ...contentFlags, live_attempted: true, token_refresh_attempted: refreshAttempted, token_refresh_status_class: refreshStatusClass, supabase_mutated: supabaseMutated, safe_code: "FANVUE_INTERNAL_TOKEN_DECRYPT_FAILED" })
  }

  const config: FanvueApiClientConfig = { accessToken, apiBaseUrl: input.apiBaseUrl, apiVersion: input.apiVersion, fetch: input.fanvueFetch }

  if (input.content.content_type === "text") {
    const created = await createFanvueTextPost(config, { text: validation.text!, audience: FANVUE_INTERNAL_SINGLE_POST_AUDIENCE })
    if (!created.ok) {
      const failure = created as FanvueApiFailure
      return baseResult({ ...contentFlags, live_attempted: true, token_refresh_attempted: refreshAttempted, token_refresh_status_class: refreshStatusClass, supabase_mutated: supabaseMutated, create_attempted: true, create_status_class: statusClass(failure.status), safe_code: failure.error_code, safe_error_message: failure.safe_error_message })
    }
    return baseResult({ ...contentFlags, ok: true, safe_code: "FANVUE_INTERNAL_SINGLE_POST_CREATED", live_attempted: true, token_refresh_attempted: refreshAttempted, token_refresh_status_class: refreshStatusClass, supabase_mutated: supabaseMutated, create_attempted: true, create_status_class: "2xx", provider_post_uuid_present: true, provider_post_uuid: created.post.uuid })
  }

  const creator = await resolveCreatorUuid(input, accessToken)
  if (!creator.ok) return baseResult({ ...contentFlags, live_attempted: true, token_refresh_attempted: refreshAttempted, token_refresh_status_class: refreshStatusClass, supabase_mutated: supabaseMutated, safe_code: creator.safe_code })

  const media = input.content.media!
  const uploadFlags = { ...contentFlags, live_attempted: true, token_refresh_attempted: refreshAttempted, token_refresh_status_class: refreshStatusClass, supabase_mutated: supabaseMutated, upload_attempted: true, uploaded_media_may_remain_in_creator_media_library: true }
  const contentType = inferContentType(media)
  const mediaSize = inferByteSize(media)
  const session = await createFanvueCreatorUploadSession(config, { creatorUserUuid: creator.creatorUserUuid, name: media.filename, filename: media.filename, mediaType: media.mediaType, contentType, size: mediaSize })
  if (!session.ok) { const failure = session as FanvueApiFailure; return baseResult({ ...uploadFlags, upload_session_status_class: statusClass(failure.status), safe_code: failure.error_code, safe_error_message: failure.safe_error_message }) }
  const signed = await getFanvueCreatorUploadPartUrl(config, { creatorUserUuid: creator.creatorUserUuid, uploadId: session.uploadId, partNumber: 1 })
  if (!signed.ok) { const failure = signed as FanvueApiFailure; return baseResult({ ...uploadFlags, upload_session_status_class: "2xx", signed_url_status_class: statusClass(failure.status), safe_code: failure.error_code, safe_error_message: failure.safe_error_message }) }
  const byteUpload = await uploadFanvueSignedPart({ signedUrl: signed.signed_url, partNumber: 1, body: media.bytes, contentType, uploader: input.signedPartUploader })
  if (!byteUpload.ok) { const failure = byteUpload as FanvueApiFailure; return baseResult({ ...uploadFlags, upload_session_status_class: "2xx", signed_url_status_class: "2xx", byte_upload_status_class: statusClass(failure.status), safe_code: failure.error_code, safe_error_message: failure.safe_error_message }) }
  const finalized = await completeFanvueCreatorUploadSession(config, { creatorUserUuid: creator.creatorUserUuid, uploadId: session.uploadId, parts: [byteUpload.part], mediaType: media.mediaType, filename: media.filename, contentType, size: mediaSize })
  if (!finalized.ok) { const failure = finalized as FanvueApiFailure; return baseResult({ ...uploadFlags, upload_session_status_class: "2xx", signed_url_status_class: "2xx", byte_upload_status_class: "2xx", finalize_status_class: statusClass(failure.status), safe_code: failure.error_code, safe_error_message: failure.safe_error_message }) }
  const ready = await (input.waitForMediaReady ?? waitForFanvueMediaReady)(config, { uuid: session.mediaUuid, ...readinessConfig(media.mediaType) })
  const readyFlags = { ...uploadFlags, upload_session_status_class: "2xx" as const, signed_url_status_class: "2xx" as const, byte_upload_status_class: "2xx" as const, finalize_status_class: "2xx" as const, readiness_checked: true, readiness_attempts_used: ready.attempts ?? null }
  if (!ready.ok) { const failure = ready as FanvueApiFailure; return baseResult({ ...readyFlags, readiness_status_class: readinessFailureStatusClass(failure), readiness_final_state: readinessFailureFinalState(failure), safe_code: failure.error_code === "FANVUE_MEDIA_READY_TIMEOUT" ? "FANVUE_INTERNAL_MEDIA_NOT_READY" : failure.error_code, safe_error_message: failure.safe_error_message }) }
  const created = await createFanvueMediaPost(config, { text: validation.text, audience: FANVUE_INTERNAL_SINGLE_POST_AUDIENCE, mediaUuids: [session.mediaUuid] })
  if (!created.ok) { const failure = created as FanvueApiFailure; return baseResult({ ...readyFlags, readiness_ready: true, readiness_status_class: "2xx", readiness_final_state: "ready", create_attempted: true, create_status_class: statusClass(failure.status), safe_code: failure.error_code, safe_error_message: failure.safe_error_message }) }
  return baseResult({ ...readyFlags, ok: true, safe_code: "FANVUE_INTERNAL_SINGLE_POST_CREATED", readiness_ready: true, readiness_status_class: "2xx", readiness_final_state: "ready", create_attempted: true, create_status_class: "2xx", provider_post_uuid_present: true, provider_post_uuid: created.post.uuid })
}

export function redactFanvueInternalPostResult(result: FanvueInternalPostResult): Omit<FanvueInternalPostResult, "provider_post_uuid" | "safe_error_message"> {
  // Keep full provider UUIDs and detailed provider messages out of route responses.
  // The internal adapter result can still be used by the persistence layer.
  const { provider_post_uuid: _providerPostUuid, safe_error_message: _safeErrorMessage, ...safe } = result
  return safe
}
