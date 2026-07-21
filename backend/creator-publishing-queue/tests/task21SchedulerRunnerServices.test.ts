import assert from "node:assert/strict"
import test from "node:test"
import { authenticateSchedulerRequest, parseClaimSchedulerEvents, parseProcessSchedulerEvent, runCreatorPublishingSchedulerCore, SCHEDULER_SAFE_ERROR_CODES } from "../../../lib/creator-publishing-queue/scheduler-runner/serviceCore"

const secret = "configured-secret"
const h = (headers: Record<string, string>) => ({ get: (name: string) => headers[name.toLowerCase()] ?? null })
const validId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const lock = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`
class ThrownClaimRpcError extends Error {}

const reconciledRow = (overrides: Record<string, unknown> = {}) => ({ status: "processed", processed_at: "2026-01-01T00:00:00.000Z", superseded_at: null, safe_error_code: null, lock_token: null, locked_at: null, ...overrides })
const fakeAdmin = (claimData: unknown, processData: unknown[] = [], reconciliationData?: unknown) => {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const fromCalls: { table: string; projection?: string; column?: string; value?: unknown; limit?: number; mutation?: string }[] = []
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name === "creator_publishing_claim_due_scheduler_events") {
        if (claimData instanceof ThrownClaimRpcError) throw claimData
        return claimData instanceof Error ? { data: null, error: claimData } : { data: claimData, error: null }
      }
      const data = processData.shift()
      if (data === undefined) throw new Error("unexpected process retry")
      if (data instanceof Error && data.message === "throw") throw data
      return data instanceof Error ? { data: null, error: data } : { data, error: null }
    },
    from: (table: "creator_publishing_scheduler_events") => {
      const call = { table } as { table: string; projection?: string; column?: string; value?: unknown; limit?: number; mutation?: string }
      fromCalls.push(call)
      return {
        select: (projection: "status,processed_at,superseded_at,safe_error_code,lock_token,locked_at") => {
          call.projection = projection
          return { eq: (column: "id", value: string) => {
            call.column = column; call.value = value
            return { limit: async (limit: 1) => {
              call.limit = limit
              if (reconciliationData instanceof Error && reconciliationData.message === "throw") throw reconciliationData
              return reconciliationData instanceof Error ? { data: null, error: reconciliationData } : reconciliationData
            } }
          } }
        },
        insert: () => { call.mutation = "insert" }, update: () => { call.mutation = "update" }, upsert: () => { call.mutation = "upsert" }, delete: () => { call.mutation = "delete" },
      }
    },
  }
  return { calls, fromCalls, admin }
}
const runOne = (f: ReturnType<typeof fakeAdmin>) => runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: "true", getAdminClient: () => f.admin })

const completed = (overrides: Record<string, number> = {}) => ({ ok: true, code: "SCHEDULER_RUN_COMPLETED", claimedCount: 0, attemptedCount: 0, processedCount: 0, blockedCount: 0, supersededCount: 0, ...overrides })
const claimFailed = { ok: false, code: "CLAIM_RPC_FAILED", claimedCount: 0, attemptedCount: 0, processedCount: 0, blockedCount: 0, supersededCount: 0 }

test("authentication and activation order remain fail closed", async () => {
  assert.deepEqual(authenticateSchedulerRequest(h({}), undefined), { ok: false, code: "CRON_SECRET_NOT_CONFIGURED" })
  assert.deepEqual(authenticateSchedulerRequest(h({}), secret), { ok: false, code: "UNAUTHORIZED" })
  assert.deepEqual(authenticateSchedulerRequest(h({ authorization: "Bearer wrong" }), secret), { ok: false, code: "UNAUTHORIZED" })
  assert.equal(authenticateSchedulerRequest(h({ authorization: `Bearer ${secret}` }), secret).ok, true)
  assert.equal(authenticateSchedulerRequest(h({ "x-vercel-cron-secret": secret }), secret).ok, true)
  let adminCalls = 0
  const getAdminClient = () => { adminCalls += 1; return fakeAdmin([], []).admin }
  assert.deepEqual(await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: false, environmentEnabled: "true", getAdminClient }), { ok: false, code: "SCHEDULER_BUILD_DISABLED" })
  assert.deepEqual(await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: undefined, getAdminClient }), { ok: false, code: "SCHEDULER_ENV_DISABLED" })
  assert.equal(adminCalls, 0)
})

test("claim parser remains exact and bounded", () => {
  assert.deepEqual(parseClaimSchedulerEvents([]), { ok: true, events: [] })
  assert.equal(parseClaimSchedulerEvents([{ event_id: validId(1), lock_token: lock(1) }]).ok, true)
  for (const invalid of [[{ event_id: validId(1), lock_token: lock(1) }, { event_id: validId(2), lock_token: lock(2) }], [{ event_id: "bad", lock_token: lock(1) }], [{ event_id: validId(1), lock_token: lock(1), extra: true }], null]) assert.deepEqual(parseClaimSchedulerEvents(invalid), { ok: false })
})

test("existing process variants remain finite", () => {
  for (const job_state of ["awaiting_operator", "due_now", "direct_publish_queued", "ready_for_export"]) assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "processed", job_state }), { ok: true, kind: "processed" })
  for (const safe_error_code of SCHEDULER_SAFE_ERROR_CODES) assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "blocked", safe_error_code }), { ok: true, kind: "blocked" })
  for (const code of ["STALE_LOCK_TOKEN", "EVENT_NOT_FOUND", "IDENTITY_MISMATCH"] as const) assert.deepEqual(parseProcessSchedulerEvent({ ok: false, code }), { ok: false, code })
  assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "blocked", safe_error_code: "NEW" }), { ok: false, code: "UNKNOWN_SAFE_ERROR_CODE" })
})

test("claim uncertainty is handled once, sanitized, and never reconciled", async () => {
  for (const claimData of [new Error("raw claim transport failure"), new ThrownClaimRpcError("thrown claim transport failure")]) {
    const f = fakeAdmin(claimData, [{ ok: true, status: "processed", job_state: "due_now" }], { data: [reconciledRow()], error: null })
    let result: unknown
    await assert.doesNotReject(async () => { result = await runOne(f) })
    assert.deepEqual(result, claimFailed)
    assert.deepEqual(f.calls, [{ name: "creator_publishing_claim_due_scheduler_events", args: { p_limit: 1, p_lock_minutes: 15 } }])
    assert.equal(f.fromCalls.length, 0)
    const serialized = JSON.stringify(result)
    for (const forbidden of ["raw claim", "thrown claim", validId(1), lock(1), "p_limit", "p_lock_minutes"]) assert.equal(serialized.includes(forbidden), false)
  }
})

test("normal empty and malformed claim responses retain existing behavior", async () => {
  const empty = fakeAdmin([])
  assert.deepEqual(await runOne(empty), completed())
  assert.equal(empty.calls.length, 1)
  assert.equal(empty.fromCalls.length, 0)
  const malformed = fakeAdmin([{ event_id: "bad", lock_token: lock(1) }])
  assert.deepEqual(await runOne(malformed), { ok: false, code: "CLAIM_RESPONSE_INVALID", claimedCount: 0, attemptedCount: 0, processedCount: 0, blockedCount: 0, supersededCount: 0 })
  assert.equal(malformed.fromCalls.length, 0)
})

test("normal processing and Gate 21C-2 reconciliation remain exactly once", async () => {
  const rows = [{ event_id: validId(1), lock_token: lock(1) }]
  const normal = fakeAdmin(rows, [{ ok: true, status: "processed", job_state: "due_now" }])
  assert.deepEqual(await runOne(normal), completed({ claimedCount: 1, attemptedCount: 1, processedCount: 1 }))
  assert.deepEqual(normal.calls.map(c => c.name), ["creator_publishing_claim_due_scheduler_events", "creator_publishing_process_scheduler_event"])
  assert.equal(normal.fromCalls.length, 0)
  const uncertain = fakeAdmin(rows, [new Error("rpc")], { data: [reconciledRow()], error: null })
  assert.deepEqual(await runOne(uncertain), completed({ claimedCount: 1, attemptedCount: 1, processedCount: 1 }))
  assert.equal(uncertain.calls.filter(c => c.name === "creator_publishing_process_scheduler_event").length, 1)
  assert.deepEqual(uncertain.fromCalls, [{ table: "creator_publishing_scheduler_events", projection: "status,processed_at,superseded_at,safe_error_code,lock_token,locked_at", column: "id", value: validId(1), limit: 1 }])
})

test("retry exhaustion is reconciliation-only", async () => {
  assert.equal((SCHEDULER_SAFE_ERROR_CODES as readonly string[]).includes("SCHEDULER_RETRY_EXHAUSTED"), false)
  assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "blocked", safe_error_code: "SCHEDULER_RETRY_EXHAUSTED" }), { ok: false, code: "UNKNOWN_SAFE_ERROR_CODE" })
  const rows = [{ event_id: validId(21), lock_token: lock(21) }]
  const normal = fakeAdmin(rows, [{ ok: true, status: "blocked", safe_error_code: "SCHEDULER_RETRY_EXHAUSTED" }], { data: [reconciledRow({ status: "blocked", safe_error_code: "SCHEDULER_RETRY_EXHAUSTED" })], error: null })
  const normalResult = await runOne(normal)
  assert.equal(normalResult.code, "UNKNOWN_SAFE_ERROR_CODE")
  assert.equal(normal.fromCalls.length, 0)
  assert.equal(JSON.stringify(normalResult).includes("SCHEDULER_RETRY_EXHAUSTED"), false)

  const uncertain = fakeAdmin(rows, [new Error("rpc")], { data: [reconciledRow({ status: "blocked", safe_error_code: "SCHEDULER_RETRY_EXHAUSTED" })], error: null })
  assert.deepEqual(await runOne(uncertain), completed({ claimedCount: 1, attemptedCount: 1, blockedCount: 1 }))
  assert.equal(uncertain.calls.filter(c => c.name === "creator_publishing_process_scheduler_event").length, 1)
  assert.equal(uncertain.fromCalls.length, 1)

  for (const safe_error_code of SCHEDULER_SAFE_ERROR_CODES) {
    const reconciled = fakeAdmin(rows, [new Error("rpc")], { data: [reconciledRow({ status: "blocked", safe_error_code })], error: null })
    assert.deepEqual(await runOne(reconciled), completed({ claimedCount: 1, attemptedCount: 1, blockedCount: 1 }))
  }

  const unknown = fakeAdmin(rows, [new Error("rpc")], { data: [reconciledRow({ status: "blocked", safe_error_code: "SCHEDULER_UNKNOWN_RECONCILIATION_CODE" })], error: null })
  const unknownResult = await runOne(unknown)
  assert.equal(unknownResult.code, "PROCESS_RPC_FAILED")
  const serialized = JSON.stringify(unknownResult)
  for (const forbidden of [validId(21), lock(21), "SCHEDULER_UNKNOWN_RECONCILIATION_CODE", "safe_error_code", "processed_at"]) assert.equal(serialized.includes(forbidden), false)
})

test("reconciliation fails closed for malformed, nonterminal, and locked rows", async () => {
  const rows = [{ event_id: validId(1), lock_token: lock(1) }]
  const cases = [{ data: [], error: null }, { data: [reconciledRow({ status: "processing" })], error: null }, { data: [reconciledRow({ lock_token: lock(2) })], error: null }, { data: [reconciledRow({ status: "blocked", safe_error_code: "NEW" })], error: null }]
  for (const reconciliation of cases) {
    const f = fakeAdmin(rows, [new Error("rpc")], reconciliation)
    const result = await runOne(f)
    assert.equal(result.code, "PROCESS_RPC_FAILED")
    assert.equal(f.calls.filter(c => c.name === "creator_publishing_process_scheduler_event").length, 1)
    assert.equal(f.fromCalls.length, 1)
    assert.equal(f.fromCalls.some(c => c.mutation), false)
  }
})
