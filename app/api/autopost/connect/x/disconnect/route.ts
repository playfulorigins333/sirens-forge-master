import { NextResponse } from "next/server"
import { requireFreshTotpResponse } from "@/lib/security/mfaRoute"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const mfa = await requireFreshTotpResponse()
  if (mfa instanceof NextResponse) return mfa
  const userId = mfa.userId

  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin.rpc("disconnect_publishing_provider", {
    p_user_id: userId,
    p_provider: "x",
  })

  if (error) {
    return NextResponse.json({ error: "DISCONNECT_FAILED" }, { status: 500 })
  }

  return NextResponse.json({ success: true, cancellation: data })
}
