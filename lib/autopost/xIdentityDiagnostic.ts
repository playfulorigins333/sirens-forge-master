import "server-only"

import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getXStoredPostureBlocker, type XStoredPostureAccount, type XStoredPostureBlocker } from "./platformAvailability"
import { decryptAutopostToken, getAutopostTokenKeyVersion } from "./tokenCrypto"
import { getXApiBaseUrl } from "./xOAuth"

export const X_IDENTITY_DIAGNOSTIC_MODE = "x_identity_read_only_diagnostic" as const
export const X_IDENTITY_DIAGNOSTIC_CONFIRMATION_HEADER = "x-autopost-x-identity-diagnostic" as const
export const X_IDENTITY_DIAGNOSTIC_CONFIRMATION_VALUE = "read-only-users-me-v1" as const
export const X_IDENTITY_DIAGNOSTIC_TIMEOUT_MS = 5000 as const

export const X_IDENTITY_DIAGNOSTIC_ACCOUNT_SELECT = [
  "connection_status", "provider_account_id", "provider_username", "last_error",
  "encrypted_access_token", "encrypted_refresh_token", "token_expires_at",
  "token_key_version", "metadata",
].join(", ")

export type XIdentityDiagnosticAccount = XStoredPostureAccount
export type XIdentityDiagnosticSafeCode =
  | "X_IDENTITY_DIAGNOSTIC_UNAUTHENTICATED" | "X_IDENTITY_DIAGNOSTIC_CONFIRMATION_REQUIRED"
  | "X_IDENTITY_DIAGNOSTIC_PARAMETERS_NOT_ALLOWED" | "X_IDENTITY_DIAGNOSTIC_METHOD_NOT_ALLOWED"
  | "X_IDENTITY_DIAGNOSTIC_ACCOUNT_LOOKUP_FAILED" | "X_IDENTITY_DIAGNOSTIC_ACCOUNT_NOT_READY"
  | "X_IDENTITY_DIAGNOSTIC_TOKEN_KEY_VERSION_UNAVAILABLE" | "X_IDENTITY_DIAGNOSTIC_TOKEN_KEY_VERSION_MISMATCH"
  | "X_IDENTITY_DIAGNOSTIC_ACCESS_TOKEN_DECRYPT_FAILED" | "X_IDENTITY_DIAGNOSTIC_ACCESS_TOKEN_INVALID"
  | "X_IDENTITY_DIAGNOSTIC_PROVIDER_CONFIG_INVALID" | "X_IDENTITY_DIAGNOSTIC_PROVIDER_UNAUTHORIZED"
  | "X_IDENTITY_DIAGNOSTIC_PROVIDER_FORBIDDEN" | "X_IDENTITY_DIAGNOSTIC_PROVIDER_RATE_LIMITED"
  | "X_IDENTITY_DIAGNOSTIC_PROVIDER_TEMPORARY_FAILURE" | "X_IDENTITY_DIAGNOSTIC_PROVIDER_REJECTED"
  | "X_IDENTITY_DIAGNOSTIC_NETWORK_FAILURE" | "X_IDENTITY_DIAGNOSTIC_TIMEOUT"
  | "X_IDENTITY_DIAGNOSTIC_RESPONSE_INVALID" | "X_IDENTITY_DIAGNOSTIC_PROVIDER_ID_MISMATCH"
  | "X_IDENTITY_DIAGNOSTIC_USERNAME_MISMATCH" | "X_IDENTITY_DIAGNOSTIC_MATCHED"

export type XIdentityDiagnosticResult = {
  ok: boolean; mode: typeof X_IDENTITY_DIAGNOSTIC_MODE; safe_code: XIdentityDiagnosticSafeCode
  stored_posture_verified: boolean; stored_posture_blocker?: XStoredPostureBlocker
  provider_request_attempted: boolean; provider_status_class: "2xx" | "4xx" | "5xx" | null
  provider_authenticated: boolean | null; identity_match: boolean | null; read_only: true
  database_write_attempted: false; refresh_attempted: false; retry_attempted: false; post_attempted: false
}

type ReadClient = Pick<ReturnType<typeof getSupabaseAdmin>, "from">

