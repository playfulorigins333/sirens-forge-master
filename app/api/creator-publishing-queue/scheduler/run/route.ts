import { NextResponse } from "next/server"
import { runCreatorPublishingScheduler } from "@/lib/creator-publishing-queue/scheduler-runner/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
}

const statusByCode: Record<string, number> = {
  CRON_SECRET_NOT_CONFIGURED: 503,
  UNAUTHORIZED: 401,
  SCHEDULER_BUILD_DISABLED: 503,
  SCHEDULER_ENV_DISABLED: 503,
  SCHEDULER_SERVICE_UNAVAILABLE: 503,
}

export async function GET(request: Request) {
  const result = await runCreatorPublishingScheduler(request.headers)
  return NextResponse.json(result, { status: result.ok ? 200 : statusByCode[result.code] ?? 500, headers: noStoreHeaders })
}
