import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin"
import { refreshFanvueAccessToken, type FanvueTokenRefreshResult } from "../../../lib/autopost/fanvueTokenRefresh"
import {
  completeFanvueUploadSession,
  createFanvueUploadSession,
  getFanvueUploadPartUrl,
  uploadFanvueSignedPart,
  waitForFanvueMediaReady,
  type FanvueApiFailure,
  type FanvueFetch,
  type FanvueSignedPartUploader,
} from "../../../lib/autopost/fanvueApiClientCore"

/**
 * FV-37 hard-gated local/admin runner for a single connected-user Fanvue
 * photo media upload/readback test. This file intentionally lives outside
 * app/api, UI code, and public run dispatch. It never creates posts, updates
 * jobs, advances schedules, or persists upload results.
 *
 * Local preflight shape (safe gate-disabled CLI path; must print blocked JSON and must not call Fanvue):
 * DOTENV_CONFIG_PATH=.env.local FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENABLED=false FANVUE_RUN_DISPATCH_ENABLED=false FANVUE_POST_VERIFY_ENABLED=false npx tsx -r dotenv/config backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts --operation upload_photo_only --user-id <uuid> --file <local image path> --confirm "UPLOAD_ONE_FANVUE_PHOTO_NO_POST"
 *
 * DO NOT RUN UNTIL HUMAN APPROVES FV-40. Future single-process live upload-only command shape:
 * DOTENV_CONFIG_PATH=.env.local FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENABLED=true FANVUE_RUN_DISPATCH_ENABLED=false FANVUE_POST_VERIFY_ENABLED=false npx tsx -r dotenv/config backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts --operation upload_photo_only --user-id <uuid> --file <local image path> --confirm "UPLOAD_ONE_FANVUE_PHOTO_NO_POST"
 *
 * Live execution additionally requires:
 * FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENABLED === "true"
 */

export const FANVUE_PHOTO_UPLOAD_OPERATION = "upload_photo_only" as const
export const FANVUE_PHOTO_UPLOAD_CONFIRMATION = "UPLOAD_ONE_FANVUE_PHOTO_NO_POST" as const
export const FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENV = "FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENABLED" as const
export const FANVUE_TOKEN_FRESHNESS_BUFFER_MS = 5 * 60 * 1000
// Admin upload-only media processing wait. This is deliberately scoped to the
// hard-gated upload/readback runner and is not public posting, dispatch,
// scheduling, or launch-readiness behavior. Tests inject sleep so this real
// runtime window does not slow local safety checks.
export const FANVUE_ADMIN_UPLOAD_ONLY_MEDIA_READY_MAX_ATTEMPTS = 18
export const FANVUE_ADMIN_UPLOAD_ONLY_MEDIA_READY_BACKOFF_BASE_MS = 5_000
export const FANVUE_ADMIN_UPLOAD_ONLY_MEDIA_READY_MAX_DELAY_MS = 5_000

const POST_RELATED_FIELDS = new Set([
  "caption",
  "text",
  "audience",
  "publishAt",
  "expiresAt",
  "collectionUuids",
  "mediaPreviewUuid",
  "post",
  "postUuid",
  "platform_post_id",
])

const SUSPICIOUS_FILENAME_RE = /(secret|token|credential|password|private|oauth|cookie|supabase|service[_-]?role|client[_-]?secret)/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type FanvueLivePhotoUploadArgs = {
  operation?: string | null
  userId?: string | null
  filePath?: string | null
  confirm?: string | null
  payload?: Record<string, unknown> | null
}

export type FanvueAutopostAccountRow = {
  user_id?: unknown
  platform?: unknown
  connection_status?: unknown
  metadata?: Record<string, unknown> | null
  provider_account_id?: unknown
  encrypted_access_token?: unknown
  encrypted_refresh_token?: unknown
  token_expires_at?: unknown
  token_type?: unknown
  token_key_version?: unknown
  last_refresh_at?: unknown
  scopes?: unknown
}

