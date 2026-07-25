import "server-only"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getXApiBaseUrl } from "@/lib/autopost/xOAuth"
import { encryptAutopostToken, getAutopostTokenKeyVersion } from "@/lib/autopost/tokenCrypto"

type SafeCode =
  | "X_REAUTH_ACCOUNT_NOT_READY"
  | "X_REAUTH_STATE_IDENTITY_INVALID"
  | "X_REAUTH_ACCOUNT_CHANGED"
  | "X_REAUTH_TOKEN_EXCHANGE_FAILED"
  | "X_REAUTH_TOKEN_RESPONSE_INVALID"
  | "X_REAUTH_IDENTITY_LOOKUP_FAILED"
  | "X_REAUTH_IDENTITY_RESPONSE_INVALID"
  | "X_REAUTH_PROVIDER_ID_MISMATCH"
  | "X_REAUTH_USERNAME_MISMATCH"
  | "X_REAUTH_TOKEN_ENCRYPTION_FAILED"
  | "X_REAUTH_ACCOUNT_UPDATE_FAILED"
  | "X_REAUTH_SUCCEEDED"

type Account = {
  connection_status?: unknown
  provider_account_id?: unknown
  provider_username?: unknown
  metadata?: unknown
}
type Admin = ReturnType<typeof getSupabaseAdmin>
export type XReauthorizationCallbackDeps = {
  fetchImpl?: typeof fetch
  getApiBaseUrl?: () => string
  readCurrentAccount?: (userId: string) => Promise<{ data: Account | null; error: unknown }>
  encryptToken?: (value: string) => string
  getTokenKeyVersion?: () => number
  getSupabaseAdmin?: () => Admin
  env?: Record<string, string | undefined>
  now?: () => Date
}
export type XReauthorizationResult = ReturnType<typeof result>

function result(
  safeCode: SafeCode,
  providerRequestAttempted = false,
  identityRequestAttempted = false,
  databaseWriteAttempted = false
) {
  return {
    ok: safeCode === "X_REAUTH_SUCCEEDED",
    mode: "x_controlled_reauthorization" as const,
    safe_code: safeCode,
    provider_request_attempted: providerRequestAttempted,
    identity_request_attempted: identityRequestAttempted,
    database_write_attempted: databaseWriteAttempted,
    refresh_attempted: false as const,
    retry_attempted: false as const,
    disconnect_attempted: false as const,
    post_attempted: false as const,
    fanvue_account_queried: false as const,
    fanvue_account_mutated: false as const,
  }
}
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function text(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}
function normalizeScopes(value: unknown) {
  if (typeof value !== "string") return null
  const values = [...new Set(value.trim().split(/\s+/).filter(Boolean))]
  return values.length ? values : null
}
function expiry(value: unknown, now: Date) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null
  const date = new Date(now.getTime() + value * 1000)
  try { return Number.isFinite(date.getTime()) ? date.toISOString() : null } catch { return null }
}
function auth(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
}
async function defaultRead(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("autopost_accounts")
    .select("connection_status, provider_account_id, provider_username, metadata")
    .eq("user_id", userId)
    .eq("platform", "x")
    .maybeSingle()
  return { data: data as Account | null, error }
}

