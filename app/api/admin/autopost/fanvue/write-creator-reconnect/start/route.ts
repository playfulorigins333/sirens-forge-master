import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import {
  buildFanvueAuthorizeUrl,
  createFanvueOAuthState,
  FANVUE_DEFAULT_REQUESTED_SCOPES,
  FANVUE_REQUIRED_CONNECTION_SCOPES,
  getFanvueOAuthConfigStatus,
  setFanvueOAuthCookie,
} from "@/lib/autopost/fanvueOAuth"
import { handleFanvueWriteCreatorReconnectRoute } from "@/lib/autopost/fanvueWriteCreatorReconnectRoute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const response = await handleFanvueWriteCreatorReconnectRoute({
    request: req,
    expectedSecret: process.env.FANVUE_WRITE_CREATOR_RECONNECT_SECRET,
    adminUserIds: process.env.FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    createOAuthState: createFanvueOAuthState,
    buildAuthorizeUrl: buildFanvueAuthorizeUrl,
    getConfigStatus: getFanvueOAuthConfigStatus,
    defaultScopes: FANVUE_DEFAULT_REQUESTED_SCOPES,
    requiredConnectionScopes: FANVUE_REQUIRED_CONNECTION_SCOPES,
  })

  if (response.type === "redirect") {
    const redirect = NextResponse.redirect(response.redirectUrl)
    setFanvueOAuthCookie(redirect, response.cookieValue)
    return redirect
  }

  return NextResponse.json(response.body, { status: response.status })
}
