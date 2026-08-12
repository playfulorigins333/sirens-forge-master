-- LOCK-05E: bridge only the dormant A1 inbox when wholly absent, then add
-- exact Early Bird lifecycle mutation. No existing Payment V2 ledger/finance
-- function or evidence contract is replaced.
begin;

do $lock05e_pre$
declare
  v_table boolean := pg_catalog.to_regclass('public.payment_v2_provider_event_inbox') is not null;
  v_receive boolean := pg_catalog.to_regprocedure('public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)') is not null;
  v_transition boolean := pg_catalog.to_regprocedure('public.payment_v2_inbox_transition_status(text,text,text,text,boolean)') is not null;
  v_named_functions bigint;
begin
  select count(*) into v_named_functions
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('payment_v2_inbox_receive_event','payment_v2_inbox_transition_status');
  if not ((v_table and v_receive and v_transition and v_named_functions=2)
          or (not v_table and not v_receive and not v_transition and v_named_functions=0)) then
    raise exception 'lock05e_partial_a1_inbox_prestate';
  end if;
end $lock05e_pre$;

create table if not exists public.payment_v2_provider_event_inbox (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique check (btrim(provider_event_id)=provider_event_id and btrim(provider_event_id)<>''),
  provider_event_type text not null check (btrim(provider_event_type)=provider_event_type and btrim(provider_event_type)<>''),
  provider_object_id text not null check (btrim(provider_object_id)=provider_object_id and btrim(provider_object_id)<>''),
  provider_object_type text not null check (provider_object_type in ('refund','subscription','invoice','dispute')),
  provider_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  raw_payload_sha256 text not null check (raw_payload_sha256 ~ '^[0-9a-fA-F]{64}$'),
  lifecycle_phase text not null check (lifecycle_phase in ('PFC-07E-A2','PFC-07E-A3','PFC-07E-B')),
  processing_status text not null check (processing_status in ('RECEIVED','PENDING_PHASE','PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL')),
  attempt_count integer not null default 0 check (attempt_count>=0),
  last_attempt_at timestamptz,
  processed_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  lifecycle_version integer not null default 1 check (lifecycle_version=1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((processing_status in ('PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL'))=(processed_at is not null))
);
create index if not exists payment_v2_inbox_status_received_at on public.payment_v2_provider_event_inbox(processing_status,received_at);
create index if not exists payment_v2_inbox_type_status_received_at on public.payment_v2_provider_event_inbox(provider_event_type,processing_status,received_at);
create index if not exists payment_v2_inbox_object on public.payment_v2_provider_event_inbox(provider_object_type,provider_object_id);
alter table public.payment_v2_provider_event_inbox enable row level security;

do $lock05e_bridge$
begin
  if pg_catalog.to_regprocedure('public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)') is null then
    execute $ddl$
create function public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)
returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $fn$
declare v_existing public.payment_v2_provider_event_inbox%rowtype;
begin
  if pg_catalog.btrim(coalesce($1,''))='' or $1<>pg_catalog.btrim($1) or pg_catalog.btrim(coalesce($2,''))='' or $2<>pg_catalog.btrim($2)
     or pg_catalog.btrim(coalesce($3,''))='' or $3<>pg_catalog.btrim($3) or $4 not in ('refund','subscription','invoice','dispute')
     or $5 is null or coalesce($6,'') !~ '^[0-9a-fA-F]{64}$' or $7 not in ('PFC-07E-A2','PFC-07E-A3','PFC-07E-B') or $8<>1 then raise exception 'invalid_request'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2:event:'||$1,2800));
  select * into v_existing from public.payment_v2_provider_event_inbox where provider_event_id=$1 for update;
  if found then
    if v_existing.provider_event_type=$2 and v_existing.provider_object_id=$3 and v_existing.provider_object_type=$4 and v_existing.provider_created_at=$5
       and v_existing.raw_payload_sha256=$6 and v_existing.lifecycle_phase=$7 and v_existing.lifecycle_version=$8 then return v_existing.processing_status; end if;
    raise exception 'inbox_event_conflict';
  end if;
  insert into public.payment_v2_provider_event_inbox(provider_event_id,provider_event_type,provider_object_id,provider_object_type,provider_created_at,raw_payload_sha256,lifecycle_phase,processing_status,lifecycle_version)
  values($1,$2,$3,$4,$5,$6,$7,'RECEIVED',$8);
  return 'RECEIVED';
end $fn$
$ddl$;
    execute 'alter function public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer) owner to postgres';
  end if;
  if pg_catalog.to_regprocedure('public.payment_v2_inbox_transition_status(text,text,text,text,boolean)') is null then
    execute $ddl$
