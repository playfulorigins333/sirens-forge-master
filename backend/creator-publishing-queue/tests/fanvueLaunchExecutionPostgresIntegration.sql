create or replace function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'ASSERT:%',label;end if;end$$;
-- Migration is additive and performs no Fanvue job/attempt backfill.
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_platform_jobs where target_platform='fanvue'),'no job backfill');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_fanvue_attempts),'no attempt backfill');
insert into public.creator_publishing_plans(id,creator_id,idempotency_key,request_fingerprint,registry_version) values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','server_key_01',repeat('a',64),'task14.20260711.001');
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,oauth_account_id,publication_type,requested_publication_at,server_idempotency_key)
select '55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444',p.creator_id,p.id,p.platform_account_id,'fanvue','direct','direct_publish_queued',p.updated_at,repeat('b',64),'task14.20260711.001',repeat('c',64),a.id,'text',clock_timestamp()-interval '1 minute','server-derived-logical-request'
from public.creator_publishing_content_packages p join public.creator_platform_accounts d on d.id=p.platform_account_id join public.autopost_accounts a on a.id=d.oauth_account_id where p.target_platform='fanvue' limit 1;
-- Duplicate logical identity and cross-owner/account relationships are database-rejected.
do $$begin begin update public.creator_publishing_platform_jobs set creator_id='22222222-2222-4222-8222-222222222222' where id='55555555-5555-4555-8555-555555555555'; set constraints all immediate; raise exception 'cross owner accepted'; exception when foreign_key_violation then null;end;end$$;
create temp table claim as select * from public.creator_publishing_claim_due_fanvue_jobs(1,15);
select pg_temp.assert_true((select count(*)=1 from claim),'due claim');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_claim_due_fanvue_jobs(1,15)),'concurrent claim excluded');
select pg_temp.assert_true(public.creator_publishing_finish_fanvue_attempt('55555555-5555-4555-8555-555555555555',(select lease_token from claim),'uncertain',true,false,false,'FANVUE_CREATE_AMBIGUOUS','unknown',null,null,'response_lost'),'uncertain finish');
select pg_temp.assert_true((select job_state='uncertain' and next_attempt_at is null from public.creator_publishing_platform_jobs where id='55555555-5555-4555-8555-555555555555'),'uncertain no retry');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_claim_due_fanvue_jobs(1,15)),'terminal not rerun');
-- Creators have read-only ownership-scoped attempt history; authoritative RPCs remain service-only.
set local role authenticated; set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_fanvue_attempts),'owner reads attempt');
do $$begin begin insert into public.creator_publishing_fanvue_attempts(job_id,creator_id,attempt_ordinal) values('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',2);raise exception 'creator forged attempt';exception when insufficient_privilege then null;end;end$$;
reset role; set local role authenticated; set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_fanvue_attempts),'other creator isolated');
reset role;
select 'FANVUE_LAUNCH_EXECUTION_POSTGRES_ASSERTIONS_PASSED';