export function createXIdentityDiagnosticAccountLoader(client: ReadClient) {
  return async (userId: string): Promise<XIdentityDiagnosticAccount | null> => {
    const { data, error } = await client.from("autopost_accounts")
      .select(X_IDENTITY_DIAGNOSTIC_ACCOUNT_SELECT).eq("user_id", userId).eq("platform", "x").maybeSingle()
    if (error) throw new Error("X_IDENTITY_DIAGNOSTIC_ACCOUNT_LOOKUP_FAILED")
    return (data ?? null) as unknown as XIdentityDiagnosticAccount | null
  }
}

function result(safe_code: XIdentityDiagnosticSafeCode, options: Partial<XIdentityDiagnosticResult> = {}): XIdentityDiagnosticResult {
  return { ok: false, mode: X_IDENTITY_DIAGNOSTIC_MODE, safe_code, stored_posture_verified: false,
    provider_request_attempted: false, provider_status_class: null, provider_authenticated: null,
    identity_match: null, read_only: true, database_write_attempted: false, refresh_attempted: false,
    retry_attempted: false, post_attempted: false, ...options }
}

function statusClass(status: number) {
  if (status >= 200 && status < 300) return "2xx" as const
  if (status >= 400 && status < 500) return "4xx" as const
  if (status >= 500 && status < 600) return "5xx" as const
  return null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  try { const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null } catch { return false }
}

function isTimeout(error: unknown) {
  if (!error || typeof error !== "object") return false
  try { return "name" in error && (error as { name?: unknown }).name === "TimeoutError" } catch { return false }
}

export type XIdentityDiagnosticDependencies = {
  loadAccount: (userId: string) => Promise<XIdentityDiagnosticAccount | null>
  fetchImpl?: typeof fetch; decryptToken?: (value: string) => unknown; getTokenKeyVersion?: () => unknown
  getApiBaseUrl?: () => unknown; createTimeoutSignal?: (milliseconds: number) => AbortSignal
}

