import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { authenticateSchedulerRequest, parseClaimSchedulerEvents, parseProcessSchedulerEvent, runCreatorPublishingSchedulerCore, SCHEDULER_SAFE_ERROR_CODES } from "../../../lib/creator-publishing-queue/scheduler-runner/serviceCore"

const secret = "configured-secret"
const h = (headers: Record<string, string>) => ({ get: (name: string) => headers[name.toLowerCase()] ?? null })
const validId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const lock = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const fakeAdmin = (claimData: unknown, processData: unknown[] = []) => { const calls: { name: string; args: Record<string, unknown> }[] = []; return { calls, admin: { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); if (name === "creator_publishing_claim_due_scheduler_events") return claimData instanceof Error ? { data: null, error: claimData } : { data: claimData, error: null }; const data = processData.shift(); return data instanceof Error ? { data: null, error: data } : { data, error: null } } } } }

test("authentication, dual headers, constant-time length safety, and activation order", async () => {
  assert.deepEqual(authenticateSchedulerRequest(h({}), undefined), { ok: false, code: "CRON_SECRET_NOT_CONFIGURED" })
  assert.deepEqual(authenticateSchedulerRequest(h({}), secret), { ok: false, code: "UNAUTHORIZED" })
  assert.deepEqual(authenticateSchedulerRequest(h({ authorization: "Basic abc" }), secret), { ok: false, code: "UNAUTHORIZED" })
  assert.deepEqual(authenticateSchedulerRequest(h({ authorization: "Bearer wrong" }), secret), { ok: false, code: "UNAUTHORIZED" })
  assert.deepEqual(authenticateSchedulerRequest(h({ "x-vercel-cron-secret": "wrong" }), secret), { ok: false, code: "UNAUTHORIZED" })
  assert.equal(authenticateSchedulerRequest(h({ authorization: `Bearer ${secret}` }), secret).ok, true)
  assert.equal(authenticateSchedulerRequest(h({ "x-vercel-cron-secret": secret }), secret).ok, true)
  assert.doesNotThrow(() => authenticateSchedulerRequest(h({ authorization: "Bearer x" }), secret))
  const invalids = [
    { authorization: "Bearer bad", "x-vercel-cron-secret": secret },
    { authorization: `Bearer ${secret}`, "x-vercel-cron-secret": "bad" },
    { authorization: "Bearer", "x-vercel-cron-secret": secret },
    { authorization: `Bearer ${secret}`, "x-vercel-cron-secret": "" },
    { authorization: "Bearer bad", "x-vercel-cron-secret": "wrong" },
    { authorization: "Bad", "x-vercel-cron-secret": "" },
    { authorization: `Bearer ${secret}`, "x-vercel-cron-secret": "configured-secret-2" },
  ]
  for (const headers of invalids) assert.deepEqual(authenticateSchedulerRequest(h(headers), secret), { ok: false, code: "UNAUTHORIZED" })
  assert.equal(authenticateSchedulerRequest(h({ authorization: `Bearer ${secret}`, "x-vercel-cron-secret": secret }), secret).ok, true)
  let adminCalls = 0
  const getAdminClient = () => { adminCalls += 1; return fakeAdmin([], []).admin }
  assert.deepEqual(await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: false, environmentEnabled: "true", getAdminClient }), { ok: false, code: "SCHEDULER_BUILD_DISABLED" })
  assert.equal(adminCalls, 0)
  assert.deepEqual(await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: undefined, getAdminClient }), { ok: false, code: "SCHEDULER_ENV_DISABLED" })
  for (const value of ["TRUE", "1", "yes", " true "]) assert.deepEqual(await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: value, getAdminClient }), { ok: false, code: "SCHEDULER_ENV_DISABLED" })
  assert.equal(adminCalls, 0)
  const ok = await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: "true", getAdminClient })
  assert.equal(ok.code, "SCHEDULER_RUN_COMPLETED"); assert.equal(adminCalls, 1)
  assert.deepEqual(await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: false, environmentEnabled: "true", getAdminClient: () => { throw new Error("credential probe") } }), { ok: false, code: "SCHEDULER_BUILD_DISABLED" })
})

test("claim parser accepts only exact bounded UUID rows", () => {
  assert.deepEqual(parseClaimSchedulerEvents([]), { ok: true, events: [] })
  assert.equal(parseClaimSchedulerEvents([{ event_id: validId(1), lock_token: lock(1) }]).ok, true)
  assert.equal(parseClaimSchedulerEvents(Array.from({ length: 1 }, (_, i) => ({ event_id: validId(i), lock_token: lock(i) }))).ok, true)
  for (const data of [Array.from({ length: 2 }, (_, i) => ({ event_id: validId(i), lock_token: lock(i) })), [{ event_id: "bad", lock_token: lock(1) }], null, 1, [{ lock_token: lock(1) }], [{ event_id: validId(1) }], [{ event_id: validId(1), lock_token: lock(1) }, { event_id: validId(1), lock_token: lock(2) }], [{ event_id: validId(1), lock_token: lock(1), extra: true }], { event_id: validId(1), lock_token: lock(1) }]) assert.deepEqual(parseClaimSchedulerEvents(data), { ok: false })
})