export async function completeXReauthorization(
  input: {
    userId: string
    code: string
    codeVerifier: string
    expectedProviderAccountId: string
    expectedProviderUsername: string
  },
  deps: XReauthorizationCallbackDeps = {}
): Promise<XReauthorizationResult> {
  const userId = text(input.userId)
  const code = text(input.code)
  const verifier = text(input.codeVerifier)
  const expectedId = text(input.expectedProviderAccountId)
  const expectedUsername = text(input.expectedProviderUsername)
  if (!userId || !code || !verifier || !expectedId || !expectedUsername) {
    return result("X_REAUTH_STATE_IDENTITY_INVALID")
  }

  let current: Account | null
  try {
    const lookup = await (deps.readCurrentAccount ?? defaultRead)(userId)
    if (lookup.error) return result("X_REAUTH_ACCOUNT_NOT_READY")
    current = lookup.data
  } catch { return result("X_REAUTH_ACCOUNT_NOT_READY") }
  const currentId = text(current?.provider_account_id)
  const currentUsername = text(current?.provider_username)
  if (current?.connection_status !== "CONNECTED" || !currentId || !currentUsername) {
    return result("X_REAUTH_ACCOUNT_NOT_READY")
  }
  if (currentId !== expectedId || currentUsername !== expectedUsername) {
    return result("X_REAUTH_ACCOUNT_CHANGED")
  }

  const env = deps.env ?? process.env
  const clientId = text(env.X_CLIENT_ID)
  const secret = text(env.X_CLIENT_SECRET)
  const redirectUri = text(env.X_REDIRECT_URI)
  if (!clientId || !secret || !redirectUri) return result("X_REAUTH_TOKEN_EXCHANGE_FAILED")
  const request = deps.fetchImpl ?? fetch
  let tokenResponse: Response
  try {
    tokenResponse = await request(`${(deps.getApiBaseUrl ?? getXApiBaseUrl)()}/2/oauth2/token`, {
      method: "POST",
      headers: { authorization: auth(clientId, secret), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: verifier }),
    })
  } catch { return result("X_REAUTH_TOKEN_EXCHANGE_FAILED", true) }
  if (!tokenResponse.ok) return result("X_REAUTH_TOKEN_EXCHANGE_FAILED", true)
  let tokenBody: unknown
  try { tokenBody = await tokenResponse.json() } catch { return result("X_REAUTH_TOKEN_RESPONSE_INVALID", true) }
  if (!plain(tokenBody)) return result("X_REAUTH_TOKEN_RESPONSE_INVALID", true)
  const accessToken = text(tokenBody.access_token)
  const refreshToken = text(tokenBody.refresh_token)
  const tokenType = text(tokenBody.token_type)
  const normalizedScopes = normalizeScopes(tokenBody.scope)
  let now: Date
  try { now = (deps.now ?? (() => new Date()))() } catch { return result("X_REAUTH_TOKEN_RESPONSE_INVALID", true) }
  const tokenExpiresAt = expiry(tokenBody.expires_in, now)
  if (!accessToken || !refreshToken || tokenType?.toLowerCase() !== "bearer" || !normalizedScopes || !tokenExpiresAt) {
    return result("X_REAUTH_TOKEN_RESPONSE_INVALID", true)
  }

  let identityResponse: Response
  try {
    identityResponse = await request(`${(deps.getApiBaseUrl ?? getXApiBaseUrl)()}/2/users/me`, {
      method: "GET", headers: { authorization: `Bearer ${accessToken}` },
    })
  } catch { return result("X_REAUTH_IDENTITY_LOOKUP_FAILED", true, true) }
  if (!identityResponse.ok) return result("X_REAUTH_IDENTITY_LOOKUP_FAILED", true, true)
  let identityBody: unknown
  try { identityBody = await identityResponse.json() } catch { return result("X_REAUTH_IDENTITY_RESPONSE_INVALID", true, true) }
  if (!plain(identityBody) || !plain(identityBody.data)) return result("X_REAUTH_IDENTITY_RESPONSE_INVALID", true, true)
  const returnedId = text(identityBody.data.id)
  const returnedUsername = text(identityBody.data.username)
  const identityName = text(identityBody.data.name)
  if (!returnedId || !returnedUsername) return result("X_REAUTH_IDENTITY_RESPONSE_INVALID", true, true)
  if (returnedId !== expectedId) return result("X_REAUTH_PROVIDER_ID_MISMATCH", true, true)
  if (returnedUsername.toLowerCase() !== expectedUsername.toLowerCase()) {
    return result("X_REAUTH_USERNAME_MISMATCH", true, true)
  }

  let encryptedAccessToken: string
  let encryptedRefreshToken: string
  let keyVersion: number
  let admin: Admin
  try {
    const encrypt = deps.encryptToken ?? encryptAutopostToken
    encryptedAccessToken = encrypt(accessToken)
    encryptedRefreshToken = encrypt(refreshToken)
    keyVersion = (deps.getTokenKeyVersion ?? getAutopostTokenKeyVersion)()
    admin = (deps.getSupabaseAdmin ?? getSupabaseAdmin)()
  } catch { return result("X_REAUTH_TOKEN_ENCRYPTION_FAILED", true, true) }

  const oldMetadata = plain(current.metadata) ? current.metadata : {}
  const update = {
    provider_username: expectedUsername,
    display_name: identityName ?? currentUsername,
    token_type: "bearer",
    scopes: normalizedScopes,
    encrypted_access_token: encryptedAccessToken,
    encrypted_refresh_token: encryptedRefreshToken,
    token_key_version: keyVersion,
    token_expires_at: tokenExpiresAt,
    connection_status: "CONNECTED",
    last_refresh_at: null,
    last_error: null,
    metadata: { ...oldMetadata, provider: "x", identity_fetched: true, ...(identityName ? { identity_name: identityName } : {}), reauthorized: true, reauthorized_at: now.toISOString() },
  }
  try {
    const { data, error } = await admin.from("autopost_accounts").update(update)
      .eq("user_id", userId).eq("platform", "x").eq("provider_account_id", expectedId)
      .eq("provider_username", expectedUsername).eq("connection_status", "CONNECTED")
      .select("id")
    if (error) return result("X_REAUTH_ACCOUNT_UPDATE_FAILED", true, true, true)
    if (!Array.isArray(data) || data.length !== 1) return result("X_REAUTH_ACCOUNT_CHANGED", true, true, true)
  } catch { return result("X_REAUTH_ACCOUNT_UPDATE_FAILED", true, true, true) }
  return result("X_REAUTH_SUCCEEDED", true, true, true)
}
