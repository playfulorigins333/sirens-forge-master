import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const migrationPath = 'supabase/migrations/20260711001300_creator_publishing_scheduler_due_state.sql'
const migration = () => readFileSync(migrationPath, 'utf8')

test('Task 15 migration preserves helper key policy exactly and repairs ambiguity', () => {
  const src = migration()
  const keys = ['password','access_token','refresh_token','auth_token','session','session_id','cookie','cookies','two_factor_secret','recovery_code','platform_secret']
  for (const key of keys) assert.match(src, new RegExp(`'${key}'`))
  for (const added of ['api_key','apikey','authorization','credential','credentials','secret']) assert.doesNotMatch(src, new RegExp(`'${added}'`))
  assert.match(src, /create or replace function public\.creator_publishing_queue_jsonb_has_forbidden_credential_key\(value jsonb\)/)
  assert.match(src, /#variable_conflict error/)
  assert.match(src, /jsonb_each\(\$1\) as object_source\(key, value\)/)
  assert.match(src, /jsonb_array_elements\(\$1\) as array_source\(value\)/)
})

test('Task 15 database contracts include final overrides and no application layer', () => {
  const src = migration()
  assert.match(src, /schedule_revision integer[,\n]/)
  assert.doesNotMatch(src, /schedule_revision integer not null default 0/i)
  assert.match(src, /creator_publishing_jobs_id_plan_creator_unique unique \(id, publishing_plan_id, creator_id\)/)
  assert.match(src, /foreign key \(platform_job_id, publishing_plan_id, creator_id\)/)
  assert.match(src, /create trigger trg_creator_publishing_scheduler_events_updated_at/)
  assert.match(src, /p_expected_ai_twin_consent_version text/)
  assert.match(src, /p_expected_ai_twin_consent_text_sha256 text/)
  assert.match(src, /event_source\.status = 'pending'[\s\S]+or[\s\S]+event_source\.status = 'processing'/)
  assert.match(src, /claim_audits as \(/)
  assert.doesNotMatch(src, /create temp table/i)
  assert.doesNotMatch(src, /fetch\(|onlyfans\.com|fansly\.com|fanvue\.com|browser automation/i)
})

test('Task 15 pass 1 does not modify application cron files', () => {
  const vercel = readFileSync('vercel.json','utf8')
  const runRoute = readFileSync('app/api/autopost/run/route.ts','utf8')
  assert.match(vercel, /"path": "\/api\/autopost\/run"/)
  assert.doesNotMatch(vercel, /creator-publishing-queue\/scheduler/)
  assert.match(runRoute, /AUTOPOST JOB FOUNDATION RUNNER/)
})
