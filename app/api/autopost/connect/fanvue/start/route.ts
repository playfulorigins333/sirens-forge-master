import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import {
  buildFanvueAuthorizeUrl,
  createFanvueOAuthState,
  FANVUE_WRITE_CREATOR_ADMIN_ROUTE_REQUIRED_CODE,
  FANVUE_WRITE_CREATOR_ADMIN_ROUTE_REQUIRED_MESSAGE,
  getFanvueOAuthConfigStatus,
  hasFanvueWriteCreatorScope,
  setFanvueOAuthCookie,
} from "@/lib/autopost/fanvueOAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const userId = await requireUserId({ request: req }).catch(() => null)
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  const configStatus = getFanvueOAuthConfigStatus()
  if (!configStatus.connect_enabled) {
    return NextResponse.json({ error: "FANVUE_CONNECT_DISABLED" }, { status: 403 })
  }
  if (!configStatus.configured) {
    return NextResponse.json({ error: configStatus.config_error ?? "FANVUE_OAUTH_CONFIG_INCOMPLETE" }, { status: 500 })
  }
  if (hasFanvueWriteCreatorScope(configStatus.scopes)) {
    return NextResponse.json(
      { error: FANVUE_WRITE_CREATOR_ADMIN_ROUTE_REQUIRED_CODE, message: FANVUE_WRITE_CREATOR_ADMIN_ROUTE_REQUIRED_MESSAGE },
      { status: 403 },
    )
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
