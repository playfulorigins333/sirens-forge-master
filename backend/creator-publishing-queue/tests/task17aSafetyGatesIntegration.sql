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
select task17a_test.assert(pg_get_functiondef('public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text)'::regprocedure) like '%OPERATOR_TASK_JOB_MISMATCH%', 'claim validates exact task job identity');
select task17a_test.assert(pg_get_functiondef('public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text)'::regprocedure) like '%OPERATOR_TARGET_NOT_SUPPORTED%', 'claim rejects non OnlyFans or non assisted');
select task17a_test.assert(pg_get_functiondef('public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text)'::regprocedure) like '%OPERATOR_QUEUE_TASK_AMBIGUOUS%', 'claim rejects duplicate active queue tasks');
select task17a_test.expect_error('progress invalid key deterministic','OPERATOR_IDEMPOTENCY_KEY_INVALID',$$select public.creator_publishing_update_onlyfans_operator_progress('00000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','not_started',0,'preparing','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','bad')$$);
