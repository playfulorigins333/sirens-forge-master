import { NextResponse } from "next/server"
import { requireXAdminUserId } from "@/lib/autopost/xAdminAuthorization"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import {
  createXLiveTextCanaryAccountLoader,
  handleXLiveTextCanaryRequest,
  xLiveTextCanaryMethodNotAllowedResult,
} from "@/lib/autopost/xLiveTextCanary"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
}

export async function POST(request: Request) {
  const gated = await handleXLiveTextCanaryRequest({
    request,
    getAuthenticatedUserId: () => requireXAdminUserId({ request }),
    // Construction is deliberately deferred until every request gate has passed.
    loadAccount: (userId) => createXLiveTextCanaryAccountLoader(getSupabaseAdmin())(userId),
  })
  return NextResponse.json(gated.body, { status: gated.status, headers: SECURITY_HEADERS })
}

export function GET() {
  return NextResponse.json(xLiveTextCanaryMethodNotAllowedResult(), { status: 405, headers: SECURITY_HEADERS })
}
