create or replace function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'ASSERT:%',label;end if;end$$;
-- Migration is additive and performs no Fanvue job/attempt backfill.
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_platform_jobs where target_platform='fanvue'),'no job backfill');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_fanvue_attempts),'no attempt backfill');
insert into public.creator_publishing_creator_verifications(creator_id,status,evidence_reference,reason,reviewed_by,reviewed_at) values('11111111-1111-4111-8111-111111111111','verified','fixture://verification','fixture','33333333-3333-4333-8333-333333333333',clock_timestamp()) on conflict(creator_id) do update set status='verified';
insert into public.creator_publishing_ai_twin_consents(creator_id,status,attestation_version,attestation_text_sha256,granted_at,revoked_at) values('11111111-1111-4111-8111-111111111111','granted','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',clock_timestamp(),null) on conflict(creator_id) do update set status='granted',revoked_at=null,attestation_version=excluded.attestation_version,attestation_text_sha256=excluded.attestation_text_sha256;
update public.creator_publishing_content_packages set creator_approval_status='approved',creator_approved_by=creator_id,creator_approved_at=clock_timestamp(),compliance_status='passed',compliance_policy_version='fanvue-launch-test-v1',second_person_present=false where target_platform='fanvue';
insert into public.creator_publishing_compliance_reviews(content_package_id,review_source,outcome,compliance_policy_version,created_at) select id,'automated','pass','fanvue-launch-test-v1',clock_timestamp() from public.creator_publishing_content_packages where target_platform='fanvue';
insert into public.creator_publishing_plans(id,creator_id,idempotency_key,request_fingerprint,registry_version) values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','server_key_01',repeat('a',64),'task14.20260711.001');
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,oauth_account_id,publication_type,server_idempotency_key)
select '55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444',p.creator_id,p.id,p.platform_account_id,'fanvue','direct','draft',p.updated_at,public.creator_publishing_autopost_source_fingerprint(p.id),'task14.20260711.001',repeat('c',64),a.id,'text','server-derived-logical-request' from public.creator_publishing_content_packages p join public.creator_platform_accounts d on d.id=p.platform_account_id join public.autopost_accounts a on a.id=d.oauth_account_id where p.target_platform='fanvue' limit 1;
create temp table scheduled as select public.creator_publishing_schedule_plan('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',clock_timestamp()+interval '2 hours','UTC','fanvue_schedule_01','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['55555555-5555-4555-8555-555555555555'::uuid]) result;
select pg_temp.assert_true((select intended_publish_at>clock_timestamp() and schedule_timezone='UTC' and schedule_revision=1 and job_state='ready_to_publish' from public.creator_publishing_platform_jobs where id='55555555-5555-4555-8555-555555555555'),'canonical schedule fields');
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_scheduler_events where platform_job_id='55555555-5555-4555-8555-555555555555' and event_type='publish_due' and status='pending'),'publish due created');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_scheduler_events where platform_job_id='55555555-5555-4555-8555-555555555555' and event_type='operator_due'),'no Fanvue operator due');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_claim_due_scheduler_events(1,15)),'future scheduler event not claimed');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_claim_scheduled_fanvue_jobs(1,15)),'future job not worker eligible');
update public.creator_publishing_platform_jobs set intended_publish_at=clock_timestamp()-interval '1 minute' where id='55555555-5555-4555-8555-555555555555';update public.creator_publishing_scheduler_events set due_at=(select intended_publish_at from public.creator_publishing_platform_jobs where id=platform_job_id) where platform_job_id='55555555-5555-4555-8555-555555555555';
create temp table scheduler_claim as select * from public.creator_publishing_claim_due_scheduler_events(1,15);
create temp table scheduler_process as select public.creator_publishing_process_scheduler_event((select event_id from scheduler_claim),(select lock_token from scheduler_claim),'creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') result;
select pg_temp.assert_true((select job_state='direct_publish_queued' from public.creator_publishing_platform_jobs where id='55555555-5555-4555-8555-555555555555'),'scheduler makes worker eligible');
select pg_temp.assert_true((select status='processed' from public.creator_publishing_scheduler_events where id=(select event_id from scheduler_claim)),'canonical event processed');
create temp table claim as select * from public.creator_publishing_claim_scheduled_fanvue_jobs(1,15);
select pg_temp.assert_true((select count(*)=1 from claim),'due worker claim');select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_fanvue_attempts where id=(select attempt_id from claim)),'attempt durable at claim');
select pg_temp.assert_true(public.creator_publishing_mark_fanvue_create_dispatched((select attempt_id from claim),(select lease_token from claim)),'dispatch marker durable');update public.creator_publishing_platform_jobs set leased_at=clock_timestamp()-interval '16 minutes' where id='55555555-5555-4555-8555-555555555555';select count(*) from public.creator_publishing_claim_scheduled_fanvue_jobs(1,15);
select pg_temp.assert_true((select job_state='uncertain' and next_attempt_at is null from public.creator_publishing_platform_jobs where id='55555555-5555-4555-8555-555555555555'),'crash after dispatch uncertain');select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_claim_scheduled_fanvue_jobs(1,15)),'second create impossible');
-- Creators have read-only ownership-scoped attempt history; authoritative RPCs remain service-only.
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_fanvue_attempts),'owner reads attempt');
do $$begin begin insert into public.creator_publishing_fanvue_attempts(id,job_id,creator_id,attempt_ordinal,lease_token) values('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',2,'77777777-7777-4777-8777-777777777777');raise exception 'creator forged attempt';exception when insufficient_privilege then null;end;end$$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_fanvue_attempts),'other creator isolated');
commit;
select 'FANVUE_LAUNCH_EXECUTION_POSTGRES_ASSERTIONS_PASSED';