create function public.payment_v2_inbox_transition_status(text,text,text,text,boolean)
returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $fn$
declare v_existing public.payment_v2_provider_event_inbox%rowtype; v_allowed boolean;
begin
  if pg_catalog.btrim(coalesce($1,''))='' or $1<>pg_catalog.btrim($1) or $2 not in ('RECEIVED','PENDING_PHASE','PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL')
     or $3 not in ('RECEIVED','PENDING_PHASE','PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL')
     or ($4 is not null and $4 !~ '^[A-Z0-9_]{1,64}$') or $5 is null then raise exception 'invalid_request'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2:event:'||$1,2800));
  select * into v_existing from public.payment_v2_provider_event_inbox where provider_event_id=$1 for update;
  if not found then raise exception 'inbox_event_not_found'; end if;
  if v_existing.processing_status<>$2 then raise exception 'inbox_status_mismatch'; end if;
  if v_existing.processing_status in ('PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL') then raise exception 'inbox_terminal_status'; end if;
  v_allowed := (v_existing.processing_status='RECEIVED' and $3 in ('PENDING_PHASE','PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL'))
    or (v_existing.processing_status='PENDING_PHASE' and $3 in ('PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL'))
    or (v_existing.processing_status='PENDING_PURCHASE' and $3 in ('PENDING_PURCHASE','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL'))
    or (v_existing.processing_status='PENDING_RETRY' and $3 in ('PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL'));
  if not v_allowed then raise exception 'inbox_invalid_transition'; end if;
  update public.payment_v2_provider_event_inbox set processing_status=$3,attempt_count=attempt_count+case when $5 then 1 else 0 end,
    last_attempt_at=case when $5 then pg_catalog.now() else last_attempt_at end,processed_at=case when $3 in ('PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL') then pg_catalog.now() else null end,
    last_error_code=$4,updated_at=pg_catalog.now() where provider_event_id=$1;
  return $3;
end $fn$
$ddl$;
    execute 'alter function public.payment_v2_inbox_transition_status(text,text,text,text,boolean) owner to postgres';
  end if;
end $lock05e_bridge$;

revoke all on table public.payment_v2_provider_event_inbox from public,anon,authenticated,service_role;
grant select on table public.payment_v2_provider_event_inbox to service_role;
revoke execute on function public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer),public.payment_v2_inbox_transition_status(text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer),public.payment_v2_inbox_transition_status(text,text,text,text,boolean) to service_role;

do $lock05e_contract$
declare v_named bigint;v_columns bigint;v_secure bigint;
begin
  select count(*) into v_named from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('payment_v2_inbox_receive_event','payment_v2_inbox_transition_status');
  select count(*) into v_columns from information_schema.columns where table_schema='public' and table_name='payment_v2_provider_event_inbox' and column_name in ('id','provider_event_id','provider_event_type','provider_object_id','provider_object_type','provider_created_at','received_at','raw_payload_sha256','lifecycle_phase','processing_status','attempt_count','last_attempt_at','processed_at','last_error_code','lifecycle_version','created_at','updated_at');
  select count(*) into v_secure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('payment_v2_inbox_receive_event','payment_v2_inbox_transition_status') and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and (p.proconfig @> array['search_path=pg_catalog, pg_temp'] or p.proconfig @> array['search_path=public, pg_temp']);
  if pg_catalog.to_regclass('public.payment_v2_provider_event_inbox') is null or v_named<>2
     or v_columns<>17 or v_secure<>2
     or pg_catalog.to_regprocedure('public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)') is null
     or pg_catalog.to_regprocedure('public.payment_v2_inbox_transition_status(text,text,text,text,boolean)') is null
     or not (select relrowsecurity from pg_catalog.pg_class where oid='public.payment_v2_provider_event_inbox'::regclass)
     or (select count(*) from pg_catalog.pg_indexes where schemaname='public' and tablename='payment_v2_provider_event_inbox' and indexname in ('payment_v2_inbox_status_received_at','payment_v2_inbox_type_status_received_at','payment_v2_inbox_object'))<>3
     or pg_catalog.has_table_privilege('anon','public.payment_v2_provider_event_inbox','SELECT,INSERT,UPDATE,DELETE')
     or pg_catalog.has_table_privilege('authenticated','public.payment_v2_provider_event_inbox','SELECT,INSERT,UPDATE,DELETE')
     or not pg_catalog.has_table_privilege('service_role','public.payment_v2_provider_event_inbox','SELECT')
     or pg_catalog.has_table_privilege('service_role','public.payment_v2_provider_event_inbox','INSERT,UPDATE,DELETE')
     or pg_catalog.has_function_privilege('anon','public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)','EXECUTE')
     or pg_catalog.has_function_privilege('authenticated','public.payment_v2_inbox_transition_status(text,text,text,text,boolean)','EXECUTE')
     or not pg_catalog.has_function_privilege('service_role','public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)','EXECUTE')
  then raise exception 'lock05e_a1_inbox_postcondition_failed'; end if;
end $lock05e_contract$;

