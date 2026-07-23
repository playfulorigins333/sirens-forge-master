import "server-only"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getXApiBaseUrl } from "@/lib/autopost/xOAuth"
import {
  decryptAutopostToken,
  encryptAutopostToken,
  getAutopostTokenKeyVersion,
} from "@/lib/autopost/tokenCrypto"

type XRefreshTokenResponse = {
  token_type?: unknown
  expires_in?: unknown
  access_token?: unknown
  refresh_token?: unknown
  scope?: unknown
}

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>

export type XTokenRefreshDeps = {
  fetchImpl?: typeof fetch
  supabaseAdmin?: SupabaseAdmin
  decryptToken?: typeof decryptAutopostToken
  encryptToken?: typeof encryptAutopostToken
  getTokenKeyVersion?: typeof getAutopostTokenKeyVersion
  getApiBaseUrl?: typeof getXApiBaseUrl
  env?: Record<string, string | undefined>
  now?: () => Date
}

export type XTokenRefreshResult =
  | {
      ok: true
      encrypted_access_token: string
      encrypted_refresh_token: string
      token_expires_at: string
      token_type: string
    }
  | {
      ok: false
      error_code:
        | "X_REFRESH_FAILED"
        | "X_REFRESH_UNAUTHORIZED"
        | "X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH"
        | "X_REFRESH_TOKEN_DECRYPT_FAILED"
        | "X_REFRESH_CLIENT_INVALID"
        | "X_REFRESH_RESPONSE_INVALID"
        | "X_REFRESH_ACCOUNT_UPDATE_FAILED"
      error_message: string
    }

type RefreshFailureCode =
  | "X_REFRESH_FAILED"
  | "X_REFRESH_UNAUTHORIZED"
  | "X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH"
  | "X_REFRESH_TOKEN_DECRYPT_FAILED"
  | "X_REFRESH_CLIENT_INVALID"
  | "X_REFRESH_RESPONSE_INVALID"
  | "X_REFRESH_ACCOUNT_UPDATE_FAILED"

function getBasicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
}

function getXClientCredentials(env: Record<string, string | undefined>) {
  const clientId = env.X_CLIENT_ID
  const clientSecret = env.X_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function parseTokenExpiresAt(expiresIn: unknown, now: () => Date) {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null
  }

  const expiresAtMs = now().getTime() + expiresIn * 1000
  if (!Number.isFinite(expiresAtMs)) return null

  const expiresAt = new Date(expiresAtMs)
  if (!Number.isFinite(expiresAt.getTime())) return null
  return expiresAt.toISOString()
}

function parseScopes(scope: unknown): { ok: true; scopes?: string[] } | { ok: false } {
  if (scope === undefined) return { ok: true }
  if (typeof scope !== "string") return { ok: false }
  const scopes = scope.split(/\s+/).filter(Boolean)
  return scopes.length > 0 ? { ok: true, scopes } : { ok: false }
}

function parseOAuthError(body: unknown) {
  if (!body || typeof body !== "object" || !("error" in body)) return null
  const error = (body as { error?: unknown }).error
  return typeof error === "string" ? error : null
}

async function parseResponseJson(response: Response) {
  return (await response.json().catch(() => null)) as unknown
}

async function markRefreshFailure(
  supabaseAdmin: SupabaseAdmin,
  input: {
    userId: string
    connectionStatus: "EXPIRED" | "ERROR"
    errorCode: RefreshFailureCode
  }
) {
  try {
    await supabaseAdmin
      .from("autopost_accounts")
      .update({
        connection_status: input.connectionStatus,
        last_error: input.errorCode,
      })
      .eq("user_id", input.userId)
      .eq("platform", "x")
      .eq("connection_status", "CONNECTED")
  } catch {
    // Failure-state persistence is best-effort only.
  }
}

async function persistRefreshSuccess(
  supabaseAdmin: SupabaseAdmin,
  input: {
    userId: string
    encryptedAccessToken: string
    encryptedRefreshToken: string
    tokenExpiresAt: string
    tokenType: "bearer"
    scopes?: string[]
    tokenKeyVersion: number
    lastRefreshAt: string
  }
) {
  const updatePayload: Record<string, unknown> = {
    encrypted_access_token: input.encryptedAccessToken,
    encrypted_refresh_token: input.encryptedRefreshToken,
    token_key_version: input.tokenKeyVersion,
    token_expires_at: input.tokenExpiresAt,
    token_type: input.tokenType,
    connection_status: "CONNECTED",
    last_refresh_at: input.lastRefreshAt,
    last_error: null,
  }

  if (input.scopes) {
    updatePayload.scopes = input.scopes
  }

  const { error } = await supabaseAdmin
    .from("autopost_accounts")
    .update(updatePayload)
    .eq("user_id", input.userId)
    .eq("platform", "x")
    .eq("connection_status", "CONNECTED")

  if (error) {
    throw new Error("X_REFRESH_ACCOUNT_UPDATE_FAILED")
  }
}

function failureMessage(errorCode: RefreshFailureCode) {
  switch (errorCode) {
    case "X_REFRESH_TOKEN_DECRYPT_FAILED":
      return "Unable to decrypt X refresh token"
    case "X_REFRESH_UNAUTHORIZED":
      return "X refresh token is unauthorized or expired"
    case "X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH":
      return "X token refresh did not return a usable access token expiry"
    case "X_REFRESH_CLIENT_INVALID":
      return "X token refresh client configuration is invalid"
    case "X_REFRESH_RESPONSE_INVALID":
      return "X token refresh response was invalid"
    case "X_REFRESH_ACCOUNT_UPDATE_FAILED":
      return "X token refresh account update failed"
    case "X_REFRESH_FAILED":
    default:
      return "X token refresh failed"
  }
}

