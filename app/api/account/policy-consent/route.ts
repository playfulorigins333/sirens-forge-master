import { NextResponse } from "next/server"
import { recordAuthenticatedAcceptance } from "@/lib/material-policy/service"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const result = await recordAuthenticatedAcceptance(body)
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.status })
  return NextResponse.json({ ok: true })
}
