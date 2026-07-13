import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migrationPath = "supabase/migrations/20260712001400_creator_publishing_onlyfans_operator_queue.sql"
const migration = () => readFileSync(migrationPath, "utf8")

const functionBlock = (source: string, name: string) => {
  const start = source.indexOf(`create or replace function public.${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = source.indexOf("\ncreate or replace function public.", start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test("Task 17A extends the existing queue and does not create a second operator-task table", () => {
  const src = migration()
  assert.match(src, /alter table public\.creator_publishing_queue_tasks[\s\S]+claim_token uuid/)
  assert.match(src, /claim_expires_at timestamptz/)
  assert.match(src, /claim_attempts integer not null default 0/)
  assert.match(src, /operator_progress_state text not null default 'not_started'/)
  assert.doesNotMatch(src, /create table if not exists public\.creator_publishing_(?:onlyfans_)?operator_tasks\b/)
})

test("active claim ownership uses only the four approved claim fields", () => {
  const src = migration()
  for (const field of ["claimed_by", "claimed_at", "claim_token", "claim_expires_at"]) assert.match(src, new RegExp(`\\b${field}\\b`))
  assert.match(src, /Active claim ownership is represented only by claimed_by, claimed_at, claim_token, and claim_expires_at/)
  assert.doesNotMatch(src, /set[\s\S]{0,120}assigned_operator_id\s*=/i)
})

test("creator-specific authorization is required and global role membership is not consulted", () => {
  const src = functionBlock(migration(), "creator_publishing_onlyfans_operator_is_authorized")
  assert.match(src, /p_creator_id\s*=\s*p_operator_id/)
  assert.match(src, /creator_publishing_operator_authorizations/)
  assert.match(src, /platform\s*=\s*'onlyfans'/)
  assert.match(src, /status\s*=\s*'active'/)
  assert.doesNotMatch(src, /creator_publishing_trusted_reviewers/)
})

test("claim rules distinguish unscheduled ready work from scheduled operator due work", () => {
  const src = functionBlock(migration(), "creator_publishing_claim_onlyfans_operator_task")
  assert.match(src, /job_rec\.schedule_revision is null[\s\S]+queue_rec\.status\s*<>\s*'ready_for_handoff'/)
  assert.match(src, /job_rec\.operator_due_at is null or job_rec\.operator_due_at\s*>\s*v_now[\s\S]+OPERATOR_NOT_DUE/)
  assert.doesNotMatch(src, /assigned_operator_id\s*=/)
})

test("ordinary Task 17A RPCs cannot write Task 18 confirmation state", () => {
  const src = migration()
  for (const functionName of [
    "creator_publishing_claim_onlyfans_operator_task",
    "creator_publishing_release_onlyfans_operator_task",
    "creator_publishing_update_onlyfans_operator_progress",
    "creator_publishing_recover_expired_onlyfans_operator_claim",
  ]) {
    const block = functionBlock(src, functionName)
    assert.doesNotMatch(block, /set[\s\S]{0,160}(posted_by|posted_at|posted_confirmation|final_post_url|final_post_url_skip_reason|proof_screenshot_storage_key)\s*=/i)
    assert.doesNotMatch(block, /set[\s\S]{0,160}status\s*=\s*'(scheduled_on_platform|awaiting_post_confirmation|confirmed_posted_manual)'/i)
  }
})

test("Task 15 compatibility is a narrow wrapper around the preserved Task 15 function", () => {
  const src = migration()
  assert.match(src, /alter function public\.creator_publishing_process_scheduler_event\(uuid,uuid,text,text\)[\s\S]+rename to creator_publishing_process_scheduler_event_task15/)
  const wrapper = functionBlock(src, "creator_publishing_process_scheduler_event")
  assert.match(wrapper, /creator_publishing_process_scheduler_event_task15\(/)
  assert.match(wrapper, /v_valid_active_claim/)
  assert.match(wrapper, /claim_expires_at\s*>\s*v_now/)
  assert.match(wrapper, /creator_publishing_onlyfans_operator_is_authorized/)
  assert.match(wrapper, /set status\s*=\s*'claimed',[\s\S]+claim_token\s*=\s*v_claim_token[\s\S]+claim_expires_at\s*=\s*v_claim_expires_at/)
  assert.doesNotMatch(wrapper, /update public\.creator_publishing_platform_jobs/)
  assert.doesNotMatch(wrapper, /update public\.creator_publishing_plans/)
  assert.doesNotMatch(wrapper, /update public\.creator_publishing_scheduler_events/)
})

test("Task 17A contains no platform access, browser automation, Fanvue mutation, or cron work", () => {
  const src = migration().toLowerCase()
  for (const prohibited of [
    "onlyfans.com",
    "fetch(",
    "axios",
    "playwright",
    "puppeteer",
    "webdriver",
    "access_token",
    "refresh_token",
    "session_id",
    "recovery_code",
    "two_factor_secret",
    "/api/autopost/run",
    "vercel.json",
  ]) assert.equal(src.includes(prohibited), false, `migration must not contain ${prohibited}`)
  assert.doesNotMatch(src, /update\s+public\.creator_publishing_platform_capabilities[\s\S]+fanvue/)
})

test("Task 17A RPCs and tables are service-role only", () => {
  const src = migration()
  for (const name of [
    "creator_publishing_claim_onlyfans_operator_task",
    "creator_publishing_release_onlyfans_operator_task",
    "creator_publishing_update_onlyfans_operator_progress",
    "creator_publishing_recover_expired_onlyfans_operator_claim",
  ]) {
    assert.match(src, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated`))
    assert.match(src, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`))
  }
})
