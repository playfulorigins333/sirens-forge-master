import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import {
  decryptAutopostToken,
  encryptAutopostToken,
  getAutopostTokenKeyVersion,
} from "@/lib/autopost/tokenCryptoCore"

export type FanvueRefreshAccount = {
  user_id: string
  platform: string
  encrypted_refresh_token: string | null
  token_expires_at?: string | null
  token_type?: string | null
  token_key_version?: number | null
  scopes?: string[] | string | null
}

type FanvueRefreshTokenResponse = {
  token_type?: unknown
  expires_in?: unknown
  access_token?: unknown
  refresh_token?: unknown
  scope?: unknown
}

export type FanvueTokenRefreshErrorCode =
  | "FANVUE_ACCOUNT_PLATFORM_INVALID"
  | "FANVUE_REFRESH_TOKEN_MISSING"
  | "FANVUE_REFRESH_TOKEN_DECRYPT_FAILED"
  | "FANVUE_REFRESH_FAILED"
  | "FANVUE_REFRESH_UNAUTHORIZED"
  | "FANVUE_REFRESH_RESPONSE_INVALID"
  | "FANVUE_REFRESH_PERSIST_FAILED"

export type FanvueTokenRefreshResult =
  | {
      ok: true
      token_expires_at: string
      token_type: string
      scopes: string[]
      refreshed: true
    }
  | {
      ok: false
      blocked: true
      error_code: FanvueTokenRefreshErrorCode
      safe_error_message: string
      provider_calls_attempted: boolean
      posted_proof: false
      platform_post_id: null
    }

type FanvueRefreshFetch = (url: string, init: {
  method: "POST"
  headers: Record<string, string>
  body: URLSearchParams
}) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

type FanvueRefreshUpdater = (input: {
  userId: string
  updatePayload: Record<string, unknown>
}) => Promise<{ error?: unknown } | void>

type FanvueTokenRefreshDependencies = {
  fetch?: FanvueRefreshFetch
  now?: () => Date
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  decryptToken?: (encryptedToken: string) => string
  encryptToken?: (token: string) => string
  getTokenKeyVersion?: () => number
  persistRefresh?: FanvueRefreshUpdater
}

function safeFailure(
  errorCode: FanvueTokenRefreshErrorCode,
  safeErrorMessage: string,
  providerCallsAttempted: boolean,
): FanvueTokenRefreshResult {
  return {
    ok: false,
    blocked: true,
    error_code: errorCode,
    safe_error_message: safeErrorMessage,
    provider_calls_attempted: providerCallsAttempted,
    posted_proof: false,
    platform_post_id: null,
  }
}

function env(name: string) {
  return process.env[name]?.trim() ?? ""
}

function requireRefreshConfig(deps: FanvueTokenRefreshDependencies) {
  const tokenUrl = deps.tokenUrl ?? env("FANVUE_OAUTH_TOKEN_URL")
  const clientId = deps.clientId ?? env("FANVUE_CLIENT_ID")
  const clientSecret = deps.clientSecret ?? env("FANVUE_CLIENT_SECRET")
  if (!tokenUrl || !clientId || !clientSecret) throw new Error("FANVUE_REFRESH_CONFIG_INCOMPLETE")
  return { tokenUrl, clientId, clientSecret }
}

function getBasicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
}

function normalizeScopes(scope: unknown, fallback: FanvueRefreshAccount["scopes"]) {
  const source = typeof scope === "string" ? scope.split(/\s+/) : Array.isArray(fallback) ? fallback : typeof fallback === "string" ? fallback.split(/\s+/) : []
  return Array.from(new Set(source.map((value) => String(value).trim()).filter(Boolean)))
}

function parseExpiresAt(expiresIn: unknown, now: Date) {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return null
  return new Date(now.getTime() + expiresIn * 1000).toISOString()
}

async function defaultPersistRefresh(input: { userId: string; updatePayload: Record<string, unknown> }) {
  const { error } = await getSupabaseAdmin()
    .from("autopost_accounts")
    .update(input.updatePayload)
    .eq("user_id", input.userId)
    .eq("platform", "fanvue")
    .eq("connection_status", "CONNECTED")
  return { error }
}

