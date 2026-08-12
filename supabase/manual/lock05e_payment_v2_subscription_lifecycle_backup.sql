-- REPOSITORY ARTIFACT ONLY. Run manually before LOCK-05E with separate authorization.
begin;
do $$
declare v_table boolean:=to_regclass('public.payment_v2_provider_event_inbox') is not null;v_receive boolean:=to_regprocedure('public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)') is not null;v_transition boolean:=to_regprocedure('public.payment_v2_inbox_transition_status(text,text,text,text,boolean)') is not null;v_named bigint;
begin
  if current_user<>'postgres' then raise exception 'lock05e_backup_requires_postgres';end if;
  select count(*) into v_named from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('payment_v2_inbox_receive_event','payment_v2_inbox_transition_status');
  if not((v_table and v_receive and v_transition and v_named=2)or(not v_table and not v_receive and not v_transition and v_named=0))then raise exception 'lock05e_backup_partial_a1_prestate';end if;
  if to_regclass('public.payment_v2_purchases') is null or to_regclass('public.payment_v2_allocations') is null or to_regclass('public.user_subscriptions') is null
     or to_regprocedure('public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz)') is not null
     or to_regnamespace('lock05e_backup_20260811_pre_apply') is not null then raise exception 'lock05e_unexpected_catalog_prestate';end if;
end$$;
create schema lock05e_backup_20260811_pre_apply authorization postgres;
revoke all on schema lock05e_backup_20260811_pre_apply from public,anon,authenticated,service_role;
create table lock05e_backup_20260811_pre_apply.manifest as
select 'eff1aa6e96c21dfd2b17f59b292476da164f0073'::text baseline_sha,'20260812080000_lock05e_payment_v2_early_bird_subscription_lifecycle.sql'::text forward_migration,clock_timestamp() backup_timestamp,
       (to_regclass('public.payment_v2_provider_event_inbox') is not null)::boolean a1_inbox_preexisting;
create table lock05e_backup_20260811_pre_apply.purchases as select id,hold_id,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_subscription_id,state,claimed_profile_id,claimed_at,created_at,updated_at from public.payment_v2_purchases;
create table lock05e_backup_20260811_pre_apply.allocations as select * from public.payment_v2_allocations;
create table lock05e_backup_20260811_pre_apply.entitlements as select id,user_id,tier_id,tier_name,stripe_subscription_id,stripe_customer_id,status,current_period_start,current_period_end,cancel_at_period_end,canceled_at,trial_start,trial_end,metadata,created_at,updated_at from public.user_subscriptions where tier_name='early_bird';
create table lock05e_backup_20260811_pre_apply.inbox_rows(snapshot jsonb);
create table lock05e_backup_20260811_pre_apply.inbox_catalog(object_kind text,object_identity text,owner_name text,security_definer boolean,configuration text[],acl text,definition text);
do $$ begin
 if to_regclass('public.payment_v2_provider_event_inbox') is not null then
  execute 'insert into lock05e_backup_20260811_pre_apply.inbox_rows select to_jsonb(i) from public.payment_v2_provider_event_inbox i';
  insert into lock05e_backup_20260811_pre_apply.inbox_catalog select 'table','public.payment_v2_provider_event_inbox',pg_get_userbyid(c.relowner),null,null,coalesce(array_to_string(c.relacl,','),''),null from pg_class c where c.oid='public.payment_v2_provider_event_inbox'::regclass;
  insert into lock05e_backup_20260811_pre_apply.inbox_catalog select 'function',p.oid::regprocedure::text,pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,coalesce(array_to_string(p.proacl,','),''),pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('payment_v2_inbox_receive_event','payment_v2_inbox_transition_status');
 end if;
end$$;
alter table lock05e_backup_20260811_pre_apply.manifest owner to postgres;alter table lock05e_backup_20260811_pre_apply.purchases owner to postgres;alter table lock05e_backup_20260811_pre_apply.allocations owner to postgres;alter table lock05e_backup_20260811_pre_apply.entitlements owner to postgres;alter table lock05e_backup_20260811_pre_apply.inbox_rows owner to postgres;alter table lock05e_backup_20260811_pre_apply.inbox_catalog owner to postgres;
revoke all on all tables in schema lock05e_backup_20260811_pre_apply from public,anon,authenticated,service_role;
do $$begin if has_schema_privilege('anon','lock05e_backup_20260811_pre_apply','usage')or has_schema_privilege('authenticated','lock05e_backup_20260811_pre_apply','usage')or has_schema_privilege('service_role','lock05e_backup_20260811_pre_apply','usage')or exists(select 1 from information_schema.columns where table_schema='lock05e_backup_20260811_pre_apply'and column_name='password_hash')then raise exception 'lock05e_backup_privacy_postcondition_failed';end if;end$$;
commit;
