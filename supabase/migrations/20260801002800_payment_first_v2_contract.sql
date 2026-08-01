-- Payment-first V2 ledger. This migration is intentionally independent of the
-- removed 02100-02600 incident objects and performs no provider operations.

create table public.payment_v2_holds (
  id uuid primary key default gen_random_uuid(),
  purchaser_credential_hash bytea not null check (octet_length(purchaser_credential_hash) = 32),
  tier text not null check (tier in ('og_throne', 'early_bird')),
  state text not null default 'HELD' check (state in ('HELD','SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED','EXPIRED_UNPAID','CANCELED_UNPAID','REFUNDED','REVOKED')),
  stripe_checkout_session_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((state = 'HELD' and stripe_checkout_session_id is null) or
         (state <> 'HELD' and state not in ('EXPIRED_UNPAID','CANCELED_UNPAID') and stripe_checkout_session_id is not null) or
         (state in ('EXPIRED_UNPAID','CANCELED_UNPAID')))
);
create unique index payment_v2_one_effective_credential
  on public.payment_v2_holds (purchaser_credential_hash)
  where state in ('HELD','SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED');
create unique index payment_v2_one_checkout_session
  on public.payment_v2_holds (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index payment_v2_effective_capacity on public.payment_v2_holds (tier, state, expires_at);

create table public.payment_v2_purchases (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null unique references public.payment_v2_holds(id),
  purchaser_credential_hash bytea not null check (octet_length(purchaser_credential_hash) = 32),
  tier text not null check (tier in ('og_throne', 'early_bird')),
  stripe_checkout_session_id text not null unique check (btrim(stripe_checkout_session_id) <> ''),
  stripe_customer_id text not null check (btrim(stripe_customer_id) <> ''),
  stripe_price_id text not null check (btrim(stripe_price_id) <> ''),
  stripe_payment_intent_id text unique,
  stripe_subscription_id text unique,
  state text not null default 'PAID_UNCLAIMED' check (state in ('PAID_UNCLAIMED','CLAIMED','REFUNDED','REVOKED')),
  claimed_profile_id uuid references public.profiles(id),
  claimed_at timestamptz,
  provider_event_id text not null unique check (btrim(provider_event_id) <> ''),
  provider_confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tier = 'og_throne' and stripe_payment_intent_id is not null and stripe_subscription_id is null) or
         (tier = 'early_bird' and stripe_payment_intent_id is null and stripe_subscription_id is not null)),
  check ((state = 'PAID_UNCLAIMED' and claimed_profile_id is null and claimed_at is null) or
         (state <> 'PAID_UNCLAIMED' and state <> 'CLAIMED') or
         (state = 'CLAIMED' and claimed_profile_id is not null and claimed_at is not null))
);

create table public.payment_v2_allocations (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.payment_v2_purchases(id),
  tier text not null check (tier in ('og_throne', 'early_bird')),
  customer_facing boolean not null default true check (customer_facing),
  profile_id uuid not null references public.profiles(id),
  entitlement_id uuid not null unique references public.user_subscriptions(id),
  created_at timestamptz not null default now(),
  unique (profile_id, tier)
);

create table public.payment_v2_reconciliation_evidence (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.payment_v2_purchases(id),
  event_kind text not null check (event_kind in ('PAYMENT_CONFIRMED','CLAIMED')),
  provider_event_id text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (purchase_id, event_kind),
  check ((event_kind = 'PAYMENT_CONFIRMED' and provider_event_id is not null) or
         (event_kind = 'CLAIMED' and provider_event_id is null))
);

alter table public.payment_v2_holds enable row level security;
alter table public.payment_v2_purchases enable row level security;
alter table public.payment_v2_allocations enable row level security;
alter table public.payment_v2_reconciliation_evidence enable row level security;