export type FanvueUploadOnlySuccess = {
  ok: true
  operation: typeof FANVUE_PHOTO_UPLOAD_OPERATION
  platform: "fanvue"
  provider_media_uuid: string
  media_status: "ready"
  media_type: "image"
  upload_session_created: true
  signed_part_uploaded: true
  upload_completion_accepted: true
  media_ready_readback: true
  attempts: number
  posted_proof: false
  platform_post_id: null
}

export type FanvueUploadFailedStep = "create_upload_session" | "get_signed_part_url" | "upload_signed_part" | "complete_upload" | "media_readback"

export type FanvueUploadBlockedResult = {
  ok: false
  blocked: true
  error_code: string
  safe_error_message: string
  provider_calls_attempted: boolean
  posted_proof: false
  platform_post_id: null
  failed_step?: FanvueUploadFailedStep
  provider_status?: number
  provider_error_code?: string
  provider_route?: string
}

function blocked(error_code: string, safe_error_message: string): FanvueUploadBlockedResult {
  return { ok: false, blocked: true, error_code, safe_error_message, provider_calls_attempted: false, posted_proof: false, platform_post_id: null }
}

function failed(error_code: string, safe_error_message: string, provider_calls_attempted: boolean): FanvueUploadBlockedResult {
  return { ok: false, blocked: true, error_code, safe_error_message, provider_calls_attempted, posted_proof: false, platform_post_id: null }
}

function sanitizeProviderErrorCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return /^[A-Z0-9_]{3,80}$/.test(value) ? value : undefined
}

function fromApiFailure(result: FanvueApiFailure, provider_calls_attempted: boolean, failed_step: FanvueUploadFailedStep, provider_route: string): FanvueUploadBlockedResult {
  const authFailure = result.status === 401 || result.status === 403 || result.error_code === "FANVUE_UNAUTHORIZED"
  const base = failed(
    authFailure ? "FANVUE_UNAUTHORIZED" : result.error_code,
    authFailure ? "Fanvue rejected the request authorization." : result.safe_error_message,
    provider_calls_attempted,
  )
  return {
    ...base,
    failed_step,
    ...(typeof result.status === "number" ? { provider_status: result.status } : {}),
    ...(sanitizeProviderErrorCode(result.error_code) ? { provider_error_code: result.error_code } : {}),
    provider_route,
  }
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

export function parseFanvueLivePhotoUploadArgs(argv: string[]): FanvueLivePhotoUploadArgs {
  const args: FanvueLivePhotoUploadArgs = {}
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index]
    const next = argv[index + 1]
    if (item === "--operation") { args.operation = next; index++; continue }
    if (item === "--user-id") { args.userId = next; index++; continue }
    if (item === "--file") { args.filePath = next; index++; continue }
    if (item === "--confirm") { args.confirm = next; index++; continue }
  }
  return args
}

export function validateNoPostPayload(payload: Record<string, unknown> | null | undefined): FanvueUploadBlockedResult | null {
  if (!payload) return null
  for (const key of Object.keys(payload)) {
    if (POST_RELATED_FIELDS.has(key)) {
      return blocked("FANVUE_UPLOAD_POST_FIELD_REJECTED", `Post-related field is not allowed for upload-only dry run: ${key}.`)
    }
    const value = payload[key]
    if (typeof value === "string" && /\/posts(?:\/|$)/i.test(value)) {
      return blocked("FANVUE_UPLOAD_POST_ROUTE_REJECTED", "Post routes are not allowed for upload-only dry run.")
    }
  }
  return null
}

