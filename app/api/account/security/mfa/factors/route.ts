import { NextResponse } from "next/server"
import { supabaseServer } from "@/lib/supabaseServer"
import { mfaErrorBody, requireFreshTotp } from "@/lib/security/mfa"

export async function DELETE(request: Request) {
  const mfa = await requireFreshTotp()
  if (mfa.ok === false) return NextResponse.json(mfaErrorBody(mfa), { status: mfa.status })
  let factorId = ""
  try { factorId = String((await request.json()).factorId ?? "") } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 }) }
  const supabase = await supabaseServer()
  const factors = await supabase.auth.mfa.listFactors()
  if (factors.error) return NextResponse.json({ error: "MFA_LOOKUP_FAILED" }, { status: 503 })
  if (!factors.data.totp.some((factor) => factor.id === factorId && factor.status === "verified")) return NextResponse.json({ error: "MFA_FACTOR_NOT_OWNED" }, { status: 403 })
  const removed = await supabase.auth.mfa.unenroll({ factorId })
  if (removed.error) return NextResponse.json({ error: "MFA_FACTOR_REMOVAL_FAILED" }, { status: 400 })
  await supabase.auth.refreshSession()
  return NextResponse.json({ ok: true })
}
