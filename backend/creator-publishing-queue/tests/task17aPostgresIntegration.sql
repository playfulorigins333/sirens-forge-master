create or replace function public.task17a_assert(condition boolean, message text) returns void language plpgsql as $$ begin if not condition then raise exception 'Task17A assertion failed: %', message; end if; end; $$;
select public.task17a_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_token'), 'queue task has claim_token');
select public.task17a_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='operator_progress_state'), 'queue task has operator progress');
select public.task17a_assert(to_regclass('public.creator_publishing_operator_authorizations') is not null, 'operator authorization table exists');
select public.task17a_assert(to_regclass('public.creator_publishing_operator_action_idempotency') is not null, 'operator idempotency table exists');
select public.task17a_assert(has_function_privilege('authenticated','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text)','execute') is false, 'authenticated cannot claim');
select public.task17a_assert(has_function_privilege('service_role','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text)','execute') is true, 'service role can claim');
select public.task17a_assert(not exists(select 1 from information_schema.tables where table_schema='public' and table_name like '%operator%task%'), 'no second operator task table');
