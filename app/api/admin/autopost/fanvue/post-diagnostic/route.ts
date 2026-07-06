import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { handleFanvuePostDiagnosticRoute } from "@/lib/autopost/fanvuePostDiagnosticRoute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const response = await handleFanvuePostDiagnosticRoute({
    request: req,
    expectedSecret: process.env.FANVUE_POST_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_POST_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
  })
  return NextResponse.json(response.body, { status: response.status })
}
