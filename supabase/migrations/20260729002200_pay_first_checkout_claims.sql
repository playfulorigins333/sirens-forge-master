-- Additive pay-first ownership and claim ledger. The preceding applied migration is immutable.
alter table public.checkout_capacity_reservations alter column profile_id drop not null;
alter table public.checkout_capacity_reservations add column purchaser_token_hash bytea;
alter table public.checkout_capacity_reservations add constraint checkout_capacity_exactly_one_owner
  check ((profile_id is not null)::integer + (purchaser_token_hash is not null)::integer = 1);
alter table public.checkout_capacity_reservations add constraint checkout_capacity_token_hash_length
  check (purchaser_token_hash is null or octet_length(purchaser_token_hash)=32);
create unique index checkout_capacity_one_effective_guest on public.checkout_capacity_reservations(purchaser_token_hash)
  where purchaser_token_hash is not null and status in ('active','associated');

create table public.pay_first_purchases (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.checkout_capacity_reservations(id),
  purchaser_token_hash bytea not null check (octet_length(purchaser_token_hash)=32),
  tier text not null check (tier in ('og_throne','early_bird')),
  stripe_session_id text not null unique check (btrim(stripe_session_id)<>''),
  stripe_customer_id text not null check (btrim(stripe_customer_id)<>''),
  stripe_price_id text not null check (btrim(stripe_price_id)<>''),
  payment_intent_id text unique,
  stripe_subscription_id text unique,
  state text not null default 'paid_unclaimed' check (state in ('paid_unclaimed','claimed')),
  claimed_profile_id uuid references public.profiles(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((tier='og_throne' and payment_intent_id is not null and stripe_subscription_id is null) or
         (tier='early_bird' and payment_intent_id is null and stripe_subscription_id is not null)),
  check ((state='paid_unclaimed' and claimed_profile_id is null and claimed_at is null) or
         (state='claimed' and claimed_profile_id is not null and claimed_at is not null))
);
alter table public.pay_first_purchases enable row level security;

create function public.acquire_guest_checkout_capacity_reservation(p_purchaser_token_hash bytea,p_tier text)
returns table(reservation_id uuid,expires_at timestamptz,stripe_session_id text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.subscription_tiers%rowtype; r public.checkout_capacity_reservations%rowtype; paid bigint; held bigint;
begin
 if octet_length(p_purchaser_token_hash)<>32 or p_tier not in ('og_throne','early_bird') then raise exception 'invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(encode(p_purchaser_token_hash,'hex'),2049));
 select * into t from public.subscription_tiers where name=p_tier for update;
 if not found or not coalesce(t.is_active,false) or t.max_slots is null then raise exception 'plan_unavailable'; end if;
 update public.checkout_capacity_reservations set status='expired',updated_at=now() where status='active' and stripe_session_id is null and expires_at<=now();
 select * into r from public.checkout_capacity_reservations where purchaser_token_hash=p_purchaser_token_hash and status in ('active','associated') for update;
 if found and r.tier<>p_tier then raise exception 'reservation_conflict'; end if;
 if found then return query select r.id,r.expires_at,r.stripe_session_id; return; end if;
 select count(*) into paid from public.user_subscriptions s where s.tier_name=p_tier and s.status in ('active','trialing') and not (p_tier='og_throne' and coalesce(s.metadata->>'counts_toward_seats','true')='false');
 select count(*) into held from public.checkout_capacity_reservations x where x.tier=p_tier and ((x.status='active' and x.stripe_session_id is null and x.expires_at>now()) or x.status='associated')
  and (x.profile_id is null or not exists(select 1 from public.user_subscriptions s where s.user_id=x.profile_id and s.tier_name=x.tier and s.status in ('active','trialing')));
 if paid+held>=t.max_slots then raise exception 'sold_out'; end if;
 insert into public.checkout_capacity_reservations(profile_id,purchaser_token_hash,tier,expires_at) values(null,p_purchaser_token_hash,p_tier,now()+interval '24 hours') returning * into r;
 return query select r.id,r.expires_at,r.stripe_session_id;
end $$;

create function public.bind_guest_checkout_session(p_reservation_id uuid,p_purchaser_token_hash bytea,p_tier text,p_session_id text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.checkout_capacity_reservations%rowtype; begin
 if octet_length(p_purchaser_token_hash)<>32 or p_tier not in ('og_throne','early_bird') or btrim(coalesce(p_session_id,''))='' then raise exception 'invalid_request'; end if;
 select * into r from public.checkout_capacity_reservations where id=p_reservation_id for update;
 if not found or r.purchaser_token_hash<>p_purchaser_token_hash or r.tier<>p_tier then raise exception 'reservation_mismatch'; end if;
 if r.stripe_session_id=p_session_id and r.status='associated' then return 'already_bound'; end if;
 if r.status<>'active' or r.stripe_session_id is not null then raise exception 'session_conflict'; end if;
 update public.checkout_capacity_reservations set stripe_session_id=p_session_id,status='associated',updated_at=now() where id=r.id; return 'bound';
end $$;

create function public.expire_guest_checkout_session(p_reservation_id uuid,p_tier text,p_session_id text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.checkout_capacity_reservations%rowtype; begin
 if p_tier not in ('og_throne','early_bird') or btrim(coalesce(p_session_id,''))='' then raise exception 'invalid_request'; end if;
 select * into r from public.checkout_capacity_reservations where id=p_reservation_id for update;
 if not found or r.profile_id is not null or r.tier<>p_tier or r.stripe_session_id<>p_session_id then raise exception 'reservation_mismatch'; end if;
 if exists(select 1 from public.pay_first_purchases p where p.reservation_id=r.id) then raise exception 'paid_purchase_exists'; end if;
 if r.status='expired' then return 'already_expired'; end if; if r.status<>'associated' then raise exception 'terminal_conflict'; end if;
 update public.checkout_capacity_reservations set status='expired',updated_at=now() where id=r.id; return 'expired';
end $$;

create function public.record_pay_first_purchase(p_reservation_id uuid,p_purchaser_token_hash bytea,p_tier text,p_session_id text,p_customer_id text,p_price_id text,p_payment_intent_id text,p_subscription_id text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.checkout_capacity_reservations%rowtype; p public.pay_first_purchases%rowtype; begin
 if octet_length(p_purchaser_token_hash)<>32 or p_tier not in ('og_throne','early_bird') or btrim(coalesce(p_session_id,''))='' or btrim(coalesce(p_customer_id,''))='' or btrim(coalesce(p_price_id,''))='' then raise exception 'invalid_request'; end if;
 if not ((p_tier='og_throne' and p_payment_intent_id is not null and p_subscription_id is null) or
         (p_tier='early_bird' and p_payment_intent_id is null and p_subscription_id is not null)) then raise exception 'provider_identity_mismatch'; end if;
 select * into r from public.checkout_capacity_reservations where id=p_reservation_id for update;
 if not found or r.purchaser_token_hash<>p_purchaser_token_hash or r.tier<>p_tier or r.stripe_session_id<>p_session_id or r.status<>'associated' then raise exception 'reservation_mismatch'; end if;
 select * into p from public.pay_first_purchases where reservation_id=r.id for update;
 if found then
  if p.purchaser_token_hash=p_purchaser_token_hash and p.tier=p_tier and p.stripe_session_id=p_session_id and p.stripe_customer_id=p_customer_id and p.stripe_price_id=p_price_id and p.payment_intent_id is not distinct from p_payment_intent_id and p.stripe_subscription_id is not distinct from p_subscription_id then return 'already_recorded'; end if;
  raise exception 'purchase_conflict';
 end if;
 insert into public.pay_first_purchases(reservation_id,purchaser_token_hash,tier,stripe_session_id,stripe_customer_id,stripe_price_id,payment_intent_id,stripe_subscription_id)
 values(r.id,p_purchaser_token_hash,p_tier,p_session_id,p_customer_id,p_price_id,p_payment_intent_id,p_subscription_id); return 'recorded';
end $$;

create function public.claim_pay_first_purchase(p_reservation_id uuid,p_purchaser_token_hash bytea,p_session_id text,p_profile_id uuid,p_auth_user_id uuid,p_subscription_status text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pay_first_purchases%rowtype; r public.checkout_capacity_reservations%rowtype; prof public.profiles%rowtype; t public.subscription_tiers%rowtype; entitlement_ids uuid[];
begin
 if octet_length(p_purchaser_token_hash)<>32 or btrim(coalesce(p_session_id,''))='' then raise exception 'invalid_request'; end if;
 select * into p from public.pay_first_purchases where reservation_id=p_reservation_id for update;
 if not found or p.purchaser_token_hash<>p_purchaser_token_hash or p.stripe_session_id<>p_session_id then raise exception 'purchase_mismatch'; end if;
 if p.state='claimed' then if p.claimed_profile_id=p_profile_id then return 'already_claimed'; else raise exception 'claimed_by_other_profile'; end if;
 select * into r from public.checkout_capacity_reservations where id=p.reservation_id for update;
 select * into prof from public.profiles where id=p_profile_id for update;
 if not found or prof.user_id<>p_auth_user_id then raise exception 'ownership_mismatch'; end if;
 if prof.stripe_customer_id is not null and prof.stripe_customer_id<>p.stripe_customer_id then raise exception 'customer_conflict'; end if;
 select * into t from public.subscription_tiers where name=p.tier for update;
 if not found or t.stripe_price_id<>p.stripe_price_id then raise exception 'price_mismatch'; end if;
 perform 1 from public.checkout_capacity_reservations x where x.profile_id=p_profile_id and x.id<>r.id and x.status in ('active','associated') for update;
 if found then raise exception 'reservation_conflict'; end if;
 select array_agg(id) into entitlement_ids from (select id from public.user_subscriptions where user_id=p_profile_id and tier_name=p.tier and status in ('active','trialing') for update) q;
 if coalesce(array_length(entitlement_ids,1),0)>1 then raise exception 'ambiguous_entitlement'; end if;
 update public.profiles set stripe_customer_id=p.stripe_customer_id where id=p_profile_id;
 if coalesce(array_length(entitlement_ids,1),0)=1 then
  update public.user_subscriptions set status=case when p.tier='og_throne' then 'active' else p_subscription_status end,stripe_customer_id=p.stripe_customer_id,stripe_subscription_id=p.stripe_subscription_id,
   metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('checkout_contract','sirens_forge_pay_first_v1','reservation_id',p.reservation_id,'checkout_session_id',p.stripe_session_id,'stripe_price_id',p.stripe_price_id,'payment_intent_id',p.payment_intent_id,'access_type',case when p.tier='og_throne' then 'one_time_lifetime' else 'subscription' end) where id=entitlement_ids[1];
 else
  insert into public.user_subscriptions(user_id,tier_id,tier_name,stripe_customer_id,stripe_subscription_id,status,metadata) values(p_profile_id,t.id,p.tier,p.stripe_customer_id,p.stripe_subscription_id,case when p.tier='og_throne' then 'active' else p_subscription_status end,
   jsonb_build_object('checkout_contract','sirens_forge_pay_first_v1','reservation_id',p.reservation_id,'checkout_session_id',p.stripe_session_id,'stripe_price_id',p.stripe_price_id,'payment_intent_id',p.payment_intent_id,'access_type',case when p.tier='og_throne' then 'one_time_lifetime' else 'subscription' end));
 end if;
 update public.pay_first_purchases set state='claimed',claimed_profile_id=p_profile_id,claimed_at=now(),updated_at=now() where id=p.id;
 update public.checkout_capacity_reservations set status='fulfilled',profile_id=p_profile_id,purchaser_token_hash=null,payment_intent_id=coalesce(p.payment_intent_id,p.stripe_subscription_id),fulfilled_at=now(),updated_at=now() where id=r.id;
 return 'claimed';
end $$;

revoke all on public.pay_first_purchases from public,anon,authenticated;
grant select,insert,update on public.pay_first_purchases to service_role;
revoke all on function public.acquire_guest_checkout_capacity_reservation(bytea,text), public.bind_guest_checkout_session(uuid,bytea,text,text), public.expire_guest_checkout_session(uuid,text,text), public.record_pay_first_purchase(uuid,bytea,text,text,text,text,text,text), public.claim_pay_first_purchase(uuid,bytea,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.acquire_guest_checkout_capacity_reservation(bytea,text), public.bind_guest_checkout_session(uuid,bytea,text,text), public.expire_guest_checkout_session(uuid,text,text), public.record_pay_first_purchase(uuid,bytea,text,text,text,text,text,text), public.claim_pay_first_purchase(uuid,bytea,text,uuid,uuid,text) to service_role;
