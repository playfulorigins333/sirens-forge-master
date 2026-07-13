import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const baseSha = '3ba031511782eec922ed284fb472d7435d7b6e18';
const migrationPath = 'supabase/migrations/20260712001400_creator_publishing_onlyfans_operator_queue.sql';
const migration = readFileSync(migrationPath, 'utf8');
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}
const changedFiles = execSync(`git diff --name-only ${baseSha}...HEAD`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const appSource = changedFiles
  .filter((f) => /^(app|backend|\.github\/workflows)/.test(f) && !f.includes('tests/task17a') && existsSync(f))
  .map((f) => `${f}\n${readFileSync(f, 'utf8')}`).join('\n');

test('Task 17A migration exists and migrations 00100 through 01300 are unchanged from base', () => {
  assert.equal(existsSync(migrationPath), true);
  assert.equal(changedFiles.some((f) => /^supabase\/migrations\/2026071[01].*\.sql$/.test(f) && !f.endsWith('20260712001400_creator_publishing_onlyfans_operator_queue.sql')), false);
});

test('extends existing queue task table without a second operator-task table', () => {
  assert.match(migration, /alter table public\.creator_publishing_queue_tasks[\s\S]*claim_token uuid/);
  assert.doesNotMatch(migration, /create table[^;]+operator_tasks/i);
  assert.match(migration, /claimed_by[\s\S]*claimed_at[\s\S]*claim_token[\s\S]*claim_expires_at/);
  assert.doesNotMatch(migration, /set\s+assigned_operator_id\s*=/i);
  assert.match(migration, /interval '30 minutes'/);
});

test('authorization, idempotency, locks, and trusted RPC contracts exist', () => {
  assert.match(migration, /create table if not exists public\.creator_publishing_operator_authorizations/);
  assert.match(migration, /creator_id<>operator_id|creator_id <> operator_id/);
  assert.match(migration, /status in \('active','revoked'\)/);
  assert.match(migration, /creator_publishing_operator_is_authorized/);
  assert.doesNotMatch(migration, /creator_publishing_trusted_reviewers[\s\S]*authorized/i);
  assert.match(migration, /create table if not exists public\.creator_publishing_operator_action_idempotency/);
  assert.match(migration, /\^\[A-Za-z0-9_-\]\{8,128\}\$/);
  assert.match(migration, /extensions\.digest\(p::text,'sha256'\)/);
  assert.doesNotMatch(migration, /[^.]digest\(p::text,'sha256'\)/);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*creator_operator_idempotency/);
  assert.match(migration, /from public\.creator_publishing_platform_jobs where id=p_platform_job_id for update[\s\S]*from public\.creator_publishing_queue_tasks where id=p_queue_task_id for update/);
  assert.match(migration, /p_expected_ai_twin_consent_version/);
  assert.match(migration, /p_expected_attestation_text_sha256/);
  assert.match(migration, /creator_publishing_operator_current_safety_gate/);
  assert.match(migration, /review_source='automated'[\s\S]*outcome='pass'/);
  assert.match(migration, /review_source='human'[\s\S]*outcome='escalate'[\s\S]*escalated_approval_reason/);
  assert.match(migration, /outcome in \('block','manual_review'\)/);
  assert.match(migration, /if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'/);
  assert.match(migration, /if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'/);
  assert.match(migration, /before_state[\s\S]*prior_task\.status[\s\S]*prior_task\.operator_progress_revision[\s\S]*prior_task\.assigned_operator_id/);
});

test('audit inserts use real audit schema and idempotency inserts use explicit columns', () => {
  assert.doesNotMatch(migration, /creator_publishing_audit_events\([^)]*metadata/i);
  assert.match(migration, /entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at/);
  assert.doesNotMatch(migration, /insert into public\.creator_publishing_operator_action_idempotency values/i);
});

test('Task 15 compatibility is narrow and active claims are preserved', () => {
  assert.match(migration, /create or replace function public\.creator_publishing_schedule_plan/);
  assert.match(migration, /create or replace function public\.creator_publishing_process_scheduler_event/);
  assert.doesNotMatch(migration, /create or replace function public\.creator_publishing_cancel_plan_schedule/);
  assert.doesNotMatch(migration, /create or replace function public\.creator_publishing_cancel_job_schedule/);
  assert.doesNotMatch(migration, /create or replace function public\.creator_publishing_claim_due_scheduler_events/);
  assert.match(migration, /status='claimed'/);
  assert.match(migration, /claim_expires_at > v_now/);
  assert.match(migration, /when event_rec\.event_type='operator_due'/);
  assert.match(migration, /when event_rec\.event_type='publish_due'/);
});


test('internal helpers are not executable by browser roles and action RPCs remain service-role only', () => {
  for (const signature of [
    String.raw`creator_publishing_operator_validate_idempotency_key\(text\)`,
    String.raw`creator_publishing_operator_is_authorized\(uuid,uuid,text\)`,
    String.raw`creator_publishing_operator_current_safety_gate\(public\.creator_publishing_platform_jobs,public\.creator_publishing_queue_tasks,uuid,text,text\)`,
    String.raw`creator_publishing_operator_restore_queue_status\(public\.creator_publishing_platform_jobs,timestamptz\)`,
    String.raw`creator_publishing_operator_request_fingerprint\(jsonb\)`,
    String.raw`creator_publishing_operator_replay_or_conflict\(uuid,text,text,text\)`,
  ]) {
    assert.match(migration, new RegExp(String.raw`revoke all on function public\.${signature} from public, anon, authenticated`));
  }
  for (const signature of [
    String.raw`creator_publishing_claim_onlyfans_operator_task\(uuid,uuid,uuid,text,text,text\)`,
    String.raw`creator_publishing_release_onlyfans_operator_task\(uuid,uuid,uuid,uuid,text\)`,
    String.raw`creator_publishing_update_onlyfans_operator_progress\(uuid,uuid,uuid,uuid,text,integer,text,text,text,text\)`,
    String.raw`creator_publishing_recover_expired_onlyfans_operator_claim\(uuid,uuid,uuid,text\)`,
  ]) {
    assert.match(migration, new RegExp(String.raw`revoke all on function public\.${signature} from public, anon, authenticated`));
    assert.match(migration, new RegExp(String.raw`grant execute on function public\.${signature} to service_role`));
  }
});

test('prohibited Task 17B, Task 18, platform, and deployment work is absent', () => {
  assert.doesNotMatch(migration, /final_post_url\s*=|scheduled_on_platform\s*=|awaiting_post_confirmation\s*=/i);
  assert.doesNotMatch(migration, /fetch\(|playwright|puppeteer|onlyfans\.com/i);
  assert.doesNotMatch(appSource, /task17a[\s\S]*(operator.*loader|onlyfans.*download|\/api\/autopost\/run|vercel.*cron)/i);
});
