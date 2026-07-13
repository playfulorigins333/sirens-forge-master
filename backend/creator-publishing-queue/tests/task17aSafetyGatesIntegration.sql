\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql
\echo TASK17A_SCENARIO_START: safety_capability_unavailable
create or replace function task17a_test.assert_claim_rejected(seed integer, label text, expected text, mutate text) returns void language plpgsql as $$
declare f jsonb; before_row public.creator_publishing_queue_tasks%rowtype;
begin
  f := task17a_test.reset_fixture(seed);
  execute mutate using f;
  select * into before_row from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  perform task17a_test.expect_error(label, expected, format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)', f->>'creator', f->>'task', f->>'job', f->>'consent_version', f->>'consent_hash', 'gate'||seed));
  perform task17a_test.assert((select claimed_by is not distinct from before_row.claimed_by and claimed_at is not distinct from before_row.claimed_at and claim_token is not distinct from before_row.claim_token and claim_expires_at is not distinct from before_row.claim_expires_at and claim_attempt_count=before_row.claim_attempt_count and operator_progress_state=before_row.operator_progress_state and assigned_operator_id is not distinct from before_row.assigned_operator_id from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), label || ' no mutation');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and idempotency_key='gate'||seed), label || ' no success audit');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key='gate'||seed), label || ' no idempotency success');
end $$;
select task17a_test.assert_claim_rejected(923001,'capability unavailable','PLATFORM_UNAVAILABLE',$$update public.creator_publishing_platform_capabilities set availability_status='frozen', publishing_mode='disabled' where platform='onlyfans'$$);
update public.creator_publishing_platform_capabilities set availability_status='available', publishing_mode='assisted' where platform='onlyfans';
select task17a_test.assert_claim_rejected(923002,'creator verification missing','CREATOR_VERIFICATION_MISSING',$$delete from public.creator_publishing_creator_verifications where creator_id=($1->>'creator')::uuid$$);
select task17a_test.assert_claim_rejected(923003,'account revoked','DESTINATION_ACCOUNT_REVOKED',$$update public.creator_platform_accounts set verification_status='revoked', verification_reason='revoked', verification_reviewed_by=($1->>'global_only')::uuid, verification_reviewed_at=clock_timestamp() where id=($1->>'account')::uuid$$);
select task17a_test.assert_claim_rejected(923004,'consent missing','AI_TWIN_CONSENT_MISSING',$$delete from public.creator_publishing_ai_twin_consents where creator_id=($1->>'creator')::uuid$$);
select task17a_test.assert_claim_rejected(923005,'approval missing','CREATOR_APPROVAL_MISSING',$$update public.creator_publishing_content_packages set creator_approval_status='pending' where id=($1->>'package')::uuid$$);
select task17a_test.assert_claim_rejected(923006,'source fingerprint stale','SOURCE_FINGERPRINT_STALE',$$update public.creator_publishing_platform_jobs set source_package_fingerprint='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' where id=($1->>'job')::uuid$$);
select task17a_test.assert_claim_rejected(923007,'duplicate active queue task','OPERATOR_QUEUE_TASK_AMBIGUOUS',$$insert into public.creator_publishing_queue_tasks(content_package_id,creator_id,target_platform,platform_account_id,status) values(($1->>'package')::uuid,($1->>'creator')::uuid,'onlyfans',($1->>'account')::uuid,'ready_for_handoff')$$);
select task17a_test.assert_claim_rejected(923008,'cancelled job','OPERATOR_TASK_INELIGIBLE',$$update public.creator_publishing_platform_jobs set cancelled_at=clock_timestamp(), cancelled_by=($1->>'creator')::uuid, cancellation_reason='cancelled' where id=($1->>'job')::uuid$$);
select task17a_test.assert_claim_rejected(923009,'ineligible job state','OPERATOR_TASK_INELIGIBLE',$$update public.creator_publishing_platform_jobs set job_state='blocked' where id=($1->>'job')::uuid$$);
select task17a_test.assert_claim_rejected(923010,'mismatched account','OPERATOR_TASK_JOB_MISMATCH',$$with alt_account as (insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_attested_at,is_virtual_entity,verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason) values(task17a_test.uuid_for('17190000-0000-4000-8000-',923010),($1->>'creator')::uuid,'onlyfans','alt923010','verified',clock_timestamp(),false,($1->>'global_only')::uuid,clock_timestamp(),'alt evidence','verified') returning id) update public.creator_publishing_queue_tasks set platform_account_id=(select id from alt_account) where id=($1->>'task')::uuid$$);
