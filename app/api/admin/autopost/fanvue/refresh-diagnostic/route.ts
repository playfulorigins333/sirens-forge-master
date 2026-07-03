import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { refreshFanvueAccessToken } from "@/lib/autopost/fanvueTokenRefresh"
import { handleFanvueRefreshDiagnosticRoute } from "@/lib/autopost/fanvueRefreshDiagnosticRoute"
import type { FanvueRefreshDiagnosticAccount } from "@/lib/autopost/fanvueRefreshDiagnostic"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FANVUE_REFRESH_DIAGNOSTIC_ACCOUNT_SELECT = [
  "user_id",
  "platform",
  "connection_status",
  "provider_account_id",
  "metadata",
  "encrypted_refresh_token",
  "token_expires_at",
  "token_type",
  "token_key_version",
  "last_refresh_at",
  "scopes",
].join(", ")

async function loadFanvueRefreshDiagnosticAccount(userId: string): Promise<FanvueRefreshDiagnosticAccount | null> {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from("autopost_accounts")
    .select(FANVUE_REFRESH_DIAGNOSTIC_ACCOUNT_SELECT)
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as unknown as FanvueRefreshDiagnosticAccount | null
}

export async function POST(req: Request) {
  const response = await handleFanvueRefreshDiagnosticRoute({
    request: req,
    expectedSecret: process.env.FANVUE_REFRESH_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_REFRESH_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    createLoadAccount: () => loadFanvueRefreshDiagnosticAccount,
    getRefreshAccessToken: () => refreshFanvueAccessToken,
  })

  return NextResponse.json(response.body, { status: response.status })
}