test("processing parser accepts finite variants and rejects malformed output", () => {
  for (const job_state of ["awaiting_operator", "due_now", "direct_publish_queued", "ready_for_export"]) assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "processed", job_state }), { ok: true, kind: "processed" })
  for (const safe_error_code of SCHEDULER_SAFE_ERROR_CODES) assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "blocked", safe_error_code }), { ok: true, kind: "blocked" })
  assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "superseded", code: "JOB_TERMINAL", job_state: "archived" }), { ok: true, kind: "superseded" })
  assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "superseded", code: "SCHEDULER_STALE_REVISION", job_state: "due_now", schedule_revision: 1 }), { ok: true, kind: "superseded" })
  assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "superseded", code: "SCHEDULER_STALE_REVISION", job_state: "due_now", schedule_revision: null }), { ok: true, kind: "superseded" })
  assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "superseded", code: "OBSOLETE_OPERATOR_DUE_SUPERSEDED" }), { ok: true, kind: "superseded" })
  for (const code of ["STALE_LOCK_TOKEN", "EVENT_NOT_FOUND", "IDENTITY_MISMATCH"] as const) assert.deepEqual(parseProcessSchedulerEvent({ ok: false, code }), { ok: false, code })
  assert.deepEqual(parseProcessSchedulerEvent({ ok: true, status: "blocked", safe_error_code: "NEW" }), { ok: false, code: "UNKNOWN_SAFE_ERROR_CODE" })
  for (const data of [{ ok: true, status: "superseded", code: "NEW" }, { ok: true, status: "superseded", code: "JOB_TERMINAL", job_state: "new" }, { ok: true, status: "superseded", code: "SCHEDULER_STALE_REVISION", job_state: "due_now", schedule_revision: 0 }, { ok: true }, { ok: true, status: "processed", job_state: "due_now", extra: true }, null, [], 1, {}, { ok: false, code: "OTHER" }]) assert.deepEqual(parseProcessSchedulerEvent(data), { ok: false, code: "PROCESS_RESPONSE_INVALID" })
})

test("batch policy is sequential, bounded, finite, and stops safely", async () => {
  const rows = [1].map((i) => ({ event_id: validId(i), lock_token: lock(i) }))
  const f = fakeAdmin(rows, [{ ok: true, status: "processed", job_state: "due_now" }])
  assert.deepEqual(await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: "true", getAdminClient: () => f.admin }), { ok: true, code: "SCHEDULER_RUN_COMPLETED", claimedCount: 1, attemptedCount: 1, processedCount: 1, blockedCount: 0, supersededCount: 0 })
  assert.deepEqual(f.calls.map(c => c.name), ["creator_publishing_claim_due_scheduler_events", "creator_publishing_process_scheduler_event"])
  assert.deepEqual(f.calls[0].args, { p_limit: 1, p_lock_minutes: 15 })
  for (const code of ["STALE_LOCK_TOKEN", "EVENT_NOT_FOUND", "IDENTITY_MISMATCH"] as const) { const s = fakeAdmin(rows, [{ ok: false, code }, { ok: true, status: "processed", job_state: "due_now" }]); const result = await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: "true", getAdminClient: () => s.admin }); assert.equal(result.code, code); assert.equal(s.calls.length, 2); assert.equal(JSON.stringify(result).includes(validId(1)), false); assert.equal(JSON.stringify(result).includes(lock(1)), false) }
  assert.equal((await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: "true", getAdminClient: () => fakeAdmin(new Error("raw"), []).admin })).code, "CLAIM_RPC_FAILED")
  assert.equal((await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: "true", getAdminClient: () => fakeAdmin(rows, [new Error("raw")]).admin })).code, "PROCESS_RPC_FAILED")
  assert.equal((await runCreatorPublishingSchedulerCore({ headers: h({ authorization: `Bearer ${secret}` }), configuredSecret: secret, buildEnabled: true, environmentEnabled: "true", getAdminClient: () => fakeAdmin(rows, [{ ok: true, status: "blocked", safe_error_code: "NEW" }]).admin })).code, "UNKNOWN_SAFE_ERROR_CODE")
  const src = readFileSync("lib/creator-publishing-queue/scheduler-runner/serviceCore.ts", "utf8"); assert.doesNotMatch(src, /Promise\.all|\.from\(|\.delete\(|\.insert\(|\.upsert\(|fetch\(|console\./)
})
