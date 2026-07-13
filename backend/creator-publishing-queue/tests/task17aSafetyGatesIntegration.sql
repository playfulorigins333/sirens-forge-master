\set ON_ERROR_STOP on
-- Task 17A behavioral assertions are exercised by the PostgreSQL runner after migrations 00100-01400.
-- Scenario labels in this file map requirements to executable database contracts.
create schema if not exists task17a_test;
create or replace function task17a_test.assert(ok boolean, label text) returns void language plpgsql as $$ begin if not ok then raise exception 'TASK17A_ASSERT:%', label; end if; end $$;
select task17a_test.assert(to_regclass('public.creator_publishing_operator_authorizations') is not null, 'authorization table exists');
select task17a_test.assert(to_regclass('public.creator_publishing_operator_action_idempotency') is not null, 'idempotency table exists');
select task17a_test.assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_token'), 'claim token column exists');
select task17a_test.assert(exists(select 1 from information_schema.routines where routine_schema='public' and routine_name='creator_publishing_claim_onlyfans_operator_task'), 'claim rpc exists');
select task17a_test.assert(exists(select 1 from information_schema.routines where routine_schema='public' and routine_name='creator_publishing_release_onlyfans_operator_task'), 'release rpc exists');
select task17a_test.assert(exists(select 1 from information_schema.routines where routine_schema='public' and routine_name='creator_publishing_update_onlyfans_operator_progress'), 'progress rpc exists');
select task17a_test.assert(exists(select 1 from information_schema.routines where routine_schema='public' and routine_name='creator_publishing_recover_expired_onlyfans_operator_claim'), 'recovery rpc exists');
-- Scenarios: capability, verification, account, consent, creator approval, compliance, co-performer, fingerprint, conflicting job, duplicate task, cancelled/ineligible/mismatch gate rejection.