export function validateHardDisabledGate(args: FanvueLivePhotoUploadArgs, env: Record<string, string | undefined> = process.env): FanvueUploadBlockedResult | null {
  if (args.operation !== FANVUE_PHOTO_UPLOAD_OPERATION) return blocked("FANVUE_UPLOAD_OPERATION_INVALID", "Operation must be upload_photo_only.")
  if (!nonEmptyString(args.userId) || !UUID_RE.test(String(args.userId))) return blocked("FANVUE_UPLOAD_USER_ID_REQUIRED", "A target app user UUID is required.")
  if (!nonEmptyString(args.filePath)) return blocked("FANVUE_UPLOAD_FILE_REQUIRED", "A local controlled test image path is required.")
  const noPost = validateNoPostPayload(args.payload)
  if (noPost) return noPost
  if (args.confirm !== FANVUE_PHOTO_UPLOAD_CONFIRMATION) return blocked("FANVUE_UPLOAD_CONFIRMATION_REQUIRED", "Exact confirmation phrase is required before any future live upload.")
  if (env[FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENV] !== "true") return blocked("FANVUE_UPLOAD_LIVE_GATE_DISABLED", "Fanvue admin live photo upload gate is disabled.")
  return null
}

function scopeList(scopes: unknown) {
  if (Array.isArray(scopes)) return scopes.filter((scope): scope is string => typeof scope === "string").map((scope) => scope.trim()).filter(Boolean)
  if (typeof scopes === "string") return scopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
  return []
}

export function validateFanvueAccessTokenFreshness(account: Pick<FanvueAutopostAccountRow, "token_expires_at"> | null | undefined, nowMs: number = Date.now()): FanvueUploadBlockedResult | { ok: true; tokenExpiresAt: Date } {
  const stale = () => blocked("FANVUE_TOKEN_FRESHNESS_REQUIRED", "Fanvue access token needs refresh before media upload.")
  if (!account || account.token_expires_at == null) return stale()
  if (typeof account.token_expires_at !== "string" && typeof account.token_expires_at !== "number" && !(account.token_expires_at instanceof Date)) return stale()

  const tokenExpiresAt = new Date(account.token_expires_at)
  const expiresAtMs = tokenExpiresAt.getTime()
  if (!Number.isFinite(expiresAtMs)) return stale()
  if (expiresAtMs <= nowMs + FANVUE_TOKEN_FRESHNESS_BUFFER_MS) return stale()

  return { ok: true, tokenExpiresAt }
}

export function validateFanvueAccountForPhotoUpload(account: FanvueAutopostAccountRow | null | undefined, targetUserId: string): FanvueUploadBlockedResult | { ok: true; scopes: string[]; writeCreatorRequired: false } {
  if (!account) return blocked("FANVUE_ACCOUNT_NOT_FOUND", "Fanvue account row was not found.")
  if (account.platform !== "fanvue") return blocked("FANVUE_ACCOUNT_PLATFORM_INVALID", "Account platform must be fanvue.")
  if (account.user_id !== targetUserId) return blocked("FANVUE_ACCOUNT_USER_MISMATCH", "Fanvue account row does not match target user.")
  if (account.connection_status !== "CONNECTED") return blocked("FANVUE_ACCOUNT_NOT_CONNECTED", "Fanvue account must be connected.")
  if (account.metadata?.provider !== "fanvue") return blocked("FANVUE_ACCOUNT_PROVIDER_INVALID", "Fanvue provider metadata is required.")
  if (account.metadata?.identity_fetched !== true) return blocked("FANVUE_ACCOUNT_IDENTITY_UNCONFIRMED", "Fanvue identity must be confirmed.")
  if (!nonEmptyString(account.provider_account_id)) return blocked("FANVUE_PROVIDER_ACCOUNT_ID_REQUIRED", "Fanvue provider account id is required.")
  if (!nonEmptyString(account.encrypted_access_token)) return blocked("FANVUE_ENCRYPTED_ACCESS_TOKEN_REQUIRED", "Encrypted access token is required; plaintext tokens are never accepted here.")
  const scopes = scopeList(account.scopes)
  if (!scopes.includes("write:media") || !scopes.includes("read:media")) return blocked("FANVUE_MEDIA_SCOPES_MISSING", "Stored Fanvue scopes must include write:media and read:media.")
  return { ok: true, scopes, writeCreatorRequired: false }
}

