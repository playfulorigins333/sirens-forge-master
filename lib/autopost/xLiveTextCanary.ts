import "server-only"

import { decryptAutopostToken, getAutopostTokenKeyVersion } from "./tokenCrypto"
import { getXStoredPostureBlocker, type XStoredPostureAccount } from "./xStoredPosture"
import {
  createXTextPost,
  X_TOKEN_EXPIRY_REFRESH_BUFFER_MS,
  type XCreatePostResult,
} from "./xAdapter"

export const X_LIVE_TEXT_CANARY = "Testing a new posting workflow. No action needed."
export const X_LIVE_CANARY_CONFIRMATION_HEADER = "x-autopost-x-live-text-canary"
export const X_LIVE_CANARY_CONFIRMATION_VALUE = "post-fixed-canary-once-v1"
export const X_LIVE_CANARY_TIMEOUT_MS = 10000
export const X_LIVE_CANARY_ACCOUNT_SELECT =
  "connection_status, provider_account_id, provider_username, last_error, encrypted_access_token, encrypted_refresh_token, token_expires_at, token_key_version, metadata"

const PROTECTED_USERNAME = "the_beard0302"
const MAX_ZERO_LENGTH_READS = 8
const BODY_READ_TIMEOUT_MS = 250
const BODY_CANCEL_TIMEOUT_MS = 50

type Account = XStoredPostureAccount & {
  provider_username?: unknown
  encrypted_access_token?: unknown
  encrypted_refresh_token?: unknown
  token_expires_at?: unknown
  token_key_version?: unknown
}

export type XLiveCanarySafeCode =
  | "X_LIVE_CANARY_UNAUTHENTICATED" | "X_LIVE_CANARY_CONFIRMATION_REQUIRED"
  | "X_LIVE_CANARY_PARAMETERS_NOT_ALLOWED" | "X_LIVE_CANARY_METHOD_NOT_ALLOWED"
  | "X_LIVE_CANARY_ACCOUNT_LOOKUP_FAILED" | "X_LIVE_CANARY_ACCOUNT_NOT_READY"
  | "X_LIVE_CANARY_PROTECTED_USERNAME_MISMATCH" | "X_LIVE_CANARY_TOKEN_KEY_VERSION_UNAVAILABLE"
  | "X_LIVE_CANARY_TOKEN_KEY_VERSION_MISMATCH" | "X_LIVE_CANARY_TOKEN_EXPIRED_OR_EXPIRING"
  | "X_LIVE_CANARY_ACCESS_TOKEN_DECRYPT_FAILED" | "X_LIVE_CANARY_ACCESS_TOKEN_INVALID"
  | "X_LIVE_CANARY_PROVIDER_CONFIG_INVALID" | "X_LIVE_CANARY_X_UNAUTHORIZED"
  | "X_LIVE_CANARY_X_FORBIDDEN" | "X_LIVE_CANARY_X_RATE_LIMITED"
  | "X_LIVE_CANARY_X_INVALID_REQUEST" | "X_LIVE_CANARY_X_REJECTED"
  | "X_LIVE_CANARY_RESPONSE_INVALID" | "X_LIVE_CANARY_OUTCOME_UNKNOWN"
  | "X_LIVE_CANARY_NETWORK_FAILURE" | "X_LIVE_CANARY_TIMEOUT" | "X_LIVE_CANARY_SUCCEEDED"

const fixedFlags = {
  database_write_attempted: false, refresh_attempted: false, retry_attempted: false,
  runner_invoked: false, scheduler_action_attempted: false, cron_action_attempted: false,
  public_enablement_attempted: false, fanvue_account_queried: false, fanvue_account_mutated: false,
} as const

export function xLiveCanaryResult(
  safeCode: XLiveCanarySafeCode,
  state: { provider?: boolean; verified?: boolean; uncertain?: boolean; postId?: string } = {}
) {
  const succeeded = safeCode === "X_LIVE_CANARY_SUCCEEDED"
  return {
    ok: succeeded, mode: "x_live_text_canary" as const, safe_code: safeCode,
    ...(succeeded && state.postId ? { post_id: state.postId } : {}),
    provider_request_attempted: state.provider === true,
    post_attempted: state.provider === true,
    post_verified: state.verified === true,
    outcome_uncertain: state.uncertain === true,
    ...fixedFlags,
  }
}

