import "server-only"

import { createDecipheriv } from "node:crypto"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getAutopostTokenKeyVersion } from "./tokenCrypto"

export const X_CRYPTO_DIAGNOSTIC_MODE = "x_token_crypto_read_only_diagnostic" as const
export const X_CRYPTO_DIAGNOSTIC_CONFIRMATION_HEADER = "x-autopost-x-crypto-envelope-diagnostic" as const
export const X_CRYPTO_DIAGNOSTIC_CONFIRMATION_VALUE = "classify-read-only-v1" as const
export const X_CRYPTO_DIAGNOSTIC_ACCOUNT_SELECT = "connection_status, encrypted_access_token, token_key_version" as const
export const X_CRYPTO_DIAGNOSTIC_MAX_ENVELOPE_LENGTH = 16_384 as const

export type XCryptoDiagnosticSafeCode =
  | "X_CRYPTO_DIAGNOSTIC_UNAUTHENTICATED" | "X_CRYPTO_DIAGNOSTIC_CONFIRMATION_REQUIRED"
  | "X_CRYPTO_DIAGNOSTIC_PARAMETERS_NOT_ALLOWED" | "X_CRYPTO_DIAGNOSTIC_METHOD_NOT_ALLOWED"
  | "X_CRYPTO_DIAGNOSTIC_ACCOUNT_LOOKUP_FAILED" | "X_CRYPTO_DIAGNOSTIC_ACCOUNT_NOT_READY"
  | "X_CRYPTO_DIAGNOSTIC_TOKEN_KEY_VERSION_INVALID" | "X_CRYPTO_DIAGNOSTIC_TOKEN_KEY_VERSION_MISMATCH"
  | "X_CRYPTO_DIAGNOSTIC_KEY_NOT_CONFIGURED" | "X_CRYPTO_DIAGNOSTIC_KEY_ENCODING_INVALID"
  | "X_CRYPTO_DIAGNOSTIC_KEY_LENGTH_INVALID" | "X_CRYPTO_DIAGNOSTIC_ENVELOPE_MALFORMED"
  | "X_CRYPTO_DIAGNOSTIC_ENVELOPE_VERSION_UNSUPPORTED" | "X_CRYPTO_DIAGNOSTIC_IV_INVALID"
  | "X_CRYPTO_DIAGNOSTIC_AUTH_TAG_INVALID" | "X_CRYPTO_DIAGNOSTIC_CIPHERTEXT_INVALID"
  | "X_CRYPTO_DIAGNOSTIC_AUTHENTICATED_DECRYPTION_FAILED" | "X_CRYPTO_DIAGNOSTIC_DECRYPTED_TOKEN_INVALID"
  | "X_CRYPTO_DIAGNOSTIC_DECRYPTION_SUCCEEDED"

type CheckFlags = {
  key_configured?: boolean; key_encoding_valid?: boolean; key_length_valid?: boolean
  envelope_structure_valid?: boolean; envelope_version_supported?: boolean; iv_structure_valid?: boolean
  authentication_tag_structure_valid?: boolean; ciphertext_structure_valid?: boolean
  decryption_attempted?: boolean; decryption_succeeded?: boolean; decrypted_token_valid?: boolean
}

export type XCryptoDiagnosticResult = CheckFlags & {
  ok: boolean; mode: typeof X_CRYPTO_DIAGNOSTIC_MODE; safe_code: XCryptoDiagnosticSafeCode; read_only: true
  provider_request_attempted: false; database_write_attempted: false; oauth_attempted: false
  refresh_attempted: false; retry_attempted: false; reconnect_attempted: false
  disconnect_attempted: false; post_attempted: false; fanvue_account_queried: false; fanvue_account_mutated: false
}

export type XCryptoDiagnosticAccount = {
  connection_status?: unknown; encrypted_access_token?: unknown; token_key_version?: unknown
}

type ReadClient = Pick<ReturnType<typeof getSupabaseAdmin>, "from">

export function createXCryptoDiagnosticAccountLoader(client: ReadClient) {
  return async (userId: string): Promise<XCryptoDiagnosticAccount | null> => {
    const { data, error } = await client.from("autopost_accounts").select(X_CRYPTO_DIAGNOSTIC_ACCOUNT_SELECT)
      .eq("user_id", userId).eq("platform", "x").maybeSingle()
    if (error) throw new Error("X_CRYPTO_DIAGNOSTIC_ACCOUNT_LOOKUP_FAILED")
    return (data ?? null) as unknown as XCryptoDiagnosticAccount | null
  }
}

