import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const migrationPath = 'supabase/migrations/20260712001400_creator_publishing_onlyfans_operator_queue.sql'
const migration = () => readFileSync(migrationPath, 'utf8')

test('Task 17A migration exists and extends the existing queue task table only', () => {
  const src = migration()
  assert.match(src, /alter table public\.creator_publishing_queue_tasks/) 
  assert.match(src, /add column if not exists claim_token uuid/) 
  assert.match(src, /add column if not exists claim_expires_at timestamptz/) 
  assert.match(src, /operator_progress_state text not null default 'not_started'/)
  assert.doesNotMatch(src, /create table[^;]+operator[_-]?tasks/i)
  assert.match(src, /creator_publishing_operator_authorizations/)
  assert.match(src, /creator_publishing_operator_action_idempotency/)
})

test('Task 17A active ownership uses only the approved fields and preserves assigned_operator_id', () => {
  const src = migration()
  assert.match(src, /claimed_by is not null and claimed_at is not null and claim_token is not null and claim_expires_at is not null/)
  assert.doesNotMatch(src, /set[^;]*assigned_operator_id/i)
  assert.doesNotMatch(src, /assigned_operator_id\s*=/i)
  assert.match(src, /claim_attempt_count >= 0/)
  assert.match(src, /interval '30 minutes'/)
})

test('Task 17A requires creator-specific OnlyFans authorization and not global roles', () => {
  const src = migration()
  assert.match(src, /platform text not null check \(platform = 'onlyfans'\)/)
  assert.match(src, /creator_id=p_creator_id and a\.operator_id=p_operator_id and a\.platform='onlyfans' and a\.status='active'/)
  assert.doesNotMatch(src, /creator_publishing_trusted_reviewers|global_operator|reviewer role/i)
})

test('Task 17A enforces due timing, no loader recovery, no Task 18/platform automation', () => {
  const src = migration()
  assert.match(src, /v_job\.operator_due_at is null or v_job\.operator_due_at > v_now/) 
  assert.match(src, /raise exception 'OPERATOR_NOT_DUE'/)
  assert.match(src, /v_job\.schedule_revision is null[\s\S]+ready_for_handoff/)
  assert.doesNotMatch(src, /page loader|on select/i)
  for (const bad of ['scheduled_on_platform','awaiting_post_confirmation','awaiting_post_confirmation','final_post_url =','proof_screenshot_storage_key =','onlyfans.com','puppeteer','playwright','selenium','webdriver','cookie','session','access_token','password']) {
    assert.doesNotMatch(src, new RegExp(bad, 'i'))
  }
})

test('Task 17A does not modify protected files or earlier migrations', () => {
  const migrations = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()
  assert.ok(migrations.includes('20260712001400_creator_publishing_onlyfans_operator_queue.sql'))
  assert.ok(migrations.includes('20260710000100_creator_publishing_queue_foundation.sql'))
  assert.ok(migrations.includes('20260711001300_creator_publishing_scheduler_due_state.sql'))
  const pkg = readFileSync('package.json','utf8')
  assert.match(pkg, /test:creator-publishing-task17a-postgres/)
  assert.doesNotMatch(readFileSync('vercel.json','utf8'), /task17a|operator-queue/i)
  assert.doesNotMatch(readFileSync('app/api/autopost/run/route.ts','utf8'), /task17a|operator/i)
})
