import "server-only"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getXApiBaseUrl } from "@/lib/autopost/xOAuth"
import { encryptAutopostToken, getAutopostTokenKeyVersion } from "@/lib/autopost/tokenCrypto"

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>
export type XInitialOAuthCallbackDeps = {
  fetchImpl?: typeof fetch
  getApiBaseUrl?: () => string
  encryptToken?: (value: string) => string
  getTokenKeyVersion?: () => number
  getSupabaseAdmin?: () => SupabaseAdmin
  env?: Record<string, string | undefined>
  now?: () => Date
}
export type XInitialOAuthCallbackResult = { ok: true } | { ok: false; error_code: "X_TOKEN_EXCHANGE_FAILED" | "X_TOKEN_RESPONSE_INVALID" | "X_IDENTITY_LOOKUP_FAILED" | "X_IDENTITY_RESPONSE_INVALID" | "X_OAUTH_ACCOUNT_SAVE_FAILED" }
const DEFAULT_SCOPES = "tweet.read tweet.write users.read offline.access"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function requiredString(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length ? normalized : null
}
function scopes(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = [...new Set(value.trim().split(/\s+/).filter(Boolean))]
  return normalized.length ? normalized : null
}
function expiryIso(value: unknown, now: Date) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null
  const nowMs = now.getTime()
  const expiresAtMs = nowMs + value * 1000
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs)) return null
  const date = new Date(expiresAtMs)
  if (!Number.isFinite(date.getTime())) return null
  try { const iso = date.toISOString(); return iso.length ? iso : null } catch { return null }
}
function basicAuth(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
}

export async function completeInitialXOAuthConnection(input: { userId: string; code: string; codeVerifier: string }, deps: XInitialOAuthCallbackDeps = {}): Promise<XInitialOAuthCallbackResult> {
  const env = deps.env ?? process.env
  const clientId = requiredString(env.X_CLIENT_ID)
  const clientSecret = requiredString(env.X_CLIENT_SECRET)
  const redirectUri = requiredString(env.X_REDIRECT_URI)
  if (!clientId || !clientSecret || !redirectUri) return { ok: false, error_code: "X_TOKEN_EXCHANGE_FAILED" }
  const fetchImpl = deps.fetchImpl ?? fetch
  const getApiBaseUrl = deps.getApiBaseUrl ?? getXApiBaseUrl
  let tokenResponse: Response
  try {
    tokenResponse = await fetchImpl(`${getApiBaseUrl()}/2/oauth2/token`, { method: "POST", headers: { authorization: basicAuth(clientId, clientSecret), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: input.code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: input.codeVerifier }) })
  } catch { return { ok: false, error_code: "X_TOKEN_EXCHANGE_FAILED" } }
  if (!tokenResponse.ok) return { ok: false, error_code: "X_TOKEN_EXCHANGE_FAILED" }
  let tokenBody: unknown
  try { tokenBody = await tokenResponse.json() } catch { return { ok: false, error_code: "X_TOKEN_RESPONSE_INVALID" } }
  if (!isPlainObject(tokenBody)) return { ok: false, error_code: "X_TOKEN_RESPONSE_INVALID" }
  const accessToken = requiredString(tokenBody.access_token)
  const refreshToken = requiredString(tokenBody.refresh_token)
  if (!accessToken || !refreshToken) return { ok: false, error_code: "X_TOKEN_RESPONSE_INVALID" }
  let currentTime: Date
  try { currentTime = (deps.now ?? (() => new Date()))() } catch { return { ok: false, error_code: "X_TOKEN_RESPONSE_INVALID" } }
  const tokenExpiresAt = expiryIso(tokenBody.expires_in, currentTime)
  if (!tokenExpiresAt) return { ok: false, error_code: "X_TOKEN_RESPONSE_INVALID" }
  const tokenType = requiredString(tokenBody.token_type)
  if (!tokenType || tokenType.toLowerCase() !== "bearer") return { ok: false, error_code: "X_TOKEN_RESPONSE_INVALID" }
  const scopeSource = Object.prototype.hasOwnProperty.call(tokenBody, "scope") ? tokenBody.scope : requiredString(env.X_OAUTH_SCOPES) ?? DEFAULT_SCOPES
  const normalizedScopes = scopes(scopeSource)
  if (!normalizedScopes) return { ok: false, error_code: "X_TOKEN_RESPONSE_INVALID" }
  let identityResponse: Response
  try { identityResponse = await fetchImpl(`${getApiBaseUrl()}/2/users/me`, { method: "GET", headers: { authorization: `Bearer ${accessToken}` } }) } catch { return { ok: false, error_code: "X_IDENTITY_LOOKUP_FAILED" } }
  if (!identityResponse.ok) return { ok: false, error_code: "X_IDENTITY_LOOKUP_FAILED" }
  let identityBody: unknown
  try { identityBody = await identityResponse.json() } catch { return { ok: false, error_code: "X_IDENTITY_RESPONSE_INVALID" } }
  if (!isPlainObject(identityBody) || !isPlainObject(identityBody.data)) return { ok: false, error_code: "X_IDENTITY_RESPONSE_INVALID" }
  const providerAccountId = requiredString(identityBody.data.id)
  const providerUsername = requiredString(identityBody.data.username)
  if (!providerAccountId || !providerUsername) return { ok: false, error_code: "X_IDENTITY_RESPONSE_INVALID" }
  const identityName = requiredString(identityBody.data.name)
  let encryptedAccessToken: string, encryptedRefreshToken: string, tokenKeyVersion: number, supabaseAdmin: SupabaseAdmin
  try {
    const encrypt = deps.encryptToken ?? encryptAutopostToken
    encryptedAccessToken = encrypt(accessToken)
    encryptedRefreshToken = encrypt(refreshToken)
    tokenKeyVersion = (deps.getTokenKeyVersion ?? getAutopostTokenKeyVersion)()
    supabaseAdmin = (deps.getSupabaseAdmin ?? getSupabaseAdmin)()
  } catch { return { ok: false, error_code: "X_TOKEN_RESPONSE_INVALID" } }
  try {
    const { error } = await supabaseAdmin.from("autopost_accounts").upsert({ user_id: input.userId, platform: "x", provider_account_id: providerAccountId, provider_username: providerUsername, display_name: identityName ?? providerUsername, token_type: "bearer", scopes: normalizedScopes, encrypted_access_token: encryptedAccessToken, encrypted_refresh_token: encryptedRefreshToken, token_key_version: tokenKeyVersion, token_expires_at: tokenExpiresAt, connection_status: "CONNECTED", connected_at: currentTime.toISOString(), last_refresh_at: null, last_error: null, metadata: { provider: "x", identity_fetched: true, identity_name: identityName } }, { onConflict: "user_id,platform" })
    if (error) return { ok: false, error_code: "X_OAUTH_ACCOUNT_SAVE_FAILED" }
  } catch { return { ok: false, error_code: "X_OAUTH_ACCOUNT_SAVE_FAILED" } }
  return { ok: true }
}
