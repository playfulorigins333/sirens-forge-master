import { NextResponse } from "next/server"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import {
  buildFanvueAuthorizeUrl,
  createFanvueOAuthState,
  getFanvueOAuthConfigStatus,
  setFanvueOAuthCookie,
} from "@/lib/autopost/fanvueOAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request) {
  const entitlement = await ensureActiveSubscription()
  if (!entitlement.ok || !entitlement.user) {
    return NextResponse.json(
      { error: entitlement.error ?? "NO_ACTIVE_SUBSCRIPTION" },
      { status: entitlement.status ?? 403 },
    )
  }
  const userId = entitlement.user.id

  const configStatus = getFanvueOAuthConfigStatus()
  if (!configStatus.connect_enabled) {
    return NextResponse.json({ error: "FANVUE_CONNECT_DISABLED" }, { status: 403 })
  }
  if (!configStatus.configured) {
    return NextResponse.json({ error: configStatus.config_error ?? "FANVUE_OAUTH_CONFIG_INCOMPLETE" }, { status: 500 })
  }
  try {
    const oauthState = createFanvueOAuthState(userId)
    const authorizeUrl = buildFanvueAuthorizeUrl({
      state: oauthState.state,
      codeChallenge: oauthState.codeChallenge,
    })

    const response = NextResponse.redirect(authorizeUrl)
    setFanvueOAuthCookie(response, oauthState.cookieValue)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : "FANVUE_OAUTH_START_FAILED"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
