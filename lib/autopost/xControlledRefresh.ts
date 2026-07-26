import "server-only"

import {
  decryptAutopostToken,
  encryptAutopostToken,
  getAutopostTokenKeyVersion,
} from "./tokenCrypto"
import { getXStoredPostureBlocker, type XStoredPostureAccount } from "./xStoredPosture"

export const X_CONTROLLED_REFRESH_BUFFER_MS = 60_000
export const X_CONTROLLED_REFRESH_TIMEOUT_MS = 10_000
export const MAX_ZERO_LENGTH_READS = 8
export const BODY_READ_TIMEOUT_MS = 250
export const BODY_CANCEL_TIMEOUT_MS = 50
export const X_CONTROLLED_REFRESH_CONFIRMATION = "refresh-protected-x-once-v1"
export const X_CONTROLLED_REFRESH_ENDPOINT = "https://api.x.com/2/oauth2/token"

export type XControlledRefreshSafeCode =
  | "X_CONTROLLED_REFRESH_UNAUTHENTICATED"
  | "X_CONTROLLED_REFRESH_CONFIRMATION_REQUIRED"
  | "X_CONTROLLED_REFRESH_PARAMETERS_NOT_ALLOWED"
  | "X_CONTROLLED_REFRESH_METHOD_NOT_ALLOWED"
  | "X_CONTROLLED_REFRESH_ACCOUNT_LOOKUP_FAILED"
  | "X_CONTROLLED_REFRESH_ACCOUNT_NOT_READY"
  | "X_CONTROLLED_REFRESH_PROTECTED_USERNAME_MISMATCH"
  | "X_CONTROLLED_REFRESH_NOT_REQUIRED"
  | "X_CONTROLLED_REFRESH_TOKEN_KEY_VERSION_UNAVAILABLE"
  | "X_CONTROLLED_REFRESH_TOKEN_KEY_VERSION_MISMATCH"
  | "X_CONTROLLED_REFRESH_CLOCK_INVALID"
  | "X_CONTROLLED_REFRESH_REFRESH_TOKEN_DECRYPT_FAILED"
  | "X_CONTROLLED_REFRESH_REFRESH_TOKEN_INVALID"
  | "X_CONTROLLED_REFRESH_PROVIDER_CONFIG_INVALID"
  | "X_CONTROLLED_REFRESH_PROVIDER_UNAUTHORIZED"
  | "X_CONTROLLED_REFRESH_PROVIDER_INVALID_CLIENT"
  | "X_CONTROLLED_REFRESH_PROVIDER_RATE_LIMITED"
  | "X_CONTROLLED_REFRESH_PROVIDER_REJECTED"
  | "X_CONTROLLED_REFRESH_PROVIDER_RESPONSE_INVALID"
  | "X_CONTROLLED_REFRESH_PROVIDER_TIMEOUT"
  | "X_CONTROLLED_REFRESH_PROVIDER_NETWORK_FAILURE"
  | "X_CONTROLLED_REFRESH_PROVIDER_OUTCOME_UNKNOWN"
  | "X_CONTROLLED_REFRESH_TOKEN_ENCRYPTION_FAILED"
  | "X_CONTROLLED_REFRESH_ACCOUNT_CHANGED"
  | "X_CONTROLLED_REFRESH_ACCOUNT_UPDATE_FAILED"
  | "X_CONTROLLED_REFRESH_SUCCEEDED"

type ProviderStatusClass = "2xx" | "4xx" | "5xx" | null
export type XControlledRefreshResult = {
  ok: boolean
  mode: "x_controlled_refresh"
  safe_code: XControlledRefreshSafeCode
  provider_request_attempted: boolean
  provider_status_class: ProviderStatusClass
  refresh_attempted: boolean
  refresh_verified: boolean
  outcome_uncertain: boolean
  database_write_attempted: boolean
  database_write_verified: boolean
  retry_attempted: false
  post_attempted: false
  runner_invoked: false
  scheduler_action_attempted: false
  cron_action_attempted: false
  public_enablement_attempted: false
  fanvue_account_queried: false
  fanvue_account_mutated: false
}

