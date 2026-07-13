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
select task17a_test.assert(has_function_privilege('authenticated','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text)','execute') is false, 'authenticated cannot execute claim rpc');
select task17a_test.assert(has_function_privilege('service_role','public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text)','execute') is true, 'service_role can execute claim rpc');
select task17a_test.expect_error('unauthorized missing ids fail closed','OPERATOR_REQUEST_INVALID',$$select public.creator_publishing_claim_onlyfans_operator_task(null,'60000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','authTime01')$$);
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where idempotency_key='authTime01'), 'failed authorization/timing request stores no idempotency success');