function result(safe_code: XCryptoDiagnosticSafeCode, flags: CheckFlags = {}): XCryptoDiagnosticResult {
  return {
    ok: safe_code === "X_CRYPTO_DIAGNOSTIC_DECRYPTION_SUCCEEDED", mode: X_CRYPTO_DIAGNOSTIC_MODE, safe_code,
    read_only: true, provider_request_attempted: false, database_write_attempted: false, oauth_attempted: false,
    refresh_attempted: false, retry_attempted: false, reconnect_attempted: false, disconnect_attempted: false,
    post_attempted: false, fanvue_account_queried: false, fanvue_account_mutated: false, ...flags,
  }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
}

function decodeCanonical(value: string, alphabet: "base64" | "base64url"): Buffer | null {
  if (!value || value.length % 4 === 1) return null
  const expression = alphabet === "base64" ? /^[A-Za-z0-9+/]*={0,2}$/ : /^[A-Za-z0-9_-]*={0,2}$/
  if (!expression.test(value)) return null
  const paddingIndex = value.indexOf("=")
  if (paddingIndex >= 0 && paddingIndex < value.length - (value.endsWith("==") ? 2 : 1)) return null
  if (paddingIndex >= 0 && value.length % 4 !== 0) return null
  const unpadded = value.replace(/=+$/, "")
  const requiredPadding = (4 - (unpadded.length % 4)) % 4
  if (requiredPadding === 3) return null
  const normalized = unpadded + "=".repeat(requiredPadding)
  if (value !== unpadded && value !== normalized) return null
  try {
    const decoded = Buffer.from(normalized, alphabet)
    const roundTrip = decoded.toString(alphabet).replace(/=+$/, "")
    return roundTrip === unpadded ? decoded : null
  } catch { return null }
}

export type XCryptoDiagnosticDependencies = {
  loadAccount: (userId: string) => Promise<XCryptoDiagnosticAccount | null>
  getTokenKeyVersion?: () => unknown
  getEncryptionKey?: () => unknown
  decryptAuthenticated?: (key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer) => Buffer
}

function decryptOnce(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher["update"](ciphertext), decipher.final()])
}

