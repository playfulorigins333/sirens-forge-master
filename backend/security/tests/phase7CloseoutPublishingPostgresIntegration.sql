\set ON_ERROR_STOP on

-- Lifecycle access predicate follows Phase 7 account/payment/OG semantics.
do $$ begin
  if public.phase7_creator_lifecycle_execution_allowed('10000000-0000-4000-8000-000000000001') is not true then
    raise exception 'active recurring creator was blocked';
  end if;
  if public.phase7_creator_lifecycle_execution_allowed('10000000-0000-4000-8000-000000000002') is not false then
    raise exception 'voluntary deletion creator remained executable';
  end if;
  if public.phase7_creator_lifecycle_execution_allowed('10000000-0000-4000-8000-000000000003') is not true then
    raise exception 'semantic OG lifetime creator was blocked';
  end if;
  if public.phase7_creator_lifecycle_execution_allowed('10000000-0000-4000-8000-000000000004') is not false then
    raise exception 'malformed recurring OG row inherited lifetime access';
  end if;
  if public.phase7_creator_lifecycle_execution_allowed('10000000-0000-4000-8000-000000000005') is not false then
    raise exception 'payment-delinquent creator remained executable';
  end if;
end $$;

-- Active recurring X dispatch can transition the already-claimed job to RUNNING.
insert into public.autopost_jobs(id,user_id,platform,state,lock_id,locked_at)
values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','x','QUEUED','lock-active',clock_timestamp());
do $$ begin
  if public.autopost_begin_x_dispatch('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','lock-active') is not true then
    raise exception 'active X dispatch was denied';
  end if;
  if not exists(select 1 from public.autopost_jobs where id='40000000-0000-4000-8000-000000000001' and state='RUNNING') then
    raise exception 'active X job did not enter RUNNING';
  end if;
end $$;

-- A first missed recurring cycle freezes provider dispatch before job state changes.
insert into public.autopost_accounts(user_id,platform,connection_status,encrypted_access_token)
values('10000000-0000-4000-8000-000000000005','x','CONNECTED','ciphertext');
insert into public.autopost_jobs(id,user_id,platform,state,lock_id,locked_at)
values('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','x','QUEUED','lock-due',clock_timestamp());
do $$ begin
  if public.autopost_begin_x_dispatch('10000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000005','lock-due') is not false then
    raise exception 'delinquent X dispatch was allowed';
  end if;
  if not exists(select 1 from public.autopost_jobs where id='40000000-0000-4000-8000-000000000005' and state='QUEUED') then
    raise exception 'delinquent X job mutated before provider dispatch';
  end if;
end $$;

-- Prepare one active and one frozen Fanvue job at the same due time.
insert into public.creator_publishing_platform_jobs(id,creator_id,target_platform,job_state,intended_publish_at,schedule_revision)
values
('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fanvue','direct_publish_queued',clock_timestamp()-interval '1 minute',1),
('50000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','fanvue','direct_publish_queued',clock_timestamp()-interval '1 minute',1);
insert into public.creator_publishing_scheduler_events(platform_job_id,event_type,schedule_revision,status,due_at)
select id,'publish_due',schedule_revision,'processed',intended_publish_at
from public.creator_publishing_platform_jobs;

create temporary table claimed_active as
select * from public.creator_publishing_claim_scheduled_fanvue_jobs(10,15);
do $$ begin
  if (select count(*) from claimed_active) <> 1 then
    raise exception 'Fanvue claim did not filter frozen creator';
  end if;
  if not exists(select 1 from claimed_active where job_id='50000000-0000-4000-8000-000000000001') then
    raise exception 'active Fanvue job was not claimed';
  end if;
  if not exists(select 1 from public.creator_publishing_platform_jobs where id='50000000-0000-4000-8000-000000000005' and job_state='direct_publish_queued' and attempt_count=0) then
    raise exception 'frozen Fanvue job consumed an attempt';
  end if;
end $$;

-- Close the claim-to-provider-create race: if payment freezes after claim, the
-- irreversible provider-create marker must fail without setting dispatch proof.
insert into public.subscription_payment_delinquencies(auth_user_id,profile_id,subscription_id,state)
values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','first_miss_frozen');
do $$ declare v_attempt uuid; v_lease uuid; begin
  select attempt_id,lease_token into strict v_attempt,v_lease from claimed_active where job_id='50000000-0000-4000-8000-000000000001';
  if public.creator_publishing_mark_fanvue_create_dispatched(v_attempt,v_lease) is not false then
    raise exception 'Fanvue dispatch race bypassed lifecycle freeze';
  end if;
  if exists(select 1 from public.creator_publishing_fanvue_attempts where id=v_attempt and provider_create_dispatched_at is not null) then
    raise exception 'Fanvue provider-create marker was written while frozen';
  end if;
end $$;

-- Browser roles cannot call internal lifecycle/provider execution gates.
do $$ begin
  if has_function_privilege('anon','public.phase7_creator_lifecycle_execution_allowed(uuid)','execute')
     or has_function_privilege('authenticated','public.phase7_creator_lifecycle_execution_allowed(uuid)','execute')
     or has_function_privilege('authenticated','public.autopost_begin_x_dispatch(uuid,uuid,text)','execute')
     or has_function_privilege('authenticated','public.creator_publishing_claim_scheduled_fanvue_jobs(integer,integer)','execute')
     or has_function_privilege('authenticated','public.creator_publishing_mark_fanvue_create_dispatched(uuid,uuid)','execute') then
    raise exception 'browser role can execute internal Phase 7 publishing gate';
  end if;
  if not has_function_privilege('service_role','public.autopost_begin_x_dispatch(uuid,uuid,text)','execute')
     or not has_function_privilege('service_role','public.creator_publishing_claim_scheduled_fanvue_jobs(integer,integer)','execute')
     or not has_function_privilege('service_role','public.creator_publishing_mark_fanvue_create_dispatched(uuid,uuid)','execute') then
    raise exception 'service role missing internal publishing gate execution';
  end if;
end $$;
