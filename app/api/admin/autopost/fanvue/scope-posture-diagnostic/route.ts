import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { handleFanvueScopePostureDiagnosticRoute, type FanvueScopePostureAccount } from "@/lib/autopost/fanvueScopePostureDiagnosticRoute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FANVUE_SCOPE_POSTURE_ACCOUNT_SELECT = ["user_id", "platform", "connection_status", "status", "scopes"].join(", ")

async function loadFanvueScopePostureAccounts(userId: string): Promise<FanvueScopePostureAccount[]> {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from("autopost_accounts")
    .select(FANVUE_SCOPE_POSTURE_ACCOUNT_SELECT)
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .limit(2)
  if (error) throw error
  return (data ?? []) as FanvueScopePostureAccount[]
}

export async function POST(req: Request) {
  const response = await handleFanvueScopePostureDiagnosticRoute({
    request: req,
    expectedSecret: process.env.FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    loadAccounts: loadFanvueScopePostureAccounts,
  })
  return NextResponse.json(response.body, { status: response.status })
}