async function fail(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
  errorCode: RefreshFailureCode,
  connectionStatus: "EXPIRED" | "ERROR" = "ERROR"
): Promise<XTokenRefreshResult> {
  await markRefreshFailure(supabaseAdmin, { userId, connectionStatus, errorCode })
  return { ok: false, error_code: errorCode, error_message: failureMessage(errorCode) }
}

export async function refreshXAccessToken(
  input: {
    userId: string
    encryptedRefreshToken: string
  },
  deps: XTokenRefreshDeps = {}
): Promise<XTokenRefreshResult> {
  const supabaseAdmin = deps.supabaseAdmin ?? getSupabaseAdmin()
  const decryptToken = deps.decryptToken ?? decryptAutopostToken
  const encryptToken = deps.encryptToken ?? encryptAutopostToken
  const getTokenKeyVersion = deps.getTokenKeyVersion ?? getAutopostTokenKeyVersion
  const getApiBaseUrl = deps.getApiBaseUrl ?? getXApiBaseUrl
  const fetchImpl = deps.fetchImpl ?? fetch
  const env = deps.env ?? process.env
  const now = deps.now ?? (() => new Date())

  let refreshToken: string
  try {
    refreshToken = decryptToken(input.encryptedRefreshToken)
  } catch {
    return fail(supabaseAdmin, input.userId, "X_REFRESH_TOKEN_DECRYPT_FAILED")
  }

  const credentials = getXClientCredentials(env)
  if (!credentials) {
    return fail(supabaseAdmin, input.userId, "X_REFRESH_CLIENT_INVALID")
  }

  let response: Response
  try {
    response = await fetchImpl(`${getApiBaseUrl()}/2/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: getBasicAuthHeader(credentials.clientId, credentials.clientSecret),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    })
  } catch {
    return fail(supabaseAdmin, input.userId, "X_REFRESH_FAILED")
  }

  const parsedBody = await parseResponseJson(response)
  if (!response.ok) {
    const oauthError = parseOAuthError(parsedBody)
    if (oauthError === "invalid_grant") {
      return fail(supabaseAdmin, input.userId, "X_REFRESH_UNAUTHORIZED", "EXPIRED")
    }
    if (oauthError === "invalid_client") {
      return fail(supabaseAdmin, input.userId, "X_REFRESH_CLIENT_INVALID")
    }
    return fail(supabaseAdmin, input.userId, "X_REFRESH_FAILED")
  }

  const tokenResponse = (parsedBody ?? {}) as XRefreshTokenResponse
  if (typeof tokenResponse.access_token !== "string" || tokenResponse.access_token.trim().length === 0) {
    return fail(supabaseAdmin, input.userId, "X_REFRESH_RESPONSE_INVALID")
  }

  if (typeof tokenResponse.token_type !== "string" || tokenResponse.token_type.trim().length === 0) {
    return fail(supabaseAdmin, input.userId, "X_REFRESH_RESPONSE_INVALID")
  }

  if (tokenResponse.token_type.trim().toLowerCase() !== "bearer") {
    return fail(supabaseAdmin, input.userId, "X_REFRESH_RESPONSE_INVALID")
  }

  const tokenExpiresAt = parseTokenExpiresAt(tokenResponse.expires_in, now)
  if (!tokenExpiresAt) {
    return fail(supabaseAdmin, input.userId, "X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH")
  }

  let replacementRefreshToken: string | null = null
  if (tokenResponse.refresh_token !== undefined) {
    if (typeof tokenResponse.refresh_token !== "string" || tokenResponse.refresh_token.trim().length === 0) {
      return fail(supabaseAdmin, input.userId, "X_REFRESH_RESPONSE_INVALID")
    }
    replacementRefreshToken = tokenResponse.refresh_token
  }

  const scopesResult = parseScopes(tokenResponse.scope)
  if (!scopesResult.ok) {
    return fail(supabaseAdmin, input.userId, "X_REFRESH_RESPONSE_INVALID")
  }

  let encryptedAccessToken: string
  let encryptedRefreshToken: string
  let tokenKeyVersion: number
  try {
    encryptedAccessToken = encryptToken(tokenResponse.access_token)
    encryptedRefreshToken = replacementRefreshToken ? encryptToken(replacementRefreshToken) : input.encryptedRefreshToken
    tokenKeyVersion = getTokenKeyVersion()
  } catch {
    return fail(supabaseAdmin, input.userId, "X_REFRESH_FAILED")
  }

  try {
    await persistRefreshSuccess(supabaseAdmin, {
      userId: input.userId,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      tokenType: "bearer",
      scopes: scopesResult.scopes,
      tokenKeyVersion,
      lastRefreshAt: now().toISOString(),
    })
  } catch {
    await markRefreshFailure(supabaseAdmin, {
      userId: input.userId,
      connectionStatus: "ERROR",
      errorCode: "X_REFRESH_ACCOUNT_UPDATE_FAILED",
    })
    return {
      ok: false,
      error_code: "X_REFRESH_ACCOUNT_UPDATE_FAILED",
      error_message: failureMessage("X_REFRESH_ACCOUNT_UPDATE_FAILED"),
    }
  }

  return {
    ok: true,
    encrypted_access_token: encryptedAccessToken,
    encrypted_refresh_token: encryptedRefreshToken,
    token_expires_at: tokenExpiresAt,
    token_type: "bearer",
  }
}
