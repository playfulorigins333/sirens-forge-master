import { NextResponse } from "next/server"
import { mfaErrorBody, requireFreshTotp } from "@/lib/security/mfa"

export async function requireFreshTotpResponse() {
  const result = await requireFreshTotp()
  return result.ok === true ? result : NextResponse.json(mfaErrorBody(result), { status: result.status })
}
