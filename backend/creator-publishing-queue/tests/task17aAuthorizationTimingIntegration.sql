\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql
\echo TASK17A_SCENARIO_START: authorization_creator_claim
select task17a_test.reset_fixture(921001) as fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','selfclaim1') as self_claim \gset
select task17a_test.assert((:'self_claim')::jsonb->>'ok'='true', 'creator self-claim succeeds');
select task17a_test.reset_fixture(921002) as fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'operator_a')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','opclaim01') as op_claim \gset
select task17a_test.assert((:'op_claim')::jsonb->>'ok'='true', 'authorized operator claim succeeds');
select task17a_test.reset_fixture(921003) as fixture \gset
select task17a_test.expect_error('unauthorized operator fails','OPERATOR_NOT_AUTHORIZED',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'unauthorized'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','unauth01'));
select task17a_test.assert((select claim_attempt_count from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)=0, 'unauthorized claim leaves attempts unchanged');
select task17a_test.reset_fixture(921004) as fixture \gset
select task17a_test.expect_error('revoked operator fails','OPERATOR_NOT_AUTHORIZED',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'revoked'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','revoked1'));
select task17a_test.reset_fixture(921005) as fixture \gset
select task17a_test.expect_error('other creator authorization fails','OPERATOR_NOT_AUTHORIZED',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'unauthorized'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','otherauth'));
select task17a_test.reset_fixture(921006) as fixture \gset
select task17a_test.assert(exists(select 1 from public.creator_publishing_trusted_reviewers where reviewer_id=(:'fixture'::jsonb->>'global_only')::uuid and role='operator' and active is true), 'global-role-only fixture has active operator role');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_authorizations where creator_id=(:'fixture'::jsonb->>'creator')::uuid and operator_id=(:'fixture'::jsonb->>'global_only')::uuid and status='active'), 'global-role-only fixture has no creator authorization');
select task17a_test.expect_error('global role alone fails','OPERATOR_NOT_AUTHORIZED',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'global_only'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','global01'));
select task17a_test.reset_fixture(921007) as fixture \gset
select task17a_test.expect_error('Fanvue platform job constraint prevents matching Fanvue work','creator_publishing_jobs_no_fanvue',format('update public.creator_publishing_platform_jobs set target_platform=%L where id=%L','fanvue',(:'fixture'::jsonb->>'job')));
update public.creator_publishing_queue_tasks set target_platform='fanvue' where id=(:'fixture'::jsonb->>'task')::uuid;
select task17a_test.expect_error('Task17A RPC rejects non-OnlyFans queue work','OPERATOR_TASK_JOB_MISMATCH',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'creator'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','fanvue01'));
select task17a_test.reset_fixture(921008,'ready_for_handoff','scheduled_internally',true) as fixture \gset
select task17a_test.expect_error('scheduled before operator due blocked','OPERATOR_NOT_DUE',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'creator'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','early001'));
select task17a_test.assert(status='ready_for_handoff' and claim_attempt_count=0 and operator_progress_state='not_started' and not exists(select 1 from public.creator_publishing_operator_action_idempotency where idempotency_key='early001'), 'early claim leaves task audit progress idempotency unchanged') from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid;
select task17a_test.reset_fixture(921009,'awaiting_operator','scheduled_internally',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '1 minute' where id=(:'fixture'::jsonb->>'job')::uuid;
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','dueclaim1');
select task17a_test.reset_fixture(921010,'due_now','due_now',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '2 hours', intended_publish_at=clock_timestamp()-interval '1 minute' where id=(:'fixture'::jsonb->>'job')::uuid;
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'operator_a')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','duenow01');

create or replace function task17a_test.assert_claim_no_mutation(f jsonb, actor_id uuid, expected text, key text, label text) returns void language plpgsql as $$
declare before_row public.creator_publishing_queue_tasks%rowtype;
begin
  select * into before_row from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  perform task17a_test.expect_error(label, expected, format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)', actor_id, f->>'task', f->>'job', f->>'consent_version', f->>'consent_hash', key));
  perform task17a_test.assert((select
    status is not distinct from before_row.status
    and claimed_by is not distinct from before_row.claimed_by
    and claimed_at is not distinct from before_row.claimed_at
    and claim_token is not distinct from before_row.claim_token
    and claim_expires_at is not distinct from before_row.claim_expires_at
    and claim_attempt_count is not distinct from before_row.claim_attempt_count
    and operator_progress_state is not distinct from before_row.operator_progress_state
    and operator_progress_revision is not distinct from before_row.operator_progress_revision
    and operator_progress_updated_by is not distinct from before_row.operator_progress_updated_by
    and operator_progress_updated_at is not distinct from before_row.operator_progress_updated_at
    and assigned_operator_id is not distinct from before_row.assigned_operator_id
    and posted_by is not distinct from before_row.posted_by
    and posted_at is not distinct from before_row.posted_at
    and posted_confirmation is not distinct from before_row.posted_confirmation
    and final_post_url is not distinct from before_row.final_post_url
    and final_post_url_skip_reason is not distinct from before_row.final_post_url_skip_reason
    and proof_screenshot_storage_key is not distinct from before_row.proof_screenshot_storage_key
    and skip_or_fail_reason is not distinct from before_row.skip_or_fail_reason
  from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), label || ' preserves full queue row');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and idempotency_key=key), label || ' writes no claim audit');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key=key), label || ' writes no idempotency');
end $$;

create or replace function task17a_test.assert_claim_queue_status_rejected(seed integer, queue_status text) returns void language plpgsql as $$
declare f jsonb;
begin
  f := task17a_test.reset_fixture(seed, queue_status, 'draft', false);
  perform task17a_test.assert_claim_no_mutation(f,(f->>'creator')::uuid,'OPERATOR_TASK_INELIGIBLE','qstatus'||seed,'claim queue status ' || queue_status || ' rejected');
end $$;

create or replace function task17a_test.assert_claim_job_state_rejected(seed integer, state text) returns void language plpgsql as $$
declare f jsonb;
begin
  f := task17a_test.reset_fixture(seed, 'ready_for_handoff', state, false);
  perform task17a_test.assert_claim_no_mutation(f,(f->>'creator')::uuid,'OPERATOR_TASK_INELIGIBLE','jstate'||seed,'claim job state ' || state || ' rejected');
end $$;

\echo TASK17A_SCENARIO_START: claim_queue_status_draft_rejected
select task17a_test.assert_claim_queue_status_rejected(921101,'draft');
\echo TASK17A_SCENARIO_START: claim_queue_status_needs_compliance_review_rejected
select task17a_test.assert_claim_queue_status_rejected(921102,'needs_compliance_review');
\echo TASK17A_SCENARIO_START: claim_queue_status_needs_creator_approval_rejected
select task17a_test.assert_claim_queue_status_rejected(921103,'needs_creator_approval');
\echo TASK17A_SCENARIO_START: claim_queue_status_needs_fix_rejected
select task17a_test.assert_claim_queue_status_rejected(921104,'needs_fix');
\echo TASK17A_SCENARIO_START: claim_queue_status_blocked_rejected
select task17a_test.assert_claim_queue_status_rejected(921105,'blocked');
\echo TASK17A_SCENARIO_START: claim_queue_status_skipped_rejected
select task17a_test.assert_claim_queue_status_rejected(921106,'skipped');
\echo TASK17A_SCENARIO_START: claim_queue_status_failed_manual_upload_rejected
select task17a_test.assert_claim_queue_status_rejected(921107,'failed_manual_upload');
\echo TASK17A_SCENARIO_START: claim_queue_status_archived_rejected
select task17a_test.assert_claim_queue_status_rejected(921108,'archived');
\echo TASK17A_SCENARIO_START: claim_queue_status_confirmed_posted_manual_rejected
select task17a_test.assert_claim_queue_status_rejected(921109,'confirmed_posted_manual');

\echo TASK17A_SCENARIO_START: claim_job_state_needs_fix_rejected
select task17a_test.assert_claim_job_state_rejected(921201,'needs_fix');
\echo TASK17A_SCENARIO_START: claim_job_state_authentication_required_rejected
select task17a_test.assert_claim_job_state_rejected(921202,'authentication_required');
\echo TASK17A_SCENARIO_START: claim_job_state_platform_rejected_rejected
select task17a_test.assert_claim_job_state_rejected(921203,'platform_rejected');
\echo TASK17A_SCENARIO_START: claim_job_state_blocked_rejected
select task17a_test.assert_claim_job_state_rejected(921204,'blocked');
\echo TASK17A_SCENARIO_START: claim_job_state_archived_rejected
select task17a_test.assert_claim_job_state_rejected(921205,'archived');
\echo TASK17A_SCENARIO_START: claim_job_state_published_direct_rejected
select task17a_test.assert_claim_job_state_rejected(921206,'published_direct');
\echo TASK17A_SCENARIO_START: claim_job_state_confirmed_posted_manual_rejected
select task17a_test.assert_claim_job_state_rejected(921207,'confirmed_posted_manual');
\echo TASK17A_SCENARIO_START: claim_job_state_direct_publish_failed_rejected
select task17a_test.assert_claim_job_state_rejected(921208,'direct_publish_failed');
\echo TASK17A_SCENARIO_START: claim_job_state_exported_rejected
select task17a_test.assert_claim_job_state_rejected(921209,'exported');
\echo TASK17A_SCENARIO_START: claim_job_state_skipped_rejected
select task17a_test.assert_claim_job_state_rejected(921210,'skipped');
\echo TASK17A_SCENARIO_START: claim_job_cancelled_rejected
select task17a_test.reset_fixture(921211) as cancel_fixture \gset
update public.creator_publishing_platform_jobs set cancelled_at=clock_timestamp(), cancelled_by=(:'cancel_fixture'::jsonb->>'creator')::uuid, cancellation_reason='cancelled' where id=(:'cancel_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_claim_no_mutation(:'cancel_fixture'::jsonb,(:'cancel_fixture'::jsonb->>'creator')::uuid,'OPERATOR_TASK_INELIGIBLE','jstate921211','claim cancelled job rejected');
