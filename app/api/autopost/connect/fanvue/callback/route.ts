import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { encryptAutopostToken, getAutopostTokenKeyVersion } from "@/lib/autopost/tokenCrypto"
import { buildFanvueTokenExchangeRequestInit } from "@/lib/autopost/fanvueOAuthTokenExchange"
import {
  FANVUE_REQUIRED_CONNECTION_SCOPES,
  FANVUE_OAUTH_COOKIE_NAME,
  clearFanvueOAuthCookie,
  getSafeFanvueRedirect,
  requireFanvueOAuthConfig,
  sha256Base64Url,
  verifySignedFanvueOAuthCookie,
} from "@/lib/autopost/fanvueOAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type FanvueTokenResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

type FanvueIdentityResponse = {
  uuid?: string
  id?: string
  userUuid?: string
  handle?: string
  username?: string
  displayName?: string
  name?: string
  email?: string
  isCreator?: boolean
  account?: unknown
  creator?: unknown
}

function redirectWithClearedCookie(params: Record<string, string>) {
  const response = NextResponse.redirect(getSafeFanvueRedirect(params))
  clearFanvueOAuthCookie(response)
  return response
}

function normalizeScopes(tokenResponse: FanvueTokenResponse, fallbackScopes: string[]) {
  return (tokenResponse.scope ? tokenResponse.scope.split(/\s+/) : fallbackScopes)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function missingRequiredScopes(grantedScopes: string[]) {
  const granted = new Set(grantedScopes)
  return FANVUE_REQUIRED_CONNECTION_SCOPES.filter((scope) => !granted.has(scope))
}

async function exchangeCodeForTokens(input: { code: string; codeVerifier: string }) {
  const config = requireFanvueOAuthConfig()
  const requestInit = buildFanvueTokenExchangeRequestInit({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code: input.code,
    redirectUri: config.redirectUri,
    codeVerifier: input.codeVerifier,
  })

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: requestInit.headers,
    body: requestInit.body,
  })

  const tokenResponse = (await response.json().catch(() => null)) as FanvueTokenResponse | null
  if (!response.ok || !tokenResponse?.access_token) {
    throw new Error("FANVUE_TOKEN_EXCHANGE_FAILED")
  }

  return { tokenResponse, requestedScopes: config.scopes, apiBaseUrl: config.apiBaseUrl, apiVersion: config.apiVersion }
}

async function fetchFanvueIdentity(input: { accessToken: string; apiBaseUrl: string; apiVersion: string }) {
  const response = await fetch(`${input.apiBaseUrl}/users/account`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "X-Fanvue-API-Version": input.apiVersion,
    },
  })

  if (!response.ok) return null
  const body = (await response.json().catch(() => null)) as FanvueIdentityResponse | null
  return body
}

function getIdentityId(identity: FanvueIdentityResponse | null) {
  return identity?.uuid ?? identity?.userUuid ?? identity?.id ?? null
}

function getIdentityUsername(identity: FanvueIdentityResponse | null) {
  return identity?.handle ?? identity?.username ?? identity?.displayName ?? identity?.name ?? null
}

export async function GET(req: Request) {
  let userId = await requireUserId({ request: req }).catch(() => null)
  if (!userId) {
    const response = NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
    clearFanvueOAuthCookie(response)
    return response
  }

  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const returnedState = url.searchParams.get("state")
  const fanvueError = url.searchParams.get("error")

  if (fanvueError) return redirectWithClearedCookie({ error: "fanvue_oauth_denied" })
  if (!code || !returnedState) return redirectWithClearedCookie({ error: "fanvue_oauth_missing_code" })

  try {
    requireFanvueOAuthConfig()

    const cookieStore = await cookies()
    const cookieValue = cookieStore.get(FANVUE_OAUTH_COOKIE_NAME)?.value
    if (!cookieValue) return redirectWithClearedCookie({ error: "fanvue_oauth_state_missing" })

    const statePayload = verifySignedFanvueOAuthCookie(cookieValue)
    if (statePayload.user_id !== userId) return redirectWithClearedCookie({ error: "fanvue_oauth_state_user_mismatch" })
    if (statePayload.state_hash !== sha256Base64Url(returnedState)) {
      return redirectWithClearedCookie({ error: "fanvue_oauth_state_mismatch" })
    }

    const { tokenResponse, requestedScopes, apiBaseUrl, apiVersion } = await exchangeCodeForTokens({
      code,
      codeVerifier: statePayload.code_verifier,
    })

    const scopes = normalizeScopes(tokenResponse, requestedScopes)
    const missingScopes = missingRequiredScopes(scopes)
    if (missingScopes.length > 0) {
      return redirectWithClearedCookie({ error: "fanvue_oauth_missing_required_scopes" })
    }

    const identity = await fetchFanvueIdentity({
      accessToken: tokenResponse.access_token,
      apiBaseUrl,
      apiVersion,
    })
    const providerAccountId = getIdentityId(identity)
    if (!providerAccountId) {
      return redirectWithClearedCookie({ error: "fanvue_identity_unverified" })
    }

    const encryptedAccessToken = encryptAutopostToken(tokenResponse.access_token)
    const encryptedRefreshToken = tokenResponse.refresh_token ? encryptAutopostToken(tokenResponse.refresh_token) : null
    const now = new Date().toISOString()
    const tokenExpiresAt = tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : null
    const providerUsername = getIdentityUsername(identity)

    const supabaseAdmin = getSupabaseAdmin()
    const { error: upsertError } = await supabaseAdmin
      .from("autopost_accounts")
      .upsert(
        {
          user_id: userId,
          platform: "fanvue",
          provider_account_id: providerAccountId,
          provider_username: providerUsername,
          display_name: identity?.displayName ?? identity?.name ?? providerUsername,
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
            provider: "fanvue",
            identity_fetched: true,
            identity_source: "users/account",
            api_version: apiVersion,
            is_creator: identity?.isCreator ?? null,
            has_account: Boolean(identity?.account),
            has_creator: Boolean(identity?.creator),
          },
        },
        { onConflict: "user_id,platform" }
      )

    if (upsertError) return redirectWithClearedCookie({ error: "fanvue_oauth_account_save_failed" })
    return redirectWithClearedCookie({ connected: "fanvue" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "fanvue_oauth_failed"
    if (message === "FANVUE_CONNECT_DISABLED") return redirectWithClearedCookie({ error: "fanvue_connect_disabled" })
    return redirectWithClearedCookie({ error: "fanvue_oauth_failed" })
  }
}
