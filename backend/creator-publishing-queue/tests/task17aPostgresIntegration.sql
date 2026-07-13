create or replace function public.task17a_assert(condition boolean, message text) returns void language plpgsql as $$ begin if not condition then raise exception 'Task17A assertion failed: %', message; end if; end; $$;
select public.task17a_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_token'), 'queue task has claim_token');
select public.task17a_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_expires_at'), 'queue task has claim_expires_at');
select public.task17a_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='operator_progress_state'), 'queue task has operator progress');
select public.task17a_assert(to_regclass('public.creator_publishing_operator_authorizations') is not null, 'operator authorization table exists');
select public.task17a_assert(to_regclass('public.creator_publishing_operator_action_idempotency') is not null, 'operator idempotency table exists');
select public.task17a_assert(has_function_privilege('authenticated','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text)','execute') is false, 'authenticated cannot claim');
select public.task17a_assert(has_function_privilege('service_role','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text)','execute') is true, 'service role can claim');
select public.task17a_assert(not exists(select 1 from information_schema.tables where table_schema='public' and table_name like '%operator%task%'), 'no second operator task table');
select public.task17a_assert(exists(select 1 from pg_constraint where conname='creator_publishing_queue_claim_fields_consistent'), 'strict claim consistency constraint exists');
select public.task17a_assert(exists(select 1 from pg_proc where proname='creator_publishing_schedule_plan'), 'Task 15 schedule function present after 01400');
select public.task17a_assert(exists(select 1 from pg_proc where proname='creator_publishing_process_scheduler_event'), 'Task 15 process function present after 01400');

-- Claim consistency: malformed claimed state fails closed, but complete active claim shape is schema-valid.
do $$
declare v_constraint_ok boolean := false;
begin
  begin
    insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,claimed_by,claimed_at,created_at,updated_at)
    values ('6fffffff-ffff-4fff-8fff-000000000001','30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000001','claimed','00000000-0000-4000-8000-000000000001',now(),now(),now());
  exception when check_violation then v_constraint_ok := true;
  end;
  perform public.task17a_assert(v_constraint_ok, 'malformed partial claimed task is rejected');
end $$;

-- Authorization helper: creator self-authorizes; active creator-specific authorization works; revoked authorization fails.
insert into auth.users(id,email) values ('00000000-0000-4000-8000-0000000000aa','operator-a@example.test'),('00000000-0000-4000-8000-0000000000bb','operator-b@example.test') on conflict do nothing;
select public.task17a_assert(public.creator_publishing_onlyfans_operator_authorized('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'), 'creator can operate own task');
insert into public.creator_publishing_operator_authorizations(creator_id,operator_id,platform,status,authorized_at,created_at,updated_at)
values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000aa','onlyfans','active',now(),now(),now()) on conflict do nothing;
select public.task17a_assert(public.creator_publishing_onlyfans_operator_authorized('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000aa'), 'authorized operator can operate');
insert into public.creator_publishing_operator_authorizations(creator_id,operator_id,platform,status,authorized_at,revoked_at,created_at,updated_at)
values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000bb','onlyfans','revoked',now(),now(),now(),now());
select public.task17a_assert(not public.creator_publishing_onlyfans_operator_authorized('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000bb'), 'revoked operator cannot operate');

-- Status restoration helper: terminal/cancelled fails closed; unscheduled/upcoming/due states map only to pre-Task-18 queue statuses.
select public.task17a_assert(public.creator_publishing_onlyfans_queue_status_from_schedule(j, clock_timestamp())='ready_for_handoff', 'unscheduled maps to ready_for_handoff') from public.creator_publishing_platform_jobs j where j.id='80000000-0000-4000-8000-000000000001';