export function guardFanvueUploadOnlyRoute(method: string, rawUrl: string): FanvueUploadBlockedResult | { ok: true; pathname: string } {
  const url = new URL(rawUrl, "https://fanvue-upload-guard.invalid")
  const pathname = url.pathname
  if (/\/posts(?:\/|$)/i.test(pathname)) return blocked("FANVUE_POST_ROUTE_FORBIDDEN", "Fanvue post routes are forbidden in upload-only dry run.")
  if (/\/creators(?:\/|$)/i.test(pathname)) return blocked("FANVUE_CREATOR_ROUTE_FORBIDDEN", "Fanvue creator-scoped routes are forbidden in connected-user upload dry run.")
  const normalizedMethod = method.toUpperCase()
  const allowed =
    (normalizedMethod === "POST" && pathname === "/media/uploads") ||
    (normalizedMethod === "GET" && /^\/media\/uploads\/[^/]+\/parts\/[1-9][0-9]*\/url$/.test(pathname)) ||
    (normalizedMethod === "PATCH" && /^\/media\/uploads\/[^/]+$/.test(pathname)) ||
    (normalizedMethod === "GET" && /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pathname))
  if (!allowed) return blocked("FANVUE_UPLOAD_ROUTE_NOT_ALLOWED", "Only Fanvue media upload/readback routes are allowed.")
  return { ok: true, pathname }
}

export function redactSensitiveLogValue(value: unknown): unknown {
  if (typeof value !== "string") return value
  if (/^authorization$/i.test(value)) return "[REDACTED_AUTHORIZATION]"
  if (/Bearer\s+[A-Za-z0-9._~+/-]+=*/i.test(value)) return value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      url.search = ""
      if (/signed|upload|amazonaws|fanvue/i.test(value)) return `${url.origin}${url.pathname}`
      return `${url.origin}${url.pathname}`
    } catch {
      return "[REDACTED_URL]"
    }
  }
  return value.replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)=([^\s&]+)/gi, "$1=[REDACTED]")
}

export function safeUploadOnlySuccess(input: { provider_media_uuid: string; attempts: number }): FanvueUploadOnlySuccess {
  return {
    ok: true,
    operation: FANVUE_PHOTO_UPLOAD_OPERATION,
    platform: "fanvue",
    provider_media_uuid: input.provider_media_uuid,
    media_status: "ready",
    media_type: "image",
    upload_session_created: true,
    signed_part_uploaded: true,
    upload_completion_accepted: true,
    media_ready_readback: true,
    attempts: input.attempts,
    posted_proof: false,
    platform_post_id: null,
  }
}

export async function validateLocalTestImageFile(filePath: string, readBytes: (path: string) => Promise<Buffer> = readFile): Promise<FanvueUploadBlockedResult | { ok: true; filename: string; extension: ".jpg" | ".jpeg" | ".png"; bytes: number }> {
  if (/^https?:\/\//i.test(filePath)) return blocked("FANVUE_UPLOAD_REMOTE_FILE_REJECTED", "Remote URLs are not allowed for the controlled test image.")
  const filename = path.basename(filePath)
  if (!filename || filename.startsWith(".")) return blocked("FANVUE_UPLOAD_HIDDEN_FILE_REJECTED", "Hidden files are not allowed for the controlled test image.")
  if (SUSPICIOUS_FILENAME_RE.test(filename) || SUSPICIOUS_FILENAME_RE.test(filePath)) return blocked("FANVUE_UPLOAD_SUSPICIOUS_FILENAME_REJECTED", "File names that look like secrets are not allowed.")
  const extension = path.extname(filename).toLowerCase()
  if (extension !== ".jpg" && extension !== ".jpeg" && extension !== ".png") return blocked("FANVUE_UPLOAD_IMAGE_TYPE_REJECTED", "Internal test image policy allows only JPEG or PNG for the first photo test; this is not an official Fanvue limit.")
  const bytes = await readBytes(filePath)
  if (bytes.length === 0) return blocked("FANVUE_UPLOAD_EMPTY_FILE_REJECTED", "Empty files are not allowed for the controlled test image.")
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  if ((extension === ".png" && !isPng) || ((extension === ".jpg" || extension === ".jpeg") && !isJpeg)) return blocked("FANVUE_UPLOAD_IMAGE_SIGNATURE_REJECTED", "Internal test image signature check failed; this is not an official Fanvue limit.")
  return { ok: true, filename, extension, bytes: bytes.length }
}

export type FanvueLivePhotoUploadDependencies = {
  loadAccount: (userId: string) => Promise<FanvueAutopostAccountRow | null>
  decryptToken: (encryptedToken: string) => string
  readFileBytes: (filePath: string) => Promise<Buffer>
  fanvueFetch: FanvueFetch
  signedPartUploader: FanvueSignedPartUploader
  refreshFanvueAccessToken?: (account: FanvueAutopostAccountRow) => Promise<FanvueTokenRefreshResult>
  apiBaseUrl: string
  apiVersion: string
  sleep?: (ms: number) => Promise<void>
}

export async function loadFanvueAutopostAccountForUser(userId: string): Promise<FanvueAutopostAccountRow | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("autopost_accounts")
    .select("user_id, platform, connection_status, metadata, provider_account_id, encrypted_access_token, encrypted_refresh_token, token_expires_at, token_type, token_key_version, last_refresh_at, scopes")
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .maybeSingle()
  if (error) throw new Error("FANVUE_ACCOUNT_LOOKUP_FAILED")
  return data as FanvueAutopostAccountRow | null
}

