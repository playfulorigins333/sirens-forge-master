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
  assert.match(migration, /creator_publishing_operator_queue_is_clean/);
  assert.match(migration, /if not public\.creator_publishing_operator_queue_is_clean\(task\) then raise exception 'OPERATOR_TASK_INELIGIBLE'/);
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
    String.raw`creator_publishing_operator_queue_is_clean\(public\.creator_publishing_queue_tasks\)`,
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


test('Task 17A current Task 17A scenario labels are present and runner emits non-final marker', () => {
  const scenarioFiles = [
    'backend/creator-publishing-queue/tests/task17aPostgresIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aAuthorizationTimingIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aIdempotencyRecoveryIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aSafetyGatesIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aSchedulerCompatibilityIntegration.sql',
  ];
  const scenarioSource = scenarioFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  const requiredLabels = [
    'ownership_creator_claim',
    'claim_audit_prior_status_matrix',
    'runtime_privilege_assertions',
    'authorization_creator_claim',
    'idempotency_claim_replay',
    'expired_claim_fixture_valid',
    'recovery_select_no_mutation',
    'explicit_recovery_authorized_operator',
    'recovery_active_claim_rejected',
    'release_identity_rejections',
    'manual_result_evidence_blocks_release_recovery_and_progress',
    'manual_result_field_posted_by',
    'manual_result_field_posted_at',
    'manual_result_field_posted_confirmation',
    'manual_result_field_final_post_url',
    'manual_result_field_final_post_url_skip_reason',
    'manual_result_field_proof_screenshot_storage_key',
    'manual_result_field_skip_or_fail_reason',
    'recovery_deterministic_errors',
    'safety_capability_unavailable',
    'duplicate_task_unique_index_boundary',
    'duplicate_task_rpc_ambiguity',
    'account_missing_foreign_key_boundary',
    'account_missing_defensive_rpc_boundary',
    'safety_account_unverified',
    'safety_consent_revoked',
    'active_publication_unique_index_boundary',
    'active_publication_defensive_rpc_boundary',
    'safety_compliance_later_manual_review_rejected',
    'safety_manual_result_claim_rejected',
    'scheduler_operator_due_ready',
    'scheduler_terminal_blocked_superseded',
    'scheduler_terminal_cancelled_superseded',
    'claim_queue_status_draft_rejected',
    'claim_queue_status_needs_compliance_review_rejected',
    'claim_queue_status_needs_creator_approval_rejected',
    'claim_queue_status_needs_fix_rejected',
    'claim_queue_status_blocked_rejected',
    'claim_queue_status_skipped_rejected',
    'claim_queue_status_failed_manual_upload_rejected',
    'claim_queue_status_archived_rejected',
    'claim_queue_status_confirmed_posted_manual_rejected',
    'claim_job_state_needs_fix_rejected',
    'claim_job_state_authentication_required_rejected',
    'claim_job_state_platform_rejected_rejected',
    'claim_job_state_blocked_rejected',
    'claim_job_state_archived_rejected',
    'claim_job_state_published_direct_rejected',
    'claim_job_state_confirmed_posted_manual_rejected',
    'claim_job_state_direct_publish_failed_rejected',
    'claim_job_state_exported_rejected',
    'claim_job_state_skipped_rejected',
    'claim_job_cancelled_rejected',
  ];
  for (const label of requiredLabels) {
    assert.match(scenarioSource, new RegExp(`TASK17A_SCENARIO_START: ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  const runner = readFileSync('backend/creator-publishing-queue/tests/runTask17aPostgresIntegration.mjs', 'utf8');
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(runner, /task15 regression post-01400/);
  assert.match(runner, /runTask17aConcurrency\.mjs/);
  assert.match(runner, /TASK17A_CURRENT_SCENARIOS_PASSED/);
});


test('Task 17A fixture seeds are unique and scheduler namespace is isolated', () => {
  const scenarioFiles = [
    'backend/creator-publishing-queue/tests/task17aPostgresIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aAuthorizationTimingIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aIdempotencyRecoveryIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aSafetyGatesIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aSchedulerCompatibilityIntegration.sql',
  ];
  const helperPattern = /\b(reset_fixture|create_secondary_work|assert_claim_rejected|assert_claim_queue_status_rejected|assert_claim_job_state_rejected|assert_manual_result_field_blocks|run_scheduler_transition|assert_terminal_scheduler_superseded)\s*\(\s*(\d{6})\b/g;
  const reserved = new Map<number, string>();
  for (const file of scenarioFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(helperPattern)) {
      const helper = match[1];
      const seed = Number(match[2]);
      const claimedSeeds = helper === 'assert_manual_result_field_blocks' ? [seed, seed + 1000] : [seed];
      for (const claimedSeed of claimedSeeds) {
        const current = `${file}:${helper}(${seed})`;
        const prior = reserved.get(claimedSeed);
        assert.equal(prior, undefined, `duplicate Task 17A fixture seed ${claimedSeed}: first ${prior}, second ${current}`);
        reserved.set(claimedSeed, current);
      }
    }
  }
  const scheduler = readFileSync('backend/creator-publishing-queue/tests/task17aSchedulerCompatibilityIntegration.sql', 'utf8');
  assert.match(scheduler, /reset_fixture\(926001/);
  assert.match(scheduler, /run_scheduler_transition\(926101/);
  assert.doesNotMatch(scheduler, /reset_fixture\(924/);
  assert.doesNotMatch(scheduler, /924\d{2}00-0000-4000-8000-/);
  const idempotencyRecovery = readFileSync('backend/creator-publishing-queue/tests/task17aIdempotencyRecoveryIntegration.sql', 'utf8');
  assert.match(idempotencyRecovery, /assert_manual_result_field_blocks\(924001/);
  assert.match(idempotencyRecovery, /seed \+ 1000/);
  const runner = readFileSync('backend/creator-publishing-queue/tests/runTask17aPostgresIntegration.mjs', 'utf8');
  assert.match(runner, /TASK17A_CURRENT_SCENARIOS_PASSED/);
  assert.doesNotMatch(runner, /TASK17A_BEHAVIORAL_COVERAGE_COMPLETE/);
});

test('prohibited Task 17B, Task 18, platform, and deployment work is absent', () => {
  assert.doesNotMatch(migration, /final_post_url\s*=|scheduled_on_platform\s*=|awaiting_post_confirmation\s*=/i);
  assert.doesNotMatch(migration, /fetch\(|playwright|puppeteer|onlyfans\.com/i);
  assert.doesNotMatch(appSource, /task17a[\s\S]*(operator.*loader|onlyfans.*download|\/api\/autopost\/run|vercel.*cron)/i);
});
