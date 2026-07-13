\set ON_ERROR_STOP on
create schema if not exists task17a_test;
create or replace function task17a_test.assert(ok boolean, label text) returns void language plpgsql as $$ begin if not ok then raise exception 'TASK17A_ASSERT:%', label; end if; end $$;
create or replace function task17a_test.expect_error(label text, expected text, statement text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'TASK17A_ASSERT:% expected %', label, expected;
exception when others then
  if sqlerrm not like '%' || expected || '%' then
    raise exception 'TASK17A_ASSERT:% expected %, got %', label, expected, sqlerrm;
  end if;
end $$;
select task17a_test.assert(pg_get_functiondef('public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text)'::regprocedure) like '%claim_token%', 'schedule_plan recognizes four-field active claim');
select task17a_test.assert(pg_get_functiondef('public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)'::regprocedure) like '%awaiting_operator%', 'process_scheduler_event recognizes awaiting_operator');
select task17a_test.assert(pg_get_functiondef('public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)'::regprocedure) like '%due_now%', 'process_scheduler_event preserves due_now path');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_queue_tasks where status in ('scheduled_on_platform','awaiting_post_confirmation')), 'scheduler compatibility reaches no Task 18 queue state');