export async function refreshFanvueAccessToken(
  account: FanvueRefreshAccount,
  deps: FanvueTokenRefreshDependencies = {},
): Promise<FanvueTokenRefreshResult> {
  if (account.platform !== "fanvue") {
    return safeFailure("FANVUE_ACCOUNT_PLATFORM_INVALID", "Fanvue refresh requires a Fanvue account.", false)
  }

  if (!account.encrypted_refresh_token) {
    return safeFailure("FANVUE_REFRESH_TOKEN_MISSING", "Fanvue refresh token is missing.", false)
  }

  const decryptToken = deps.decryptToken ?? decryptAutopostToken
  const encryptToken = deps.encryptToken ?? encryptAutopostToken
  const now = deps.now?.() ?? new Date()

  let refreshToken: string
  try {
    refreshToken = decryptToken(account.encrypted_refresh_token)
  } catch {
    return safeFailure("FANVUE_REFRESH_TOKEN_DECRYPT_FAILED", "Unable to decrypt Fanvue refresh token.", false)
  }

  let response: Awaited<ReturnType<FanvueRefreshFetch>>
  try {
    const { tokenUrl, clientId, clientSecret } = requireRefreshConfig(deps)
    const fetchImpl = deps.fetch ?? fetch
    response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        authorization: getBasicAuthHeader(clientId, clientSecret),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    })
  } catch {
    return safeFailure("FANVUE_REFRESH_FAILED", "Fanvue token refresh request failed.", true)
  }

  const tokenResponse = (await response.json().catch(() => null)) as FanvueRefreshTokenResponse | null
  if (!response.ok) {
    const unauthorized = response.status === 400 || response.status === 401 || response.status === 403
    return safeFailure(
      unauthorized ? "FANVUE_REFRESH_UNAUTHORIZED" : "FANVUE_REFRESH_FAILED",
      unauthorized ? "Fanvue refresh token is unauthorized or expired." : "Fanvue token refresh failed.",
      true,
    )
  }

  if (!tokenResponse || typeof tokenResponse.access_token !== "string" || !tokenResponse.access_token) {
    return safeFailure("FANVUE_REFRESH_RESPONSE_INVALID", "Fanvue token refresh response was invalid.", true)
  }

  const tokenExpiresAt = parseExpiresAt(tokenResponse.expires_in, now)
  if (!tokenExpiresAt) {
    return safeFailure("FANVUE_REFRESH_RESPONSE_INVALID", "Fanvue token refresh response was invalid.", true)
  }

  const encryptedAccessToken = encryptToken(tokenResponse.access_token)
  const encryptedRefreshToken = typeof tokenResponse.refresh_token === "string" && tokenResponse.refresh_token
    ? encryptToken(tokenResponse.refresh_token)
    : account.encrypted_refresh_token
  const tokenType = typeof tokenResponse.token_type === "string" && tokenResponse.token_type ? tokenResponse.token_type : account.token_type || "bearer"
  const scopes = normalizeScopes(tokenResponse.scope, account.scopes)

  const updatePayload = {
    encrypted_access_token: encryptedAccessToken,
    encrypted_refresh_token: encryptedRefreshToken,
    token_expires_at: tokenExpiresAt,
    token_type: tokenType,
    token_key_version: (deps.getTokenKeyVersion ?? getAutopostTokenKeyVersion)(),
    scopes,
    last_refresh_at: now.toISOString(),
    last_error: null,
    connection_status: "CONNECTED",
  }

  try {
    const persistResult = await (deps.persistRefresh ?? defaultPersistRefresh)({ userId: account.user_id, updatePayload })
    if (persistResult && "error" in persistResult && persistResult.error) throw new Error("persist failed")
  } catch {
    return safeFailure("FANVUE_REFRESH_PERSIST_FAILED", "Fanvue token refresh could not be saved.", true)
  }

  return { ok: true, token_expires_at: tokenExpiresAt, token_type: tokenType, scopes, refreshed: true }
}
