import { readFile } from "node:fs/promises"
import path from "node:path"
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin"
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
 * Local preflight shape (safe gate-disabled import/test path):
 * DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts --operation upload_photo_only --user-id <uuid> --file <local image path> --confirm "UPLOAD_ONE_FANVUE_PHOTO_NO_POST"
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

export type FanvueUploadBlockedResult = {
  ok: false
  blocked: true
  error_code: string
  safe_error_message: string
  provider_calls_attempted: boolean
  posted_proof: false
  platform_post_id: null
}

function blocked(error_code: string, safe_error_message: string): FanvueUploadBlockedResult {
  return { ok: false, blocked: true, error_code, safe_error_message, provider_calls_attempted: false, posted_proof: false, platform_post_id: null }
}

function failed(error_code: string, safe_error_message: string, provider_calls_attempted: boolean): FanvueUploadBlockedResult {
  return { ok: false, blocked: true, error_code, safe_error_message, provider_calls_attempted, posted_proof: false, platform_post_id: null }
}

function fromApiFailure(result: FanvueApiFailure, provider_calls_attempted: boolean): FanvueUploadBlockedResult {
  return failed(result.error_code, result.safe_error_message, provider_calls_attempted)
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
  apiBaseUrl: string
  apiVersion: string
  sleep?: (ms: number) => Promise<void>
}

export async function loadFanvueAutopostAccountForUser(userId: string): Promise<FanvueAutopostAccountRow | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("autopost_accounts")
    .select("user_id, platform, connection_status, metadata, provider_account_id, encrypted_access_token, scopes")
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
    if (!response.ok) throw new Error("FANVUE_SIGNED_PART_UPLOAD_FAILED")
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

  let accessToken: string
  try {
    accessToken = deps.decryptToken(String(account?.encrypted_access_token))
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
  if (!uploadSession.ok) return fromApiFailure(uploadSession as FanvueApiFailure, providerCallsAttempted)

  const signed = await getFanvueUploadPartUrl(config, { uploadId: uploadSession.uploadId, partNumber: 1 })
  if (!signed.ok) return fromApiFailure(signed as FanvueApiFailure, providerCallsAttempted)

  const bytes = await deps.readFileBytes(String(args.filePath))
  const uploaded = await uploadFanvueSignedPart({ signedUrl: signed.signed_url, partNumber: 1, body: bytes, uploader: guardedSignedPartUploader })
  if (!uploaded.ok) return fromApiFailure(uploaded as FanvueApiFailure, providerCallsAttempted)

  const completed = await completeFanvueUploadSession(config, { uploadId: uploadSession.uploadId, parts: [uploaded.part] })
  if (!completed.ok) return fromApiFailure(completed as FanvueApiFailure, providerCallsAttempted)

  const ready = await waitForFanvueMediaReady(config, { uuid: uploadSession.mediaUuid, maxAttempts: 5, maxDelayMs: 1_000, sleep: deps.sleep })
  if (!ready.ok) return fromApiFailure(ready as FanvueApiFailure, providerCallsAttempted)

  return safeUploadOnlySuccess({ provider_media_uuid: ready.media.uuid, attempts: ready.attempts })
}

async function main() {
  const result = await planFanvueLivePhotoUploadDryRun(parseFanvueLivePhotoUploadArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, (_key, value) => redactSensitiveLogValue(value), 2))
  process.exitCode = 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(() => {
    console.log(JSON.stringify(blocked("FANVUE_UPLOAD_DRY_RUN_FAILED", "Fanvue upload dry-run scaffold failed safely.")))
    process.exitCode = 0
  })
}