export type XLiveTextCanaryDeps = {
  loadAccount: (userId: string) => Promise<Account | null>
  getTokenKeyVersion?: () => unknown
  decryptToken?: (encrypted: string) => unknown
  getApiBaseUrl?: () => unknown
  fetchImpl?: typeof fetch
  now?: () => Date
  createTimeoutSignal?: (milliseconds: number) => AbortSignal
}

export function createXLiveTextCanaryAccountLoader(client: any) {
  return async (userId: string): Promise<Account | null> => {
    const { data, error } = await client.from("autopost_accounts")
      .select(X_LIVE_CANARY_ACCOUNT_SELECT).eq("user_id", userId).eq("platform", "x").maybeSingle()
    if (error) throw new Error("account lookup failed")
    return data ?? null
  }
}

function providerCode(result: Extract<XCreatePostResult, { ok: false }>): XLiveCanarySafeCode {
  const byError: Record<string, XLiveCanarySafeCode> = {
    X_API_UNAUTHORIZED: "X_LIVE_CANARY_X_UNAUTHORIZED", X_API_FORBIDDEN: "X_LIVE_CANARY_X_FORBIDDEN",
    X_API_RATE_LIMITED: "X_LIVE_CANARY_X_RATE_LIMITED", X_API_INVALID_REQUEST: "X_LIVE_CANARY_X_INVALID_REQUEST",
    X_API_REJECTED: "X_LIVE_CANARY_X_REJECTED",
  }
  return byError[result.error_code] ?? ({
    network_failure: "X_LIVE_CANARY_NETWORK_FAILURE", timeout: "X_LIVE_CANARY_TIMEOUT",
    response_invalid: "X_LIVE_CANARY_RESPONSE_INVALID", outcome_unknown: "X_LIVE_CANARY_OUTCOME_UNKNOWN",
  } as Partial<Record<typeof result.failure_kind, XLiveCanarySafeCode>>)[result.failure_kind]
    ?? "X_LIVE_CANARY_OUTCOME_UNKNOWN"
}

function isUncertain(result: Extract<XCreatePostResult, { ok: false }>) {
  return ["network_failure", "timeout", "outcome_unknown", "response_invalid"].includes(result.failure_kind)
}

