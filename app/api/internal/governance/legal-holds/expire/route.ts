import { NextResponse } from "next/server"
import { authenticateSchedulerRequest } from "@/lib/creator-publishing-queue/scheduler-runner/serviceCore"
import { expireLegalHolds } from "@/lib/governance/legalHolds"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const headers = { "Cache-Control": "private, no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" }

export async function GET(request: Request) {
  const configuredSecret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET
  const auth = authenticateSchedulerRequest(request.headers, configuredSecret)
  if (auth.ok === false) {
    const status = auth.code === "CRON_SECRET_NOT_CONFIGURED" ? 503 : 401
    return NextResponse.json(auth, { status, headers })
  }

  const result = await expireLegalHolds(50)
  console.info({ event: "phase8f_legal_hold_expiry_run", ...result })
  return NextResponse.json(result, { status: result.ok ? 200 : 503, headers })
}
