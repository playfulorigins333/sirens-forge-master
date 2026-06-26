import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import {
  clearXOAuthCookie,
  getSafeAutopostRedirect,
  getXApiBaseUrl,
  sha256Base64Url,
  verifySignedXOAuthCookie,
  X_OAUTH_COOKIE_NAME,
} from "@/lib/autopost/xOAuth"
import {
  encryptAutopostToken,
  getAutopostTokenKeyVersion,
} from "@/lib/autopost/tokenCrypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type XTokenResponse = {
  token_type?: string
  expires_in?: number
  access_token?: string
  refresh_token?: string
  scope?: string
}

type XMeResponse = {
  data?: {
    id?: string
    username?: string
    name?: string
  }
}

function redirectWithClearedCookie(params: Record<string, string>) {
  const response = NextResponse.redirect(getSafeAutopostRedirect(params))
  clearXOAuthCookie(response)
  return response
}

function getBasicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
}

async function exchangeCodeForTokens(input: {
  code: string
  codeVerifier: string
}) {
  const clientId = process.env.X_CLIENT_ID
  const clientSecret = process.env.X_CLIENT_SECRET
  const redirectUri = process.env.X_REDIRECT_URI

  if (!clientId) throw new Error("X_CLIENT_ID_NOT_CONFIGURED")
  if (!clientSecret) throw new Error("X_CLIENT_SECRET_NOT_CONFIGURED")
  if (!redirectUri) throw new Error("X_REDIRECT_URI_NOT_CONFIGURED")

  const body = new URLSearchParams({
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: input.codeVerifier,
  })

  const response = await fetch(`${getXApiBaseUrl()}/2/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: getBasicAuthHeader(clientId, clientSecret),
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  })

  const tokenResponse = (await response.json().catch(() => null)) as XTokenResponse | null
  if (!response.ok || !tokenResponse?.access_token) {
    throw new Error("X_TOKEN_EXCHANGE_FAILED")
  }

  return tokenResponse
}

async function fetchXIdentity(accessToken: string) {
  const response = await fetch(`${getXApiBaseUrl()}/2/users/me`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) return null

  const body = (await response.json().catch(() => null)) as XMeResponse | null
  return body?.data ?? null
}

export async function GET(req: Request) {
  const userId = await requireUserId({ request: req }).catch(() => null)
  if (!userId) {
    const response = NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
    clearXOAuthCookie(response)
    return response
  }

  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const returnedState = url.searchParams.get("state")
  const xError = url.searchParams.get("error")

  if (xError) {
    return redirectWithClearedCookie({ error: "x_oauth_denied" })
  }

  if (!code || !returnedState) {
    return redirectWithClearedCookie({ error: "x_oauth_missing_code" })
  }

  try {
    const cookieStore = await cookies()
    const cookieValue = cookieStore.get(X_OAUTH_COOKIE_NAME)?.value
    if (!cookieValue) {
      return redirectWithClearedCookie({ error: "x_oauth_state_missing" })
    }

    const statePayload = verifySignedXOAuthCookie(cookieValue)
    if (statePayload.user_id !== userId) {
      return redirectWithClearedCookie({ error: "x_oauth_state_user_mismatch" })
    }

    if (statePayload.state_hash !== sha256Base64Url(returnedState)) {
      return redirectWithClearedCookie({ error: "x_oauth_state_mismatch" })
    }

    const tokenResponse = await exchangeCodeForTokens({
      code,
      codeVerifier: statePayload.code_verifier,
    })

    const encryptedAccessToken = encryptAutopostToken(tokenResponse.access_token ?? "")
    const encryptedRefreshToken = tokenResponse.refresh_token
      ? encryptAutopostToken(tokenResponse.refresh_token)
      : null
    const xIdentity = await fetchXIdentity(tokenResponse.access_token ?? "")
    const now = new Date().toISOString()
    const tokenExpiresAt = tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : null
    const scopes = tokenResponse.scope
      ? tokenResponse.scope.split(/\s+/).filter(Boolean)
      : (process.env.X_OAUTH_SCOPES || "tweet.read tweet.write users.read offline.access")
          .split(/\s+/)
          .filter(Boolean)

    const supabaseAdmin = getSupabaseAdmin()
    const { error: upsertError } = await supabaseAdmin
      .from("autopost_accounts")
      .upsert(
        {
          user_id: userId,
          platform: "x",
          provider_account_id: xIdentity?.id ?? null,
          provider_username: xIdentity?.username ?? null,
          display_name: xIdentity?.name ?? xIdentity?.username ?? null,
          token_type: tokenResponse.token_type ?? "bearer",
          scopes,
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          token_key_version: getAutopostTokenKeyVersion(),
          token_expires_at: tokenExpiresAt,
          connection_status: "CONNECTED",
          connected_at: now,
          last_refresh_at: null,
          last_error: null,
          metadata: {
            provider: "x",
            identity_fetched: Boolean(xIdentity),
            identity_name: xIdentity?.name ?? null,
          },
        },
        { onConflict: "user_id,platform" }
      )

    if (upsertError) {
      return redirectWithClearedCookie({ error: "x_oauth_account_save_failed" })
    }

    return redirectWithClearedCookie({ connected: "x" })
  } catch {
    return redirectWithClearedCookie({ error: "x_oauth_failed" })
  }
}
