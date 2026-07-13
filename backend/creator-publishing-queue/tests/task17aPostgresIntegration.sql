\set ON_ERROR_STOP on
\echo 'Task 17A integration assertions starting'

create or replace function public.task17a_assert(p_condition boolean, p_message text)
returns void language plpgsql as $$ begin if not p_condition then raise exception 'ASSERTION_FAILED: %', p_message; end if; end $$;

insert into auth.users(id,email) values
('00000000-0000-4000-8000-000000000011','task17a-creator@example.test'),
('00000000-0000-4000-8000-000000000012','task17a-operator@example.test'),
('00000000-0000-4000-8000-000000000013','task17a-other@example.test')
on conflict do nothing;

insert into public.creator_publishing_trusted_reviewers(reviewer_id,role,active,created_at)
values ('00000000-0000-4000-8000-000000000012','operator',true,now())
on conflict (reviewer_id) do update set role='operator',active=true;

insert into public.creator_publishing_creator_verifications(creator_id,status,evidence_reference,reason,reviewed_by,reviewed_at,created_at,updated_at)
values ('00000000-0000-4000-8000-000000000011','verified','task17a-fixture','Task 17A fixture','00000000-0000-4000-8000-000000000013',now(),now(),now());

insert into public.creator_publishing_ai_twin_consents(creator_id,status,attestation_version,attestation_text_sha256,granted_at,created_at,updated_at)
values ('00000000-0000-4000-8000-000000000011','granted','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',now(),now(),now());

insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_attested_at,verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason,created_at,updated_at)
values ('20000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','onlyfans','task17a_creator','verified',now(),'00000000-0000-4000-8000-000000000013',now(),'task17a-fixture','Task 17A fixture',now(),now());

insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_at,creator_approved_by,created_at,updated_at)
values
('30000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000011','onlyfans','Task 17A unscheduled','#ai Task 17A unscheduled','#ai','ai_generated','{}','pending','unassigned','pending',null,null,now(),now()),
('30000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000011','onlyfans','Task 17A scheduled','#ai Task 17A scheduled','#ai','ai_generated','{}','pending','unassigned','pending',null,null,now(),now());

insert into public.generations(id,user_id,status,r2_bucket,r2_key,metadata) values
('40000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','completed','bucket','task17a-key-11','{}'),
('40000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000011','completed','bucket','task17a-key-12','{}');

insert into public.creator_publishing_media_assets(id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at) values
('50000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000011','media/task17a-11','image/png','1111111111111111111111111111111111111111111111111111111111111111','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000011"}',now()),
('50000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000012','media/task17a-12','image/png','1212121212121212121212121212121212121212121212121212121212121212','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000012"}',now());

insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata)
values
('30000000-0000-4000-8000-000000000011',null,'pass','automated','[]','policy-task17a',now(),'{}'),
('30000000-0000-4000-8000-000000000012',null,'pass','automated','[]','policy-task17a',now(),'{}');

update public.creator_publishing_content_packages
set compliance_status='passed',compliance_policy_version='policy-task17a',creator_approval_status='approved',creator_approved_at=now(),creator_approved_by='00000000-0000-4000-8000-000000000011'
where id in ('30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000012');

insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,due_at,created_at,updated_at)
values
('60000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','onlyfans','20000000-0000-4000-8000-000000000011','ready_for_handoff',null,now(),now()),
('60000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000011','onlyfans','20000000-0000-4000-8000-000000000011','scheduled_internally',now()+interval '1 hour',now(),now());

insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
values
('70000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','draft','task17a-plan-key-11','1111111111111111111111111111111111111111111111111111111111111711','task14.20260711.001',now(),now()),
('70000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000011','scheduled','task17a-plan-key-12','1212121212121212121212121212121212121212121212121212121212121712','task14.20260711.001',now(),now());

insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values
('80000000-0000-4000-8000-000000000011','70000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000011','onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000011'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000011'),'task14.20260711.001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11',now(),now()),
('80000000-0000-4000-8000-000000000012','70000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000011','onlyfans','assisted','scheduled_internally',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000012'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000012'),'task14.20260711.001','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb12',now(),now());

update public.creator_publishing_platform_jobs
set intended_publish_at=now()+interval '2 hours',schedule_timezone='UTC',operator_due_at=now()+interval '1 hour',schedule_revision=1,scheduled_at=now(),scheduled_by='00000000-0000-4000-8000-000000000011'
where id='80000000-0000-4000-8000-000000000012';

select public.task17a_assert(public.creator_publishing_onlyfans_operator_is_authorized('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011'),'creator may operate own task');
select public.task17a_assert(not public.creator_publishing_onlyfans_operator_is_authorized('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012'),'global operator role alone grants no creator access');

do $$ begin
  begin
    perform public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000011',15,'unauthorized-claim-0001');
    raise exception 'expected OPERATOR_UNAUTHORIZED';
  exception when others then if sqlerrm not like '%OPERATOR_UNAUTHORIZED%' then raise; end if; end;
end $$;

select public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000011',15,'creator-claim-0001') as creator_claim_result \gset
select public.task17a_assert((:'creator_claim_result')::jsonb->>'idempotent'='false','creator claims unscheduled ready work immediately');
select public.task17a_assert(status='claimed' and claimed_by='00000000-0000-4000-8000-000000000011' and claimed_at is not null and claim_token is not null and claim_expires_at is not null and assigned_operator_id is null,'active ownership uses approved claim fields and leaves assigned_operator_id unchanged') from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000011';
select public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000011',15,'creator-claim-0001') as creator_claim_replay \gset
select public.task17a_assert((:'creator_claim_replay')::jsonb->>'idempotent'='true','claim replay is idempotent');

