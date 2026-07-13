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
\echo TASK17A_SCENARIO_START: duplicate_task_unique_index_boundary
select task17a_test.reset_fixture(923007) as duplicate_unique_fixture \gset
select task17a_test.expect_error('duplicate active queue task unique boundary','creator_publishing_queue_one_task_per_package_platform_uidx',format('insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status) values(%L,%L,%L,%L,%L,%L)', '17790000-0000-4000-8000-000000923007',(:'duplicate_unique_fixture'::jsonb->>'package'),(:'duplicate_unique_fixture'::jsonb->>'creator'),'onlyfans',(:'duplicate_unique_fixture'::jsonb->>'account'),'ready_for_handoff'));
select task17a_test.assert((select count(*) from public.creator_publishing_queue_tasks where content_package_id=(:'duplicate_unique_fixture'::jsonb->>'package')::uuid and target_platform='onlyfans' and status not in ('archived','skipped','failed_manual_upload','confirmed_posted_manual'))=1, 'duplicate unique boundary leaves exactly one active task');
select task17a_test.assert((select claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null from public.creator_publishing_queue_tasks where id=(:'duplicate_unique_fixture'::jsonb->>'task')::uuid), 'duplicate unique boundary leaves original ownership empty');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and entity_id=(:'duplicate_unique_fixture'::jsonb->>'task')::uuid), 'duplicate unique boundary writes no claim audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='claim' and queue_task_id=(:'duplicate_unique_fixture'::jsonb->>'task')::uuid), 'duplicate unique boundary writes no idempotency');
\echo TASK17A_SCENARIO_START: duplicate_task_rpc_ambiguity
select task17a_test.reset_fixture(923107) as duplicate_rpc_fixture \gset
begin;
drop index public.creator_publishing_queue_one_task_per_package_platform_uidx;
insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,created_at,updated_at)
values('17790000-0000-4000-8000-000000923107',(:'duplicate_rpc_fixture'::jsonb->>'package')::uuid,(:'duplicate_rpc_fixture'::jsonb->>'creator')::uuid,'onlyfans',(:'duplicate_rpc_fixture'::jsonb->>'account')::uuid,'ready_for_handoff',clock_timestamp(),clock_timestamp());
select task17a_test.expect_error('duplicate task defensive RPC ambiguity','OPERATOR_QUEUE_TASK_AMBIGUOUS',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'duplicate_rpc_fixture'::jsonb->>'creator'),(:'duplicate_rpc_fixture'::jsonb->>'task'),(:'duplicate_rpc_fixture'::jsonb->>'job'),:'duplicate_rpc_fixture'::jsonb->>'consent_version',:'duplicate_rpc_fixture'::jsonb->>'consent_hash','dupambig1'));
select task17a_test.assert((select count(*) from public.creator_publishing_queue_tasks where content_package_id=(:'duplicate_rpc_fixture'::jsonb->>'package')::uuid and status='claimed')=0, 'duplicate task RPC ambiguity claims neither task');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and idempotency_key='dupambig1'), 'duplicate task RPC ambiguity writes no claim audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key='dupambig1'), 'duplicate task RPC ambiguity writes no idempotency');
rollback;
select task17a_test.assert(to_regclass('public.creator_publishing_queue_one_task_per_package_platform_uidx') is not null, 'duplicate task RPC rollback restores unique index');
select task17a_test.assert((select count(*) from public.creator_publishing_queue_tasks where content_package_id=(:'duplicate_rpc_fixture'::jsonb->>'package')::uuid and target_platform='onlyfans' and status not in ('archived','skipped','failed_manual_upload','confirmed_posted_manual'))=1, 'duplicate task RPC rollback leaves one active task');
select task17a_test.assert_claim_rejected(923008,'cancelled job','OPERATOR_TASK_INELIGIBLE',$$update public.creator_publishing_platform_jobs set cancelled_at=clock_timestamp(), cancelled_by=($1->>'creator')::uuid, cancellation_reason='cancelled' where id=($1->>'job')::uuid$$);
select task17a_test.assert_claim_rejected(923009,'ineligible job state','OPERATOR_TASK_INELIGIBLE',$$update public.creator_publishing_platform_jobs set job_state='blocked' where id=($1->>'job')::uuid$$);
select task17a_test.assert_claim_rejected(923010,'mismatched account','OPERATOR_TASK_JOB_MISMATCH',$$with alt_account as (insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_attested_at,is_virtual_entity,verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason) values(task17a_test.uuid_for('17190000-0000-4000-8000-',923010),($1->>'creator')::uuid,'onlyfans','alt923010','verified',clock_timestamp(),false,($1->>'global_only')::uuid,clock_timestamp(),'alt evidence','verified') returning id) update public.creator_publishing_queue_tasks set platform_account_id=(select id from alt_account) where id=($1->>'task')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_capability_mode_not_assisted
select task17a_test.assert_claim_rejected(923011,'capability mode not assisted','PLATFORM_MODE_UNSUPPORTED',$$update public.creator_publishing_platform_capabilities set availability_status='available', publishing_mode='direct' where platform='onlyfans'$$);
update public.creator_publishing_platform_capabilities set availability_status='available', publishing_mode='assisted' where platform='onlyfans';
\echo TASK17A_SCENARIO_START: safety_creator_verification_revoked
select task17a_test.assert_claim_rejected(923012,'creator verification revoked','CREATOR_VERIFICATION_MISSING',$$update public.creator_publishing_creator_verifications set status='revoked' where creator_id=($1->>'creator')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_account_missing
select task17a_test.assert_claim_rejected(923013,'destination account missing','DESTINATION_ACCOUNT_NOT_FOUND',$$delete from public.creator_platform_accounts where id=($1->>'account')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_account_unverified
select task17a_test.assert_claim_rejected(923014,'destination account unverified','DESTINATION_ACCOUNT_NOT_VERIFIED',$$update public.creator_platform_accounts set verification_status='pending' where id=($1->>'account')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_consent_revoked
select task17a_test.assert_claim_rejected(923015,'consent revoked','AI_TWIN_CONSENT_MISSING',$$update public.creator_publishing_ai_twin_consents set revoked_at=clock_timestamp() where creator_id=($1->>'creator')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_compliance_review_missing
select task17a_test.assert_claim_rejected(923016,'matching compliance review missing','COMPLIANCE_EVIDENCE_INVALID',$$delete from public.creator_publishing_compliance_reviews where content_package_id=($1->>'package')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_compliance_status_invalid
select task17a_test.assert_claim_rejected(923017,'package compliance status invalid','COMPLIANCE_EVIDENCE_INVALID',$$update public.creator_publishing_content_packages set compliance_status='manual_review' where id=($1->>'package')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_later_blocking_review
select task17a_test.assert_claim_rejected(923018,'later blocking review','COMPLIANCE_EVIDENCE_INVALID',$$insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata) values(($1->>'package')::uuid,($1->>'global_only')::uuid,'block','human','[]','policy-v1',clock_timestamp()+interval '1 second','{}')$$);
\echo TASK17A_SCENARIO_START: safety_coperformer_missing
select task17a_test.assert_claim_rejected(923019,'co-performer record missing','CO_PERFORMER_RELEASE_MISSING',$$update public.creator_publishing_content_packages set second_person_present=true where id=($1->>'package')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_coperformer_release_incomplete
select task17a_test.assert_claim_rejected(923020,'co-performer release incomplete','CO_PERFORMER_RELEASE_MISSING',$$with upd as (update public.creator_publishing_content_packages set second_person_present=true where id=($1->>'package')::uuid returning id) insert into public.creator_publishing_co_performer_records(content_package_id,person_name,release_document_reference,platform_release_confirmed) select id,'Incomplete Performer','',false from upd$$);
\echo TASK17A_SCENARIO_START: safety_source_updated_stale
select task17a_test.assert_claim_rejected(923021,'source package updated timestamp stale','SOURCE_FINGERPRINT_STALE',$$update public.creator_publishing_platform_jobs set source_package_updated_at=source_package_updated_at - interval '1 second' where id=($1->>'job')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_active_publication_conflict
select task17a_test.assert_claim_rejected(923022,'conflicting active publication job','ACTIVE_PUBLICATION_JOB_CONFLICT',$$insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at) values(task17a_test.uuid_for('17690000-0000-4000-8000-',923022),($1->>'plan')::uuid,($1->>'creator')::uuid,($1->>'package')::uuid,($1->>'account')::uuid,'onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id=($1->>'package')::uuid),public.creator_publishing_autopost_source_fingerprint(($1->>'package')::uuid),'task14.20260711.001','9999999999999999999999999999999999999999999999999999999999999999',clock_timestamp(),clock_timestamp())$$);
\echo TASK17A_SCENARIO_START: safety_mismatched_creator
select task17a_test.assert_claim_rejected(923023,'mismatched creator','OPERATOR_TASK_JOB_MISMATCH',$$update public.creator_publishing_queue_tasks set creator_id=($1->>'other_creator')::uuid where id=($1->>'task')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_mismatched_platform
select task17a_test.assert_claim_rejected(923024,'mismatched platform','OPERATOR_TASK_JOB_MISMATCH',$$update public.creator_publishing_queue_tasks set target_platform='fansly' where id=($1->>'task')::uuid$$);
