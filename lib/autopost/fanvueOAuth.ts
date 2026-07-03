import "server-only"
import crypto from "crypto"
import type { NextResponse } from "next/server"

export const FANVUE_OAUTH_COOKIE_NAME = "sf_autopost_fanvue_oauth"
export const FANVUE_OAUTH_COOKIE_PATH = "/api/autopost/connect/fanvue"
export const FANVUE_OAUTH_EXPIRES_IN_SECONDS = 10 * 60

export const FANVUE_APPROVED_SCOPES = [
  "openid",
  "offline_access",
  "offline",
  "read:self",
  "read:creator",
  "read:post",
  "write:post",
  "read:media",
  "write:media",
  "write:creator",
] as const

export const FANVUE_DEFAULT_REQUESTED_SCOPES = [
  "openid",
  "offline_access",
  "offline",
  "read:self",
  "read:creator",
  "read:post",
  "write:post",
  "read:media",
  "write:media",
] as const

export const FANVUE_REQUIRED_CONNECTION_SCOPES = [
  "read:self",
  "read:media",
  "write:media",
] as const

export const FANVUE_OPTIONAL_CREATOR_UPLOAD_SCOPES = [
  "write:creator",
] as const

export type FanvueScope = (typeof FANVUE_APPROVED_SCOPES)[number]

export const FANVUE_DEFAULT_SCOPES = FANVUE_DEFAULT_REQUESTED_SCOPES.join(" ")

export const FANVUE_CONNECT_OPERATION = "fanvue_connect" as const
export const FANVUE_WRITE_CREATOR_RECONNECT_OPERATION = "fanvue_write_creator_reconnect" as const
export const FANVUE_GENERIC_START_INITIATOR = "generic_fanvue_start" as const
export const FANVUE_ADMIN_WRITE_CREATOR_RECONNECT_INITIATOR = "admin_write_creator_reconnect_start" as const
export const FANVUE_WRITE_CREATOR_ADMIN_ROUTE_REQUIRED_CODE = "FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_ROUTE_REQUIRED" as const
export const FANVUE_WRITE_CREATOR_ADMIN_ROUTE_REQUIRED_MESSAGE = "Fanvue write:creator reconnect must be initiated through the admin-only reconnect route." as const

export type FanvueOAuthOperation = typeof FANVUE_CONNECT_OPERATION | typeof FANVUE_WRITE_CREATOR_RECONNECT_OPERATION
export type FanvueOAuthInitiator = typeof FANVUE_GENERIC_START_INITIATOR | typeof FANVUE_ADMIN_WRITE_CREATOR_RECONNECT_INITIATOR

export type FanvueOAuthCookiePayload = {
  provider: "fanvue"
  user_id: string
  state_hash: string
  code_verifier: string
  created_at: string
  expires_at: string
  operation: FanvueOAuthOperation
  initiated_from: FanvueOAuthInitiator
  requested_scopes_hash: string
  requested_scopes_include_write_creator: boolean
  admin_reconnect_authorized: boolean
}

export type FanvueOAuthConfigStatus = {
  connect_enabled: boolean
  configured: boolean
  missing: string[]
  config_error: string | null
  scopes: string[]
  api_base_url: string | null
  api_version: string | null
}

function env(name: string) {
  return process.env[name]?.trim() ?? ""
}

function requireStateSecret() {
  const secret = env("AUTOPOST_OAUTH_STATE_SECRET")
  if (!secret) throw new Error("AUTOPOST_OAUTH_STATE_SECRET_NOT_CONFIGURED")
  return secret
}

function base64UrlEncode(value: Buffer) {
  return value.toString("base64url")
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url")
}

function signPayload(encodedPayload: string) {
  return base64UrlEncode(crypto.createHmac("sha256", requireStateSecret()).update(encodedPayload).digest())
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

export function randomBase64Url(byteLength = 32) {
  return base64UrlEncode(crypto.randomBytes(byteLength))
}

export function sha256Base64Url(value: string) {
  return base64UrlEncode(crypto.createHash("sha256").update(value).digest())
}

export function isFanvueConnectEnabled() {
  return env("FANVUE_CONNECT_ENABLED") === "true"
}

export function scopeList(scopes: unknown): string[] {
  if (Array.isArray(scopes)) {
    return scopes
      .filter((scope): scope is string => typeof scope === "string")
      .map((scope) => scope.trim())
      .filter(Boolean)
  }
  if (typeof scopes === "string") {
    return scopes
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean)
  }
  return []
}

export function hasFanvueScope(scopes: unknown, scope: FanvueScope): boolean {
  return scopeList(scopes).includes(scope)
}

export function hasFanvueWriteCreatorScope(scopes: unknown): boolean {
  return hasFanvueScope(scopes, "write:creator")
}

export function canonicalFanvueScopeString(scopes: unknown): string {
  return Array.from(new Set(scopeList(scopes))).sort().join(" ")
}

export function hashFanvueScopes(scopes: unknown): string {
  return sha256Base64Url(canonicalFanvueScopeString(scopes))
}

export function getFanvueRequestedScopes() {
  const requested = scopeList(env("FANVUE_OAUTH_SCOPES") || FANVUE_DEFAULT_SCOPES)

  const approved = new Set<string>(FANVUE_APPROVED_SCOPES)
  const unique = Array.from(new Set(requested))
  const disallowed = unique.filter((scope) => !approved.has(scope))
  if (disallowed.length > 0) {
    throw new Error("FANVUE_OAUTH_SCOPES_UNAPPROVED")
  }

  return unique
}

