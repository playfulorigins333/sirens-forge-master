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
select task17a_test.assert(exists(select 1 from pg_proc where proname='creator_publishing_operator_replay_or_conflict'), 'idempotency replay helper exists');
select task17a_test.assert(pg_get_functiondef('public.creator_publishing_operator_replay_or_conflict(uuid,text,text,text)'::regprocedure) like '%pg_advisory_xact_lock%', 'idempotency helper acquires deterministic advisory lock');
select task17a_test.expect_error('recovery invalid key deterministic','OPERATOR_IDEMPOTENCY_KEY_INVALID',$$select public.creator_publishing_recover_expired_onlyfans_operator_claim('00000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','bad')$$);
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='bad'), 'invalid recovery stores no idempotency row');