export async function runXIdentityDiagnostic(userId: string, deps: XIdentityDiagnosticDependencies): Promise<XIdentityDiagnosticResult> {
  let account: XIdentityDiagnosticAccount | null
  try { account = await deps.loadAccount(userId) } catch { return result("X_IDENTITY_DIAGNOSTIC_ACCOUNT_LOOKUP_FAILED") }
  const blocker = getXStoredPostureBlocker(account)
  if (blocker) return result("X_IDENTITY_DIAGNOSTIC_ACCOUNT_NOT_READY", { stored_posture_blocker: blocker })
  const ready = { stored_posture_verified: true } as const
  let currentVersion: unknown
  try { currentVersion = (deps.getTokenKeyVersion ?? getAutopostTokenKeyVersion)() } catch { return result("X_IDENTITY_DIAGNOSTIC_TOKEN_KEY_VERSION_UNAVAILABLE", ready) }
  if (typeof currentVersion !== "number" || !Number.isFinite(currentVersion) || !Number.isInteger(currentVersion) || currentVersion <= 0)
    return result("X_IDENTITY_DIAGNOSTIC_TOKEN_KEY_VERSION_UNAVAILABLE", ready)
  if (account!.token_key_version !== currentVersion) return result("X_IDENTITY_DIAGNOSTIC_TOKEN_KEY_VERSION_MISMATCH", ready)
  let decrypted: unknown
  try { decrypted = (deps.decryptToken ?? decryptAutopostToken)(account!.encrypted_access_token as string) }
  catch { return result("X_IDENTITY_DIAGNOSTIC_ACCESS_TOKEN_DECRYPT_FAILED", ready) }
  if (typeof decrypted !== "string" || !decrypted.trim()) return result("X_IDENTITY_DIAGNOSTIC_ACCESS_TOKEN_INVALID", ready)
  const token = decrypted.trim()
  let endpoint: URL
  try {
    const raw = (deps.getApiBaseUrl ?? getXApiBaseUrl)()
    if (typeof raw !== "string" || !raw.trim()) throw new Error()
    const base = new URL(raw.trim())
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error()
    endpoint = new URL("/2/users/me", base.origin)
  } catch { return result("X_IDENTITY_DIAGNOSTIC_PROVIDER_CONFIG_INVALID", ready) }
  let response: Response
  try {
    const signal = (deps.createTimeoutSignal ?? ((ms) => AbortSignal.timeout(ms)))(X_IDENTITY_DIAGNOSTIC_TIMEOUT_MS)
    response = await (deps.fetchImpl ?? fetch)(endpoint.toString(), {
      method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal,
    })
  } catch (error) { return result(isTimeout(error) ? "X_IDENTITY_DIAGNOSTIC_TIMEOUT" : "X_IDENTITY_DIAGNOSTIC_NETWORK_FAILURE", { ...ready, provider_request_attempted: true }) }
  const provider = { ...ready, provider_request_attempted: true, provider_status_class: statusClass(response.status) }
  if (!response.ok) {
    if (response.status === 401) return result("X_IDENTITY_DIAGNOSTIC_PROVIDER_UNAUTHORIZED", { ...provider, provider_authenticated: false })
    if (response.status === 403) return result("X_IDENTITY_DIAGNOSTIC_PROVIDER_FORBIDDEN", provider)
    if (response.status === 429) return result("X_IDENTITY_DIAGNOSTIC_PROVIDER_RATE_LIMITED", provider)
    if (response.status >= 500 && response.status < 600) return result("X_IDENTITY_DIAGNOSTIC_PROVIDER_TEMPORARY_FAILURE", provider)
    return result("X_IDENTITY_DIAGNOSTIC_PROVIDER_REJECTED", provider)
  }
  let body: unknown
  try { body = await response.json() } catch { return result("X_IDENTITY_DIAGNOSTIC_RESPONSE_INVALID", { ...provider, provider_authenticated: true }) }
  if (!isPlainObject(body) || !isPlainObject(body.data)) return result("X_IDENTITY_DIAGNOSTIC_RESPONSE_INVALID", { ...provider, provider_authenticated: true })
  const id = body.data.id, username = body.data.username
  if (typeof id !== "string" || !id.trim() || typeof username !== "string" || !username.trim())
    return result("X_IDENTITY_DIAGNOSTIC_RESPONSE_INVALID", { ...provider, provider_authenticated: true })
  if (id.trim() !== account!.provider_account_id!.trim()) return result("X_IDENTITY_DIAGNOSTIC_PROVIDER_ID_MISMATCH", { ...provider, provider_authenticated: true, identity_match: false })
  if (username.trim().toLowerCase() !== account!.provider_username!.trim().toLowerCase()) return result("X_IDENTITY_DIAGNOSTIC_USERNAME_MISMATCH", { ...provider, provider_authenticated: true, identity_match: false })
  return result("X_IDENTITY_DIAGNOSTIC_MATCHED", { ...provider, ok: true, provider_authenticated: true, identity_match: true })
}

export async function handleXIdentityDiagnosticRequest(args: XIdentityDiagnosticDependencies & {
  request: Request; getAuthenticatedUserId: (request: Request) => Promise<string>
}) {
  let userId = ""
  try { userId = (await args.getAuthenticatedUserId(args.request)).trim() } catch { /* sanitized below */ }
  if (!userId) return { status: 401, body: result("X_IDENTITY_DIAGNOSTIC_UNAUTHENTICATED") }
  if (args.request.headers.get(X_IDENTITY_DIAGNOSTIC_CONFIRMATION_HEADER) !== X_IDENTITY_DIAGNOSTIC_CONFIRMATION_VALUE)
    return { status: 400, body: result("X_IDENTITY_DIAGNOSTIC_CONFIRMATION_REQUIRED") }
  if (new URL(args.request.url).search) return { status: 400, body: result("X_IDENTITY_DIAGNOSTIC_PARAMETERS_NOT_ALLOWED") }
  return { status: 200, body: await runXIdentityDiagnostic(userId, args) }
}

export function xIdentityDiagnosticMethodNotAllowedResult() { return result("X_IDENTITY_DIAGNOSTIC_METHOD_NOT_ALLOWED") }