function createResult(
  safeCode: XControlledRefreshSafeCode,
  overrides: Partial<XControlledRefreshResult> = {},
): XControlledRefreshResult {
  return {
    ok: false,
    mode: "x_controlled_refresh",
    safe_code: safeCode,
    provider_request_attempted: false,
    provider_status_class: null,
    refresh_attempted: false,
    refresh_verified: false,
    outcome_uncertain: false,
    database_write_attempted: false,
    database_write_verified: false,
    retry_attempted: false,
    post_attempted: false,
    runner_invoked: false,
    scheduler_action_attempted: false,
    cron_action_attempted: false,
    public_enablement_attempted: false,
    fanvue_account_queried: false,
    fanvue_account_mutated: false,
    ...overrides,
  }
}

export function xControlledRefreshMethodNotAllowedResult() {
  return createResult("X_CONTROLLED_REFRESH_METHOD_NOT_ALLOWED")
}

async function settleWithin<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("bounded operation timed out")), milliseconds)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function hasZeroByteBody(request: Request): Promise<boolean> {
  if (request.body === null) return true
  const reader = request.body.getReader()
  let accepted = false
  try {
    for (let reads = 0; reads <= MAX_ZERO_LENGTH_READS; reads += 1) {
      const next = await settleWithin(reader.read(), BODY_READ_TIMEOUT_MS)
      if (next.done) {
        accepted = true
        break
      }
      if (next.value.byteLength > 0 || reads === MAX_ZERO_LENGTH_READS) break
    }
  } catch {
    accepted = false
  }
  if (!accepted) {
    try {
      await settleWithin(Promise.resolve(reader.cancel()), BODY_CANCEL_TIMEOUT_MS)
    } catch {
      // Cancellation is best effort and bounded.
    }
  }
  try {
    reader.releaseLock()
  } catch {
    // A hostile stream cannot change the sanitized gate result.
  }
  return accepted
}

export type XControlledRefreshAccount = XStoredPostureAccount & {
  encrypted_access_token: string | null
  encrypted_refresh_token: string | null
  token_expires_at: string | null
  token_key_version: number | null
}
export type XControlledRefreshWriteProof = { data: { id?: unknown } | null; error: unknown }
export type XControlledRefreshWriter = (
  values: Record<string, unknown>,
  account: XControlledRefreshAccount,
  userId: string,
) => Promise<XControlledRefreshWriteProof>
export type XControlledRefreshDependencies = {
  decryptToken?: (value: string) => unknown
  encryptToken?: (value: string) => string
  getTokenKeyVersion?: () => unknown
  now?: () => unknown
  fetch?: typeof fetch
  createTimeoutSignal?: (milliseconds: number) => AbortSignal
  clientId?: string
  clientSecret?: string
  endpoint?: string
}

type ValidProviderTokens = {
  accessToken: string
  replacementRefreshToken?: string
  expiresAt: string
  scopes?: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function classifyStatus(status: number): ProviderStatusClass {
  if (status >= 200 && status < 300) return "2xx"
  if (status >= 400 && status < 500) return "4xx"
  if (status >= 500 && status < 600) return "5xx"
  return null
}

function isExactProviderEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.href === X_CONTROLLED_REFRESH_ENDPOINT &&
      url.protocol === "https:" && url.hostname === "api.x.com" && url.port === "" &&
      url.username === "" && url.password === "" && url.search === "" &&
      url.hash === "" && url.pathname === "/2/oauth2/token"
  } catch {
    return false
  }
}

function validateProviderSuccess(body: unknown, nowMs: number): ValidProviderTokens | null {
  if (!isPlainObject(body)) return null
  if (typeof body.access_token !== "string") return null
  const accessToken = body.access_token.trim()
  if (!accessToken) return null
  if (typeof body.token_type !== "string" || body.token_type.trim().toLowerCase() !== "bearer") return null
  if (typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) return null
  const expiryMs = nowMs + body.expires_in * 1000
  if (!Number.isFinite(expiryMs)) return null
  let expiresAt: string
  try {
    expiresAt = new Date(expiryMs).toISOString()
  } catch {
    return null
  }
  let replacementRefreshToken: string | undefined
  if (body.refresh_token !== undefined) {
    if (typeof body.refresh_token !== "string") return null
    replacementRefreshToken = body.refresh_token.trim()
    if (!replacementRefreshToken) return null
  }
  let scopes: string[] | undefined
  if (body.scope !== undefined) {
    if (typeof body.scope !== "string" || !body.scope.trim()) return null
    scopes = [...new Set(body.scope.trim().split(/\s+/).filter(Boolean))]
    if (!scopes.length) return null
  }
  return { accessToken, replacementRefreshToken, expiresAt, scopes }
}

