\set ON_ERROR_STOP on
set role service_role;
-- First failure: February cycle.
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_feb','evt_feb','2026-02-02Z','2026-02-01Z','2026-03-01Z');
do $$ declare d record; begin select * into d from public.subscription_payment_delinquencies; if d.state <> 'first_miss_frozen' or d.consecutive_missed_cycles <> 1 or d.retention_until is not null then raise exception 'first_miss_failed'; end if; end $$;
-- Same invoice retry and a different invoice for the same cycle both remain miss one.
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_feb','evt_feb_retry','2026-02-03Z','2026-02-01Z','2026-03-01Z');
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_feb_reissued','evt_feb_reissued','2026-02-04Z','2026-02-01Z','2026-03-01Z');
do $$ begin if (select consecutive_missed_cycles from public.subscription_payment_delinquencies) <> 1 then raise exception 'cycle_dedupe_failed'; end if; end $$;
-- An older January cycle arriving late is ignored.
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_jan','evt_jan_late','2026-02-05Z','2026-01-01Z','2026-02-01Z');
do $$ begin if (select consecutive_missed_cycles from public.subscription_payment_delinquencies) <> 1 then raise exception 'stale_failure_incremented'; end if; end $$;
-- March is the second newer cycle and anchors exactly one 60-day contract.
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_mar','evt_mar','2026-03-02Z','2026-03-01Z','2026-04-01Z');
do $$ declare d record; begin select * into d from public.subscription_payment_delinquencies; if d.state <> 'retention_countdown' or d.consecutive_missed_cycles <> 2 or d.retention_until <> d.retention_started_at + interval '60 days' then raise exception 'second_miss_failed'; end if; end $$;
create temporary table deadline_snapshot as select retention_until from public.subscription_payment_delinquencies;
-- April may be retained as miss three but cannot move the deadline.
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_apr','evt_apr','2026-04-02Z','2026-04-01Z','2026-05-01Z');
do $$ begin if (select d.retention_until <> s.retention_until or d.consecutive_missed_cycles <> 3 from public.subscription_payment_delinquencies d cross join deadline_snapshot s) then raise exception 'deadline_restarted'; end if; end $$;
-- Historical January payment cannot recover February-April delinquency.
select public.payment_v2_recover_subscription_payment_delinquency('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_jan','2026-01-01Z','2026-02-01Z','2026-04-03Z');
do $$ begin if not exists(select 1 from public.subscription_payment_delinquencies where state='retention_countdown' and recovered_at is null) then raise exception 'stale_recovery_closed_episode'; end if; end $$;
-- Same/latest April cycle recovers and preserves history/deadline.
select public.payment_v2_recover_subscription_payment_delinquency('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_apr','2026-04-01Z','2026-05-01Z','2026-04-04Z');
do $$ begin if not exists(select 1 from public.subscription_payment_delinquencies where state='recovered' and retention_until=(select retention_until from deadline_snapshot) and recovery_invoice_id='in_apr' and recovery_billing_period_start='2026-04-01Z' and recovery_billing_period_end='2026-05-01Z') then raise exception 'latest_recovery_failed'; end if; end $$;
-- A truly unseen older cycle remains stale after recovery. A cycle already recorded in the recovered episode is an idempotent no-op.
do $$ declare v_result text; begin
  if public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_jan_after_recovery','evt_jan_after_recovery','2026-05-02Z','2026-01-01Z','2026-02-01Z') <> 'stale_failure_ignored' then raise exception 'cross_episode_stale_failure_not_ignored'; end if;
  v_result := public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_apr_late','evt_apr_late','2026-05-02Z','2026-04-01Z','2026-05-01Z');
  if v_result <> 'already_recorded_cycle' then raise exception 'recovery_cycle_duplicate_not_idempotent'; end if;
  if exists(select 1 from public.subscription_payment_delinquencies where state in ('first_miss_frozen','retention_countdown')) then raise exception 'stale_failure_opened_episode'; end if;
end $$;
-- The adjacent May cycle is truly later and starts a fresh miss-one episode.
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_may','evt_may','2026-05-02Z','2026-05-01Z','2026-06-01Z');
do $$ begin if (select count(*) from public.subscription_payment_delinquencies) <> 2 or not exists(select 1 from public.subscription_payment_delinquencies where first_missed_invoice_id='in_may' and state='first_miss_frozen' and consecutive_missed_cycles=1 and retention_until is null) then raise exception 'new_episode_failed'; end if; end $$;
-- Current subscription-cycle evidence without an invoice id also persists period recovery.
select public.payment_v2_recover_subscription_payment_delinquency('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early',null,'2026-06-01Z','2026-07-01Z','2026-06-02Z');
do $$ begin if not exists(select 1 from public.subscription_payment_delinquencies where first_missed_invoice_id='in_may' and state='recovered' and recovery_invoice_id is null and recovery_billing_period_start='2026-06-01Z' and recovery_billing_period_end='2026-07-01Z') then raise exception 'subscription_period_recovery_failed'; end if; end $$;
-- A failure for that persisted recovery cycle was never previously recorded and must still be rejected as stale.
do $$ begin
  if public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_june_late','evt_june_late','2026-07-02Z','2026-06-01Z','2026-07-01Z') <> 'stale_failure_ignored' then raise exception 'persisted_recovery_cycle_failure_not_ignored'; end if;
  if exists(select 1 from public.subscription_payment_delinquencies where state in ('first_miss_frozen','retention_countdown')) then raise exception 'recovery_cycle_failure_opened_episode'; end if;
end $$;
-- Semantic OG/lifetime chain and cancellation retention remain untouched.
do $$ begin
  begin perform public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000002','sub_og','cus_og','price_og','in_og','evt_og',now(),now()-interval '1 month',now()); raise exception 'og_was_accepted'; exception when others then if sqlerrm='og_was_accepted' then raise; end if; end;
  if exists(select 1 from public.subscription_payment_delinquencies where profile_id='10000000-0000-4000-8000-000000000002') then raise exception 'og_row_created'; end if;
  if exists(select 1 from public.subscription_cancellation_retentions) then raise exception 'cancellation_contaminated'; end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.subscription_payment_delinquencies','select') or has_table_privilege('authenticated','public.subscription_payment_delinquency_invoices','select') then raise exception 'browser_read_granted'; end if;
  if has_table_privilege('service_role','public.subscription_payment_delinquencies','delete') or has_table_privilege('service_role','public.subscription_payment_delinquency_invoices','update,delete') then raise exception 'excess_service_grant'; end if;
  if not has_function_privilege('service_role','public.payment_v2_recover_subscription_payment_delinquency(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz)','execute') then raise exception 'service_rpc_missing'; end if;
  if has_function_privilege('authenticated','public.payment_v2_record_subscription_payment_failure(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz)','execute') then raise exception 'browser_rpc_granted'; end if;
end $$;
