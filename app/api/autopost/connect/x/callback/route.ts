import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import {
  clearXOAuthCookie,
  getSafeAutopostRedirect,
  sha256Base64Url,
  verifySignedXOAuthCookie,
  X_OAUTH_COOKIE_NAME,
} from "@/lib/autopost/xOAuth"
import { completeInitialXOAuthConnection } from "@/lib/autopost/xInitialOAuthCallback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function redirectWithClearedCookie(params: Record<string, string>) {
  const response = NextResponse.redirect(getSafeAutopostRedirect(params))
  clearXOAuthCookie(response)
  return response
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

    const completion = await completeInitialXOAuthConnection({
      userId,
      code,
      codeVerifier: statePayload.code_verifier,
    })

    if (completion.ok === false && completion.error_code === "X_OAUTH_ACCOUNT_SAVE_FAILED") {
      return redirectWithClearedCookie({ error: "x_oauth_account_save_failed" })
    }
    if (completion.ok === false) {
      return redirectWithClearedCookie({ error: "x_oauth_failed" })
    }

    return redirectWithClearedCookie({ connected: "x" })
  } catch {
    return redirectWithClearedCookie({ error: "x_oauth_failed" })
  }
}