-- Bounded claim lifetime: exactly 30 minutes is valid; exceeding 30 minutes fails; nonclaimed cannot retain any ownership field.
do $$
declare v_claimed_ok boolean := false; v_too_long_ok boolean := false; v_nonclaimed_ok boolean := false;
begin
  insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,claimed_by,claimed_at,claim_token,claim_expires_at,created_at,updated_at)
  values ('6fffffff-ffff-4fff-8fff-000000000002','30000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000001','claimed','00000000-0000-4000-8000-000000000001',now(),'90000000-0000-4000-8000-000000000777',now()+interval '30 minutes',now(),now());
  v_claimed_ok := true;
  begin
    insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,claimed_by,claimed_at,claim_token,claim_expires_at,created_at,updated_at)
    values ('6fffffff-ffff-4fff-8fff-000000000003','30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000001','claimed','00000000-0000-4000-8000-000000000001',now(),'90000000-0000-4000-8000-000000000778',now()+interval '31 minutes',now(),now());
  exception when check_violation then v_too_long_ok := true;
  end;
  begin
    insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,claimed_by,claimed_at,claim_token,claim_expires_at,created_at,updated_at)
    values ('6fffffff-ffff-4fff-8fff-000000000004','30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000001','ready_for_handoff','00000000-0000-4000-8000-000000000001',now(),'90000000-0000-4000-8000-000000000779',now()+interval '30 minutes',now(),now());
  exception when check_violation then v_nonclaimed_ok := true;
  end;
  perform public.task17a_assert(v_claimed_ok, 'exactly 30 minute claim is valid');
  perform public.task17a_assert(v_too_long_ok, 'claim exceeding 30 minutes is rejected');
  perform public.task17a_assert(v_nonclaimed_ok, 'nonclaimed task cannot retain ownership fields');
end $$;

-- Behavioral RPC fixture: create media before creator approval so the production media
-- invalidation trigger is respected, then fingerprint the final approved package state.
insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_by,creator_approved_at,created_at,updated_at)
values ('31000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','onlyfans','task17a claim pkg','caption',null,'ai_generated','{}','pending','unassigned','pending',null,null,now(),now());
insert into public.generations(id,user_id,status,r2_bucket,r2_key,metadata) values ('41000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','completed','bucket','task17a-key','{}');
insert into public.creator_publishing_media_assets(id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at)
values ('51000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','media/task17a','image/png','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','ai_pipeline','{"generation_id":"41000000-0000-4000-8000-000000000001"}',now());
insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata)
values ('31000000-0000-4000-8000-000000000001',null,'pass','automated','[]'::jsonb,'policy-v1',now(),'{}'::jsonb);
update public.creator_publishing_content_packages
set compliance_status='passed',
    compliance_policy_version='policy-v1',
    forced_disclosure_text='#AI',
    creator_approval_status='approved',
    creator_approved_by='00000000-0000-4000-8000-000000000001',
    creator_approved_at=now(),
    updated_at=now()
where id='31000000-0000-4000-8000-000000000001';
insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
values ('71000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','draft','task17a-plan-key-0001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','task14.20260711.001',now(),now());
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values ('81000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id='31000000-0000-4000-8000-000000000001'),public.creator_publishing_autopost_source_fingerprint('31000000-0000-4000-8000-000000000001'),'task14.20260711.001','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',now(),now());
insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,due_at,created_at,updated_at)
values ('61000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000001','ready_for_handoff',null,now(),now());

