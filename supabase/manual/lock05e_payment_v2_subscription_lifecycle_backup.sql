-- REPOSITORY ARTIFACT ONLY. Run manually before LOCK-05E only with separate authorization.
begin;

do $$
begin
  if current_user <> 'postgres' then raise exception 'lock05e_backup_requires_postgres'; end if;
  if to_regclass('public.payment_v2_purchases') is null
     or to_regclass('public.payment_v2_allocations') is null
     or to_regclass('public.user_subscriptions') is null
     or to_regclass('public.payment_v2_provider_event_inbox') is null
     or to_regprocedure('public.payment_v2_inbox_transition_status(text,text,text,text,boolean)') is null
     or to_regprocedure('public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz)') is not null
  then raise exception 'lock05e_unexpected_catalog_prestate'; end if;
end $$;

create schema lock05e_backup_20260811_pre_apply authorization postgres;
revoke all on schema lock05e_backup_20260811_pre_apply from public, anon, authenticated, service_role;

create table lock05e_backup_20260811_pre_apply.manifest as
select 'eff1aa6e96c21dfd2b17f59b292476da164f0073'::text baseline_sha,
       '20260812080000_lock05e_payment_v2_early_bird_subscription_lifecycle.sql'::text forward_migration,
       clock_timestamp() backup_timestamp;

create table lock05e_backup_20260811_pre_apply.purchases as
select id,hold_id,tier,stripe_checkout_session_id,stripe_customer_id,stripe_subscription_id,state,claimed_profile_id,claimed_at,created_at,updated_at
from public.payment_v2_purchases;
create table lock05e_backup_20260811_pre_apply.allocations as select * from public.payment_v2_allocations;
create table lock05e_backup_20260811_pre_apply.entitlements as
select id,user_id,tier_id,tier_name,stripe_subscription_id,stripe_customer_id,status,current_period_start,current_period_end,cancel_at_period_end,canceled_at,trial_start,trial_end,metadata,created_at,updated_at
from public.user_subscriptions where tier_name='early_bird';
create table lock05e_backup_20260811_pre_apply.inbox as select * from public.payment_v2_provider_event_inbox;
create table lock05e_backup_20260811_pre_apply.inbox_counts as
select provider_event_type,processing_status,count(*) row_count from public.payment_v2_provider_event_inbox group by provider_event_type,processing_status;
create table lock05e_backup_20260811_pre_apply.rpc_prestate as
select p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef security_definer,
       p.proconfig,pg_get_functiondef(p.oid) definition,coalesce(array_to_string(p.proacl,','),'') grants
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('payment_v2_inbox_receive_event','payment_v2_inbox_transition_status');

alter table lock05e_backup_20260811_pre_apply.manifest owner to postgres;
alter table lock05e_backup_20260811_pre_apply.purchases owner to postgres;
alter table lock05e_backup_20260811_pre_apply.allocations owner to postgres;
alter table lock05e_backup_20260811_pre_apply.entitlements owner to postgres;
alter table lock05e_backup_20260811_pre_apply.inbox owner to postgres;
alter table lock05e_backup_20260811_pre_apply.inbox_counts owner to postgres;
alter table lock05e_backup_20260811_pre_apply.rpc_prestate owner to postgres;
revoke all on all tables in schema lock05e_backup_20260811_pre_apply from public, anon, authenticated, service_role;

do $$
begin
  if has_schema_privilege('anon','lock05e_backup_20260811_pre_apply','usage')
     or has_schema_privilege('authenticated','lock05e_backup_20260811_pre_apply','usage')
     or has_schema_privilege('service_role','lock05e_backup_20260811_pre_apply','usage')
     or exists (select 1 from information_schema.columns where table_schema='lock05e_backup_20260811_pre_apply' and column_name='password_hash')
  then raise exception 'lock05e_backup_privacy_postcondition_failed'; end if;
end $$;

commit;
