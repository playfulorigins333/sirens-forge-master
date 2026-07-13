create or replace function public.task17a_assert(condition boolean, message text) returns void language plpgsql as $$ begin if not condition then raise exception 'Task17A assertion failed: %', message; end if; end; $$;
select public.task17a_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_token'), 'queue task has claim_token');
select public.task17a_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_expires_at'), 'queue task has claim_expires_at');
select public.task17a_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='operator_progress_state'), 'queue task has operator progress');
select public.task17a_assert(to_regclass('public.creator_publishing_operator_authorizations') is not null, 'operator authorization table exists');
select public.task17a_assert(to_regclass('public.creator_publishing_operator_action_idempotency') is not null, 'operator idempotency table exists');
select public.task17a_assert(has_function_privilege('authenticated','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text)','execute') is false, 'authenticated cannot claim');
select public.task17a_assert(has_function_privilege('service_role','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text)','execute') is true, 'service role can claim');
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
    values ('6fffffff-ffff-4fff-8fff-000000000001','30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000001','claimed','00000000-0000-4000-8000-000000000001',now(),now(),now());
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
select public.task17a_assert(public.creator_publishing_onlyfans_queue_status_from_schedule(j)='ready_for_handoff', 'unscheduled maps to ready_for_handoff') from public.creator_publishing_platform_jobs j where j.id='80000000-0000-4000-8000-000000000001';
