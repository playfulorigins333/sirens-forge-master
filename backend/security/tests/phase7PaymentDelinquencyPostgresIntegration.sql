\set ON_ERROR_STOP on
set role service_role;
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_a','evt_a','2026-01-02Z','2026-01-01Z','2026-02-01Z');
do $$ declare d record; begin select * into d from public.subscription_payment_delinquencies; if d.state <> 'first_miss_frozen' or d.consecutive_missed_cycles <> 1 or d.retention_until is not null then raise exception 'first_miss_failed'; end if; end $$;
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_a','evt_a_retry','2026-01-03Z','2026-01-01Z','2026-02-01Z');
do $$ begin if (select consecutive_missed_cycles from public.subscription_payment_delinquencies) <> 1 then raise exception 'duplicate_incremented'; end if; end $$;
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_b','evt_b','2026-02-02Z','2026-02-01Z','2026-03-01Z');
do $$ declare d record; begin select * into d from public.subscription_payment_delinquencies; if d.state <> 'retention_countdown' or d.consecutive_missed_cycles <> 2 or d.retention_until <> d.retention_started_at + interval '60 days' then raise exception 'second_miss_failed'; end if; end $$;
create temporary table deadline_snapshot as select retention_until from public.subscription_payment_delinquencies;
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_b','evt_b_retry','2026-02-03Z','2026-02-01Z','2026-03-01Z');
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_c','evt_c','2026-03-02Z','2026-03-01Z','2026-04-01Z');
do $$ begin if (select d.retention_until <> s.retention_until or d.consecutive_missed_cycles <> 3 from public.subscription_payment_delinquencies d cross join deadline_snapshot s) then raise exception 'deadline_restarted'; end if; end $$;
select public.payment_v2_recover_subscription_payment_delinquency('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','2026-03-03Z');
do $$ begin if not exists(select 1 from public.subscription_payment_delinquencies where state='recovered' and recovered_at='2026-03-03Z' and retention_until is not null) then raise exception 'recovery_failed'; end if; end $$;
select public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000001','sub_early','cus_early','price_early','in_d','evt_d','2026-05-02Z','2026-05-01Z','2026-06-01Z');
do $$ begin if (select count(*) from public.subscription_payment_delinquencies) <> 2 or not exists(select 1 from public.subscription_payment_delinquencies where state='first_miss_frozen' and consecutive_missed_cycles=1) then raise exception 'new_episode_failed'; end if; end $$;
do $$ begin
  begin perform public.payment_v2_record_subscription_payment_failure('30000000-0000-4000-8000-000000000002','sub_og','cus_og','price_og','in_og','evt_og',now(),now()-interval '1 month',now()); raise exception 'og_was_accepted'; exception when others then if sqlerrm='og_was_accepted' then raise; end if; end;
  if exists(select 1 from public.subscription_payment_delinquencies where profile_id='10000000-0000-4000-8000-000000000002') then raise exception 'og_row_created'; end if;
  if exists(select 1 from public.subscription_cancellation_retentions) then raise exception 'cancellation_contaminated'; end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.subscription_payment_delinquencies','select') or has_table_privilege('authenticated','public.subscription_payment_delinquency_invoices','select') then raise exception 'browser_read_granted'; end if;
  if has_table_privilege('service_role','public.subscription_payment_delinquencies','delete') or has_table_privilege('service_role','public.subscription_payment_delinquency_invoices','update,delete') then raise exception 'excess_service_grant'; end if;
  if not has_function_privilege('service_role','public.payment_v2_record_subscription_payment_failure(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz)','execute') then raise exception 'service_rpc_missing'; end if;
  if has_function_privilege('authenticated','public.payment_v2_record_subscription_payment_failure(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz)','execute') then raise exception 'browser_rpc_granted'; end if;
end $$;