create function public.payment_v2_apply_early_bird_subscription_lifecycle(
  p_hold_id uuid,
  p_subscription_id text,
  p_customer_id text,
  p_price_id text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_trial_start timestamptz,
  p_trial_end timestamptz
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_purchase public.payment_v2_purchases%rowtype;
  v_purchase_count bigint;
  v_allocation public.payment_v2_allocations%rowtype;
  v_allocation_count bigint;
  v_entitlement public.user_subscriptions%rowtype;
  v_entitlement_count bigint;
begin
  if p_hold_id is null
     or btrim(coalesce(p_subscription_id, '')) = '' or p_subscription_id <> btrim(p_subscription_id)
     or btrim(coalesce(p_customer_id, '')) = '' or p_customer_id <> btrim(p_customer_id)
     or btrim(coalesce(p_price_id, '')) = '' or p_price_id <> btrim(p_price_id)
     or p_status not in ('active','trialing','past_due','canceled','unpaid','paused','incomplete','incomplete_expired')
     or p_cancel_at_period_end is null
     or (p_current_period_start is not null and p_current_period_end is not null and p_current_period_end < p_current_period_start)
     or (p_trial_start is not null and p_trial_end is not null and p_trial_end < p_trial_start)
  then
    raise exception 'invalid_subscription_snapshot';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2:early_bird_subscription:' || p_subscription_id, 2800));

  select count(*) into v_purchase_count
  from public.payment_v2_purchases p
  where p.tier = 'early_bird'
    and p.hold_id = p_hold_id
    and p.stripe_subscription_id = p_subscription_id
    and p.stripe_customer_id = p_customer_id
    and p.stripe_price_id = p_price_id;

  if v_purchase_count = 0 then
    if exists (
      select 1 from public.payment_v2_purchases p
      where p.tier = 'early_bird' and p.stripe_subscription_id = p_subscription_id
        and p.stripe_customer_id = p_customer_id and p.hold_id <> p_hold_id
    ) then
      raise exception 'subscription_hold_mismatch';
    end if;
    if exists (
      select 1 from public.payment_v2_purchases p
      where p.tier = 'early_bird' and p.stripe_subscription_id = p_subscription_id
        and p.stripe_customer_id = p_customer_id and p.hold_id = p_hold_id
        and p.stripe_price_id <> p_price_id
    ) then
      raise exception 'subscription_price_mismatch';
    end if;
    if exists (
      select 1 from public.payment_v2_purchases p
      where p.tier = 'early_bird' and p.stripe_subscription_id = p_subscription_id
    ) then
      raise exception 'subscription_customer_mismatch';
    end if;
    return 'purchase_pending';
  elsif v_purchase_count <> 1 then
    raise exception 'purchase_ambiguous';
  end if;

  select p.* into strict v_purchase
  from public.payment_v2_purchases p
  where p.tier = 'early_bird'
    and p.hold_id = p_hold_id
    and p.stripe_subscription_id = p_subscription_id
    and p.stripe_customer_id = p_customer_id
    and p.stripe_price_id = p_price_id
  for update;

  select count(*) into v_allocation_count
  from public.payment_v2_allocations a where a.purchase_id = v_purchase.id;

  if v_purchase.state = 'PAID_UNCLAIMED' then
    if v_purchase.claimed_profile_id is not null or v_allocation_count <> 0 then
      raise exception 'unclaimed_relationship_mismatch';
    end if;
    return 'unclaimed';
  end if;

  if v_purchase.state in ('REFUNDED','REVOKED') then
    return 'terminal_noop';
  end if;

  if v_purchase.state <> 'CLAIMED' or v_purchase.claimed_profile_id is null or v_allocation_count <> 1 then
    raise exception 'claimed_relationship_mismatch';
  end if;

  select a.* into strict v_allocation
  from public.payment_v2_allocations a where a.purchase_id = v_purchase.id;
  if v_allocation.tier <> 'early_bird' or v_allocation.profile_id <> v_purchase.claimed_profile_id then
    raise exception 'allocation_identity_mismatch';
  end if;

  select count(*) into v_entitlement_count
  from public.user_subscriptions s where s.id = v_allocation.entitlement_id;
  if v_entitlement_count <> 1 then raise exception 'entitlement_cardinality_mismatch'; end if;

  select s.* into strict v_entitlement
  from public.user_subscriptions s where s.id = v_allocation.entitlement_id for update;
  if v_entitlement.user_id <> v_purchase.claimed_profile_id
     or v_entitlement.tier_name <> 'early_bird'
     or v_entitlement.stripe_subscription_id is distinct from p_subscription_id
     or v_entitlement.stripe_customer_id is distinct from p_customer_id
  then
    raise exception 'entitlement_identity_mismatch';
  end if;

  update public.user_subscriptions
  set status = p_status,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      cancel_at_period_end = p_cancel_at_period_end,
      canceled_at = p_canceled_at,
      trial_start = p_trial_start,
      trial_end = p_trial_end,
      updated_at = pg_catalog.now()
  where id = v_entitlement.id;

  return 'applied';
end
$$;

alter function public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz) owner to postgres;
revoke execute on function public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz) to service_role;

commit;