function providerAttempt(
  safeCode: XControlledRefreshSafeCode,
  providerStatusClass: ProviderStatusClass,
  outcomeUncertain = false,
) {
  return createResult(safeCode, {
    provider_request_attempted: true,
    provider_status_class: providerStatusClass,
    refresh_attempted: true,
    outcome_uncertain: outcomeUncertain,
  })
}

type WriteContext = "provider_success" | "invalid_grant"
async function persistConditionalWrite(
  context: WriteContext,
  writer: XControlledRefreshWriter,
  values: Record<string, unknown>,
  account: XControlledRefreshAccount,
  userId: string,
): Promise<XControlledRefreshResult> {
  const providerSuccess = context === "provider_success"
  const common: Partial<XControlledRefreshResult> = {
    provider_request_attempted: true,
    provider_status_class: providerSuccess ? "2xx" : "4xx",
    refresh_attempted: true,
    refresh_verified: providerSuccess,
    database_write_attempted: true,
  }
  try {
    const proof = await writer(values, account, userId)
    if (proof.error) throw new Error("write failed")
    if (proof.data === null) {
      return createResult("X_CONTROLLED_REFRESH_ACCOUNT_CHANGED", {
        ...common,
        outcome_uncertain: providerSuccess,
      })
    }
    if (typeof proof.data.id !== "string" || !proof.data.id.trim()) throw new Error("invalid proof")
    return createResult(
      providerSuccess ? "X_CONTROLLED_REFRESH_SUCCEEDED" : "X_CONTROLLED_REFRESH_PROVIDER_UNAUTHORIZED",
      { ...common, ok: providerSuccess, database_write_verified: true },
    )
  } catch {
    return createResult("X_CONTROLLED_REFRESH_ACCOUNT_UPDATE_FAILED", {
      ...common,
      outcome_uncertain: true,
    })
  }
}