function getFanvueAdminApiBaseUrl(env: Record<string, string | undefined> = process.env) {
  return env.FANVUE_API_BASE_URL ?? env.FANVUE_API_BASE ?? "https://api.fanvue.com"
}

function getFanvueAdminApiVersion(env: Record<string, string | undefined> = process.env) {
  return env.FANVUE_API_VERSION ?? "2025-06-26"
}

function defaultFanvueFetchWithUploadOnlyGuard(providerCallCounter: () => void): FanvueFetch {
  return async (url, init) => {
    const guarded = guardFanvueUploadOnlyRoute(init.method, url)
    if ("blocked" in guarded) throw new Error(guarded.error_code)
    providerCallCounter()
    return fetch(url, init) as Promise<Awaited<ReturnType<FanvueFetch>>>
  }
}

function defaultSignedPartUploader(providerCallCounter: () => void): FanvueSignedPartUploader {
  return async ({ signedUrl, body }) => {
    providerCallCounter()
    const response = await fetch(signedUrl, { method: "PUT", body: body as BodyInit })
    if (!response.ok) {
      const status = response.status
      throw {
        ok: false,
        kind: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "FAILED",
        status,
        error_code: status === 401 ? "FANVUE_UNAUTHORIZED" : status === 403 ? "FANVUE_FORBIDDEN" : "FANVUE_SIGNED_PART_UPLOAD_FAILED",
        safe_error_message: status === 401 || status === 403 ? "Fanvue rejected the request authorization." : "Signed upload part failed.",
      } satisfies FanvueApiFailure
    }
    return { ETag: response.headers.get("ETag") ?? response.headers.get("etag") ?? "" }
  }
}

export function createDefaultFanvueLivePhotoUploadDependencies(env: Record<string, string | undefined> = process.env, providerCallCounter: () => void = () => {}): FanvueLivePhotoUploadDependencies {
  return {
    loadAccount: loadFanvueAutopostAccountForUser,
    decryptToken: (encryptedToken) => {
      throw new Error("FANVUE_TOKEN_DECRYPT_DEPENDENCY_NOT_LOADED")
    },
    readFileBytes: readFile,
    fanvueFetch: defaultFanvueFetchWithUploadOnlyGuard(providerCallCounter),
    signedPartUploader: defaultSignedPartUploader(providerCallCounter),
    refreshFanvueAccessToken: (account) => refreshFanvueAccessToken({
      user_id: String(account.user_id),
      platform: String(account.platform),
      encrypted_refresh_token: typeof account.encrypted_refresh_token === "string" ? account.encrypted_refresh_token : null,
      token_expires_at: typeof account.token_expires_at === "string" ? account.token_expires_at : null,
      token_type: typeof account.token_type === "string" ? account.token_type : null,
      token_key_version: typeof account.token_key_version === "number" ? account.token_key_version : null,
      scopes: Array.isArray(account.scopes) || typeof account.scopes === "string" ? account.scopes : null,
    }),
    apiBaseUrl: getFanvueAdminApiBaseUrl(env),
    apiVersion: getFanvueAdminApiVersion(env),
  }
}

