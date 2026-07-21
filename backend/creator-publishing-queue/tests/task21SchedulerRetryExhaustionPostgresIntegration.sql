create schema if not exists task21_retry_exhaustion_test;
create or replace function task21_retry_exhaustion_test.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if not ok then raise exception '%', msg; end if; end $$;

select task21_retry_exhaustion_test.assert(
  pg_get_function_arguments('public.creator_publishing_claim_due_scheduler_events(integer,integer)'::regprocedure) = 'p_limit integer DEFAULT 25, p_lock_minutes integer DEFAULT 15',
  'claim signature defaults preserved'
);

select task21_retry_exhaustion_test.assert(
  pg_get_function_result('public.creator_publishing_claim_due_scheduler_events(integer,integer)'::regprocedure) = 'TABLE(event_id uuid, lock_token uuid)',
  'claim return columns preserved'
);

select task21_retry_exhaustion_test.assert(
  position('security definer' in lower(pg_get_functiondef('public.creator_publishing_claim_due_scheduler_events(integer,integer)'::regprocedure))) > 0,
  'claim remains security definer'
);

select task21_retry_exhaustion_test.assert(
  position('set search_path = public, pg_temp' in lower(pg_get_functiondef('public.creator_publishing_claim_due_scheduler_events(integer,integer)'::regprocedure))) > 0,
  'claim search path preserved'
);

select task21_retry_exhaustion_test.assert(
  position('for update of event_source skip locked' in lower(pg_get_functiondef('public.creator_publishing_claim_due_scheduler_events(integer,integer)'::regprocedure))) > 0,
  'skip locked preserved'
);

select task21_retry_exhaustion_test.assert(
  position('SCHEDULER_RETRY_EXHAUSTED' in pg_get_functiondef('public.creator_publishing_claim_due_scheduler_events(integer,integer)'::regprocedure)) > 0,
  'retry exhaustion safe code installed'
);

select task21_retry_exhaustion_test.assert(
  has_function_privilege('service_role','public.creator_publishing_claim_due_scheduler_events(integer,integer)','execute'),
  'service role can execute claim'
);
select task21_retry_exhaustion_test.assert(
  not has_function_privilege('anon','public.creator_publishing_claim_due_scheduler_events(integer,integer)','execute')
  and not has_function_privilege('authenticated','public.creator_publishing_claim_due_scheduler_events(integer,integer)','execute'),
  'public creator roles cannot execute claim'
);

insert into auth.users(id,email) values ('21000000-0000-4000-8000-000000000101','task21-retry@example.test') on conflict do nothing;
insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status) values
 ('21000000-0000-4000-8000-000000000401','21000000-0000-4000-8000-000000000101','onlyfans','task21_retry','creator_attested') on conflict do nothing;
insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,ai_flag,ai_detail,second_person_present,compliance_status) values
 ('21000000-0000-4000-8000-000000000501','21000000-0000-4000-8000-000000000101','21000000-0000-4000-8000-000000000401','onlyfans','Task 21 retry package','Safe fixture caption','none','{}',false,'passed') on conflict do nothing;
insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version) values
 ('21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000101','scheduled','task21retry','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','task21') on conflict do nothing;
insert into public.creator_publishing_platform_jobs(id,creator_id,publishing_plan_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,schedule_revision,intended_publish_at,schedule_timezone,scheduled_at,scheduled_by) values
 ('21000000-0000-4000-8000-000000000201','21000000-0000-4000-8000-000000000101','21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000501','21000000-0000-4000-8000-000000000401','onlyfans','assisted','due_now',clock_timestamp(),'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','task21','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',1,clock_timestamp()+interval '1 hour','UTC',clock_timestamp(),'21000000-0000-4000-8000-000000000101') on conflict do nothing;
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,processing_attempts,lock_token,locked_at) values
 ('21000000-0000-4000-8000-000000000301','21000000-0000-4000-8000-000000000101','21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000201','publish_due','pending',clock_timestamp()-interval '1 hour',1,0,null,null) on conflict do nothing;

select event_id as attempt1_event_id, lock_token as attempt1_lock from public.creator_publishing_claim_due_scheduler_events(1,1) \gset
select task21_retry_exhaustion_test.assert(:'attempt1_event_id'::uuid='21000000-0000-4000-8000-000000000301'::uuid, 'first claim returned event');
select task21_retry_exhaustion_test.assert((select processing_attempts=1 and status='processing' from public.creator_publishing_scheduler_events where id=:'attempt1_event_id'::uuid), 'first claim sets attempt 1');
update public.creator_publishing_scheduler_events set locked_at=clock_timestamp()-interval '10 minutes' where id=:'attempt1_event_id'::uuid;
select event_id as attempt2_event_id, lock_token as attempt2_lock from public.creator_publishing_claim_due_scheduler_events(1,1) \gset
select task21_retry_exhaustion_test.assert((select processing_attempts=2 from public.creator_publishing_scheduler_events where id=:'attempt2_event_id'::uuid), 'stale retry sets attempt 2');
update public.creator_publishing_scheduler_events set locked_at=clock_timestamp()-interval '10 minutes' where id=:'attempt2_event_id'::uuid;
select event_id as attempt3_event_id, lock_token as attempt3_lock from public.creator_publishing_claim_due_scheduler_events(1,1) \gset
select task21_retry_exhaustion_test.assert((select processing_attempts=3 from public.creator_publishing_scheduler_events where id=:'attempt3_event_id'::uuid), 'second stale retry sets attempt 3');
update public.creator_publishing_scheduler_events set locked_at=clock_timestamp()-interval '10 minutes' where id=:'attempt3_event_id'::uuid;
create temp table task21_fourth_claim as select * from public.creator_publishing_claim_due_scheduler_events(1,1);
select task21_retry_exhaustion_test.assert((select count(*)=0 from task21_fourth_claim), 'fourth claim is not returned');
select task21_retry_exhaustion_test.assert((select status='blocked' and safe_error_code='SCHEDULER_RETRY_EXHAUSTED' and processing_attempts=3 and lock_token is null and locked_at is null from public.creator_publishing_scheduler_events where id='21000000-0000-4000-8000-000000000301'), 'attempt 3 stale event terminalized without attempt 4');
select task21_retry_exhaustion_test.assert((select count(*)=1 from public.creator_publishing_audit_events where entity_id='21000000-0000-4000-8000-000000000301' and action='creator_publishing_scheduler_gate_failed' and after_state->>'safe_error_code'='SCHEDULER_RETRY_EXHAUSTED'), 'exhaustion audit emitted only by claim invocation');
