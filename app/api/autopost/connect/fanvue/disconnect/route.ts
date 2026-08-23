import { NextResponse } from "next/server"
import { requireFreshTotpResponse } from "@/lib/security/mfaRoute"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const mfa = await requireFreshTotpResponse()
  if (mfa instanceof NextResponse) return mfa
  const userId = mfa.userId

  const now = new Date().toISOString()
  const supabaseAdmin = getSupabaseAdmin()

  const { error } = await supabaseAdmin
    .from("autopost_accounts")
    .update({
      connection_status: "REVOKED",
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      last_error: null,
      metadata: {
        provider: "fanvue",
        disconnected_at: now,
        disconnect_reason: "user_requested",
      },
    })
    .eq("user_id", userId)
    .eq("platform", "fanvue")

  if (error) {
    return NextResponse.json({ error: "DISCONNECT_FAILED" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
