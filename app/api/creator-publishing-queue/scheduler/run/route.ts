import { NextResponse } from "next/server"
import { runCreatorPublishingScheduler } from "@/lib/creator-publishing-queue/scheduler-runner/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

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

type SchedulerResult = Awaited<ReturnType<typeof runCreatorPublishingScheduler>>
type SchedulerTrigger = "vercel_cron" | "manual_or_unknown"
type SchedulerCountKey = "claimedCount" | "attemptedCount" | "processedCount" | "blockedCount" | "supersededCount"
type SchedulerRunTelemetry = {
  event: "creator_publishing_scheduler_run"
  trigger: SchedulerTrigger
  ok: boolean
  code: string
  httpStatus: number
  claimedCount: number | null
  attemptedCount: number | null
  processedCount: number | null
  blockedCount: number | null
  supersededCount: number | null
  durationMs: number
}

function safeCount(result: SchedulerResult, key: SchedulerCountKey) {
  const value = (result as unknown as Record<string, unknown>)[key]
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : null
}

function safeDurationMs(startedAt: number) {
  const duration = Date.now() - startedAt
  return Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : 0
}

function classifyTrigger(userAgent: string | null, code: string): SchedulerTrigger {
  return userAgent === "vercel-cron/1.0" && code !== "UNAUTHORIZED" && code !== "CRON_SECRET_NOT_CONFIGURED"
    ? "vercel_cron"
    : "manual_or_unknown"
}

export async function GET(request: Request) {
  const startedAt = Date.now()
  let telemetry: SchedulerRunTelemetry = {
    event: "creator_publishing_scheduler_run",
    trigger: "manual_or_unknown",
    ok: false,
    code: "UNHANDLED_EXCEPTION",
    httpStatus: 500,
    claimedCount: null,
    attemptedCount: null,
    processedCount: null,
    blockedCount: null,
    supersededCount: null,
    durationMs: 0,
  }

  try {
    const result = await runCreatorPublishingScheduler(request.headers)
    const httpStatus = result.ok ? 200 : statusByCode[result.code] ?? 500
    const response = NextResponse.json(result, { status: httpStatus, headers: noStoreHeaders })
    telemetry = {
      event: "creator_publishing_scheduler_run",
      trigger: classifyTrigger(request.headers.get("user-agent"), result.code),
      ok: result.ok,
      code: result.code,
      httpStatus: httpStatus,
      claimedCount: safeCount(result, "claimedCount"),
      attemptedCount: safeCount(result, "attemptedCount"),
      processedCount: safeCount(result, "processedCount"),
      blockedCount: safeCount(result, "blockedCount"),
      supersededCount: safeCount(result, "supersededCount"),
      durationMs: 0,
    }
    return response
  } finally {
    telemetry.durationMs = safeDurationMs(startedAt)
    console.info(telemetry)
  }
}
