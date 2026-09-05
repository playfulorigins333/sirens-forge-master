import { NextResponse } from "next/server"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { requireFreshTotpResponse } from "@/lib/security/mfaRoute"
import {
  buildXAuthorizeUrl,
  createXOAuthState,
  setXOAuthCookie,
} from "@/lib/autopost/xOAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request) {
  const mfa = await requireFreshTotpResponse()
  if (mfa instanceof NextResponse) return mfa

  const entitlement = await ensureActiveSubscription()
  if (!entitlement.ok || entitlement.user?.id !== mfa.userId) {
    return NextResponse.json(
      { error: entitlement.error ?? "NO_ACTIVE_SUBSCRIPTION" },
      { status: entitlement.status ?? 402 }
    )
  }
  const userId = mfa.userId

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