export function getFanvueOAuthConfigStatus(): FanvueOAuthConfigStatus {
  const connectEnabled = isFanvueConnectEnabled()
  let scopes: string[] = []
  let scopesValid = true

  try {
    scopes = getFanvueRequestedScopes()
  } catch {
    scopesValid = false
  }

  const required = [
    "FANVUE_CLIENT_ID",
    "FANVUE_CLIENT_SECRET",
    "FANVUE_REDIRECT_URI",
    "FANVUE_OAUTH_AUTHORIZE_URL",
    "FANVUE_OAUTH_TOKEN_URL",
    "FANVUE_API_BASE_URL",
    "FANVUE_API_VERSION",
    "AUTOPOST_TOKEN_ENCRYPTION_KEY",
    "AUTOPOST_OAUTH_STATE_SECRET",
  ]
  const missing = connectEnabled ? required.filter((name) => !env(name)) : []
  if (connectEnabled && !scopesValid) missing.push("FANVUE_OAUTH_SCOPES")

  return {
    connect_enabled: connectEnabled,
    configured: connectEnabled && missing.length === 0,
    missing,
    config_error: !connectEnabled
      ? "FANVUE_CONNECT_DISABLED"
      : missing.length > 0
        ? "FANVUE_OAUTH_CONFIG_INCOMPLETE"
        : null,
    scopes,
    api_base_url: env("FANVUE_API_BASE_URL") || null,
    api_version: env("FANVUE_API_VERSION") || null,
  }
}

export function requireFanvueOAuthConfig() {
  const status = getFanvueOAuthConfigStatus()
  if (!status.connect_enabled) throw new Error("FANVUE_CONNECT_DISABLED")
  if (!status.configured) throw new Error(status.config_error ?? "FANVUE_OAUTH_CONFIG_INCOMPLETE")

  return {
    clientId: env("FANVUE_CLIENT_ID"),
    clientSecret: env("FANVUE_CLIENT_SECRET"),
    redirectUri: env("FANVUE_REDIRECT_URI"),
    authorizeUrl: env("FANVUE_OAUTH_AUTHORIZE_URL"),
    tokenUrl: env("FANVUE_OAUTH_TOKEN_URL"),
    apiBaseUrl: env("FANVUE_API_BASE_URL").replace(/\/$/, ""),
    apiVersion: env("FANVUE_API_VERSION"),
    scopes: status.scopes,
  }
}

export function createSignedFanvueOAuthCookie(payload: FanvueOAuthCookiePayload) {
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"))
  return `${encodedPayload}.${signPayload(encodedPayload)}`
}

export function verifySignedFanvueOAuthCookie(cookieValue: string) {
  const [encodedPayload, signature] = cookieValue.split(".")
  if (!encodedPayload || !signature) throw new Error("FANVUE_OAUTH_STATE_COOKIE_INVALID")

  const expectedSignature = signPayload(encodedPayload)
  if (!safeEqual(signature, expectedSignature)) throw new Error("FANVUE_OAUTH_STATE_SIGNATURE_INVALID")

  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as FanvueOAuthCookiePayload
  if (payload.provider !== "fanvue") throw new Error("FANVUE_OAUTH_STATE_PROVIDER_INVALID")
  if (!payload.expires_at || Date.parse(payload.expires_at) <= Date.now()) throw new Error("FANVUE_OAUTH_STATE_EXPIRED")

  return payload
}

export function createFanvueOAuthState(userId: string, options?: { operation?: FanvueOAuthOperation; initiatedFrom?: FanvueOAuthInitiator; adminReconnectAuthorized?: boolean }) {
  const state = randomBase64Url(32)
  const codeVerifier = randomBase64Url(64)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + FANVUE_OAUTH_EXPIRES_IN_SECONDS * 1000)
  const requestedScopes = getFanvueRequestedScopes()
  const operation = options?.operation ?? FANVUE_CONNECT_OPERATION
  const initiatedFrom = options?.initiatedFrom ?? FANVUE_GENERIC_START_INITIATOR
  const payload: FanvueOAuthCookiePayload = {
    provider: "fanvue",
    user_id: userId,
    state_hash: sha256Base64Url(state),
    code_verifier: codeVerifier,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    operation,
    initiated_from: initiatedFrom,
    requested_scopes_hash: hashFanvueScopes(requestedScopes),
    requested_scopes_include_write_creator: hasFanvueWriteCreatorScope(requestedScopes),
    admin_reconnect_authorized: options?.adminReconnectAuthorized === true,
  }

  return {
    state,
    codeVerifier,
    codeChallenge: sha256Base64Url(codeVerifier),
    cookieValue: createSignedFanvueOAuthCookie(payload),
  }
}

export function setFanvueOAuthCookie(response: NextResponse, cookieValue: string) {
  response.cookies.set({
    name: FANVUE_OAUTH_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: FANVUE_OAUTH_COOKIE_PATH,
    maxAge: FANVUE_OAUTH_EXPIRES_IN_SECONDS,
  })
}

export function clearFanvueOAuthCookie(response: NextResponse) {
  response.cookies.set({
    name: FANVUE_OAUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: FANVUE_OAUTH_COOKIE_PATH,
    maxAge: 0,
  })
}

export function buildFanvueAuthorizeUrl(input: { state: string; codeChallenge: string }) {
  const config = requireFanvueOAuthConfig()
  const url = new URL(config.authorizeUrl)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("scope", config.scopes.join(" "))
  url.searchParams.set("state", input.state)
  url.searchParams.set("code_challenge", input.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url
}

export function getSafeFanvueRedirect(params: Record<string, string>) {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || ""
  const url = new URL("/autopost", siteUrl || "http://localhost:3000")
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}
