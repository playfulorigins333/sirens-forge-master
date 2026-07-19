import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const routePath = "app/api/creator-publishing-queue/scheduler/run/route.ts"
const servicePath = "lib/creator-publishing-queue/scheduler-runner/service.ts"
const corePath = "lib/creator-publishing-queue/scheduler-runner/serviceCore.ts"
const route = () => readFileSync(routePath, "utf8")

function countMatches(source: string, expression: RegExp) {
  return [...source.matchAll(expression)].length
}

test("route has one finally-based sanitized telemetry emission and a sixty-second duration ceiling", () => {
  const src = route()
  assert.match(src, /export const maxDuration = 60/)
  assert.equal(countMatches(src, /console\.(?:info|log|warn|error|debug)\s*\(/g), 1)
  assert.equal(countMatches(src, /console\.info\(telemetry\)/g), 1)
  const finallyIndex = src.indexOf("finally {")
  const logIndex = src.indexOf("console.info(telemetry)")
  assert(finallyIndex >= 0)
  assert(logIndex > finallyIndex)
  assert.doesNotMatch(src, /\bcatch\s*\(/)
  assert.match(src, /const startedAt = Date\.now\(\)/)
  assert.match(src, /telemetry\.durationMs = safeDurationMs\(startedAt\)/)
})

test("telemetry schema, fallback, counts, and duration remain finite and identifier-free", () => {
  const src = route()
  assert.match(src, /event: "creator_publishing_scheduler_run"/)
  assert.match(src, /type SchedulerTrigger = "vercel_cron" \| "manual_or_unknown"/)
  assert.match(src, /code: "UNHANDLED_EXCEPTION"/)
  assert.match(src, /trigger: "manual_or_unknown"/)
  assert.match(src, /ok: false/)
  assert.match(src, /httpStatus: 500/)
  for (const key of ["claimedCount", "attemptedCount", "processedCount", "blockedCount", "supersededCount"]) {
    assert.match(src, new RegExp(`${key}: null`))
    assert.match(src, new RegExp(`${key}: safeCount\\(result, "${key}"\\)`))
  }
  assert.match(src, /typeof value === "number" && Number\.isFinite\(value\) && Number\.isInteger\(value\) && value >= 0 \? value : null/)
  assert.match(src, /Number\.isFinite\(duration\) && duration >= 0 \? Math\.floor\(duration\) : 0/)
  const allowedKeys = ["event", "trigger", "ok", "code", "httpStatus", "claimedCount", "attemptedCount", "processedCount", "blockedCount", "supersededCount", "durationMs"]
  const typeBlock = src.match(/type SchedulerRunTelemetry = \{([\s\S]*?)\n\}/)?.[1] ?? ""
  const fallbackBlock = src.match(/let telemetry: SchedulerRunTelemetry = \{([\s\S]*?)\n  \}\n\n  try/)?.[1] ?? ""
  const handledBlock = src.match(/telemetry = \{([\s\S]*?)\n    \}\n    return response/)?.[1] ?? ""
  const keys = (block: string) => [...block.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1])
  assert.deepEqual(keys(typeBlock), allowedKeys)
  assert.deepEqual(keys(fallbackBlock), allowedKeys)
  assert.deepEqual(keys(handledBlock), allowedKeys)
})

test("trigger classification uses only the documented user-agent signal after runner authentication results", () => {
  const src = route()
  assert.match(src, /userAgent === "vercel-cron\/1\.0"/)
  assert.match(src, /code !== "UNAUTHORIZED"/)
  assert.match(src, /code !== "CRON_SECRET_NOT_CONFIGURED"/)
  assert.match(src, /\? "vercel_cron"\s*:\s*"manual_or_unknown"/)
  const routeHeaderReads = [...src.matchAll(/request\.headers\.get\("([^"]+)"\)/g)].map((match) => match[1])
  assert.deepEqual(routeHeaderReads, ["user-agent"])
  assert.equal(countMatches(src, /runCreatorPublishingScheduler\(request\.headers\)/g), 1)
  assert(src.indexOf("await runCreatorPublishingScheduler(request.headers)") < src.indexOf("classifyTrigger(request.headers.get(\"user-agent\"), result.code)"))
  assert.doesNotMatch(src, /x-vercel-cron-schedule/i)
  assert.doesNotMatch(src, /console\.info\([^)]*userAgent/)
})

test("existing response status mapping and scheduler business boundary are unchanged", () => {
  const src = route()
  for (const entry of ["CRON_SECRET_NOT_CONFIGURED: 503", "UNAUTHORIZED: 401", "SCHEDULER_BUILD_DISABLED: 503", "SCHEDULER_ENV_DISABLED: 503", "SCHEDULER_SERVICE_UNAVAILABLE: 503"]) assert.match(src, new RegExp(entry))
  assert.match(src, /const httpStatus = result\.ok \? 200 : statusByCode\[result\.code\] \?\? 500/)
  assert.match(src, /const response = NextResponse\.json\(result, \{ status: httpStatus, headers: noStoreHeaders \}\)/)
  assert.doesNotMatch(src, /\.rpc\(|getSupabaseAdmin|\.from\(|\.insert\(|\.upsert\(|\.delete\(|fetch\(/)
  assert.doesNotMatch(readFileSync(servicePath, "utf8"), /console\./)
  assert.doesNotMatch(readFileSync(corePath, "utf8"), /console\./)
})
