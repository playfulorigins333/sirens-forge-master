import { NextResponse } from "next/server"
import { recordAuthenticatedAcceptance } from "@/lib/material-policy/service"
import { emitLaunchCriticalFailure } from "@/lib/observability/runtimeSignal"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const result = await recordAuthenticatedAcceptance(body)
  if (!result.ok) {
    if (result.status >= 500) {
      emitLaunchCriticalFailure({
        route: "/api/account/policy-consent",
        code: result.code,
        status: result.status,
      })
    }
    return NextResponse.json({ error: result.code }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
