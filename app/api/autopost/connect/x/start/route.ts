import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import {
  buildXAuthorizeUrl,
  createXOAuthState,
  setXOAuthCookie,
} from "@/lib/autopost/xOAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const userId = await requireUserId({ request: req }).catch(() => null)
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

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
