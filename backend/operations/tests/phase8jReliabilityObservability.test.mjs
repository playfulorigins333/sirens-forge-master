import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  checkApplicationHealth,
  checkPaymentReadiness,
  runProductionMonitor,
} from "../../../tools/phase8j-production-monitor.mjs"

const route = readFileSync("app/api/account/policy-consent/route.ts", "utf8")
const signal = readFileSync("lib/observability/runtimeSignal.ts", "utf8")
const workflow = readFileSync(".github/workflows/phase8j-production-monitor.yml", "utf8")
const monitor = readFileSync("tools/phase8j-production-monitor.mjs", "utf8")

function mockFetch(payloadByPath) {
  return async (url, init) => {
    assert.equal(init.method, "GET")
    const path = new URL(url).pathname
    const payload = payloadByPath[path]
    if (!payload) return new Response(null, { status: 404 })
    return new Response(JSON.stringify(payload.body), {
      status: payload.status ?? 200,
      headers: { "content-type": "application/json" },
    })
  }
}

test("handled policy-consent 5xx emits only a finite sanitized launch signal", () => {
  assert.match(route, /emitLaunchCriticalFailure/)
  assert.match(route, /result\.status >= 500/)
  assert.match(route, /route: "\/api\/account\/policy-consent"/)
  assert.match(route, /code: result\.code/)
  assert.match(signal, /event: "launch_critical_failure"/)
  assert.match(signal, /route: string/)
  assert.match(signal, /code: string/)
  assert.match(signal, /status: number/)
  assert.doesNotMatch(signal, /JSON\.stringify\([^)]*(?:request|body|user|email|token|authorization|cookie)/i)
  assert.doesNotMatch(route, /console\.error\([^)]*(?:body|request)/i)
})

test("production monitor uses safe GET-only health and Payment V2 readiness checks", () => {
  assert.match(monitor, /method: "GET"/)
  assert.match(monitor, /\/api\/health/)
  assert.match(monitor, /\/api\/payment-v2\/readiness/)
  assert.doesNotMatch(monitor, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/)
  assert.doesNotMatch(monitor, /checkout\/subscription|webhook|creator-publishing-queue\/fanvue\/run|account\/deletion|data-rights\/export/i)
})

test("healthy application and available or sold-out tiers pass", async () => {
  const fetchImpl = mockFetch({
    "/api/health": { body: { status: "ok" } },
    "/api/payment-v2/readiness": {
      body: { checkoutMode: "payment_v2", tiers: { og_throne: "available", early_bird: "sold_out" } },
    },
  })
  assert.deepEqual(await checkApplicationHealth(fetchImpl, "https://example.invalid"), { ok: true, check: "application_health" })
  assert.deepEqual(await checkPaymentReadiness(fetchImpl, "https://example.invalid"), { ok: true, check: "payment_v2_readiness" })
  assert.equal((await runProductionMonitor({ fetchImpl, origin: "https://example.invalid" })).ok, true)
})

test("unavailable Payment V2 or failed health makes the monitor fail closed", async () => {
  const fetchImpl = mockFetch({
    "/api/health": { status: 503, body: { status: "down" } },
    "/api/payment-v2/readiness": {
      body: { checkoutMode: "payment_v2", tiers: { og_throne: "unavailable", early_bird: "available" } },
    },
  })
  const outcome = await runProductionMonitor({ fetchImpl, origin: "https://example.invalid" })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.results[0].code, "HEALTH_REQUEST_FAILED")
  assert.equal(outcome.results[1].code, "PAYMENT_READINESS_UNHEALTHY")
})

test("scheduled monitor is read-only, least-privilege, and manually runnable", () => {
  assert.match(workflow, /schedule:/)
  assert.match(workflow, /cron:\s*["']?\*\/15 \* \* \* \*["']?/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /contents:\s*read/)
  assert.match(workflow, /node tools\/phase8j-production-monitor\.mjs/)
  assert.doesNotMatch(workflow, /secrets\./)
})
