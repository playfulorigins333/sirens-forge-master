import { NextResponse } from "next/server"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import {
  buildXAuthorizeUrl,
  createXOAuthState,
  setXOAuthCookie,
} from "@/lib/autopost/xOAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request) {
  const entitlement = await ensureActiveSubscription()
  if (!entitlement.ok || !entitlement.user?.id) {
    return NextResponse.json(
      { error: entitlement.error ?? "NO_ACTIVE_SUBSCRIPTION" },
      { status: entitlement.status ?? 402 }
    )
  }
  const userId = entitlement.user.id

  try {
    const oauthState = createXOAuthState(userId)
    const authorizeUrl = buildXAuthorizeUrl({
      state: oauthState.state,
      codeChallenge: oauthState.codeChallenge,
    })

    const response = NextResponse.redirect(authorizeUrl)
    setXOAuthCookie(response, oauthState.cookieValue)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : "X_OAUTH_START_FAILED"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
