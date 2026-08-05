-- PFC-07E-A1 dormant Payment V2 lifecycle foundation.
-- This migration does not process refunds, subscriptions, disputes, entitlement
-- termination, inventory release, or lifecycle reconciliation.

create table public.payment_v2_provider_event_inbox (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique check (btrim(provider_event_id) = provider_event_id and btrim(provider_event_id) <> ''),
  provider_event_type text not null check (btrim(provider_event_type) = provider_event_type and btrim(provider_event_type) <> ''),
  provider_object_id text not null check (btrim(provider_object_id) = provider_object_id and btrim(provider_object_id) <> ''),
  provider_object_type text not null check (provider_object_type in ('refund','subscription','invoice','dispute')),
  provider_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  raw_payload_sha256 text not null check (raw_payload_sha256 ~ '^[0-9a-fA-F]{64}$'),
  lifecycle_phase text not null check (lifecycle_phase in ('PFC-07E-A2','PFC-07E-A3','PFC-07E-B')),
  processing_status text not null check (processing_status in ('RECEIVED','PENDING_PHASE','PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  processed_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  lifecycle_version integer not null default 1 check (lifecycle_version = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((processing_status in ('PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL')) = (processed_at is not null))
);
create index payment_v2_inbox_status_received_at on public.payment_v2_provider_event_inbox(processing_status, received_at);
create index payment_v2_inbox_type_status_received_at on public.payment_v2_provider_event_inbox(provider_event_type, processing_status, received_at);
create index payment_v2_inbox_object on public.payment_v2_provider_event_inbox(provider_object_type, provider_object_id);

alter table public.payment_v2_provider_event_inbox enable row level security;

create function public.payment_v2_inbox_receive_event(
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_object_id text,
  p_provider_object_type text,
  p_provider_created_at timestamptz,
  p_raw_payload_sha256 text,
  p_lifecycle_phase text,
  p_lifecycle_version integer
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.payment_v2_provider_event_inbox%rowtype;
begin
  if btrim(coalesce(p_provider_event_id,'')) = '' or p_provider_event_id <> btrim(p_provider_event_id)
     or btrim(coalesce(p_provider_event_type,'')) = '' or p_provider_event_type <> btrim(p_provider_event_type)
     or btrim(coalesce(p_provider_object_id,'')) = '' or p_provider_object_id <> btrim(p_provider_object_id)
     or p_provider_object_type not in ('refund','subscription','invoice','dispute')
     or p_provider_created_at is null or coalesce(p_raw_payload_sha256,'') !~ '^[0-9a-fA-F]{64}$'
     or p_lifecycle_phase not in ('PFC-07E-A2','PFC-07E-A3','PFC-07E-B') or p_lifecycle_version <> 1 then
    raise exception 'invalid_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payment_v2:event:' || p_provider_event_id, 2800));
  select * into v_existing from public.payment_v2_provider_event_inbox where provider_event_id=p_provider_event_id for update;
  if found then
    if v_existing.provider_event_type=p_provider_event_type and v_existing.provider_object_id=p_provider_object_id
       and v_existing.provider_object_type=p_provider_object_type and v_existing.provider_created_at=p_provider_created_at
       and v_existing.raw_payload_sha256=p_raw_payload_sha256 and v_existing.lifecycle_phase=p_lifecycle_phase
       and v_existing.lifecycle_version=p_lifecycle_version then
      return v_existing.processing_status;
    end if;
    raise exception 'inbox_event_conflict';
  end if;
  insert into public.payment_v2_provider_event_inbox(provider_event_id,provider_event_type,provider_object_id,provider_object_type,provider_created_at,raw_payload_sha256,lifecycle_phase,processing_status,lifecycle_version)
    values(p_provider_event_id,p_provider_event_type,p_provider_object_id,p_provider_object_type,p_provider_created_at,p_raw_payload_sha256,p_lifecycle_phase,'RECEIVED',p_lifecycle_version);
  return 'RECEIVED';
end $$;

create function public.payment_v2_inbox_transition_status(
  p_provider_event_id text,
  p_expected_status text,
  p_new_status text,
  p_error_code text,
  p_count_attempt boolean
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.payment_v2_provider_event_inbox%rowtype; v_allowed boolean;
begin
  if btrim(coalesce(p_provider_event_id,'')) = '' or p_provider_event_id <> btrim(p_provider_event_id)
     or p_expected_status not in ('RECEIVED','PENDING_PHASE','PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL')
     or p_new_status not in ('RECEIVED','PENDING_PHASE','PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL')
     or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{1,64}$')
     or p_count_attempt is null then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment_v2:event:' || p_provider_event_id, 2800));
  select * into v_existing from public.payment_v2_provider_event_inbox where provider_event_id=p_provider_event_id for update;
  if not found then raise exception 'inbox_event_not_found'; end if;
  if v_existing.processing_status <> p_expected_status then raise exception 'inbox_status_mismatch'; end if;
  if v_existing.processing_status in ('PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL') then raise exception 'inbox_terminal_status'; end if;
  v_allowed := (v_existing.processing_status='RECEIVED' and p_new_status in ('PENDING_PHASE','PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL'))
    or (v_existing.processing_status='PENDING_PHASE' and p_new_status in ('PENDING_PURCHASE','PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL'))
    or (v_existing.processing_status='PENDING_PURCHASE' and p_new_status in ('PENDING_PURCHASE','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL'))
    or (v_existing.processing_status='PENDING_RETRY' and p_new_status in ('PENDING_RETRY','PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL'));
  if not v_allowed then raise exception 'inbox_invalid_transition'; end if;
  update public.payment_v2_provider_event_inbox set processing_status=p_new_status,
    attempt_count=attempt_count + case when p_count_attempt then 1 else 0 end,
    last_attempt_at=case when p_count_attempt then now() else last_attempt_at end,
    processed_at=case when p_new_status in ('PROCESSED','IGNORED_NON_V2','FAILED_TERMINAL') then now() else null end,
    last_error_code=p_error_code, updated_at=now()
    where provider_event_id=p_provider_event_id;
  return p_new_status;
end $$;

-- Preserve one-time current evidence semantics while allowing repeated future event kinds.
do $$
declare v_constraint_name name; v_before bigint; v_after bigint;
begin
  select count(*) into v_before from public.payment_v2_reconciliation_evidence;
  if exists (
    select 1 from public.payment_v2_reconciliation_evidence
    where event_kind in ('PAYMENT_CONFIRMED','SESSION_EXPIRED_UNPAID','PAYMENT_CANCELED_UNPAID','CLAIMED')
    group by hold_id,event_kind having count(*) > 1
  ) then raise exception 'payment_v2_duplicate_one_time_evidence'; end if;

  create unique index payment_v2_evidence_one_payment_confirmed_per_hold on public.payment_v2_reconciliation_evidence(hold_id) where event_kind='PAYMENT_CONFIRMED';
  create unique index payment_v2_evidence_one_session_expired_unpaid_per_hold on public.payment_v2_reconciliation_evidence(hold_id) where event_kind='SESSION_EXPIRED_UNPAID';
  create unique index payment_v2_evidence_one_payment_canceled_unpaid_per_hold on public.payment_v2_reconciliation_evidence(hold_id) where event_kind='PAYMENT_CANCELED_UNPAID';
  create unique index payment_v2_evidence_one_claimed_per_hold on public.payment_v2_reconciliation_evidence(hold_id) where event_kind='CLAIMED';

  select conname into v_constraint_name
  from pg_constraint c
  join pg_class t on t.oid=c.conrelid
  join pg_namespace n on n.oid=t.relnamespace
  where n.nspname='public' and t.relname='payment_v2_reconciliation_evidence' and c.contype='u'
    and (select array_agg(a.attname order by x.ord)
         from unnest(c.conkey) with ordinality as x(attnum,ord)
         join pg_attribute a on a.attrelid=t.oid and a.attnum=x.attnum) = array['hold_id','event_kind']::name[];
  if v_constraint_name is null then raise exception 'payment_v2_evidence_unique_constraint_not_found'; end if;
  execute format('alter table public.payment_v2_reconciliation_evidence drop constraint %I', v_constraint_name);
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='payment_v2_one_provider_event') then
    raise exception 'payment_v2_provider_event_index_missing';
  end if;
  select count(*) into v_after from public.payment_v2_reconciliation_evidence;
  if v_before <> v_after then raise exception 'payment_v2_evidence_row_count_changed'; end if;
end $$;

-- Normalize hold-scoped advisory locking for existing mutating functions.
create or replace function public.payment_v2_associate_session(p_hold_id uuid, p_purchaser_hash bytea, p_session_id text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold public.payment_v2_holds%rowtype;
begin
  if octet_length(p_purchaser_hash) <> 32 or btrim(coalesce(p_session_id,'')) = '' then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment_v2:hold:' || p_hold_id::text, 2800));
  select * into v_hold from public.payment_v2_holds where id = p_hold_id for update;
  if not found or v_hold.purchaser_credential_hash <> p_purchaser_hash then raise exception 'hold_mismatch'; end if;
  if v_hold.state = 'SESSION_ASSOCIATED' and v_hold.stripe_checkout_session_id = p_session_id then return 'already_associated'; end if;
  if v_hold.state <> 'HELD' or v_hold.expires_at <= now() or v_hold.stripe_checkout_session_id is not null then raise exception 'session_conflict'; end if;
  update public.payment_v2_holds set state='SESSION_ASSOCIATED', stripe_checkout_session_id=p_session_id, updated_at=now() where id=p_hold_id;
  return 'associated';
end $$;

create or replace function public.payment_v2_record_paid(p_hold_id uuid, p_purchaser_hash bytea, p_session_id text,
  p_customer_id text, p_price_id text, p_payment_intent_id text, p_subscription_id text,
  p_provider_event_id text, p_provider_confirmed_at timestamptz)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold public.payment_v2_holds%rowtype; v_purchase public.payment_v2_purchases%rowtype; v_tier public.subscription_tiers%rowtype; v_tier_count bigint;
begin
  if octet_length(p_purchaser_hash) <> 32 or btrim(coalesce(p_session_id,''))='' or btrim(coalesce(p_customer_id,''))=''
     or btrim(coalesce(p_price_id,''))='' or btrim(coalesce(p_provider_event_id,''))='' or p_provider_confirmed_at is null then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment_v2:hold:' || p_hold_id::text, 2800));
  select * into v_hold from public.payment_v2_holds where id=p_hold_id for update;
  if not found or v_hold.purchaser_credential_hash<>p_purchaser_hash or v_hold.stripe_checkout_session_id<>p_session_id then raise exception 'hold_mismatch'; end if;
  if not ((v_hold.tier='og_throne' and btrim(coalesce(p_payment_intent_id,''))<>'' and p_subscription_id is null) or
          (v_hold.tier='early_bird' and p_payment_intent_id is null and btrim(coalesce(p_subscription_id,''))<>'')) then raise exception 'provider_identity_mismatch'; end if;
  select * into v_purchase from public.payment_v2_purchases where hold_id=p_hold_id for update;
  if found then
    if v_purchase.purchaser_credential_hash=p_purchaser_hash and v_purchase.stripe_checkout_session_id=p_session_id
       and v_purchase.stripe_customer_id=p_customer_id and v_purchase.stripe_price_id=p_price_id
       and v_purchase.stripe_payment_intent_id is not distinct from p_payment_intent_id
       and v_purchase.stripe_subscription_id is not distinct from p_subscription_id
       and v_purchase.provider_event_id=p_provider_event_id and v_purchase.provider_confirmed_at=p_provider_confirmed_at then return 'already_recorded'; end if;
    raise exception 'purchase_conflict';
  end if;
  select count(*) into v_tier_count from public.subscription_tiers where name=v_hold.tier and is_active is true;
  if v_tier_count<>1 then raise exception 'authoritative_tier_ambiguous_or_inactive'; end if;
  select * into v_tier from public.subscription_tiers where name=v_hold.tier and is_active is true;
  if v_tier.stripe_price_id is null or v_tier.stripe_price_id<>p_price_id then raise exception 'price_mismatch'; end if;
  if v_hold.state <> 'SESSION_ASSOCIATED' then raise exception 'invalid_state'; end if;
  insert into public.payment_v2_purchases(hold_id,purchaser_credential_hash,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_payment_intent_id,stripe_subscription_id,provider_event_id,provider_confirmed_at)
    values(p_hold_id,p_purchaser_hash,v_hold.tier,p_session_id,p_customer_id,p_price_id,p_payment_intent_id,p_subscription_id,p_provider_event_id,p_provider_confirmed_at) returning * into v_purchase;
  update public.payment_v2_holds set state='PAID_UNCLAIMED',updated_at=now() where id=p_hold_id;
  insert into public.payment_v2_reconciliation_evidence(hold_id,purchase_id,stripe_checkout_session_id,event_kind,provider_event_id,occurred_at)
    values(p_hold_id,v_purchase.id,p_session_id,'PAYMENT_CONFIRMED',p_provider_event_id,p_provider_confirmed_at);
  return 'recorded';
end $$;

create or replace function public.payment_v2_expire_unpaid(p_hold_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold public.payment_v2_holds%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('payment_v2:hold:' || p_hold_id::text, 2800));
  select * into v_hold from public.payment_v2_holds where id=p_hold_id for update;
  if not found then raise exception 'hold_not_found'; end if;
  if exists(select 1 from public.payment_v2_purchases where hold_id=p_hold_id) or v_hold.state in ('PAID_UNCLAIMED','CLAIMED','REFUNDED','REVOKED') then raise exception 'paid_purchase_exists'; end if;
  if v_hold.state='EXPIRED_UNPAID' then return 'already_expired'; end if;
  if v_hold.state<>'HELD' or v_hold.stripe_checkout_session_id is not null or v_hold.expires_at>now() then raise exception 'not_expirable'; end if;
  update public.payment_v2_holds set state='EXPIRED_UNPAID',updated_at=now() where id=p_hold_id; return 'expired';
end $$;

create or replace function public.payment_v2_record_session_unpaid_terminal(p_hold_id uuid, p_session_id text, p_event_kind text, p_provider_event_id text, p_provider_occurred_at timestamptz)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold public.payment_v2_holds%rowtype; v_evidence public.payment_v2_reconciliation_evidence%rowtype; v_state text;
begin
  if btrim(coalesce(p_session_id,''))='' or p_event_kind not in ('SESSION_EXPIRED_UNPAID','PAYMENT_CANCELED_UNPAID')
     or btrim(coalesce(p_provider_event_id,''))='' or p_provider_occurred_at is null then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment_v2:hold:' || p_hold_id::text, 2800));
  select * into v_hold from public.payment_v2_holds where id=p_hold_id for update;
  select * into v_evidence from public.payment_v2_reconciliation_evidence where provider_event_id=p_provider_event_id for update;
  if found then
    if v_evidence.hold_id=p_hold_id and v_evidence.stripe_checkout_session_id=p_session_id
       and v_evidence.event_kind=p_event_kind and v_evidence.occurred_at=p_provider_occurred_at then return 'already_recorded'; end if;
    raise exception 'provider_event_conflict';
  end if;
  if v_hold.id is null or v_hold.stripe_checkout_session_id<>p_session_id then raise exception 'hold_mismatch'; end if;
  if exists(select 1 from public.payment_v2_purchases where hold_id=p_hold_id) or v_hold.state in ('PAID_UNCLAIMED','CLAIMED','REFUNDED','REVOKED') then raise exception 'paid_purchase_exists'; end if;
  if v_hold.state<>'SESSION_ASSOCIATED' then raise exception 'invalid_state'; end if;
  v_state := case p_event_kind when 'SESSION_EXPIRED_UNPAID' then 'EXPIRED_UNPAID' else 'CANCELED_UNPAID' end;
  update public.payment_v2_holds set state=v_state,updated_at=now() where id=p_hold_id;
  insert into public.payment_v2_reconciliation_evidence(hold_id,stripe_checkout_session_id,event_kind,provider_event_id,occurred_at)
    values(p_hold_id,p_session_id,p_event_kind,p_provider_event_id,p_provider_occurred_at);
  return case p_event_kind when 'SESSION_EXPIRED_UNPAID' then 'expired' else 'canceled' end;
end $$;

create or replace function public.payment_v2_claim(p_purchase_id uuid, p_purchaser_hash bytea, p_profile_id uuid, p_auth_user_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold_id uuid; v_hold public.payment_v2_holds%rowtype; v_purchase public.payment_v2_purchases%rowtype; v_profile public.profiles%rowtype; v_tier public.subscription_tiers%rowtype; v_entitlement uuid; v_existing public.user_subscriptions%rowtype; v_existing_count bigint; v_tier_count bigint;
begin
  if octet_length(p_purchaser_hash)<>32 or p_profile_id is null or p_auth_user_id is null then raise exception 'invalid_request'; end if;
  select hold_id into v_hold_id from public.payment_v2_purchases where id=p_purchase_id;
  if v_hold_id is null then raise exception 'purchase_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment_v2:hold:' || v_hold_id::text, 2800));
  select * into v_hold from public.payment_v2_holds where id=v_hold_id for update;
  select * into v_purchase from public.payment_v2_purchases where id=p_purchase_id for update;
  if not found or v_purchase.hold_id<>v_hold_id or v_purchase.purchaser_credential_hash<>p_purchaser_hash then raise exception 'purchase_mismatch'; end if;
  if v_purchase.state='CLAIMED' then
    if v_purchase.claimed_profile_id<>p_profile_id then raise exception 'claimed_by_other_profile'; end if;
    if not exists(select 1 from public.payment_v2_allocations where purchase_id=p_purchase_id and profile_id=p_profile_id) then raise exception 'allocation_mismatch'; end if;
    return 'already_claimed';
  end if;
  if v_purchase.state<>'PAID_UNCLAIMED' then raise exception 'not_claimable'; end if;
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found or v_profile.user_id<>p_auth_user_id then raise exception 'authenticated_profile_mismatch'; end if;
  if exists(select 1 from public.payment_v2_allocations where profile_id=p_profile_id and tier=v_purchase.tier) then raise exception 'duplicate_entitlement'; end if;
  select count(*) into v_tier_count from public.subscription_tiers as t where t.name=v_purchase.tier and t.stripe_price_id=v_purchase.stripe_price_id;
  if v_tier_count<>1 then raise exception 'claim_tier_ambiguous_or_missing'; end if;
  select t.* into v_tier from public.subscription_tiers as t where t.name=v_purchase.tier and t.stripe_price_id=v_purchase.stripe_price_id;
  select count(*) into v_existing_count from public.user_subscriptions where user_id=p_profile_id and tier_name=v_purchase.tier and status in ('active','trialing');
  if v_existing_count>1 then raise exception 'ambiguous_existing_entitlement'; end if;
  if v_existing_count=1 then
    select * into v_existing from public.user_subscriptions where user_id=p_profile_id and tier_name=v_purchase.tier and status in ('active','trialing') for update;
    if v_existing.tier_id is distinct from v_tier.id or v_existing.tier_name is distinct from v_purchase.tier
       or v_existing.stripe_customer_id is distinct from v_purchase.stripe_customer_id
       or v_existing.stripe_subscription_id is distinct from v_purchase.stripe_subscription_id
       or (v_purchase.tier='og_throne' and v_existing.metadata->>'payment_intent_id' is distinct from v_purchase.stripe_payment_intent_id) then
      raise exception 'conflicting_existing_entitlement';
    end if;
    v_entitlement := v_existing.id;
  else
    insert into public.user_subscriptions(user_id,tier_id,tier_name,stripe_customer_id,stripe_subscription_id,status,metadata)
      values(p_profile_id,v_tier.id,v_purchase.tier,v_purchase.stripe_customer_id,v_purchase.stripe_subscription_id,'active',
        jsonb_build_object('checkout_contract','sirens_forge_payment_v2','purchase_id',v_purchase.id,'payment_intent_id',v_purchase.stripe_payment_intent_id,'customer_facing_allocation',true)) returning id into v_entitlement;
  end if;
  insert into public.payment_v2_allocations(purchase_id,tier,profile_id,entitlement_id) values(v_purchase.id,v_purchase.tier,p_profile_id,v_entitlement);
  update public.payment_v2_purchases set state='CLAIMED',claimed_profile_id=p_profile_id,claimed_at=now(),updated_at=now() where id=p_purchase_id;
  update public.payment_v2_holds set state='CLAIMED',updated_at=now() where id=v_purchase.hold_id;
  insert into public.payment_v2_reconciliation_evidence(hold_id,purchase_id,event_kind,occurred_at) values(v_purchase.hold_id,p_purchase_id,'CLAIMED',now());
  return 'claimed';
end $$;

alter function public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer) owner to postgres;
alter function public.payment_v2_inbox_transition_status(text,text,text,text,boolean) owner to postgres;

revoke all on table public.payment_v2_provider_event_inbox from public, anon, authenticated, service_role;
grant select on table public.payment_v2_provider_event_inbox to service_role;
revoke execute on function public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer), public.payment_v2_inbox_transition_status(text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer), public.payment_v2_inbox_transition_status(text,text,text,text,boolean) to service_role;

select pg_notify('pgrst', 'reload schema');
