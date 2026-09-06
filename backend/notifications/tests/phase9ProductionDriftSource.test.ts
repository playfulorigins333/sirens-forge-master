import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const repair = fs.readFileSync("supabase/migrations/20260906035900_phase9_account_deletion_notification_contract_repair.sql", "utf8")
const phase9 = fs.readFileSync("supabase/migrations/20260906040000_phase9_transactional_notifications.sql", "utf8")
const setup = fs.readFileSync("backend/notifications/tests/phase9PostgresSetup.sql", "utf8")
const runner = fs.readFileSync("backend/notifications/tests/runPhase9Postgres.mjs", "utf8")

test("production drift repair restores account-deletion notification marker columns before Phase 9", () => {
  for (const column of ["requested_notification_due_at", "reactivated_notification_due_at", "completed_notification_due_at"]) {
    assert.match(repair, new RegExp(`add column if not exists ${column} timestamptz`, "i"))
  }
  assert.ok("20260906035900_phase9_account_deletion_notification_contract_repair.sql" < "20260906040000_phase9_transactional_notifications.sql")
})

test("repair derives markers only from authoritative lifecycle timestamps", () => {
  assert.match(repair, /requested_notification_due_at\s*:=\s*new\.requested_at/i)
  assert.match(repair, /reactivated_notification_due_at\s*:=\s*new\.reactivated_at/i)
  assert.match(repair, /set requested_notification_due_at\s*=\s*requested_at/i)
  assert.match(repair, /set reactivated_notification_due_at\s*=\s*reactivated_at/i)
  assert.doesNotMatch(repair, /requested_notification_due_at\s*=\s*clock_timestamp\(\)/i)
  assert.doesNotMatch(repair, /reactivated_notification_due_at\s*=\s*clock_timestamp\(\)/i)
  assert.doesNotMatch(repair, /send_email|resend|deliver_notification/i)
})

test("Phase 9 still owns completion marker production from purge completion evidence", () => {
  assert.match(phase9, /completed_notification_due_at:=new\.purge_completed_at/i)
  assert.match(phase9, /set completed_notification_due_at=purge_completed_at/i)
})

test("Postgres fixture reproduces Production drift instead of pre-creating repaired columns", () => {
  const accountCreate = setup.match(/create table public\.account_deletion_requests\([^;]+;/i)?.[0] ?? ""
  assert.ok(accountCreate)
  assert.doesNotMatch(accountCreate, /requested_notification_due_at|reactivated_notification_due_at|completed_notification_due_at/i)
  assert.match(runner, /20260906035900_phase9_account_deletion_notification_contract_repair\.sql/)
})