select public.task17a_assert((select creator_approval_status from public.creator_publishing_content_packages where id='31000000-0000-4000-8000-000000000001')='approved', 'fixture package is approved before claim');
select public.task17a_assert((select compliance_status from public.creator_publishing_content_packages where id='31000000-0000-4000-8000-000000000001')='passed', 'fixture package compliance is passed');
select public.task17a_assert((select compliance_policy_version from public.creator_publishing_content_packages where id='31000000-0000-4000-8000-000000000001')='policy-v1', 'fixture package policy is current');
select public.task17a_assert((select creator_approved_by from public.creator_publishing_content_packages where id='31000000-0000-4000-8000-000000000001')='00000000-0000-4000-8000-000000000001', 'fixture package approval actor is creator');
select public.task17a_assert((select creator_approved_at is not null from public.creator_publishing_content_packages where id='31000000-0000-4000-8000-000000000001'), 'fixture package approval timestamp exists');
select public.task17a_assert((select count(*) from public.creator_publishing_queue_tasks where content_package_id='31000000-0000-4000-8000-000000000001' and target_platform='onlyfans' and status <> 'archived')=1, 'fixture has exactly one active matching queue task');
select public.task17a_assert((select status from public.creator_publishing_queue_tasks where id='61000000-0000-4000-8000-000000000001')='ready_for_handoff', 'fixture queue task starts ready_for_handoff');
select public.task17a_assert((select source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(content_package_id) from public.creator_publishing_platform_jobs where id='81000000-0000-4000-8000-000000000001'), 'fixture job stores final source fingerprint');
select public.task17a_assert(exists(select 1 from public.creator_platform_accounts where id='20000000-0000-4000-8000-000000000001' and platform='onlyfans' and verification_status='verified'), 'fixture destination account is verified');
select public.task17a_assert(exists(select 1 from public.creator_publishing_creator_verifications where creator_id='00000000-0000-4000-8000-000000000001' and status='verified'), 'fixture creator verification is valid');
select public.task17a_assert(exists(select 1 from public.creator_publishing_ai_twin_consents where creator_id='00000000-0000-4000-8000-000000000001' and attestation_version='creator-ai-twin-consent-v1' and attestation_text_sha256='0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12' and status='granted' and revoked_at is null), 'fixture consent matches current policy identity');
select public.task17a_assert(exists(select 1 from public.creator_publishing_platform_capabilities where platform='onlyfans' and availability_status='available' and publishing_mode='assisted'), 'fixture OnlyFans capability is available assisted');

-- Deterministic invalid input validation happens before mutation or audit.
do $$
declare v_bad_short boolean := false; v_bad_chars boolean := false; v_missing_consent boolean := false; v_bad_hash boolean := false; v_audits_before integer; v_audits_after integer;
begin
  select count(*) into v_audits_before from public.creator_publishing_audit_events where entity_id='61000000-0000-4000-8000-000000000001';
  begin
    perform public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','short');
  exception when others then v_bad_short := sqlerrm like '%OPERATOR_INVALID_REQUEST%'; end;
  begin
    perform public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','bad key!');
  exception when others then v_bad_chars := sqlerrm like '%OPERATOR_INVALID_REQUEST%'; end;
  begin
    perform public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','task17a-bad-consent-key-0001');
  exception when others then v_missing_consent := sqlerrm like '%OPERATOR_INVALID_REQUEST%'; end;
  begin
    perform public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','not-a-sha','task17a-bad-hash-key-0001');
  exception when others then v_bad_hash := sqlerrm like '%OPERATOR_INVALID_REQUEST%'; end;
  select count(*) into v_audits_after from public.creator_publishing_audit_events where entity_id='61000000-0000-4000-8000-000000000001';
  perform public.task17a_assert(v_bad_short and v_bad_chars and v_missing_consent and v_bad_hash, 'invalid request inputs fail deterministically');
  perform public.task17a_assert(v_audits_before = v_audits_after, 'invalid request inputs write no audit');
  perform public.task17a_assert((select status from public.creator_publishing_queue_tasks where id='61000000-0000-4000-8000-000000000001')='ready_for_handoff', 'invalid request inputs do not mutate queue task');