export async function runXCryptoEnvelopeDiagnostic(userId: string, deps: XCryptoDiagnosticDependencies): Promise<XCryptoDiagnosticResult> {
  let account: XCryptoDiagnosticAccount | null
  try { account = await deps.loadAccount(userId) } catch { return result("X_CRYPTO_DIAGNOSTIC_ACCOUNT_LOOKUP_FAILED") }
  if (!account || account.connection_status !== "CONNECTED") return result("X_CRYPTO_DIAGNOSTIC_ACCOUNT_NOT_READY")
  const envelope = account.encrypted_access_token
  if (envelope == null || (typeof envelope === "string" && !envelope.trim())) return result("X_CRYPTO_DIAGNOSTIC_ACCOUNT_NOT_READY")

  let currentVersion: unknown
  try { currentVersion = (deps.getTokenKeyVersion ?? getAutopostTokenKeyVersion)() }
  catch { return result("X_CRYPTO_DIAGNOSTIC_TOKEN_KEY_VERSION_INVALID") }
  if (!positiveInteger(currentVersion) || !positiveInteger(account.token_key_version))
    return result("X_CRYPTO_DIAGNOSTIC_TOKEN_KEY_VERSION_INVALID")
  if (currentVersion !== account.token_key_version) return result("X_CRYPTO_DIAGNOSTIC_TOKEN_KEY_VERSION_MISMATCH")

  let rawKey: unknown
  try { rawKey = (deps.getEncryptionKey ?? (() => process.env.AUTOPOST_TOKEN_ENCRYPTION_KEY))() } catch { rawKey = undefined }
  if (rawKey == null || (typeof rawKey === "string" && !rawKey.trim()))
    return result("X_CRYPTO_DIAGNOSTIC_KEY_NOT_CONFIGURED", { key_configured: false })
  if (typeof rawKey !== "string") return result("X_CRYPTO_DIAGNOSTIC_KEY_ENCODING_INVALID", { key_configured: true, key_encoding_valid: false })
  const keyFlags = { key_configured: true } as const
  const key = decodeCanonical(rawKey, "base64")
  if (!key) return result("X_CRYPTO_DIAGNOSTIC_KEY_ENCODING_INVALID", { ...keyFlags, key_encoding_valid: false })
  const encodedFlags = { ...keyFlags, key_encoding_valid: true } as const
  if (key.length !== 32) return result("X_CRYPTO_DIAGNOSTIC_KEY_LENGTH_INVALID", { ...encodedFlags, key_length_valid: false })
  const keyValid = { ...encodedFlags, key_length_valid: true } as const

  if (typeof envelope !== "string" || envelope.length > X_CRYPTO_DIAGNOSTIC_MAX_ENVELOPE_LENGTH)
    return result("X_CRYPTO_DIAGNOSTIC_ENVELOPE_MALFORMED", { ...keyValid, envelope_structure_valid: false })
  const segments = envelope.split(":")
  if (segments.length !== 4 || !segments[0]) return result("X_CRYPTO_DIAGNOSTIC_ENVELOPE_MALFORMED", { ...keyValid, envelope_structure_valid: false })
  const envelopeValid = { ...keyValid, envelope_structure_valid: true } as const
  if (segments[0] !== "v1") return result("X_CRYPTO_DIAGNOSTIC_ENVELOPE_VERSION_UNSUPPORTED", { ...envelopeValid, envelope_version_supported: false })
  const versionValid = { ...envelopeValid, envelope_version_supported: true } as const
  const iv = decodeCanonical(segments[1], "base64url")
  if (!iv || iv.length !== 12) return result("X_CRYPTO_DIAGNOSTIC_IV_INVALID", { ...versionValid, iv_structure_valid: false })
  const ivValid = { ...versionValid, iv_structure_valid: true } as const
  const tag = decodeCanonical(segments[2], "base64url")
  if (!tag || tag.length !== 16) return result("X_CRYPTO_DIAGNOSTIC_AUTH_TAG_INVALID", { ...ivValid, authentication_tag_structure_valid: false })
  const tagValid = { ...ivValid, authentication_tag_structure_valid: true } as const
  const ciphertext = decodeCanonical(segments[3], "base64url")
  if (!ciphertext || ciphertext.length === 0) return result("X_CRYPTO_DIAGNOSTIC_CIPHERTEXT_INVALID", { ...tagValid, ciphertext_structure_valid: false })
  const structuresValid = { ...tagValid, ciphertext_structure_valid: true, decryption_attempted: true } as const

  let plaintext: Buffer
  try { plaintext = (deps.decryptAuthenticated ?? decryptOnce)(key, iv, tag, ciphertext) }
  catch { return result("X_CRYPTO_DIAGNOSTIC_AUTHENTICATED_DECRYPTION_FAILED", { ...structuresValid, decryption_succeeded: false }) }
  const decrypted = { ...structuresValid, decryption_succeeded: true } as const
  if (!plaintext.toString("utf8").trim()) return result("X_CRYPTO_DIAGNOSTIC_DECRYPTED_TOKEN_INVALID", { ...decrypted, decrypted_token_valid: false })
  return result("X_CRYPTO_DIAGNOSTIC_DECRYPTION_SUCCEEDED", { ...decrypted, decrypted_token_valid: true })
}

export async function handleXCryptoEnvelopeDiagnosticRequest(args: XCryptoDiagnosticDependencies & {
  request: Request; getAuthenticatedUserId: (request: Request) => Promise<string>
}) {
  let userId = ""
  try { userId = (await args.getAuthenticatedUserId(args.request)).trim() } catch { /* sanitized */ }
  if (!userId) return { status: 401, body: result("X_CRYPTO_DIAGNOSTIC_UNAUTHENTICATED") }
  if (args.request.headers.get(X_CRYPTO_DIAGNOSTIC_CONFIRMATION_HEADER) !== X_CRYPTO_DIAGNOSTIC_CONFIRMATION_VALUE)
    return { status: 400, body: result("X_CRYPTO_DIAGNOSTIC_CONFIRMATION_REQUIRED") }
  if (new URL(args.request.url).search) return { status: 400, body: result("X_CRYPTO_DIAGNOSTIC_PARAMETERS_NOT_ALLOWED") }
  return { status: 200, body: await runXCryptoEnvelopeDiagnostic(userId, args) }
}

export function xCryptoEnvelopeDiagnosticMethodNotAllowedResult() { return result("X_CRYPTO_DIAGNOSTIC_METHOD_NOT_ALLOWED") }
