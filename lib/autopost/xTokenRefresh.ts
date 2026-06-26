import "server-only"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getXApiBaseUrl } from "@/lib/autopost/xOAuth"
import {
  decryptAutopostToken,
  encryptAutopostToken,
  getAutopostTokenKeyVersion,
} from "@/lib/autopost/tokenCrypto"

type XRefreshTokenResponse = {
  token_type?: string
  expires_in?: number
  access_token?: string
  refresh_token?: string
  scope?: string
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
      error_code: "X_REFRESH_FAILED" | "X_REFRESH_UNAUTHORIZED" | "X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH" | "X_REFRESH_TOKEN_DECRYPT_FAILED"
      error_message: string
    }

function getBasicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
}

function getXClientCredentials() {
  const clientId = process.env.X_CLIENT_ID
  const clientSecret = process.env.X_CLIENT_SECRET
  if (!clientId) throw new Error("X_CLIENT_ID_NOT_CONFIGURED")
  if (!clientSecret) throw new Error("X_CLIENT_SECRET_NOT_CONFIGURED")
  return { clientId, clientSecret }
}

function parseTokenExpiresAt(expiresIn: unknown) {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null
  }

  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

function parseScopes(scope: unknown) {
  if (typeof scope !== "string") return null
  const scopes = scope.split(/\s+/).filter(Boolean)
  return scopes.length > 0 ? scopes : null
}

async function markRefreshFailure(input: {
  userId: string
  connectionStatus: "EXPIRED" | "ERROR"
  errorCode: string
}) {
  const supabaseAdmin = getSupabaseAdmin()
  await supabaseAdmin
    .from("autopost_accounts")
    .update({
      connection_status: input.connectionStatus,
      last_error: input.errorCode,
    })
    .eq("user_id", input.userId)
    .eq("platform", "x")
    .eq("connection_status", "CONNECTED")
}

async function persistRefreshSuccess(input: {
  userId: string
  encryptedAccessToken: string
  encryptedRefreshToken: string
  tokenExpiresAt: string | null
  tokenType: string
  scopes: string[] | null
}) {
  const supabaseAdmin = getSupabaseAdmin()
  const updatePayload: Record<string, unknown> = {
    encrypted_access_token: input.encryptedAccessToken,
    encrypted_refresh_token: input.encryptedRefreshToken,
    token_key_version: getAutopostTokenKeyVersion(),
    token_expires_at: input.tokenExpiresAt,
    token_type: input.tokenType,
    connection_status: "CONNECTED",
    last_refresh_at: new Date().toISOString(),
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

export async function refreshXAccessToken(input: {
  userId: string
  encryptedRefreshToken: string
}): Promise<XTokenRefreshResult> {
  let refreshToken: string
  try {
    refreshToken = decryptAutopostToken(input.encryptedRefreshToken)
  } catch {
    await markRefreshFailure({
      userId: input.userId,
      connectionStatus: "ERROR",
      errorCode: "X_REFRESH_TOKEN_DECRYPT_FAILED",
    })
    return {
      ok: false,
      error_code: "X_REFRESH_TOKEN_DECRYPT_FAILED",
      error_message: "Unable to decrypt X refresh token",
    }
  }

  let response: Response
  try {
    const { clientId, clientSecret } = getXClientCredentials()
    response = await fetch(`${getXApiBaseUrl()}/2/oauth2/token`, {
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
    await markRefreshFailure({
      userId: input.userId,
      connectionStatus: "ERROR",
      errorCode: "X_REFRESH_FAILED",
    })
    return {
      ok: false,
      error_code: "X_REFRESH_FAILED",
      error_message: "X token refresh request failed",
    }
  }

  const tokenResponse = (await response.json().catch(() => null)) as XRefreshTokenResponse | null
  if (!response.ok || !tokenResponse?.access_token) {
    const unauthorized = response.status === 400 || response.status === 401
    const errorCode = unauthorized ? "X_REFRESH_UNAUTHORIZED" : "X_REFRESH_FAILED"
    await markRefreshFailure({
      userId: input.userId,
      connectionStatus: unauthorized ? "EXPIRED" : "ERROR",
      errorCode,
    })
    return {
      ok: false,
      error_code: errorCode,
      error_message: unauthorized ? "X refresh token is unauthorized or expired" : "X token refresh failed",
    }
  }

  const encryptedAccessToken = encryptAutopostToken(tokenResponse.access_token)
  const encryptedRefreshToken = tokenResponse.refresh_token
    ? encryptAutopostToken(tokenResponse.refresh_token)
    : input.encryptedRefreshToken
  const tokenExpiresAt = parseTokenExpiresAt(tokenResponse.expires_in)
  const tokenType = tokenResponse.token_type ?? "bearer"

  await persistRefreshSuccess({
    userId: input.userId,
    encryptedAccessToken,
    encryptedRefreshToken,
    tokenExpiresAt,
    tokenType,
    scopes: parseScopes(tokenResponse.scope),
  })

  if (!tokenExpiresAt) {
    return {
      ok: false,
      error_code: "X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH",
      error_message: "X token refresh did not return an access token expiry",
    }
  }

  return {
    ok: true,
    encrypted_access_token: encryptedAccessToken,
    encrypted_refresh_token: encryptedRefreshToken,
    token_expires_at: tokenExpiresAt,
    token_type: tokenType,
  }
}