select public.creator_publishing_update_onlyfans_operator_progress('00000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000011',((:'creator_claim_result')::jsonb->>'claim_token')::uuid,'preparing','creator-progress-0001');
select public.creator_publishing_update_onlyfans_operator_progress('00000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000011',((:'creator_claim_result')::jsonb->>'claim_token')::uuid,'prepared','creator-progress-0002');
select public.creator_publishing_update_onlyfans_operator_progress('00000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000011',((:'creator_claim_result')::jsonb->>'claim_token')::uuid,'handoff_ready','creator-progress-0003');
select public.task17a_assert(operator_progress_state='handoff_ready' and progress_updated_by='00000000-0000-4000-8000-000000000011','preparation progress reaches handoff ready without Task 18 state') from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000011';

select public.creator_publishing_release_onlyfans_operator_task('00000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000011',((:'creator_claim_result')::jsonb->>'claim_token')::uuid,'Creator released fixture','creator-release-0001');
select public.task17a_assert(status='ready_for_handoff' and claimed_by is null and claim_token is null and operator_progress_state='handoff_ready','release restores unscheduled status and preserves preparation progress') from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000011';

do $$ begin
  begin
    perform public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000012',15,'upcoming-claim-0001');
    raise exception 'expected OPERATOR_NOT_DUE';
  exception when others then if sqlerrm not like '%OPERATOR_NOT_DUE%' then raise; end if; end;
end $$;
select public.task17a_assert(status='scheduled_internally' and claimed_by is null,'upcoming scheduled work remains read-only') from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000012';

insert into public.creator_publishing_operator_authorizations(creator_id,operator_id,platform,status,authorized_at,authorized_by,created_at,updated_at)
values ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','onlyfans','active',now(),'00000000-0000-4000-8000-000000000011',now(),now());
select public.task17a_assert(public.creator_publishing_onlyfans_operator_is_authorized('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012'),'creator-specific authorization enables operator');

update public.creator_publishing_platform_jobs
set intended_publish_at=now()-interval '1 minute',operator_due_at=now()-interval '61 minutes',job_state='awaiting_operator'
where id='80000000-0000-4000-8000-000000000012';
update public.creator_publishing_queue_tasks set status='awaiting_operator',due_at=now()-interval '61 minutes' where id='60000000-0000-4000-8000-000000000012';

select public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000012',30,'authorized-claim-0001') as operator_claim_result \gset
select public.task17a_assert(status='claimed' and claimed_by='00000000-0000-4000-8000-000000000012','authorized operator claims scheduled work after operator due') from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000012';

do $$ begin
  begin
    perform public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000013','60000000-0000-4000-8000-000000000012',30,'competing-claim-0001');
    raise exception 'expected OPERATOR_UNAUTHORIZED or OPERATOR_ALREADY_CLAIMED';
  exception when others then if sqlerrm not like '%OPERATOR_UNAUTHORIZED%' and sqlerrm not like '%OPERATOR_ALREADY_CLAIMED%' then raise; end if; end;
end $$;

insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,processing_attempts,lock_token,locked_at,created_at,updated_at)
values ('90000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000011','70000000-0000-4000-8000-000000000012','80000000-0000-4000-8000-000000000012','publish_due','processing',now()-interval '1 minute',1,1,'91000000-0000-4000-8000-000000000012',now(),now(),now());

select public.creator_publishing_process_scheduler_event('90000000-0000-4000-8000-000000000012','91000000-0000-4000-8000-000000000012','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as claimed_publish_due_result \gset
select public.task17a_assert((:'claimed_publish_due_result')::jsonb->>'status'='processed','Task 15 publish due processes through valid active claim');
select public.task17a_assert(job_state='due_now' and schedule_revision=1,'Task 15 advances platform job to due_now without changing revision') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000012';
select public.task17a_assert(status='claimed' and claimed_by='00000000-0000-4000-8000-000000000012' and claim_token=((:'operator_claim_result')::jsonb->>'claim_token')::uuid,'valid active queue claim remains claimed after publish due') from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000012';

update public.creator_publishing_queue_tasks set claimed_at=now()-interval '20 minutes',claim_expires_at=now()-interval '1 minute' where id='60000000-0000-4000-8000-000000000012';
select public.creator_publishing_recover_expired_onlyfans_operator_claim('00000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000012','recover-expired-0001');
select public.task17a_assert(status='due_now' and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null,'explicit authorized recovery restores due_now and clears active ownership') from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000012';

select public.task17a_assert((select count(*) from public.creator_publishing_operator_action_idempotency where creator_id='00000000-0000-4000-8000-000000000011')>=7,'operator actions persist idempotency records');
select public.task17a_assert(not has_table_privilege('authenticated','public.creator_publishing_operator_authorizations','SELECT'),'authenticated role has no direct authorization-table access');
select public.task17a_assert(not has_table_privilege('authenticated','public.creator_publishing_operator_action_idempotency','SELECT'),'authenticated role has no direct idempotency-table access');
select public.task17a_assert(not has_function_privilege('authenticated','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,integer,text)','EXECUTE'),'claim RPC is service-role only');
select public.task17a_assert(not has_function_privilege('authenticated','public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)','EXECUTE'),'Task 15 compatibility wrapper remains service-role only');

select public.task17a_assert(not exists(select 1 from public.creator_publishing_queue_tasks where id in ('60000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000012') and (posted_by is not null or posted_at is not null or posted_confirmation is true or final_post_url is not null or proof_screenshot_storage_key is not null)),'Task 17A does not write Task 18 confirmation fields');
select public.task17a_assert((select assigned_operator_id from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000011') is null and (select assigned_operator_id from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000012') is null,'assigned_operator_id remains legacy and untouched');

\echo 'Task 17A integration assertions completed'
