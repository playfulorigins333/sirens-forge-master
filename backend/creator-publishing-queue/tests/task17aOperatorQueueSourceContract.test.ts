import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const migrationPath = 'supabase/migrations/20260712001400_creator_publishing_onlyfans_operator_queue.sql'
const migration = () => readFileSync(migrationPath, 'utf8')

test('Task 17A migration extends the existing queue task table and adds no second operator-task table', () => {
  const src = migration()
  assert.match(src, /alter table public\.creator_publishing_queue_tasks/)
  assert.match(src, /add column if not exists claim_token uuid/)
  assert.match(src, /add column if not exists claim_expires_at timestamptz/)
  assert.match(src, /operator_progress_state text not null default 'not_started'/)
  assert.doesNotMatch(src, /create table[^;]+operator[_-]?tasks/i)
})

test('claim ownership is complete, bounded, and never uses assigned_operator_id', () => {
  const src = migration()
  assert.match(src, /status = 'claimed' and claimed_by is not null and claimed_at is not null and claim_token is not null and claim_expires_at is not null/)
  assert.match(src, /status <> 'claimed' and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null/)
  assert.match(src, /claim_attempt_count >= 0/)
  assert.match(src, /interval '30 minutes'/)
  assert.doesNotMatch(src, /set[^;]*assigned_operator_id/i)
  assert.doesNotMatch(src, /assigned_operator_id\s*=/i)
})

test('creator-specific OnlyFans authorization is required and global roles are not authorization', () => {
  const src = migration()
  assert.match(src, /creator_publishing_operator_authorizations/)
  assert.match(src, /platform text not null check \(platform = 'onlyfans'\)/)
  assert.match(src, /a\.creator_id=p_creator_id and a\.operator_id=p_operator_id and a\.platform='onlyfans' and a\.status='active'/)
  assert.doesNotMatch(src, /creator_publishing_trusted_reviewers|global_operator|global role|reviewer role/i)
})

test('RPC gates cover Task 17A trusted validation categories and lock job before queue task', () => {
  const src = migration()
  for (const token of [
    'creator_publishing_platform_capabilities', 'availability_status=\'available\'', 'publishing_mode <> \'assisted\'',
    'cancelled_at is not null', 'creator_publishing_creator_verifications', 'creator_platform_accounts',
    'verification_status=\'verified\'', 'creator_publishing_ai_twin_consents', 'creator_approval_status<>\'approved\'',
    'creator_publishing_compliance_reviews', 'review_source=\'automated\'', 'later.outcome in',
    'creator_publishing_co_performer_records', 'creator_publishing_autopost_source_fingerprint',
    'ACTIVE_PUBLICATION_JOB_CONFLICT', 'OPERATOR_NOT_DUE', 'OPERATOR_TASK_ALREADY_CLAIMED'
  ]) assert.match(src, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(src, /select \* into v_job from public\.creator_publishing_platform_jobs where id=p_platform_job_id for update;[\s\S]+select \* into v_task from public\.creator_publishing_queue_tasks where id=p_queue_task_id for update;/)
})

test('migration 01400 redefines exact Task 15 functions with valid-claim compatibility and publish-due preservation', () => {
  const src = migration()
  assert.match(src, /create or replace function public\.creator_publishing_schedule_plan\(\s*p_creator_id uuid,\s*p_publishing_plan_id uuid,\s*p_intended_publish_at timestamptz,/)
  assert.match(src, /create or replace function public\.creator_publishing_process_scheduler_event\(p_event_id uuid, p_lock_token uuid, p_current_ai_twin_consent_version text, p_current_attestation_text_sha256 text\)/)
  assert.match(src, /creator_publishing_task17a_queue_task_compatible/)
  assert.match(src, /q\.status = 'claimed'[\s\S]+q\.claim_expires_at > p_now[\s\S]+creator_publishing_onlyfans_operator_authorized/)
  assert.match(src, /and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null/)
  assert.match(src, /case when event_rec\.event_type='operator_due' then 'awaiting_operator' else 'due_now' end/)
})

test('Task 17A does not introduce Task 18 states, platform automation, loaders, or credential material', () => {
  const src = migration()
  for (const bad of ['awaiting_post_confirmation','scheduled_on_platform','final_post_url =','proof_screenshot_storage_key =','onlyfans.com','puppeteer','playwright','selenium','webdriver','access_token','refresh_token','password','cookie','session']) {
    assert.doesNotMatch(src, new RegExp(bad, 'i'))
  }
  assert.doesNotMatch(src, /page loader|on select|browser automation|scrap/i)
})

test('protected files and earlier migrations remain bounded', () => {
  const migrations = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()
  assert.ok(migrations.includes('20260712001400_creator_publishing_onlyfans_operator_queue.sql'))
  assert.ok(migrations.includes('20260710000100_creator_publishing_queue_foundation.sql'))
  assert.ok(migrations.includes('20260711001300_creator_publishing_scheduler_due_state.sql'))
  assert.match(readFileSync('backend/creator-publishing-queue/tests/task15PostgresIntegration.sql','utf8'), /claim_token.*90000000-0000-4000-8000-000000000666/s)
  assert.doesNotMatch(readFileSync('vercel.json','utf8'), /task17a|operator-queue/i)
  assert.doesNotMatch(readFileSync('app/api/autopost/run/route.ts','utf8'), /task17a|operator/i)
})
