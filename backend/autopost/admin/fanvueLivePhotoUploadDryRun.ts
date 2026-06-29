import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * FV-30 hard-disabled local/admin scaffold for a future single Fanvue live
 * photo upload test. This file intentionally lives outside app/api, UI code,
 * and public run dispatch. It does not perform Supabase lookups, token
 * decryption, Fanvue API calls, signed URL uploads, post creation, job updates,
 * schedule advancement, or persistence in FV-30.
 *
 * Future documented shape only:
 * npx tsx backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts --operation upload_photo_only --user-id <uuid> --file <local-test-image> --confirm "UPLOAD_ONE_FANVUE_PHOTO_NO_POST"
 *
 * Future live execution must additionally require:
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
  provider_calls_attempted: false
  posted_proof: false
  platform_post_id: null
}

function blocked(error_code: string, safe_error_message: string): FanvueUploadBlockedResult {
  return { ok: false, blocked: true, error_code, safe_error_message, provider_calls_attempted: false, posted_proof: false, platform_post_id: null }
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

export async function planFanvueLivePhotoUploadDryRun(args: FanvueLivePhotoUploadArgs, env: Record<string, string | undefined> = process.env): Promise<FanvueUploadBlockedResult> {
  const gate = validateHardDisabledGate(args, env)
  if (gate) return gate
  // FV-30 intentionally stops even after all future live gates are present. A later
  // human-approved gate must replace this final scaffold block with injected,
  // audited account/file/provider steps.
  return blocked("FANVUE_UPLOAD_SCAFFOLD_ONLY", "FV-30 scaffold does not execute live Fanvue upload.")
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