export async function runXLiveTextCanary(userId: string, deps: XLiveTextCanaryDeps) {
  let account: Account | null
  try { account = await deps.loadAccount(userId) } catch { return xLiveCanaryResult("X_LIVE_CANARY_ACCOUNT_LOOKUP_FAILED") }
  if (getXStoredPostureBlocker(account)) return xLiveCanaryResult("X_LIVE_CANARY_ACCOUNT_NOT_READY")

  const username = typeof account?.provider_username === "string" ? account.provider_username.trim().toLowerCase() : ""
  if (username !== PROTECTED_USERNAME) return xLiveCanaryResult("X_LIVE_CANARY_PROTECTED_USERNAME_MISMATCH")

  let currentVersion: unknown
  try { currentVersion = (deps.getTokenKeyVersion ?? getAutopostTokenKeyVersion)() } catch {
    return xLiveCanaryResult("X_LIVE_CANARY_TOKEN_KEY_VERSION_UNAVAILABLE")
  }
  if (typeof currentVersion !== "number" || !Number.isFinite(currentVersion) || !Number.isInteger(currentVersion) || currentVersion <= 0) {
    return xLiveCanaryResult("X_LIVE_CANARY_TOKEN_KEY_VERSION_UNAVAILABLE")
  }
  if (account?.token_key_version !== currentVersion) return xLiveCanaryResult("X_LIVE_CANARY_TOKEN_KEY_VERSION_MISMATCH")

  let capturedNow: Date
  try {
    capturedNow = (deps.now ?? (() => new Date()))()
    if (!(capturedNow instanceof Date) || !Number.isFinite(capturedNow.getTime())) throw new Error("invalid clock")
  } catch {
    return xLiveCanaryResult("X_LIVE_CANARY_TOKEN_EXPIRED_OR_EXPIRING")
  }
  const expiry = typeof account?.token_expires_at === "string" ? Date.parse(account.token_expires_at) : NaN
  if (!Number.isFinite(expiry) || expiry <= capturedNow.getTime() + X_TOKEN_EXPIRY_REFRESH_BUFFER_MS) {
    return xLiveCanaryResult("X_LIVE_CANARY_TOKEN_EXPIRED_OR_EXPIRING")
  }

  let decrypted: unknown
  try { decrypted = (deps.decryptToken ?? decryptAutopostToken)(account!.encrypted_access_token as string) } catch {
    return xLiveCanaryResult("X_LIVE_CANARY_ACCESS_TOKEN_DECRYPT_FAILED")
  }
  if (typeof decrypted !== "string" || !decrypted.trim()) return xLiveCanaryResult("X_LIVE_CANARY_ACCESS_TOKEN_INVALID")
  const accessToken = decrypted.trim()

  let getApiBaseUrl: () => string
  try {
    const base = (deps.getApiBaseUrl ?? (() => process.env.X_API_BASE_URL || "https://api.x.com"))()
    if (typeof base !== "string") throw new Error("invalid")
    const endpoint = new URL(`${base.replace(/\/+$/, "")}/2/tweets`)
    if (endpoint.protocol !== "https:" || endpoint.hostname !== "api.x.com" || endpoint.port || endpoint.username ||
      endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/2/tweets") throw new Error("invalid")
    getApiBaseUrl = () => "https://api.x.com"
  } catch { return xLiveCanaryResult("X_LIVE_CANARY_PROVIDER_CONFIG_INVALID") }

  let signal: AbortSignal
  try { signal = (deps.createTimeoutSignal ?? AbortSignal.timeout)(X_LIVE_CANARY_TIMEOUT_MS) } catch {
    return xLiveCanaryResult("X_LIVE_CANARY_PROVIDER_CONFIG_INVALID")
  }
  const result = await createXTextPost({ accessToken, text: X_LIVE_TEXT_CANARY,
    fetchImpl: deps.fetchImpl ?? fetch, getApiBaseUrl, signal })
  if (result.ok === true) return xLiveCanaryResult("X_LIVE_CANARY_SUCCEEDED", { provider: true, verified: true, postId: result.platform_post_id })
  return xLiveCanaryResult(providerCode(result), { provider: true, uncertain: isUncertain(result) })
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(reject, milliseconds) })]) }
  finally { if (timer) clearTimeout(timer) }
}
async function cancel(reader: ReadableStreamDefaultReader<Uint8Array>) {
  await withTimeout(reader.cancel().catch(() => undefined), BODY_CANCEL_TIMEOUT_MS).catch(() => undefined)
}
export async function hasXLiveCanaryRequestBody(request: Request) {
  if (request.body === null) return false
  const reader = request.body.getReader()
  try {
    for (let reads = 0; reads <= MAX_ZERO_LENGTH_READS; reads++) {
      const value = await withTimeout(reader.read(), BODY_READ_TIMEOUT_MS)
      if (value.done) return false
      if (value.value.byteLength) { await cancel(reader); return true }
    }
    await cancel(reader); throw new Error("excess zero chunks")
  } catch (error) { await cancel(reader); throw error }
  finally { reader.releaseLock() }
}

export async function handleXLiveTextCanaryRequest(args: XLiveTextCanaryDeps & {
  request: Request; getAuthenticatedUserId: () => Promise<string | null>
}) {
  let userId: string | null
  try { userId = await args.getAuthenticatedUserId() } catch { userId = null }
  if (!userId?.trim()) return { status: 401, body: xLiveCanaryResult("X_LIVE_CANARY_UNAUTHENTICATED") }
  if (args.request.headers.get(X_LIVE_CANARY_CONFIRMATION_HEADER) !== X_LIVE_CANARY_CONFIRMATION_VALUE)
    return { status: 400, body: xLiveCanaryResult("X_LIVE_CANARY_CONFIRMATION_REQUIRED") }
  if (new URL(args.request.url).search) return { status: 400, body: xLiveCanaryResult("X_LIVE_CANARY_PARAMETERS_NOT_ALLOWED") }
  try { if (await hasXLiveCanaryRequestBody(args.request)) return { status: 400, body: xLiveCanaryResult("X_LIVE_CANARY_PARAMETERS_NOT_ALLOWED") } }
  catch { return { status: 400, body: xLiveCanaryResult("X_LIVE_CANARY_PARAMETERS_NOT_ALLOWED") } }
  return { status: 200, body: await runXLiveTextCanary(userId.trim(), args) }
}

export function xLiveTextCanaryMethodNotAllowedResult() {
  return xLiveCanaryResult("X_LIVE_CANARY_METHOD_NOT_ALLOWED")
}
