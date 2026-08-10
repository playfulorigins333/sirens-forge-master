import { NextResponse } from "next/server"
import { requireXAdminUserId } from "@/lib/autopost/xAdminAuthorization"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import {
  createXCryptoDiagnosticAccountLoader, handleXCryptoEnvelopeDiagnosticRequest,
  xCryptoEnvelopeDiagnosticMethodNotAllowedResult,
} from "@/lib/autopost/xCryptoEnvelopeDiagnostic"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const headers = {
  "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Expires: "0",
  "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
}

export async function POST(request: Request) {
  const response = await handleXCryptoEnvelopeDiagnosticRequest({
    request,
    getAuthenticatedUserId: (sessionRequest) => requireXAdminUserId({ request: sessionRequest }),
    loadAccount: async (userId) => createXCryptoDiagnosticAccountLoader(getSupabaseAdmin())(userId),
  })
  return NextResponse.json(response.body, { status: response.status, headers })
}

export function GET() {
  return NextResponse.json(xCryptoEnvelopeDiagnosticMethodNotAllowedResult(), { status: 405, headers })
}
