import { NextResponse } from "next/server"
import { requireXAdminUserId } from "@/lib/autopost/xAdminAuthorization"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import {
  createXIdentityDiagnosticAccountLoader, handleXIdentityDiagnosticRequest,
  xIdentityDiagnosticMethodNotAllowedResult,
} from "@/lib/autopost/xIdentityDiagnostic"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const headers = {
  "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Expires: "0",
  "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
}

export async function POST(request: Request) {
  const response = await handleXIdentityDiagnosticRequest({
    request,
    getAuthenticatedUserId: (sessionRequest) => requireXAdminUserId({ request: sessionRequest }),
    loadAccount: async (userId) => {
      const loadAccount = createXIdentityDiagnosticAccountLoader(getSupabaseAdmin())
      return loadAccount(userId)
    },
    fetchImpl: fetch,
  })
  return NextResponse.json(response.body, { status: response.status, headers })
}

export function GET() {
  return NextResponse.json(xIdentityDiagnosticMethodNotAllowedResult(), { status: 405, headers })
}