export async function planFanvueLivePhotoUploadDryRun(args: FanvueLivePhotoUploadArgs, env: Record<string, string | undefined> = process.env, dependencies?: FanvueLivePhotoUploadDependencies): Promise<FanvueUploadBlockedResult | FanvueUploadOnlySuccess> {
  const gate = validateHardDisabledGate(args, env)
  if (gate) return gate

  let providerCallsAttempted = false
  const markProviderCall = () => { providerCallsAttempted = true }
  const deps = dependencies ?? createDefaultFanvueLivePhotoUploadDependencies(env, markProviderCall)
  if (!dependencies) {
    const { decryptAutopostToken } = await import("../../../lib/autopost/tokenCryptoCore")
    deps.decryptToken = decryptAutopostToken
  }

  const file = await validateLocalTestImageFile(String(args.filePath), deps.readFileBytes)
  if ("blocked" in file) return file

  let account: FanvueAutopostAccountRow | null
  try {
    account = await deps.loadAccount(String(args.userId))
  } catch {
    return failed("FANVUE_ACCOUNT_LOOKUP_FAILED", "Fanvue account lookup failed safely.", providerCallsAttempted)
  }

  const accountValidation = validateFanvueAccountForPhotoUpload(account, String(args.userId))
  if ("blocked" in accountValidation) return accountValidation

  const tokenFreshness = validateFanvueAccessTokenFreshness(account)

  let encryptedAccessToken = String(account?.encrypted_access_token)
  if ("blocked" in tokenFreshness) {
    if (!nonEmptyString(account?.encrypted_refresh_token)) {
      return blocked("FANVUE_REFRESH_TOKEN_MISSING", "Fanvue refresh token is missing; upload cannot start with a stale access token.")
    }

    const refresh = deps.refreshFanvueAccessToken ?? ((refreshAccount) => refreshFanvueAccessToken({
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
      return failed(refreshResult.error_code, refreshResult.safe_error_message, false)
    }

    try {
      account = await deps.loadAccount(String(args.userId))
    } catch {
      return failed("FANVUE_ACCOUNT_LOOKUP_FAILED", "Fanvue account lookup failed safely.", providerCallsAttempted)
    }
    const refreshedAccountValidation = validateFanvueAccountForPhotoUpload(account, String(args.userId))
    if ("blocked" in refreshedAccountValidation) return refreshedAccountValidation
    const refreshedTokenFreshness = validateFanvueAccessTokenFreshness(account)
    if ("blocked" in refreshedTokenFreshness) return failed("FANVUE_TOKEN_REFRESH_STALE", "Fanvue token refresh did not produce a fresh access token.", false)
    encryptedAccessToken = String(account?.encrypted_access_token)
  }

  let accessToken: string
  try {
    accessToken = deps.decryptToken(encryptedAccessToken)
  } catch {
    return failed("FANVUE_TOKEN_DECRYPT_FAILED", "Unable to decrypt Fanvue access token.", providerCallsAttempted)
  }

  const guardedFetch: FanvueFetch = async (url, init) => {
    const guarded = guardFanvueUploadOnlyRoute(init.method, url)
    if ("blocked" in guarded) throw new Error(guarded.error_code)
    markProviderCall()
    return deps.fanvueFetch(url, init)
  }
  const guardedSignedPartUploader: FanvueSignedPartUploader = async (input) => {
    markProviderCall()
    return deps.signedPartUploader(input)
  }

  const config = { accessToken, apiBaseUrl: deps.apiBaseUrl, apiVersion: deps.apiVersion, fetch: guardedFetch }
  const uploadSession = await createFanvueUploadSession(config, { name: file.filename, filename: file.filename, mediaType: "image" })
  if (!uploadSession.ok) return fromApiFailure(uploadSession as FanvueApiFailure, providerCallsAttempted, "create_upload_session", "POST /media/uploads")

  const signed = await getFanvueUploadPartUrl(config, { uploadId: uploadSession.uploadId, partNumber: 1 })
  if (!signed.ok) return fromApiFailure(signed as FanvueApiFailure, providerCallsAttempted, "get_signed_part_url", `GET /media/uploads/:uploadId/parts/1/url`)

  const bytes = await deps.readFileBytes(String(args.filePath))
  const uploaded = await uploadFanvueSignedPart({ signedUrl: signed.signed_url, partNumber: 1, body: bytes, uploader: guardedSignedPartUploader })
  if (!uploaded.ok) return fromApiFailure(uploaded as FanvueApiFailure, providerCallsAttempted, "upload_signed_part", "PUT [signed-upload-url]")

  const completed = await completeFanvueUploadSession(config, { uploadId: uploadSession.uploadId, parts: [uploaded.part] })
  if (!completed.ok) return fromApiFailure(completed as FanvueApiFailure, providerCallsAttempted, "complete_upload", "PATCH /media/uploads/:uploadId")

  const ready = await waitForFanvueMediaReady(config, {
    uuid: uploadSession.mediaUuid,
    maxAttempts: FANVUE_ADMIN_UPLOAD_ONLY_MEDIA_READY_MAX_ATTEMPTS,
    maxDelayMs: FANVUE_ADMIN_UPLOAD_ONLY_MEDIA_READY_MAX_DELAY_MS,
    backoffBaseMs: FANVUE_ADMIN_UPLOAD_ONLY_MEDIA_READY_BACKOFF_BASE_MS,
    sleep: deps.sleep,
  })
  if (!ready.ok) return fromApiFailure(ready as FanvueApiFailure, providerCallsAttempted, "media_readback", "GET /media/:uuid")

  return safeUploadOnlySuccess({ provider_media_uuid: ready.media.uuid, attempts: ready.attempts })
}

function fileUrlToCrossPlatformPath(value: string): string {
  try {
    return fileURLToPath(value)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error

    const url = new URL(value)
    if (url.protocol !== "file:") throw error

    return decodeURIComponent(url.pathname)
  }
}

function normalizeCliEntrypointPath(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  const withoutFileProtocol = normalized.startsWith("file://") ? fileUrlToCrossPlatformPath(value).replace(/\\/g, "/") : normalized
  const withoutLeadingDriveSlash = withoutFileProtocol.replace(/^\/([A-Za-z]:\/)/, "$1")
  return path.resolve(withoutLeadingDriveSlash).replace(/\\/g, "/").toLowerCase()
}

export function isFanvueLivePhotoUploadCliEntrypoint(argv: string[], importMetaUrl: string): boolean {
  const invokedPath = argv[1]
  if (!invokedPath) return false
  return normalizeCliEntrypointPath(invokedPath) === normalizeCliEntrypointPath(importMetaUrl)
}

export async function runFanvueLivePhotoUploadCliMain(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env, write: (output: string) => void = console.log): Promise<void> {
  const result = await planFanvueLivePhotoUploadDryRun(parseFanvueLivePhotoUploadArgs(argv), env)
  write(JSON.stringify(result, (_key, value) => redactSensitiveLogValue(value), 2))
  process.exitCode = 0
}

if (isFanvueLivePhotoUploadCliEntrypoint(process.argv, import.meta.url)) {
  runFanvueLivePhotoUploadCliMain().catch(() => {
    console.log(JSON.stringify(blocked("FANVUE_UPLOAD_DRY_RUN_FAILED", "Fanvue upload dry-run scaffold failed safely.")))
    process.exitCode = 0
  })
}
