import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { handleFanvuePostRiskDiagnosticRoute } from "@/lib/autopost/fanvuePostRiskDiagnosticRoute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const response = await handleFanvuePostRiskDiagnosticRoute({
    request: req,
    expectedSecret: process.env.FANVUE_POST_RISK_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
  })
  return NextResponse.json(response.body, { status: response.status })
}
