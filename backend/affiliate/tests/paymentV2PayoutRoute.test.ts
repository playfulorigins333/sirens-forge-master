import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { payoutCronResponse } from "../../../app/api/admin/affiliate-payouts/execute/route"

const old = { ...process.env }
process.env.PAYMENT_V2_PAYOUT_EXECUTION_ENABLED = "true"
process.env.CRON_SECRET = "secret"

let financialCalls: string[] = []
const deps: any = {
  prepare: async () => { financialCalls.push("prepare"); return "batch" },
  loadPending: async () => { financialCalls.push("load"); return [] },
  reconcileRecurring: async () => { financialCalls.push("reconcile"); return true },
  beginDispatch: async () => { financialCalls.push("dispatch"); return null },
  createTransfer: async () => { financialCalls.push("stripe"); return { id: "tr_test" } },
  complete: async () => { financialCalls.push("complete"); return true },
  recordFailure: async () => { financialCalls.push("failure") },
}
const authorized = (method = "GET") => new Request("http://x", { method, headers: { authorization: "Bearer secret" } })
const invoke = (iso: string, method = "GET") => payoutCronResponse(authorized(method), deps, new Date(iso))
const expectExecuted = async (iso: string, method = "GET") => {
  financialCalls = []
  const response = await invoke(iso, method)
  assert.equal(response.status, 200)
  assert.deepEqual(financialCalls, ["prepare", "load"])
}
const expectSkipped = async (iso: string, method = "GET") => {
  financialCalls = []
  const response = await invoke(iso, method)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: "skipped", reason: "outside_payout_window" })
  assert.deepEqual(financialCalls, [])
}

// The paired UTC schedules execute only in their matching New York season.
await expectExecuted("2026-08-09T03:59:00Z")
await expectSkipped("2026-08-09T04:59:00Z")
await expectExecuted("2026-01-04T04:59:00Z")
await expectSkipped("2026-01-04T03:59:00Z")

// The entire Saturday 23rd hour is accepted; adjacent local windows are harmless no-ops.
await expectExecuted("2026-08-09T03:00:00Z")
await expectSkipped("2026-08-09T02:59:00Z")
await expectSkipped("2026-08-09T04:00:00Z")

// Both externally exposed methods share the weekly New York gate.
await expectSkipped("2026-08-09T02:59:00Z", "GET")
await expectSkipped("2026-08-09T02:59:00Z", "POST")
await expectExecuted("2026-08-09T03:59:00Z", "GET")
await expectExecuted("2026-08-09T03:59:00Z", "POST")

delete process.env.CRON_SECRET
financialCalls = []
for (const method of ["GET", "POST"]) {
  assert.equal((await payoutCronResponse(authorized(method), deps, new Date("2026-08-09T03:59:00Z"))).status, 401)
  assert.deepEqual(financialCalls, [])
}
process.env.CRON_SECRET = "secret"
for (const method of ["GET", "POST"]) assert.equal((await payoutCronResponse(new Request("http://x", { method, headers: { authorization: "Bearer wrong" } }), deps, new Date("2026-08-09T03:59:00Z"))).status, 401)

process.env.PAYMENT_V2_PAYOUT_EXECUTION_ENABLED = "false"
for (const method of ["GET", "POST"]) assert.equal((await payoutCronResponse(authorized(method), deps, new Date("2026-08-09T03:59:00Z"))).status, 503)
process.env.PAYMENT_V2_PAYOUT_EXECUTION_ENABLED = "true"

const source = readFileSync("app/api/admin/affiliate-payouts/execute/route.ts", "utf8")
assert.match(source, /export const GET=\(request:Request\)=>payoutCronResponse\(request\);\s*export const POST=\(request:Request\)=>payoutCronResponse\(request\);/, "GET and POST use the same payout cron gate")
assert.match(source, /result\.status===200&&result\.body\.status==="received"/, "payout-time recurring proof requires received, not ignored")
assert.doesNotMatch(source, /affiliate_ledger\(payment_v2_recurring_invoice_id\)/, "payout loader does not join affiliate_ledger")
assert.match(source, /execution_status,recurring_invoice_id"\)\.in/, "payout loader selects recurring_invoice_id from affiliate_payout_items")
assert.match(source, /payment_v2_recurring_invoice_id:x\.recurring_invoice_id/, "payout item maps the frozen recurring identity directly")

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"))
assert.equal(vercel.version, 2)
assert.deepEqual(vercel.crons, [
  { path: "/api/admin/affiliate-payouts/execute", schedule: "59 3 * * 0" },
  { path: "/api/admin/affiliate-payouts/execute", schedule: "59 4 * * 0" },
])

process.env = old
console.log("PFC-CORE-03E payout cron route passed (summer, winter, no-op, auth, POST, and Vercel contracts).")