create function public.payment_v2_acquire_hold(p_purchaser_hash bytea, p_tier text, p_expires_at timestamptz)
returns table(hold_id uuid, state text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold public.payment_v2_holds%rowtype; v_limit integer;
begin
  if octet_length(p_purchaser_hash) <> 32 or p_tier not in ('og_throne','early_bird')
     or p_expires_at <= now() or p_expires_at > now() + interval '2 hours' then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment_v2_capacity:' || p_tier, 2800));
  select * into v_hold from public.payment_v2_holds
    where purchaser_credential_hash = p_purchaser_hash
      and state in ('HELD','SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED') for update;
  if found then
    if v_hold.tier <> p_tier then raise exception 'effective_hold_conflict'; end if;
    return query select v_hold.id, v_hold.state, v_hold.expires_at; return;
  end if;
  update public.payment_v2_holds set state = 'EXPIRED_UNPAID', updated_at = now()
    where tier = p_tier and state = 'HELD' and expires_at <= now();
  v_limit := case p_tier when 'og_throne' then 50 else 120 end;
  if (select count(*) from public.payment_v2_holds where tier = p_tier
      and state in ('HELD','SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED')) >= v_limit then raise exception 'sold_out'; end if;
  insert into public.payment_v2_holds(purchaser_credential_hash,tier,expires_at)
    values(p_purchaser_hash,p_tier,p_expires_at) returning * into v_hold;
  return query select v_hold.id, v_hold.state, v_hold.expires_at;
end $$;

create function public.payment_v2_associate_session(p_hold_id uuid, p_purchaser_hash bytea, p_session_id text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold public.payment_v2_holds%rowtype;
begin
  if octet_length(p_purchaser_hash) <> 32 or btrim(coalesce(p_session_id,'')) = '' then raise exception 'invalid_request'; end if;
  select * into v_hold from public.payment_v2_holds where id = p_hold_id for update;
  if not found or v_hold.purchaser_credential_hash <> p_purchaser_hash then raise exception 'hold_mismatch'; end if;
  if v_hold.state = 'SESSION_ASSOCIATED' and v_hold.stripe_checkout_session_id = p_session_id then return 'already_associated'; end if;
  if v_hold.state <> 'HELD' or v_hold.expires_at <= now() or v_hold.stripe_checkout_session_id is not null then raise exception 'session_conflict'; end if;
  update public.payment_v2_holds set state='SESSION_ASSOCIATED', stripe_checkout_session_id=p_session_id, updated_at=now() where id=p_hold_id;
  return 'associated';
end $$;

create function public.payment_v2_record_paid(p_hold_id uuid, p_purchaser_hash bytea, p_session_id text,
  p_customer_id text, p_price_id text, p_payment_intent_id text, p_subscription_id text,
  p_provider_event_id text, p_provider_confirmed_at timestamptz)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold public.payment_v2_holds%rowtype; v_purchase public.payment_v2_purchases%rowtype;
begin
  if octet_length(p_purchaser_hash) <> 32 or btrim(coalesce(p_session_id,''))='' or btrim(coalesce(p_customer_id,''))=''
     or btrim(coalesce(p_price_id,''))='' or btrim(coalesce(p_provider_event_id,''))='' or p_provider_confirmed_at is null then raise exception 'invalid_request'; end if;
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
  if v_hold.state <> 'SESSION_ASSOCIATED' then raise exception 'invalid_state'; end if;
  insert into public.payment_v2_purchases(hold_id,purchaser_credential_hash,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_payment_intent_id,stripe_subscription_id,provider_event_id,provider_confirmed_at)
    values(p_hold_id,p_purchaser_hash,v_hold.tier,p_session_id,p_customer_id,p_price_id,p_payment_intent_id,p_subscription_id,p_provider_event_id,p_provider_confirmed_at) returning * into v_purchase;
  update public.payment_v2_holds set state='PAID_UNCLAIMED',updated_at=now() where id=p_hold_id;
  insert into public.payment_v2_reconciliation_evidence(purchase_id,event_kind,provider_event_id,occurred_at)
    values(v_purchase.id,'PAYMENT_CONFIRMED',p_provider_event_id,p_provider_confirmed_at);
  return 'recorded';
end $$;

create function public.payment_v2_expire_unpaid(p_hold_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold public.payment_v2_holds%rowtype;
begin
  select * into v_hold from public.payment_v2_holds where id=p_hold_id for update;
  if not found then raise exception 'hold_not_found'; end if;
  if exists(select 1 from public.payment_v2_purchases where hold_id=p_hold_id) or v_hold.state in ('PAID_UNCLAIMED','CLAIMED','REFUNDED','REVOKED') then raise exception 'paid_purchase_exists'; end if;
  if v_hold.state='EXPIRED_UNPAID' then return 'already_expired'; end if;
  if v_hold.state not in ('HELD','SESSION_ASSOCIATED') or v_hold.expires_at>now() then raise exception 'not_expirable'; end if;
  update public.payment_v2_holds set state='EXPIRED_UNPAID',updated_at=now() where id=p_hold_id; return 'expired';
end $$;

create function public.payment_v2_cancel_unpaid(p_hold_id uuid, p_session_id text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hold public.payment_v2_holds%rowtype;
begin
  if btrim(coalesce(p_session_id,''))='' then raise exception 'invalid_request'; end if;
  select * into v_hold from public.payment_v2_holds where id=p_hold_id for update;
  if not found or v_hold.stripe_checkout_session_id<>p_session_id then raise exception 'hold_mismatch'; end if;
  if exists(select 1 from public.payment_v2_purchases where hold_id=p_hold_id) or v_hold.state in ('PAID_UNCLAIMED','CLAIMED','REFUNDED','REVOKED') then raise exception 'paid_purchase_exists'; end if;
  if v_hold.state='CANCELED_UNPAID' then return 'already_canceled'; end if;
  if v_hold.state<>'SESSION_ASSOCIATED' then raise exception 'not_cancelable'; end if;
  update public.payment_v2_holds set state='CANCELED_UNPAID',updated_at=now() where id=p_hold_id; return 'canceled';
end $$;

create function public.payment_v2_claim(p_purchase_id uuid, p_purchaser_hash bytea, p_profile_id uuid, p_auth_user_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.payment_v2_purchases%rowtype; v_profile public.profiles%rowtype; v_tier public.subscription_tiers%rowtype; v_entitlement uuid;
begin
  if octet_length(p_purchaser_hash)<>32 or p_profile_id is null or p_auth_user_id is null then raise exception 'invalid_request'; end if;
  select * into v_purchase from public.payment_v2_purchases where id=p_purchase_id for update;
  if not found or v_purchase.purchaser_credential_hash<>p_purchaser_hash then raise exception 'purchase_mismatch'; end if;
  if v_purchase.state='CLAIMED' then
    if v_purchase.claimed_profile_id<>p_profile_id then raise exception 'claimed_by_other_profile'; end if;
    if not exists(select 1 from public.payment_v2_allocations where purchase_id=p_purchase_id and profile_id=p_profile_id) then raise exception 'allocation_mismatch'; end if;
    return 'already_claimed';
  end if;
  if v_purchase.state<>'PAID_UNCLAIMED' then raise exception 'not_claimable'; end if;
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found or v_profile.user_id<>p_auth_user_id then raise exception 'authenticated_profile_mismatch'; end if;
  if exists(select 1 from public.payment_v2_allocations where profile_id=p_profile_id and tier=v_purchase.tier) then raise exception 'duplicate_entitlement'; end if;
  select * into v_tier from public.subscription_tiers where name=v_purchase.tier;
  if not found or v_tier.stripe_price_id<>v_purchase.stripe_price_id then raise exception 'price_mismatch'; end if;
  insert into public.user_subscriptions(user_id,tier_id,tier_name,stripe_customer_id,stripe_subscription_id,status,metadata)
    values(p_profile_id,v_tier.id,v_purchase.tier,v_purchase.stripe_customer_id,v_purchase.stripe_subscription_id,'active',
      jsonb_build_object('checkout_contract','sirens_forge_payment_v2','purchase_id',v_purchase.id,'customer_facing_allocation',true)) returning id into v_entitlement;
  insert into public.payment_v2_allocations(purchase_id,tier,profile_id,entitlement_id) values(v_purchase.id,v_purchase.tier,p_profile_id,v_entitlement);
  update public.payment_v2_purchases set state='CLAIMED',claimed_profile_id=p_profile_id,claimed_at=now(),updated_at=now() where id=p_purchase_id;
  update public.payment_v2_holds set state='CLAIMED',updated_at=now() where id=v_purchase.hold_id;
  insert into public.payment_v2_reconciliation_evidence(purchase_id,event_kind,occurred_at) values(p_purchase_id,'CLAIMED',now());
  return 'claimed';
end $$;

revoke all on table public.payment_v2_holds, public.payment_v2_purchases, public.payment_v2_allocations, public.payment_v2_reconciliation_evidence from public, anon, authenticated;
grant select, insert, update on table public.payment_v2_holds, public.payment_v2_purchases, public.payment_v2_allocations, public.payment_v2_reconciliation_evidence to service_role;
revoke execute on function public.payment_v2_acquire_hold(bytea,text,timestamptz), public.payment_v2_associate_session(uuid,bytea,text), public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz), public.payment_v2_expire_unpaid(uuid), public.payment_v2_cancel_unpaid(uuid,text), public.payment_v2_claim(uuid,bytea,uuid,uuid) from public, anon, authenticated;
grant execute on function public.payment_v2_acquire_hold(bytea,text,timestamptz), public.payment_v2_associate_session(uuid,bytea,text), public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz), public.payment_v2_expire_unpaid(uuid), public.payment_v2_cancel_unpaid(uuid,text), public.payment_v2_claim(uuid,bytea,uuid,uuid) to service_role;