end $$;
select public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','task17a-claim-key-0001') as task17a_claim_result \gset
select public.task17a_assert((:'task17a_claim_result')::jsonb->>'status'='claimed', 'creator self-claim succeeds');
select public.task17a_assert((select status from public.creator_publishing_queue_tasks where id='61000000-0000-4000-8000-000000000001')='claimed', 'claim mutates queue task to claimed');
select public.task17a_assert(public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','task17a-claim-key-0001') = (:'task17a_claim_result')::jsonb, 'claim replay returns stored result');
select public.creator_publishing_update_onlyfans_operator_progress('00000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',((:'task17a_claim_result')::jsonb->>'claim_token')::uuid,'not_started','preparing','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','task17a-progress-key-0001') as task17a_progress_result \gset
select public.task17a_assert((:'task17a_progress_result')::jsonb->>'progress_state'='preparing', 'progress transition succeeds');
create temp table task17a_claim_token as select ((:'task17a_claim_result')::jsonb->>'claim_token')::uuid as claim_token;
update public.creator_publishing_platform_capabilities set availability_status='disabled', publishing_mode='disabled', updated_at=now() where platform='onlyfans';
do $$
declare v_progress_blocked boolean := false; v_claim_blocked boolean := false; v_claim_token uuid;
begin
  select claim_token into v_claim_token from task17a_claim_token;
  begin
    perform public.creator_publishing_update_onlyfans_operator_progress('00000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',v_claim_token,'preparing','prepared','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','task17a-progress-key-0002');
  exception when others then v_progress_blocked := sqlerrm like '%PLATFORM_UNAVAILABLE%'; end;
  begin
    perform public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-0000000000aa','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','task17a-claim-key-0002');
  exception when others then v_claim_blocked := sqlerrm like '%PLATFORM_UNAVAILABLE%' or sqlerrm like '%OPERATOR_TASK_ALREADY_CLAIMED%'; end;
  perform public.task17a_assert(v_progress_blocked, 'progress is blocked by capability drift');
  perform public.task17a_assert(v_claim_blocked, 'new claim is blocked while capability is unavailable');
end $$;
select public.creator_publishing_release_onlyfans_operator_task('00000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',((:'task17a_claim_result')::jsonb->>'claim_token')::uuid,'task17a-release-key-0001') as task17a_release_result \gset
select public.task17a_assert((:'task17a_release_result')::jsonb->>'status'='ready_for_handoff', 'release restores unscheduled queue state');
select public.task17a_assert((select operator_progress_state from public.creator_publishing_queue_tasks where id='61000000-0000-4000-8000-000000000001')='preparing', 'release preserves progress history');
update public.creator_publishing_platform_capabilities set availability_status='available', publishing_mode='assisted', updated_at=now() where platform='onlyfans';

-- Task 15 compatibility helper accepts legitimate unclaimed due states but does not require a queue-status regression.
update public.creator_publishing_platform_jobs set schedule_revision=1, operator_due_at=now()-interval '5 minutes', intended_publish_at=now()+interval '55 minutes', job_state='scheduled_internally' where id='81000000-0000-4000-8000-000000000001';
update public.creator_publishing_queue_tasks set status='awaiting_operator', updated_at=now() where id='61000000-0000-4000-8000-000000000001';
select public.task17a_assert(public.creator_publishing_task17a_queue_task_compatible(j, now(), array['ready_for_handoff','scheduled_internally','awaiting_operator','due_now']::text[]), 'operator_due compatibility accepts existing awaiting_operator queue task') from public.creator_publishing_platform_jobs j where j.id='81000000-0000-4000-8000-000000000001';
update public.creator_publishing_queue_tasks set status='due_now', updated_at=now() where id='61000000-0000-4000-8000-000000000001';
select public.task17a_assert(public.creator_publishing_task17a_queue_task_compatible(j, now(), array['ready_for_handoff','scheduled_internally','awaiting_operator','due_now']::text[]), 'operator_due compatibility accepts existing due_now queue task without regression') from public.creator_publishing_platform_jobs j where j.id='81000000-0000-4000-8000-000000000001';
update public.creator_publishing_queue_tasks set status='blocked', updated_at=now() where id='61000000-0000-4000-8000-000000000001';
select public.task17a_assert(not public.creator_publishing_task17a_queue_task_compatible(j, now(), array['ready_for_handoff','scheduled_internally','awaiting_operator','due_now']::text[]), 'blocked queue status fails closed') from public.creator_publishing_platform_jobs j where j.id='81000000-0000-4000-8000-000000000001';
