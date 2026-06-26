import "server-only"
import crypto from "crypto"
import type { NextResponse } from "next/server"

export const X_OAUTH_COOKIE_NAME = "sf_autopost_x_oauth"
export const X_OAUTH_COOKIE_PATH = "/api/autopost/connect/x"
export const X_OAUTH_EXPIRES_IN_SECONDS = 10 * 60

export type XOAuthCookiePayload = {
  provider: "x"
  user_id: string
  state_hash: string
  code_verifier: string
  created_at: string
  expires_at: string
}

function requireStateSecret() {
  const secret = process.env.AUTOPOST_OAUTH_STATE_SECRET
  if (!secret) {
    throw new Error("AUTOPOST_OAUTH_STATE_SECRET_NOT_CONFIGURED")
  }
  return secret
}

function base64UrlEncode(value: Buffer) {
  return value.toString("base64url")
}

export function randomBase64Url(byteLength = 32) {
  return base64UrlEncode(crypto.randomBytes(byteLength))
}

export function sha256Base64Url(value: string) {
  return base64UrlEncode(crypto.createHash("sha256").update(value).digest())
}

function signPayload(encodedPayload: string) {
  return base64UrlEncode(
    crypto.createHmac("sha256", requireStateSecret()).update(encodedPayload).digest()
  )
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

export function createSignedXOAuthCookie(payload: XOAuthCookiePayload) {
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"))
  return `${encodedPayload}.${signPayload(encodedPayload)}`
}

export function verifySignedXOAuthCookie(cookieValue: string) {
  const [encodedPayload, signature] = cookieValue.split(".")
  if (!encodedPayload || !signature) {
    throw new Error("X_OAUTH_STATE_COOKIE_INVALID")
  }

  const expectedSignature = signPayload(encodedPayload)
  if (!safeEqual(signature, expectedSignature)) {
    throw new Error("X_OAUTH_STATE_SIGNATURE_INVALID")
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8")
  ) as XOAuthCookiePayload

  if (payload.provider !== "x") {
    throw new Error("X_OAUTH_STATE_PROVIDER_INVALID")
  }

  if (!payload.expires_at || Date.parse(payload.expires_at) <= Date.now()) {
    throw new Error("X_OAUTH_STATE_EXPIRED")
  }

  return payload
}

export function createXOAuthState(userId: string) {
  const state = randomBase64Url(32)
  const codeVerifier = randomBase64Url(64)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + X_OAUTH_EXPIRES_IN_SECONDS * 1000)

  const payload: XOAuthCookiePayload = {
    provider: "x",
    user_id: userId,
    state_hash: sha256Base64Url(state),
    code_verifier: codeVerifier,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  }

  return {
    state,
    codeVerifier,
    codeChallenge: sha256Base64Url(codeVerifier),
    cookieValue: createSignedXOAuthCookie(payload),
  }
}

export function setXOAuthCookie(response: NextResponse, cookieValue: string) {
  response.cookies.set({
    name: X_OAUTH_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: X_OAUTH_COOKIE_PATH,
    maxAge: X_OAUTH_EXPIRES_IN_SECONDS,
  })
}

export function clearXOAuthCookie(response: NextResponse) {
  response.cookies.set({
    name: X_OAUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: X_OAUTH_COOKIE_PATH,
    maxAge: 0,
  })
}

export function buildXAuthorizeUrl(input: {
  state: string
  codeChallenge: string
}) {
  const clientId = process.env.X_CLIENT_ID
  const redirectUri = process.env.X_REDIRECT_URI
  if (!clientId) throw new Error("X_CLIENT_ID_NOT_CONFIGURED")
  if (!redirectUri) throw new Error("X_REDIRECT_URI_NOT_CONFIGURED")

  const scopes = process.env.X_OAUTH_SCOPES || "tweet.read tweet.write users.read offline.access"
  const url = new URL("https://x.com/i/oauth2/authorize")

  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", scopes)
  url.searchParams.set("state", input.state)
  url.searchParams.set("code_challenge", input.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")

  return url
}

export function getXApiBaseUrl() {
  return (process.env.X_API_BASE_URL || "https://api.x.com").replace(/\/$/, "")
}

export function getSafeAutopostRedirect(params: Record<string, string>) {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || ""
  const url = new URL("/autopost", siteUrl || "http://localhost:3000")
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url
}
