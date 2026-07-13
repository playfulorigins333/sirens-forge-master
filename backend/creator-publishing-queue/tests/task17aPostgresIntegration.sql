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
select task17a_test.assert(exists(select 1 from information_schema.check_constraints where constraint_name='creator_publishing_queue_claim_all_or_none'), 'ownership all-or-none constraint exists');
select task17a_test.assert(exists(select 1 from information_schema.check_constraints where constraint_name='creator_publishing_queue_claim_lifetime'), '30 minute claim lifetime constraint exists');
select task17a_test.assert(exists(select 1 from information_schema.check_constraints where constraint_name='creator_publishing_queue_operator_progress_state_check'), 'progress state constraint exists');
select task17a_test.expect_error('invalid idempotency key rejected before mutation','OPERATOR_IDEMPOTENCY_KEY_INVALID',$$select public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','bad')$$);
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and idempotency_key='bad'), 'invalid idempotency writes no successful claim audit');
