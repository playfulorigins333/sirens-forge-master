import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireFanvueOAuthConfig } from "@/lib/autopost/fanvueOAuth"
import { handleFanvueOneTextPostDiagnosticRoute, type FanvueOneTextPostDiagnosticAccount } from "@/lib/autopost/fanvueOneTextPostDiagnosticRoute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FANVUE_ONE_TEXT_POST_DIAGNOSTIC_ACCOUNT_SELECT = ["user_id", "platform", "connection_status", "encrypted_access_token"].join(", ")

async function loadFanvueOneTextPostDiagnosticAccount(userId: string): Promise<FanvueOneTextPostDiagnosticAccount | null> {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from("autopost_accounts")
    .select(FANVUE_ONE_TEXT_POST_DIAGNOSTIC_ACCOUNT_SELECT)
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as FanvueOneTextPostDiagnosticAccount | null
}

export async function POST(req: Request) {
  const config = requireFanvueOAuthConfig()
  const response = await handleFanvueOneTextPostDiagnosticRoute({
    request: req,
    expectedSecret: process.env.FANVUE_UPLOAD_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    createLoadAccount: () => loadFanvueOneTextPostDiagnosticAccount,
    apiBaseUrl: config.apiBaseUrl,
    apiVersion: config.apiVersion,
    fanvueFetch: (url, init) => fetch(url, init),
  })
  return NextResponse.json(response.body, { status: response.status })
}
