import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const userId = await requireUserId({ request: req }).catch(() => null)
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

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
