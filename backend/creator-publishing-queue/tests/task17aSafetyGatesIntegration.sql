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
    from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), label || ' full no mutation');
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
\echo TASK17A_SCENARIO_START: account_missing_foreign_key_boundary
select task17a_test.reset_fixture(923013) as account_fk_fixture \gset
select task17a_test.expect_error('account missing foreign key boundary','foreign key constraint',format('delete from public.creator_platform_accounts where id=%L',(:'account_fk_fixture'::jsonb->>'account')));
select task17a_test.assert(exists(select 1 from public.creator_platform_accounts where id=(:'account_fk_fixture'::jsonb->>'account')::uuid), 'account FK boundary leaves account present');
select task17a_test.assert((select platform_account_id=(:'account_fk_fixture'::jsonb->>'account')::uuid from public.creator_publishing_content_packages where id=(:'account_fk_fixture'::jsonb->>'package')::uuid), 'account FK boundary package still references account');
select task17a_test.assert((select platform_account_id=(:'account_fk_fixture'::jsonb->>'account')::uuid from public.creator_publishing_platform_jobs where id=(:'account_fk_fixture'::jsonb->>'job')::uuid), 'account FK boundary job still references account');
select task17a_test.assert((select claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null from public.creator_publishing_queue_tasks where id=(:'account_fk_fixture'::jsonb->>'task')::uuid), 'account FK boundary leaves queue ownership empty');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and entity_id=(:'account_fk_fixture'::jsonb->>'task')::uuid), 'account FK boundary writes no claim audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='claim' and queue_task_id=(:'account_fk_fixture'::jsonb->>'task')::uuid), 'account FK boundary writes no idempotency');
\echo TASK17A_SCENARIO_START: account_missing_defensive_rpc_boundary
select task17a_test.reset_fixture(923113) as account_rpc_fixture \gset
begin;
alter table public.creator_publishing_content_packages drop constraint creator_publishing_content_platform_account_fk;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_account_creator_platform_fk;
delete from public.creator_platform_accounts where id=(:'account_rpc_fixture'::jsonb->>'account')::uuid;
select task17a_test.assert(not exists(select 1 from public.creator_platform_accounts where id=(:'account_rpc_fixture'::jsonb->>'account')::uuid), 'account defensive RPC setup deleted account');
select task17a_test.expect_error('account missing defensive RPC boundary','DESTINATION_ACCOUNT_NOT_FOUND',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'account_rpc_fixture'::jsonb->>'creator'),(:'account_rpc_fixture'::jsonb->>'task'),(:'account_rpc_fixture'::jsonb->>'job'),(:'account_rpc_fixture'::jsonb->>'consent_version'),(:'account_rpc_fixture'::jsonb->>'consent_hash'),'acctmissing1'));
select task17a_test.assert((select claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and claim_attempt_count=0 and operator_progress_state='not_started' from public.creator_publishing_queue_tasks where id=(:'account_rpc_fixture'::jsonb->>'task')::uuid), 'account defensive RPC leaves queue unmutated');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and idempotency_key='acctmissing1'), 'account defensive RPC writes no claim audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key='acctmissing1'), 'account defensive RPC writes no idempotency');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conname='creator_publishing_content_platform_account_fk'), 'account defensive RPC rollback restores package account FK');
select task17a_test.assert(exists(select 1 from pg_constraint where conname='creator_publishing_jobs_account_creator_platform_fk'), 'account defensive RPC rollback restores job account FK');
select task17a_test.assert(exists(select 1 from public.creator_platform_accounts where id=(:'account_rpc_fixture'::jsonb->>'account')::uuid), 'account defensive RPC rollback restores account');
\echo TASK17A_SCENARIO_START: safety_account_unverified
select task17a_test.assert_claim_rejected(923014,'destination account unverified','DESTINATION_ACCOUNT_NOT_VERIFIED',$$with upd as (update public.creator_platform_accounts set verification_status='creator_attested', verification_reviewed_by=null, verification_reviewed_at=null, verification_evidence_reference=null, verification_reason=null, verification_legacy_revoked=false where id=($1->>'account')::uuid returning verification_status, verification_reviewed_by, verification_reviewed_at, verification_evidence_reference, verification_reason, verification_legacy_revoked, verification_attested_at) select task17a_test.assert((select verification_status='creator_attested' and verification_reviewed_by is null and verification_reviewed_at is null and verification_evidence_reference is null and verification_reason is null and verification_legacy_revoked is false and verification_attested_at is not null from upd), 'account unverified setup valid')$$);
\echo TASK17A_SCENARIO_START: safety_consent_revoked
select task17a_test.assert_claim_rejected(923015,'consent revoked','AI_TWIN_CONSENT_MISSING',$$with v as (select clock_timestamp() as v_now), upd as (update public.creator_publishing_ai_twin_consents set status='revoked', revoked_at=(select v_now from v) where creator_id=($1->>'creator')::uuid returning status, granted_at, revoked_at, attestation_version, attestation_text_sha256) select task17a_test.assert((select status='revoked' and granted_at is not null and revoked_at is not null and attestation_version is not null and length(attestation_version)>0 and attestation_text_sha256 ~ '^[0-9a-f]{64}$' from upd), 'consent revoked setup valid')$$);
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
\echo TASK17A_SCENARIO_START: active_publication_unique_index_boundary
select task17a_test.reset_fixture(923022) as active_unique_fixture \gset
insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
values('17590000-0000-4000-8000-000000923022',(:'active_unique_fixture'::jsonb->>'creator')::uuid,'draft','active-unique-plan-923022','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','task14.20260711.001',clock_timestamp(),clock_timestamp());
select task17a_test.expect_error('active publication unique index boundary','creator_publishing_jobs_active_package_uidx',format('insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at) values(%L,%L,%L,%L,%L,%L,%L,%L,(select updated_at from public.creator_publishing_content_packages where id=%L),public.creator_publishing_autopost_source_fingerprint(%L),%L,%L,clock_timestamp(),clock_timestamp())','17690000-0000-4000-8000-000000923022','17590000-0000-4000-8000-000000923022',(:'active_unique_fixture'::jsonb->>'creator'),(:'active_unique_fixture'::jsonb->>'package'),(:'active_unique_fixture'::jsonb->>'account'),'onlyfans','assisted','draft',(:'active_unique_fixture'::jsonb->>'package'),(:'active_unique_fixture'::jsonb->>'package'),'task14.20260711.001','9999999999999999999999999999999999999999999999999999999999999999'));
select task17a_test.assert((select count(*) from public.creator_publishing_platform_jobs where content_package_id=(:'active_unique_fixture'::jsonb->>'package')::uuid and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived'))=1, 'active publication unique boundary leaves one active job');
select task17a_test.assert((select claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null from public.creator_publishing_queue_tasks where id=(:'active_unique_fixture'::jsonb->>'task')::uuid), 'active publication unique boundary leaves queue unclaimed');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and entity_id=(:'active_unique_fixture'::jsonb->>'task')::uuid), 'active publication unique boundary writes no claim audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='claim' and queue_task_id=(:'active_unique_fixture'::jsonb->>'task')::uuid), 'active publication unique boundary writes no idempotency');
\echo TASK17A_SCENARIO_START: active_publication_defensive_rpc_boundary
select task17a_test.reset_fixture(923122) as active_rpc_fixture \gset
begin;
drop index public.creator_publishing_jobs_active_package_uidx;
insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
values('17590000-0000-4000-8000-000000923122',(:'active_rpc_fixture'::jsonb->>'creator')::uuid,'draft','active-rpc-plan-923122','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','task14.20260711.001',clock_timestamp(),clock_timestamp());
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values('17690000-0000-4000-8000-000000923122','17590000-0000-4000-8000-000000923122',(:'active_rpc_fixture'::jsonb->>'creator')::uuid,(:'active_rpc_fixture'::jsonb->>'package')::uuid,(:'active_rpc_fixture'::jsonb->>'account')::uuid,'onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id=(:'active_rpc_fixture'::jsonb->>'package')::uuid),public.creator_publishing_autopost_source_fingerprint((:'active_rpc_fixture'::jsonb->>'package')::uuid),'task14.20260711.001','9999999999999999999999999999999999999999999999999999999999999999',clock_timestamp(),clock_timestamp());
select task17a_test.expect_error('active publication defensive RPC boundary','ACTIVE_PUBLICATION_JOB_CONFLICT',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'active_rpc_fixture'::jsonb->>'creator'),(:'active_rpc_fixture'::jsonb->>'task'),(:'active_rpc_fixture'::jsonb->>'job'),(:'active_rpc_fixture'::jsonb->>'consent_version'),(:'active_rpc_fixture'::jsonb->>'consent_hash'),'activeconf1'));
select task17a_test.assert((select claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null from public.creator_publishing_queue_tasks where id=(:'active_rpc_fixture'::jsonb->>'task')::uuid), 'active publication defensive RPC leaves queue unclaimed');
select task17a_test.assert((select count(*) from public.creator_publishing_platform_jobs where content_package_id=(:'active_rpc_fixture'::jsonb->>'package')::uuid and job_state='draft')=2, 'active publication defensive RPC setup has two active jobs');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and idempotency_key='activeconf1'), 'active publication defensive RPC writes no claim audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key='activeconf1'), 'active publication defensive RPC writes no idempotency');
rollback;
select task17a_test.assert(to_regclass('public.creator_publishing_jobs_active_package_uidx') is not null, 'active publication defensive RPC rollback restores active job index');
select task17a_test.assert((select count(*) from public.creator_publishing_platform_jobs where content_package_id=(:'active_rpc_fixture'::jsonb->>'package')::uuid and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived'))=1, 'active publication defensive RPC rollback leaves one active job');
\echo TASK17A_SCENARIO_START: safety_mismatched_creator
select task17a_test.assert_claim_rejected(923023,'mismatched creator','OPERATOR_TASK_JOB_MISMATCH',$$update public.creator_publishing_queue_tasks set creator_id=($1->>'other_creator')::uuid where id=($1->>'task')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_mismatched_platform
select task17a_test.assert_claim_rejected(923024,'mismatched platform','OPERATOR_TASK_JOB_MISMATCH',$$update public.creator_publishing_queue_tasks set target_platform='fansly' where id=($1->>'task')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_compliance_human_pass_rejected
select task17a_test.assert_claim_rejected(923025,'passed package requires automated pass','COMPLIANCE_EVIDENCE_INVALID',$$with del as (delete from public.creator_publishing_compliance_reviews where content_package_id=($1->>'package')::uuid returning 1), ins as (insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata) values(($1->>'package')::uuid,($1->>'global_only')::uuid,'pass','human','[]','policy-v1',clock_timestamp(),'{}') returning 1) select task17a_test.assert(exists(select 1 from ins), 'human pass setup valid')$$);
\echo TASK17A_SCENARIO_START: safety_compliance_policy_mismatch_rejected
select task17a_test.assert_claim_rejected(923026,'compliance policy mismatch rejected','COMPLIANCE_EVIDENCE_INVALID',$$update public.creator_publishing_content_packages set compliance_policy_version='policy-v2' where id=($1->>'package')::uuid$$);
\echo TASK17A_SCENARIO_START: safety_compliance_later_manual_review_rejected
select task17a_test.assert_claim_rejected(923027,'later manual review rejected','COMPLIANCE_EVIDENCE_INVALID',$$insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata) values(($1->>'package')::uuid,($1->>'global_only')::uuid,'manual_review','automated','[]','policy-v1',clock_timestamp()+interval '1 second','{}')$$);
\echo TASK17A_SCENARIO_START: safety_compliance_escalated_approved_valid
select task17a_test.reset_fixture(923028) as escalation_fixture \gset
delete from public.creator_publishing_compliance_reviews where content_package_id=(:'escalation_fixture'::jsonb->>'package')::uuid;
insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata,escalated_approval_reason) values((:'escalation_fixture'::jsonb->>'package')::uuid,(:'escalation_fixture'::jsonb->>'global_only')::uuid,'escalate','human','[]','policy-v1',clock_timestamp(),'{}','documented escalation');
update public.creator_publishing_content_packages set compliance_status='escalated_approved', compliance_policy_version='policy-v1' where id=(:'escalation_fixture'::jsonb->>'package')::uuid;
update public.creator_publishing_platform_jobs set source_package_updated_at=(select updated_at from public.creator_publishing_content_packages where id=(:'escalation_fixture'::jsonb->>'package')::uuid), source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint((:'escalation_fixture'::jsonb->>'package')::uuid) where id=(:'escalation_fixture'::jsonb->>'job')::uuid;
select public.creator_publishing_claim_onlyfans_operator_task((:'escalation_fixture'::jsonb->>'creator')::uuid,(:'escalation_fixture'::jsonb->>'task')::uuid,(:'escalation_fixture'::jsonb->>'job')::uuid,:'escalation_fixture'::jsonb->>'consent_version',:'escalation_fixture'::jsonb->>'consent_hash','escalatevalid1') as escalation_claim \gset
select task17a_test.assert((:'escalation_claim')::jsonb->>'ok'='true', 'valid human escalation claim succeeds');
\echo TASK17A_SCENARIO_START: safety_compliance_automated_escalation_rejected
select task17a_test.assert_claim_rejected(923029,'automated escalation rejected','COMPLIANCE_EVIDENCE_INVALID',$$with del as (delete from public.creator_publishing_compliance_reviews where content_package_id=($1->>'package')::uuid returning 1), ins as (insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata,escalated_approval_reason) values(($1->>'package')::uuid,($1->>'global_only')::uuid,'escalate','automated','[]','policy-v1',clock_timestamp(),'{}','bad automated escalation') returning 1), pkg as (update public.creator_publishing_content_packages set compliance_status='escalated_approved', compliance_policy_version='policy-v1' where id=($1->>'package')::uuid returning updated_at), job as (update public.creator_publishing_platform_jobs set source_package_updated_at=(select updated_at from pkg), source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(($1->>'package')::uuid) where id=($1->>'job')::uuid returning 1) select task17a_test.assert(exists(select 1 from ins) and exists(select 1 from pkg) and exists(select 1 from job), 'automated escalation setup valid')$$);
