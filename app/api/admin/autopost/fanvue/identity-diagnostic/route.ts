import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireFanvueOAuthConfig } from "@/lib/autopost/fanvueOAuth"
import { handleFanvueIdentityDiagnosticRoute } from "@/lib/autopost/fanvueIdentityDiagnosticRoute"
import type { FanvueIdentityDiagnosticAccount } from "@/lib/autopost/fanvueIdentityDiagnostic"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FANVUE_IDENTITY_DIAGNOSTIC_ACCOUNT_SELECT = [
  "user_id",
  "platform",
  "connection_status",
  "provider_account_id",
  "provider_username",
  "scopes",
  "encrypted_access_token",
  "token_expires_at",
  "token_type",
  "token_key_version",
  "metadata",
].join(", ")

async function loadFanvueIdentityDiagnosticAccount(userId: string): Promise<FanvueIdentityDiagnosticAccount | null> {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from("autopost_accounts")
    .select(FANVUE_IDENTITY_DIAGNOSTIC_ACCOUNT_SELECT)
    .eq("user_id", userId)
    .eq("platform", "fanvue")
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as unknown as FanvueIdentityDiagnosticAccount | null
}

export async function POST(req: Request) {
  const config = requireFanvueOAuthConfig()
  const response = await handleFanvueIdentityDiagnosticRoute({
    request: req,
    expectedSecret: process.env.FANVUE_IDENTITY_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_IDENTITY_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    createLoadAccount: () => loadFanvueIdentityDiagnosticAccount,
    apiBaseUrl: config.apiBaseUrl,
    apiVersion: config.apiVersion,
    fetchIdentity: (url, init) => fetch(url, init),
  })

  return NextResponse.json(response.body, { status: response.status })
}