export async function controlledRefreshX(
  userId: string,
  account: XControlledRefreshAccount,
  writer: XControlledRefreshWriter,
  dependencies: XControlledRefreshDependencies = {},
): Promise<XControlledRefreshResult> {
  if (getXStoredPostureBlocker(account)) return createResult("X_CONTROLLED_REFRESH_ACCOUNT_NOT_READY")
  const storedUsername = account.provider_username as string
  const storedProviderId = account.provider_account_id as string
  if (storedUsername.trim().toLowerCase() !== "the_beard0302" || !storedProviderId.trim()) {
    return createResult("X_CONTROLLED_REFRESH_PROTECTED_USERNAME_MISMATCH")
  }

  let keyVersion: unknown
  try {
    keyVersion = (dependencies.getTokenKeyVersion ?? getAutopostTokenKeyVersion)()
  } catch {
    return createResult("X_CONTROLLED_REFRESH_TOKEN_KEY_VERSION_UNAVAILABLE")
  }
  if (typeof keyVersion !== "number" || !Number.isFinite(keyVersion) || !Number.isInteger(keyVersion) || keyVersion <= 0) {
    return createResult("X_CONTROLLED_REFRESH_TOKEN_KEY_VERSION_UNAVAILABLE")
  }
  if (keyVersion !== account.token_key_version) return createResult("X_CONTROLLED_REFRESH_TOKEN_KEY_VERSION_MISMATCH")

  let now: unknown
  try {
    now = (dependencies.now ?? (() => new Date()))()
  } catch {
    return createResult("X_CONTROLLED_REFRESH_CLOCK_INVALID")
  }
  if (!(now instanceof Date)) return createResult("X_CONTROLLED_REFRESH_CLOCK_INVALID")
  const nowMs = now.getTime()
  try {
    if (!Number.isFinite(nowMs) || !now.toISOString()) throw new Error("invalid clock")
  } catch {
    return createResult("X_CONTROLLED_REFRESH_CLOCK_INVALID")
  }
  if (new Date(account.token_expires_at as string).getTime() > nowMs + X_CONTROLLED_REFRESH_BUFFER_MS) {
    return createResult("X_CONTROLLED_REFRESH_NOT_REQUIRED")
  }

  let decryptedRefreshToken: unknown
  try {
    decryptedRefreshToken = (dependencies.decryptToken ?? decryptAutopostToken)(account.encrypted_refresh_token as string)
  } catch {
    return createResult("X_CONTROLLED_REFRESH_REFRESH_TOKEN_DECRYPT_FAILED")
  }
  if (typeof decryptedRefreshToken !== "string") return createResult("X_CONTROLLED_REFRESH_REFRESH_TOKEN_INVALID")
  const refreshToken = decryptedRefreshToken.trim()
  if (!refreshToken) return createResult("X_CONTROLLED_REFRESH_REFRESH_TOKEN_INVALID")

  const clientId = (dependencies.clientId ?? process.env.X_CLIENT_ID ?? "").trim()
  const clientSecret = (dependencies.clientSecret ?? process.env.X_CLIENT_SECRET ?? "").trim()
  const endpoint = dependencies.endpoint ?? X_CONTROLLED_REFRESH_ENDPOINT
  if (!clientId || !clientSecret || !isExactProviderEndpoint(endpoint)) {
    return createResult("X_CONTROLLED_REFRESH_PROVIDER_CONFIG_INVALID")
  }
  let signal: AbortSignal
  try {
    signal = (dependencies.createTimeoutSignal ?? ((milliseconds) => AbortSignal.timeout(milliseconds)))(X_CONTROLLED_REFRESH_TIMEOUT_MS)
  } catch {
    return createResult("X_CONTROLLED_REFRESH_PROVIDER_CONFIG_INVALID")
  }

  let response: Response
  try {
    response = await (dependencies.fetch ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams([
        ["grant_type", "refresh_token"],
        ["refresh_token", refreshToken],
      ]),
      cache: "no-store",
      redirect: "error",
      signal,
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : isPlainObject(error) && typeof error.name === "string" ? error.name : ""
    const timedOut = name === "TimeoutError" || (name === "AbortError" && signal.aborted)
    return providerAttempt(timedOut ? "X_CONTROLLED_REFRESH_PROVIDER_TIMEOUT" : "X_CONTROLLED_REFRESH_PROVIDER_NETWORK_FAILURE", null, true)
  }

  const statusClass = classifyStatus(response.status)
  let providerBody: unknown
  try {
    providerBody = await response.json()
  } catch {
    providerBody = undefined
  }
  if (!response.ok) {
    const oauthError = isPlainObject(providerBody) && typeof providerBody.error === "string" ? providerBody.error : ""
    if (oauthError === "invalid_grant") {
      return persistConditionalWrite("invalid_grant", writer, {
        connection_status: "EXPIRED",
        last_error: "X_CONTROLLED_REFRESH_PROVIDER_UNAUTHORIZED",
      }, account, userId)
    }
    if (oauthError === "invalid_client") return providerAttempt("X_CONTROLLED_REFRESH_PROVIDER_INVALID_CLIENT", statusClass)
    if (response.status === 429) return providerAttempt("X_CONTROLLED_REFRESH_PROVIDER_RATE_LIMITED", statusClass)
    if (response.status >= 400 && response.status < 500) return providerAttempt("X_CONTROLLED_REFRESH_PROVIDER_REJECTED", statusClass)
    return providerAttempt("X_CONTROLLED_REFRESH_PROVIDER_OUTCOME_UNKNOWN", statusClass, true)
  }

  const tokens = validateProviderSuccess(providerBody, nowMs)
  if (!tokens) return providerAttempt("X_CONTROLLED_REFRESH_PROVIDER_RESPONSE_INVALID", statusClass, true)
  let encryptedAccessToken: string
  let encryptedRefreshToken = account.encrypted_refresh_token as string
  try {
    const encrypt = dependencies.encryptToken ?? encryptAutopostToken
    encryptedAccessToken = encrypt(tokens.accessToken)
    if (tokens.replacementRefreshToken !== undefined) encryptedRefreshToken = encrypt(tokens.replacementRefreshToken)
  } catch {
    return createResult("X_CONTROLLED_REFRESH_TOKEN_ENCRYPTION_FAILED", {
      provider_request_attempted: true,
      provider_status_class: statusClass,
      refresh_attempted: true,
      refresh_verified: true,
      outcome_uncertain: true,
    })
  }
  const values: Record<string, unknown> = {
    encrypted_access_token: encryptedAccessToken,
    encrypted_refresh_token: encryptedRefreshToken,
    token_expires_at: tokens.expiresAt,
    token_type: "bearer",
    token_key_version: keyVersion,
    connection_status: "CONNECTED",
    last_refresh_at: now.toISOString(),
    last_error: null,
  }
  if (tokens.scopes) values.scopes = tokens.scopes
  return persistConditionalWrite("provider_success", writer, values, account, userId)
}

export function createXControlledRefreshAccountLoader(client: any) {
  return async (userId: string): Promise<{ account: XControlledRefreshAccount | null; error: unknown }> => {
    const response = await client
      .from("autopost_accounts")
      .select("connection_status,provider_account_id,provider_username,last_error,encrypted_access_token,encrypted_refresh_token,token_expires_at,token_key_version,metadata")
      .eq("user_id", userId)
      .eq("platform", "x")
      .maybeSingle()
    return { account: response.data, error: response.error }
  }
}

export function createXControlledRefreshWriter(client: any): XControlledRefreshWriter {
  return async (values, account, userId) => client
    .from("autopost_accounts")
    .update(values)
    .eq("user_id", userId)
    .eq("platform", "x")
    .eq("connection_status", "CONNECTED")
    .eq("provider_account_id", account.provider_account_id)
    .eq("provider_username", account.provider_username)
    .eq("token_key_version", account.token_key_version)
    .eq("encrypted_access_token", account.encrypted_access_token)
    .eq("encrypted_refresh_token", account.encrypted_refresh_token)
    .eq("token_expires_at", account.token_expires_at)
    .is("last_error", null)
    .select("id")
    .maybeSingle()
}

export async function handleXControlledRefreshRequest(input: {
  request: Request
  getAuthenticatedUserId: () => Promise<string | null | undefined>
  createPrivilegedAccess: () => {
    load: ReturnType<typeof createXControlledRefreshAccountLoader>
    writer: XControlledRefreshWriter
  }
  dependencies?: XControlledRefreshDependencies
}): Promise<{ status: number; body: XControlledRefreshResult }> {
  let authenticatedUser: string | null | undefined
  try {
    authenticatedUser = await input.getAuthenticatedUserId()
  } catch {
    return { status: 401, body: createResult("X_CONTROLLED_REFRESH_UNAUTHENTICATED") }
  }
  const userId = typeof authenticatedUser === "string" ? authenticatedUser.trim() : ""
  if (!userId) return { status: 401, body: createResult("X_CONTROLLED_REFRESH_UNAUTHENTICATED") }
  if (input.request.headers.get("x-autopost-x-controlled-refresh") !== X_CONTROLLED_REFRESH_CONFIRMATION) {
    return { status: 400, body: createResult("X_CONTROLLED_REFRESH_CONFIRMATION_REQUIRED") }
  }
  if (new URL(input.request.url).search !== "") {
    return { status: 400, body: createResult("X_CONTROLLED_REFRESH_PARAMETERS_NOT_ALLOWED") }
  }
  if (!(await hasZeroByteBody(input.request))) {
    return { status: 400, body: createResult("X_CONTROLLED_REFRESH_PARAMETERS_NOT_ALLOWED") }
  }
  let access: ReturnType<typeof input.createPrivilegedAccess>
  let loaded: Awaited<ReturnType<ReturnType<typeof createXControlledRefreshAccountLoader>>>
  try {
    access = input.createPrivilegedAccess()
    loaded = await access.load(userId)
  } catch {
    return { status: 200, body: createResult("X_CONTROLLED_REFRESH_ACCOUNT_LOOKUP_FAILED") }
  }
  if (loaded.error) return { status: 200, body: createResult("X_CONTROLLED_REFRESH_ACCOUNT_LOOKUP_FAILED") }
  if (!loaded.account) return { status: 200, body: createResult("X_CONTROLLED_REFRESH_ACCOUNT_NOT_READY") }
  return { status: 200, body: await controlledRefreshX(userId, loaded.account, access.writer, input.dependencies) }
}
