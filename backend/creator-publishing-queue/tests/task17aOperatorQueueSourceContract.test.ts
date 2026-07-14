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

test('migration 01400 fails fast on legacy claimed queue rows before DDL', () => {
  const preflight = migration.indexOf('TASK17A_LEGACY_CLAIMED_ROWS_REQUIRE_REMEDIATION');
  const firstDdl = migration.indexOf('create extension if not exists pgcrypto');
  assert.notEqual(preflight, -1);
  assert.ok(preflight < firstDdl);
  assert.match(migration, /status='claimed' or claimed_by is not null or claimed_at is not null/);
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
  assert.match(migration, /create or replace function public\.creator_publishing_cancel_plan_schedule/);
  assert.match(migration, /create or replace function public\.creator_publishing_cancel_job_schedule/);
  assert.match(migration, /creator_publishing_cancel_task17a_queue_claims/);
  assert.match(migration, /operator_task_claim_cleared_by_scheduler_gate/);
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
    'backend/creator-publishing-queue/tests/task17aProgressMatrixIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aReleaseMatrixIntegration.sql',
  ];
  const scenarioSource = scenarioFiles.map((file) => readFileSync(file, 'utf8')).join('\n') + '\n' + readFileSync('backend/creator-publishing-queue/tests/runTask17aUpgradeIntegration.mjs', 'utf8') + '\n' + readFileSync('backend/creator-publishing-queue/tests/runTask17aCancellationConcurrency.mjs', 'utf8');
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
    'in_claim_recovery_replacement_success',
    'in_claim_recovery_not_due_structured',
    'in_claim_recovery_safety_drift_structured',
    'in_claim_recovery_duplicate_task_structured',
    'cancel_job_active_claim_cleanup',
    'cancel_job_terminal_no_false_cleanup',
    'scheduler_claim_cleanup_authorization_revoked',
    'scheduler_claim_cleanup_claim_expired',
    'scheduler_claim_cleanup_consent_revoked',
    'scheduler_claim_cleanup_source_stale',
    'scheduler_claim_cleanup_creator_verification_revoked',
    'scheduler_claim_cleanup_account_revoked',
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

    'clean_01300_to_01400_upgrade',
    'legacy_ownership_claimed_full_preflight',
    'legacy_ownership_claimed_missing_both_preflight',
    'legacy_ownership_claimed_missing_claimed_at_preflight',
    'legacy_ownership_claimed_missing_claimed_by_preflight',
    'legacy_ownership_nonclaimed_claimed_by_preflight',
    'legacy_ownership_nonclaimed_claimed_at_preflight',
    'legacy_ownership_nonclaimed_both_preflight',
    'cancel_job_changed_job_conflict',
    'cancel_job_expired_claim_cleanup',
    'cancel_job_unclaimed_cleanup',
    'cancel_job_after_expired_recovery_cleanup',
    'cancel_job_non_onlyfans_assisted_exclusion',
    'cancel_plan_multi_job_cleanup',
    'cancel_plan_replay',
    'cancel_plan_changed_reason_conflict',
    'cancel_plan_changed_plan_conflict',
    'claim_vs_job_cancel_concurrency',
    'claim_vs_plan_cancel_concurrency',
    'recovery_vs_job_cancel_concurrency',
    'progress_valid_transition_sequence',
    'progress_exact_replay',
    'progress_request_invalid',
    'progress_missing_job',
    'progress_missing_task',
    'progress_task_job_mismatch',
    'progress_unsupported_target_or_mode',
    'progress_cancelled_job',
    'progress_ineligible_job_state',
    'progress_unauthorized_actor',
    'progress_revoked_authorization',
    'progress_wrong_owner',
    'progress_wrong_token',
    'progress_expired_token',
    'progress_stale_expected_state',
    'progress_stale_expected_revision',
    'progress_invalid_transition',
    'progress_creator_verification_drift',
    'progress_account_verification_drift',
    'progress_account_revoked_drift',
    'progress_consent_drift',
    'progress_compliance_drift',
    'progress_source_fingerprint_drift',
    'progress_changed_task_idempotency_conflict',
    'progress_changed_job_idempotency_conflict',
    'progress_changed_token_idempotency_conflict',
    'progress_changed_expected_state_idempotency_conflict',
    'progress_changed_expected_revision_idempotency_conflict',
    'progress_changed_target_state_idempotency_conflict',
    'progress_changed_consent_version_idempotency_conflict',
    'progress_changed_consent_hash_idempotency_conflict',
    'progress_complete_audit_idempotency_counts',
    'progress_complete_no_mutation_assertions',
    'release_restore_unscheduled_ready',
    'release_restore_before_operator_due',
    'release_restore_after_operator_due',
    'release_restore_after_publish_due',
    'release_exact_replay',
    'release_request_invalid',
    'release_missing_job',
    'release_missing_task',
    'release_task_job_mismatch',
    'release_unsupported_target_or_mode',
    'release_cancelled_job',
    'release_ineligible_job_state',
    'release_not_claimed',
    'release_unauthorized_actor',
    'release_revoked_authorization',
    'release_wrong_owner',
    'release_wrong_token',
    'release_expired_token',
    'release_manual_result_evidence_rejected',
    'release_changed_task_idempotency_conflict',
    'release_changed_job_idempotency_conflict',
    'release_changed_token_idempotency_conflict',
    'release_drift_missing_intended_publish_at',
    'release_drift_missing_operator_due_at',
    'release_drift_missing_timezone',
    'release_drift_blank_timezone',
    'release_drift_missing_scheduled_at',
    'release_drift_missing_scheduled_by',
    'release_drift_zero_schedule_revision',
    'release_drift_negative_schedule_revision',
    'release_drift_operator_offset_not_60_minutes',
    'release_drift_job_state_inconsistent_with_schedule',
    'release_drift_unscheduled_job_with_schedule_fields',
    'release_complete_audit_idempotency_counts',
    'release_complete_no_mutation_assertions',
  ];
  for (const label of requiredLabels) {
    assert.match(scenarioSource, new RegExp(`TASK17A_SCENARIO_START: ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  const runner = readFileSync('backend/creator-publishing-queue/tests/runTask17aPostgresIntegration.mjs', 'utf8');
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(runner, /task15 regression post-01400/);
  assert.match(runner, /runTask17aConcurrency\.mjs/);
  assert.match(runner, /task17aProgressMatrixIntegration\.sql/);
  assert.match(runner, /task17aReleaseMatrixIntegration\.sql/);
  assert.match(runner, /task17aReleaseMatrixIntegration\.sql/);
  assert.match(runner, /runTask17aCancellationConcurrency\.mjs/);
  assert.match(runner, /TASK17A_CURRENT_SCENARIOS_PASSED/);
  assert.doesNotMatch(runner, /TASK17A_BEHAVIORAL_COVERAGE_COMPLETE/);
  const workflow = readFileSync('.github/workflows/task17a-operator-queue-postgres.yml', 'utf8');
  assert.match(workflow, /test:creator-publishing-task17a-upgrade/);
  assert.match(workflow, /test:creator-publishing-task17a-postgres/);
  assert.match(runner, /const sqlTargets = \[/);
  for (const target of ['task17aPostgresIntegration.sql','task17aAuthorizationTimingIntegration.sql','task17aIdempotencyRecoveryIntegration.sql','task17aSafetyGatesIntegration.sql','task17aSchedulerCompatibilityIntegration.sql','task17aProgressMatrixIntegration.sql','task17aReleaseMatrixIntegration.sql','claim-concurrency','cancellation-concurrency']) {
    assert.ok(runner.includes(target));
    assert.ok(workflow.includes(target));
  }
  assert.match(runner, /Unknown TASK17A_DIAGNOSTIC_TARGET/);
  assert.match(runner, /task17a-postgres-diagnostics-\$\{sanitizedTarget\}\.log/);
  assert.match(runner, /TASK17A_DIAGNOSTIC_TARGET_PASSED:\$\{diagnosticTarget\}/);
  assert.match(runner, /if \(diagnosticTarget\)[\s\S]*TASK17A_DIAGNOSTIC_TARGET_PASSED[\s\S]*} else \{[\s\S]*for \(const f of sqlTargets\)[\s\S]*runTask17aConcurrency\.mjs[\s\S]*runTask17aCancellationConcurrency\.mjs[\s\S]*TASK17A_CURRENT_SCENARIOS_PASSED/);
  assert.match(workflow, /diagnostics:[\s\S]*needs: postgres[\s\S]*if: \$\{\{ always\(\) && needs\.postgres\.result == 'failure' \}\}/);
  assert.match(workflow, /diagnostics:[\s\S]*continue-on-error: true[\s\S]*fail-fast: false/);
  assert.match(workflow, /diagnostics:[\s\S]*image: postgres:15/);
  assert.match(workflow, /TASK17A_DIAGNOSTIC_TARGET: \$\{\{ matrix\.target \}\}/);
  assert.match(workflow, /path: task17a-postgres-diagnostics-\*\.log/);
  assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);
});


test('Task 17A fixture seeds are unique and scheduler namespace is isolated', () => {
  const scenarioFiles = [
    'backend/creator-publishing-queue/tests/task17aPostgresIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aAuthorizationTimingIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aIdempotencyRecoveryIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aSafetyGatesIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aSchedulerCompatibilityIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aProgressMatrixIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aReleaseMatrixIntegration.sql',
  ];
  const helperPattern = /\b(reset_fixture|create_secondary_work|create_additional_work|assert_claim_rejected|assert_claim_queue_status_rejected|assert_claim_job_state_rejected|assert_manual_result_field_blocks|run_scheduler_transition|assert_terminal_scheduler_superseded|assert_scheduler_claim_gate_cleanup)\s*\(\s*(\d{6})\b/g;
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
  assert.match(runner, /task17aProgressMatrixIntegration\.sql/);
  assert.match(runner, /runTask17aCancellationConcurrency\.mjs/);
});



test('Task 17A cancellation valid-work scenarios use schema-valid additional-work helper', () => {
  const support = readFileSync('backend/creator-publishing-queue/tests/task17aTestSupport.sql', 'utf8');
  assert.match(support, /create or replace function task17a_test\.create_additional_work/);
  assert.match(support, /p_existing_plan_id is not null[\s\S]*existing plan belongs to creator/);
  assert.match(support, /operator_due_at=intended_publish_at-interval '60 minutes'/);

  const recovery = readFileSync('backend/creator-publishing-queue/tests/task17aIdempotencyRecoveryIntegration.sql', 'utf8');
  assert.match(recovery, /cancel_job_changed_job_conflict[\s\S]*create_additional_work\(927204,[\s\S]*cancel_changed_a[\s\S]*null,'scheduled_internally','scheduled_internally',true/);
  assert.match(recovery, /cancel_plan_multi_job_cleanup[\s\S]*create_additional_work\(927302,[\s\S]*cancel_plan_claimed[\s\S]*cancel_plan_claimed'::jsonb->>'plan'[\s\S]*'scheduled_internally','scheduled_internally',true/);
  assert.match(recovery, /cancel_plan_multi_job_cleanup[\s\S]*create_additional_work\(927303,[\s\S]*cancel_plan_claimed[\s\S]*cancel_plan_claimed'::jsonb->>'plan'[\s\S]*'archived','archived',false/);
  assert.match(recovery, /cancel_plan_changed_plan_conflict[\s\S]*create_additional_work\(927304,[\s\S]*cancel_plan_claimed[\s\S]*null,'scheduled_internally','scheduled_internally',true/);
  assert.doesNotMatch(recovery, /update public\.creator_publishing_platform_jobs set creator_id=\(:'cancel_changed_a'/);
  assert.doesNotMatch(recovery, /update public\.creator_publishing_platform_jobs set publishing_plan_id=\(:'cancel_plan_claimed'/);
});

test('valid scheduled Task 17A fixtures use the schedule-phase helper', () => {
  const support = readFileSync('backend/creator-publishing-queue/tests/task17aTestSupport.sql', 'utf8');
  assert.match(support, /create or replace function task17a_test\.set_valid_schedule_phase/);
  assert.match(support, /operator_due_at=v_operator_due/);
  assert.match(support, /operator_due_at = intended_publish_at - interval '60 minutes'/);

  const postgres = readFileSync('backend/creator-publishing-queue/tests/task17aPostgresIntegration.sql', 'utf8');
  assert.match(postgres, /claim_audit_prior_status_matrix[\s\S]*auditready1[\s\S]*auditsched1[\s\S]*auditawait1[\s\S]*auditdue01/);

  const authorization = readFileSync('backend/creator-publishing-queue/tests/task17aAuthorizationTimingIntegration.sql', 'utf8');
  assert.match(authorization, /reset_fixture\(921009[\s\S]*set_valid_schedule_phase\([^\n]+after_operator_due/);
  assert.match(authorization, /reset_fixture\(921010[\s\S]*set_valid_schedule_phase\([^\n]+after_publish_due/);

  const scheduler = readFileSync('backend/creator-publishing-queue/tests/task17aSchedulerCompatibilityIntegration.sql', 'utf8');
  assert.match(scheduler, /reset_fixture\(926001[\s\S]*set_valid_schedule_phase\([^\n]+after_operator_due/);
  assert.match(scheduler, /reset_fixture\(926002[\s\S]*set_valid_schedule_phase\([^\n]+after_publish_due/);
  assert.match(scheduler, /reset_fixture\(926003[\s\S]*set_valid_schedule_phase\([^\n]+after_operator_due/);
  assert.match(scheduler, /run_scheduler_transition[\s\S]*set_valid_schedule_phase\(\(f->>'job'\)::uuid,'after_operator_due'/);
  assert.match(scheduler, /run_scheduler_transition[\s\S]*set_valid_schedule_phase\(\(f->>'job'\)::uuid,'after_publish_due'/);
  assert.match(scheduler, /reset_fixture\(926205[\s\S]*set_valid_schedule_phase\(\(f->>'job'\)::uuid,'after_publish_due'/);

  const recovery = readFileSync('backend/creator-publishing-queue/tests/task17aIdempotencyRecoveryIntegration.sql', 'utf8');
  assert.match(recovery, /in_claim_recovery_not_due_structured[\s\S]*set_valid_schedule_phase\([^\n]+after_publish_due[\s\S]*set_valid_schedule_phase\([^\n]+before_operator_due/);

  const nonDriftSource = [postgres, authorization, scheduler, recovery].join('\n');
  assert.doesNotMatch(nonDriftSource, /operator_due_at\s*=\s*clock_timestamp\(\)\s*-\s*interval '1 minute'[\s\S]{0,160}intended_publish_at\s*=\s*clock_timestamp\(\)\s*\+\s*interval '1 hour'/);
  assert.doesNotMatch(nonDriftSource, /operator_due_at\s*=\s*clock_timestamp\(\)\s*-\s*interval '2 hours'[\s\S]{0,160}intended_publish_at\s*=\s*clock_timestamp\(\)\s*-\s*interval '1 minute'/);
});



test('Task 17A cancellation helper archives active queue work without counting unclaimed rows as cleared claims', () => {
  assert.match(migration, /create or replace function public\.creator_publishing_cancel_task17a_queue_claims/);
  for (const status of [
    'draft',
    'needs_compliance_review',
    'needs_creator_approval',
    'ready_for_handoff',
    'scheduled_internally',
    'awaiting_operator',
    'due_now',
    'claimed',
    'needs_fix',
  ]) {
    assert.match(migration, new RegExp(`q\\.status in \\([\\s\\S]*'${status}'`));
  }
  assert.match(migration, /operator_task_claim_cancelled_by_schedule_cancellation/);
  assert.match(migration, /operator_task_archived_by_schedule_cancellation/);
  assert.doesNotMatch(migration, /for\s+task_rec\s*,\s*job_rec\s+in/);
  assert.match(migration, /queue_job_rec record/);
  assert.match(migration, /for queue_job_rec in/);
  assert.match(migration, /q\.id as queue_task_id[\s\S]*q\.status as prior_status[\s\S]*j\.id as platform_job_id[\s\S]*j\.creator_id as job_creator_id/);
  assert.match(migration, /j\.content_package_id as job_content_package_id[\s\S]*j\.platform_account_id as job_platform_account_id[\s\S]*j\.target_platform as job_target_platform/);
  assert.match(migration, /for update of q/);
  assert.match(migration, /v_claim_cleared := queue_job_rec\.prior_status='claimed'/);
  assert.match(migration, /if v_claim_cleared then v_count := v_count \+ 1; end if/);
  assert.match(migration, /before_state[\s\S]*claim_expires_at[\s\S]*claim_attempt_count[\s\S]*progress_state[\s\S]*assigned_operator_id/);
  assert.match(migration, /after_state[\s\S]*queue_task_id[\s\S]*platform_job_id[\s\S]*claim_cleared/);
  const cancelHelper = migration.slice(migration.indexOf('create or replace function public.creator_publishing_cancel_task17a_queue_claims'), migration.indexOf('revoke all on function public.creator_publishing_cancel_task17a_queue_claims'));
  assert.doesNotMatch(cancelHelper, /before_state[\s\S]{0,500}claim_token/);
  assert.doesNotMatch(cancelHelper, /after_state[\s\S]{0,500}claim_token/);

  const recovery = readFileSync('backend/creator-publishing-queue/tests/task17aIdempotencyRecoveryIntegration.sql', 'utf8');
  assert.match(recovery, /TASK17A_SCENARIO_START: cancel_job_after_expired_recovery_cleanup/);
  assert.match(recovery, /cancel_job_after_expired_recovery_cleanup[\s\S]*operator_task_archived_by_schedule_cancellation/);
  assert.match(recovery, /cancel_job_unclaimed_cleanup[\s\S]*operator_task_archived_by_schedule_cancellation/);
  assert.match(recovery, /cancel_plan_multi_job_cleanup[\s\S]*operator_task_claim_cancelled_by_schedule_cancellation[\s\S]*operator_task_archived_by_schedule_cancellation/);
});

test('Task 17A cancellation concurrency runner escapes psql meta-commands in JavaScript templates', () => {
  const cancelRunner = readFileSync('backend/creator-publishing-queue/tests/runTask17aCancellationConcurrency.mjs', 'utf8');
  const lines = cancelRunner.split('\n').map((line) => line.trim());
  const escapedInclude = String.raw`\\i backend/creator-publishing-queue/tests/task17aTestSupport.sql`;
  const unescapedInclude = String.raw`\i backend/creator-publishing-queue/tests/task17aTestSupport.sql`;
  const escapedGset = String.raw`as f \\gset`;
  const unescapedGset = String.raw`as f \gset`;
  assert.ok(lines.includes(escapedInclude));
  assert.equal(lines.includes(unescapedInclude), false);
  assert.ok(lines.some((line) => line.includes(escapedGset)));
  assert.equal(lines.some((line) => line.includes(unescapedGset)), false);
  assert.ok(cancelRunner.indexOf(escapedInclude) < cancelRunner.indexOf('task17a_test.reset_fixture'));
  assert.match(cancelRunner, /function parseSessionJson/);
  assert.match(cancelRunner, /recovery-vs-job-cancel-order-specific-final/);
  assert.match(cancelRunner, /operator_task_archived_by_schedule_cancellation/);
  assert.match(cancelRunner, /operator_task_claim_cancelled_by_schedule_cancellation/);
  assert.match(cancelRunner, /before_state \? 'claim_token' or after_state \? 'claim_token'/);
  for (const label of ['claim_vs_job_cancel_concurrency','claim_vs_plan_cancel_concurrency','recovery_vs_job_cancel_concurrency']) {
    assert.match(cancelRunner, new RegExp(`TASK17A_SCENARIO_START: ${label}`));
  }
  const integrationRunner = readFileSync('backend/creator-publishing-queue/tests/runTask17aPostgresIntegration.mjs', 'utf8');
  assert.match(integrationRunner, /TASK17A_CURRENT_SCENARIOS_PASSED/);
  assert.doesNotMatch(integrationRunner, /TASK17A_BEHAVIORAL_COVERAGE_COMPLETE/);
});




test('Task 17A progress matrix scenarios invoke the real progress RPC or rejection helper', () => {
  const progress = readFileSync('backend/creator-publishing-queue/tests/task17aProgressMatrixIntegration.sql', 'utf8');
  assert.match(progress, /create or replace function task17a_test\.assert_progress_rejected[\s\S]*creator_publishing_update_onlyfans_operator_progress/);
  assert.match(progress, /create or replace function task17a_test\.progress_preserved_snapshot[\s\S]*'status'[\s\S]*'claimed_by'[\s\S]*'claimed_at'[\s\S]*'claim_token'[\s\S]*'claim_expires_at'[\s\S]*'claim_attempt_count'[\s\S]*'assigned_operator_id'[\s\S]*'posted_by'[\s\S]*'posted_at'[\s\S]*'posted_confirmation'[\s\S]*'final_post_url'[\s\S]*'final_post_url_skip_reason'[\s\S]*'proof_screenshot_storage_key'[\s\S]*'skip_or_fail_reason'/);
  assert.match(progress, /create or replace function task17a_test\.assert_progress_conflict_preserved[\s\S]*p_original_task_snapshot[\s\S]*p_original_job_snapshot[\s\S]*p_alternate_task_snapshot[\s\S]*p_alternate_job_snapshot[\s\S]*request_fingerprint[\s\S]*stored_result[\s\S]*created_at/);
  assert.match(progress, /TASK17A_SCENARIO_START: progress_valid_transition_sequence[\s\S]*operator_preparation_started[\s\S]*operator_package_prepared[\s\S]*operator_handoff_ready/);
  assert.match(progress, /TASK17A_SCENARIO_START: progress_exact_replay[\s\S]*idempotent/);
  const blockFor = (label: string): string => {
    const pattern = new RegExp(`\\\\echo TASK17A_SCENARIO_START: ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)(?=\\\\echo TASK17A_SCENARIO_START:|$)`);
    const match = progress.match(pattern);
    assert.ok(match, `${label} block must exist`);
    return match[1];
  };
  const validBlock = blockFor('progress_valid_transition_sequence');
  assert.match(validBlock, /progress_valid_preserved_baseline/);
  assert.match(validBlock, /progress_preserved_snapshot\(id\)=\(:'progress_valid_preserved_baseline'\)::jsonb/g);
  assert.match(validBlock, /operator_progress_state='preparing'[\s\S]*operator_progress_revision=1[\s\S]*operator_progress_updated_by=/);
  assert.match(validBlock, /operator_progress_state='prepared'[\s\S]*operator_progress_revision=2[\s\S]*operator_progress_updated_by=/);
  assert.match(validBlock, /operator_progress_state='handoff_ready'[\s\S]*operator_progress_revision=3[\s\S]*operator_progress_updated_by=/);
  assert.match(validBlock, /idempotency_key='progseq01'[\s\S]*action='operator_preparation_started'[\s\S]*before_state->>'progress_state'='not_started'[\s\S]*before_state->>'progress_revision'\)::int=0[\s\S]*after_state->>'progress_state'='preparing'[\s\S]*after_state->>'progress_revision'\)::int=1/);
  assert.match(validBlock, /idempotency_key='progseq02'[\s\S]*action='operator_package_prepared'[\s\S]*before_state->>'progress_state'='preparing'[\s\S]*before_state->>'progress_revision'\)::int=1[\s\S]*after_state->>'progress_state'='prepared'[\s\S]*after_state->>'progress_revision'\)::int=2/);
  assert.match(validBlock, /idempotency_key='progseq03'[\s\S]*action='operator_handoff_ready'[\s\S]*before_state->>'progress_state'='prepared'[\s\S]*before_state->>'progress_revision'\)::int=2[\s\S]*after_state->>'progress_state'='handoff_ready'[\s\S]*after_state->>'progress_revision'\)::int=3/);
  const replayBlock = blockFor('progress_exact_replay');
  assert.match(replayBlock, /progress_replay_job_snapshot/);
  assert.match(replayBlock, /progress_replay_idem_snapshot/);
  assert.match(replayBlock, /request_fingerprint=\(:'progress_replay_idem_snapshot'\)::jsonb->>'request_fingerprint'/);
  assert.match(replayBlock, /stored_result=\(:'progress_replay_idem_snapshot'\)::jsonb->'stored_result'/);
  assert.match(replayBlock, /created_at=\(\(:'progress_replay_idem_snapshot'\)::jsonb->>'created_at'\)::timestamptz/);
  assert.match(replayBlock, /stored_result = \(\(:'progress_replay_second'\)::jsonb - 'idempotent'\)/);
  const conflictBlock = blockFor('progress_changed_task_idempotency_conflict');
  assert.match(conflictBlock, /progress_conflict_original_queue_snapshot/);
  assert.match(conflictBlock, /progress_conflict_original_job_snapshot/);
  assert.match(conflictBlock, /progress_conflict_alternate_queue_snapshot/);
  assert.match(conflictBlock, /progress_conflict_alternate_job_snapshot/);
  assert.match(conflictBlock, /progress_conflict_idempotency_snapshot/);
  assert.match(conflictBlock, /progress_conflict_success_audit_count/);
  assert.match(conflictBlock, /assert_progress_conflict_preserved/);
  const blocks = progress.split(/\\echo TASK17A_SCENARIO_START:\s*/).slice(1);
  for (const block of blocks) {
    const label = block.split(/\r?\n/, 1)[0].trim();
    const body = block.replace(/^.*\r?\n/, '');
    if (label.startsWith('progress_') && !label.startsWith('progress_complete_')) {
      assert.match(body, /creator_publishing_update_onlyfans_operator_progress|assert_progress_rejected/, `${label} must invoke progress RPC or rejection helper`);
      assert.match(body, /task17a_test\.(assert|expect_error|assert_progress_rejected)/, `${label} must assert progress behavior`);
    }
  }
  assert.match(progress, /progress_complete_audit_idempotency_counts[\s\S]*select count\(\*\)[\s\S]*progress_update/);
  assert.match(progress, /progress_complete_no_mutation_assertions[\s\S]*task17a_progress_rejections/);
  assert.doesNotMatch(progress, /task17a_test\.assert\s*\(\s*true\b/i);
});

test('Task 17A release matrix scenarios invoke the real release RPC or release helpers', () => {
  const release = readFileSync('backend/creator-publishing-queue/tests/task17aReleaseMatrixIntegration.sql', 'utf8');
  assert.match(release, /create or replace function task17a_test\.assert_release_rejected[\s\S]*creator_publishing_release_onlyfans_operator_task/);
  assert.match(release, /create or replace function task17a_test\.assert_release_success[\s\S]*creator_publishing_release_onlyfans_operator_task/);
  assert.match(release, /create or replace function task17a_test\.release_preserved_snapshot[\s\S]*'claim_attempt_count'[\s\S]*'operator_progress_state'[\s\S]*'operator_progress_revision'[\s\S]*'operator_progress_updated_by'[\s\S]*'operator_progress_updated_at'[\s\S]*'assigned_operator_id'[\s\S]*'posted_by'[\s\S]*'posted_at'[\s\S]*'posted_confirmation'[\s\S]*'final_post_url'[\s\S]*'proof_screenshot_storage_key'[\s\S]*'skip_or_fail_reason'/);
  assert.match(release, /create or replace function task17a_test\.assert_release_conflict_preserved[\s\S]*p_original_task_snapshot[\s\S]*p_original_job_snapshot[\s\S]*p_alternate_task_snapshot[\s\S]*p_alternate_job_snapshot[\s\S]*request_fingerprint[\s\S]*stored_result[\s\S]*created_at/);
  const requiredReleaseLabels = [
    'release_restore_unscheduled_ready',
    'release_restore_before_operator_due',
    'release_restore_after_operator_due',
    'release_restore_after_publish_due',
    'release_exact_replay',
    'release_request_invalid',
    'release_missing_job',
    'release_missing_task',
    'release_task_job_mismatch',
    'release_unsupported_target_or_mode',
    'release_cancelled_job',
    'release_ineligible_job_state',
    'release_not_claimed',
    'release_unauthorized_actor',
    'release_revoked_authorization',
    'release_wrong_owner',
    'release_wrong_token',
    'release_expired_token',
    'release_manual_result_evidence_rejected',
    'release_changed_task_idempotency_conflict',
    'release_changed_job_idempotency_conflict',
    'release_changed_token_idempotency_conflict',
    'release_drift_missing_intended_publish_at',
    'release_drift_missing_operator_due_at',
    'release_drift_missing_timezone',
    'release_drift_blank_timezone',
    'release_drift_missing_scheduled_at',
    'release_drift_missing_scheduled_by',
    'release_drift_zero_schedule_revision',
    'release_drift_negative_schedule_revision',
    'release_drift_operator_offset_not_60_minutes',
    'release_drift_job_state_inconsistent_with_schedule',
    'release_drift_unscheduled_job_with_schedule_fields',
    'release_complete_audit_idempotency_counts',
    'release_complete_no_mutation_assertions',
  ];
  const blocks = release.split(/\\echo TASK17A_SCENARIO_START:\s*/).slice(1);
  const byLabel = new Map(blocks.map((block) => [block.split(/\r?\n/, 1)[0].trim(), block.replace(/^.*\r?\n/, '')]));
  for (const label of requiredReleaseLabels) {
    assert.ok(byLabel.has(label), `${label} block must exist`);
    const body = byLabel.get(label) || '';
    if (!label.startsWith('release_complete_')) {
      assert.match(body, /creator_publishing_release_onlyfans_operator_task|assert_release_(success|rejected|conflict_preserved)/, `${label} must invoke release RPC or helper`);
      assert.match(body, /task17a_test\.(assert|expect_error|assert_release_success|assert_release_rejected|assert_release_conflict_preserved)/, `${label} must assert release behavior`);
    }
  }
  const beforeDue = byLabel.get('release_restore_before_operator_due') || '';
  assert.match(beforeDue, /set_valid_schedule_phase[\s\S]*after_operator_due[\s\S]*creator_publishing_claim_onlyfans_operator_task[\s\S]*set_valid_schedule_phase[\s\S]*before_operator_due[\s\S]*assert_release_success/);
  assert.match(byLabel.get('release_restore_after_operator_due') || '', /set_valid_schedule_phase[\s\S]*after_operator_due[\s\S]*creator_publishing_claim_onlyfans_operator_task[\s\S]*creator_publishing_update_onlyfans_operator_progress/);
  assert.match(byLabel.get('release_restore_after_publish_due') || '', /set_valid_schedule_phase[\s\S]*after_publish_due[\s\S]*creator_publishing_claim_onlyfans_operator_task[\s\S]*creator_publishing_update_onlyfans_operator_progress[\s\S]*creator_publishing_update_onlyfans_operator_progress/);
  assert.match(byLabel.get('release_exact_replay') || '', /stored_result=\(:'release_replay_idem_snapshot'\)::jsonb->'stored_result'[\s\S]*stored_result=\(\(:'release_replay_second'\)::jsonb - 'idempotent'\)/);
  assert.match(byLabel.get('release_changed_task_idempotency_conflict') || '', /release_conflict_original_queue_snapshot[\s\S]*release_conflict_alternate_queue_snapshot[\s\S]*release_conflict_idempotency_snapshot/);
  const cancelled = byLabel.get('release_cancelled_job') || '';
  assert.match(cancelled, /clock_timestamp\(\) as release_cancelled_at/);
  assert.match(cancelled, /job_state='archived'[\s\S]*cancelled_at=:'release_cancelled_at'::timestamptz[\s\S]*cancelled_by=\(:'release_cancelled_fixture'::jsonb->>'creator'\)::uuid[\s\S]*cancellation_reason='Task 17A Release cancelled-job fixture'/);
  assert.match(cancelled, /length\(btrim\(cancellation_reason\)\) between 1 and 500/);
  assert.match(cancelled, /claimed queue preserved before release[\s\S]*assert_release_rejected\('release_cancelled_job','OPERATOR_TASK_INELIGIBLE'/);
  const unscheduledDrift = byLabel.get('release_drift_unscheduled_job_with_schedule_fields') || '';
  assert.match(unscheduledDrift, /claim_token as release_drift_unscheduled_fields_fixture_token/);
  assert.match(unscheduledDrift, /:'release_drift_unscheduled_fields_fixture_token'::uuid=claim_token[\s\S]*assert_release_rejected\('release_drift_unscheduled_job_with_schedule_fields','OPERATOR_TASK_INELIGIBLE'[\s\S]*:'release_drift_unscheduled_fields_fixture_token'::uuid/);
  assert.match(unscheduledDrift, /begin;[\s\S]*drop constraint creator_publishing_jobs_unscheduled_fields_null[\s\S]*rollback;[\s\S]*constraint restored after rollback/);
  assert.doesNotMatch(unscheduledDrift, /release_drift_unscheduled_fields_token/);
  const scheduledDriftLabels = [
    'release_drift_missing_intended_publish_at',
    'release_drift_missing_operator_due_at',
    'release_drift_missing_timezone',
    'release_drift_blank_timezone',
    'release_drift_missing_scheduled_at',
    'release_drift_missing_scheduled_by',
    'release_drift_zero_schedule_revision',
    'release_drift_negative_schedule_revision',
    'release_drift_operator_offset_not_60_minutes',
    'release_drift_job_state_inconsistent_with_schedule',
  ];
  for (const label of scheduledDriftLabels) {
    assert.match(byLabel.get(label) || '', /set_valid_schedule_phase[\s\S]*after_operator_due[\s\S]*assert_release_claimable_setup[\s\S]*creator_publishing_claim_onlyfans_operator_task[\s\S]*assert_release_claimed_setup/, `${label} must establish claimable scheduled setup before claim`);
  }
  assert.match(byLabel.get('release_revoked_authorization') || '', /status='revoked'[\s\S]*revoked_at=[\s\S]*updated_at=[\s\S]*creator_publishing_operator_is_authorized/);
  assert.match(release, /before_task->>'posted_by' is not distinct from after_task->>'posted_by'[\s\S]*before_task->>'skip_or_fail_reason' is not distinct from after_task->>'skip_or_fail_reason'/);
  const releaseTokenAliases = new Set(Array.from(release.matchAll(/select\s+claim_token\s+as\s+(\w+)\b[^\n]*\\gset/g)).map((match) => match[1]));
  for (const [label, body] of byLabel) {
    for (const match of body.matchAll(/:'([^']*_token)'/g)) {
      assert.ok(releaseTokenAliases.has(match[1]), `${label} references undefined claim-token alias ${match[1]}`);
    }
  }
  const releaseLines = release.split('\n');
  releaseLines.forEach((line, index) => {
    if (/update public\.creator_publishing_platform_jobs/.test(line) && /(cancelled_at|cancelled_by|cancellation_reason)/.test(line)) {
      assert.match(line, /cancelled_at\s*=/, `cancellation metadata update at line ${index + 1} must include cancelled_at`);
      assert.match(line, /cancelled_by\s*=/, `cancellation metadata update at line ${index + 1} must include cancelled_by`);
      assert.match(line, /cancellation_reason\s*=/, `cancellation metadata update at line ${index + 1} must include cancellation_reason`);
    }
  });
  releaseLines.forEach((line, index) => {
    if (/alter table public\.creator_publishing_platform_jobs drop constraint/.test(line)) {
      const previous = releaseLines.slice(Math.max(0, index - 3), index).join('\n');
      const following = releaseLines.slice(index, index + 10).join('\n');
      assert.match(previous, /begin;/, `constraint drop at line ${index + 1} must be transaction-isolated`);
      assert.match(following, /rollback;[\s\S]*constraint restored after rollback/, `constraint drop at line ${index + 1} must roll back and assert restoration`);
    }
  });
  assert.match(byLabel.get('release_complete_audit_idempotency_counts') || '', /select count\(\*\)[\s\S]*action_type='release'/);
  const releaseNoMutation = byLabel.get('release_complete_no_mutation_assertions') || '';
  assert.match(releaseNoMutation, /create temp table task17a_release_expected_rejections/);
  assert.match(releaseNoMutation, /drop table if exists task17a_release_expected_rejections/);
  assert.match(releaseNoMutation, /create temp table task17a_release_expected_rejections[\s\S]*on commit preserve rows/);
  assert.doesNotMatch(releaseNoMutation, /on commit drop/i);
  assert.doesNotMatch(releaseNoMutation, /on commit delete rows/i);
  for (const label of ['release_request_invalid', 'release_missing_job', 'release_missing_task', 'release_task_job_mismatch', 'release_unsupported_target_or_mode', 'release_cancelled_job', 'release_ineligible_job_state', 'release_not_claimed', 'release_unauthorized_actor', 'release_revoked_authorization', 'release_wrong_owner', 'release_wrong_token', 'release_expired_token', 'release_manual_result_evidence_rejected', 'release_drift_missing_intended_publish_at', 'release_drift_missing_operator_due_at', 'release_drift_missing_timezone', 'release_drift_blank_timezone', 'release_drift_missing_scheduled_at', 'release_drift_missing_scheduled_by', 'release_drift_zero_schedule_revision', 'release_drift_negative_schedule_revision', 'release_drift_operator_offset_not_60_minutes', 'release_drift_job_state_inconsistent_with_schedule', 'release_drift_unscheduled_job_with_schedule_fields']) assert.match(releaseNoMutation, new RegExp(label));
  for (const key of ['relinvalid', 'relmissingjob', 'relmissingtask', 'relmismatch', 'relunsupported', 'relcancelled', 'relineligible', 'relnotclaimed', 'relunauth', 'relrevoked', 'relwrongowner', 'relwrongtoken', 'relexpired', 'relmanual', 'reldrift31', 'reldrift32', 'reldrift33', 'reldrift34', 'reldrift35', 'reldrift36', 'reldrift37', 'reldrift38', 'reldrift39', 'reldrift40', 'reldrift41']) assert.match(releaseNoMutation, new RegExp(key));
  assert.match(releaseNoMutation, /expected_rejections except select label,key from task17a_release_rejections/);
  assert.match(releaseNoMutation, /task17a_release_rejections except select label,key from task17a_release_expected_rejections/);
  assert.match(releaseNoMutation, /group by label having count\(\*\)<>1/);
  assert.match(releaseNoMutation, /group by key having count\(\*\)<>1/);
  assert.match(releaseNoMutation, /release_rejection_actual_count[\s\S]*release_rejection_actual_rows[\s\S]*release_rejection_expected_rows[\s\S]*release_rejection_missing_expected_rows[\s\S]*release_rejection_unexpected_actual_rows/);
  assert.doesNotMatch(releaseNoMutation, />=\s*26/);
  assert.doesNotMatch(releaseNoMutation, /count\(\*\)\s*>?=\s*\d+[^\n]*(populated|threshold)/i);
  assert.doesNotMatch(release, /task17a_test\.assert\s*\(\s*true\b/i);
});

test('Task 17A scenarios reject placeholders and require substantive executable bodies', () => {
  const task17aFiles = [
    ...listFiles('backend/creator-publishing-queue/tests').filter((file) => (/task17a|Task17a/.test(file) || /runTask17a/.test(file)) && !file.endsWith('task17aOperatorQueueSourceContract.test.ts')),
    '.github/workflows/task17a-operator-queue-postgres.yml',
  ].filter((file) => existsSync(file));
  for (const file of task17aFiles) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, new RegExp('task17a_test' + '\\.assert\\s*\\(\\s*true\\b', 'i'), `${file} contains unconditional task17a_test assert true`);
    assert.doesNotMatch(source, /assert\.equal\s*\(\s*true\s*,\s*true\s*\)/i, `${file} contains assert.equal(true, true)`);
    assert.doesNotMatch(source, /expect\s*\(\s*true\s*\)\.toBe\s*\(\s*true\s*\)/i, `${file} contains expect(true).toBe(true)`);
  }

  const scenarioFiles = [
    'backend/creator-publishing-queue/tests/task17aPostgresIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aAuthorizationTimingIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aIdempotencyRecoveryIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aSafetyGatesIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aSchedulerCompatibilityIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aProgressMatrixIntegration.sql',
    'backend/creator-publishing-queue/tests/task17aReleaseMatrixIntegration.sql',
  ];
  const substantivePattern = /creator_publishing_|task17a_test\.(expect_error|assert_claim|assert_manual_result|run_scheduler|assert_terminal_scheduler|assert_scheduler_claim_gate_cleanup|assert_release_success|assert_release_rejected|assert_release_conflict_preserved)|task17a_test\.assert\s*\(\s*(?!true\b)|select\s+count\s*\(|update\s+public\.|insert\s+into\s+public\.|psql\s*\(/i;
  for (const file of scenarioFiles) {
    const source = readFileSync(file, 'utf8');
    const parts = source.split(/TASK17A_SCENARIO_START:\s*/).slice(1);
    for (const part of parts) {
      const label = part.split(/\r?\n/, 1)[0].trim().replace(/[`'"),].*$/, '').trim();
      const body = part.replace(/^.*\r?\n/, '').split(/TASK17A_SCENARIO_START:\s*/)[0];
      const nonCommentBody = body
        .split('\n')
        .filter((line) => !/^\s*(--|\/\/|#|\\echo\b|console\.log\(|appendFileSync\()/.test(line))
        .join('\n');
      assert.match(nonCommentBody, substantivePattern, `${file} scenario ${label} lacks substantive executable statements`);
    }
  }
});

test('prohibited Task 17B, Task 18, platform, and deployment work is absent', () => {
  assert.doesNotMatch(migration, /final_post_url\s*=|scheduled_on_platform\s*=|awaiting_post_confirmation\s*=/i);
  assert.doesNotMatch(migration, /fetch\(|playwright|puppeteer|onlyfans\.com/i);
  assert.doesNotMatch(appSource, /task17a[\s\S]*(operator.*loader|onlyfans.*download|\/api\/autopost\/run|vercel.*cron)/i);
});
