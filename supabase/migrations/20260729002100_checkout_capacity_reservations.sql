create table if not exists public.checkout_capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null check (tier in ('og_throne','early_bird')),
  status text not null default 'active' check (status in ('active','associated','fulfilled','released','expired')),
  expires_at timestamptz not null,
  stripe_session_id text,
  payment_intent_id text,
  fulfilled_at timestamptz,
  idempotency_identity uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((status='fulfilled') = (payment_intent_id is not null and fulfilled_at is not null))
);
alter table public.checkout_capacity_reservations enable row level security;
create index checkout_capacity_reservations_capacity_idx on public.checkout_capacity_reservations(tier,status,expires_at);
create unique index checkout_capacity_one_effective_profile on public.checkout_capacity_reservations(profile_id)
  where status in ('active','associated');
create unique index checkout_capacity_one_stripe_session on public.checkout_capacity_reservations(stripe_session_id)
  where stripe_session_id is not null;
create unique index checkout_capacity_one_payment_intent on public.checkout_capacity_reservations(payment_intent_id)
  where payment_intent_id is not null;

create or replace function public.acquire_checkout_capacity_reservation(p_profile_id uuid, p_tier text)
returns table(reservation_id uuid, expires_at timestamptz, stripe_session_id text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tier public.subscription_tiers%rowtype; v_paid bigint; v_reserved bigint; v_existing public.checkout_capacity_reservations%rowtype;
begin
  if p_tier not in ('og_throne','early_bird') then raise exception 'plan_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 1901));
  select * into v_tier from public.subscription_tiers where name=p_tier for update;
  if not found or not coalesce(v_tier.is_active,false) or v_tier.max_slots is null then raise exception 'plan_unavailable'; end if;
  update public.checkout_capacity_reservations set status='expired',updated_at=now() where status='active' and stripe_session_id is null and expires_at<=now();
  if exists (select 1 from public.user_subscriptions s where s.user_id=p_profile_id and s.tier_name in ('og_throne','early_bird') and s.status in ('active','trialing')) then raise exception 'existing_entitlement'; end if;
  select * into v_existing from public.checkout_capacity_reservations where profile_id=p_profile_id and status in ('active','associated') and (status='associated' or expires_at>now()) limit 1;
  if found and v_existing.tier<>p_tier then raise exception 'reservation_conflict'; end if;
  if found then return query select v_existing.id,v_existing.expires_at,v_existing.stripe_session_id; return; end if;
  select count(*) into v_paid from public.user_subscriptions s where s.tier_name=p_tier and s.status in ('active','trialing')
    and not (p_tier='og_throne' and coalesce(s.metadata->>'counts_toward_seats','true')='false');
  select count(*) into v_reserved from public.checkout_capacity_reservations r where r.tier=p_tier and ((r.status='active' and r.stripe_session_id is null and r.expires_at>now()) or r.status='associated')
    and not exists (select 1 from public.user_subscriptions s where s.user_id=r.profile_id and s.tier_name=r.tier and s.status in ('active','trialing'));
  if v_paid+v_reserved>=v_tier.max_slots then raise exception 'sold_out'; end if;
  insert into public.checkout_capacity_reservations(profile_id,tier,expires_at) values(p_profile_id,p_tier,now()+interval '24 hours') returning * into v_existing;
  return query select v_existing.id,v_existing.expires_at,v_existing.stripe_session_id;
end $$;

create or replace function public.associate_checkout_capacity_session(p_reservation_id uuid,p_profile_id uuid,p_tier text,p_stripe_session_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin
 update public.checkout_capacity_reservations set stripe_session_id=coalesce(stripe_session_id,p_stripe_session_id),status='associated',updated_at=now()
 where id=p_reservation_id and profile_id=p_profile_id and tier=p_tier and status in ('active','associated') and (stripe_session_id is null or stripe_session_id=p_stripe_session_id);
 if not found then raise exception 'reservation_unavailable'; end if;
end $$;
create or replace function public.release_checkout_capacity_reservation(p_reservation_id uuid,p_profile_id uuid,p_tier text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin
 update public.checkout_capacity_reservations set status='released',updated_at=now() where id=p_reservation_id and profile_id=p_profile_id and tier=p_tier and status in ('active','associated');
end $$;
create or replace function public.expire_checkout_capacity_reservations()
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$ declare n bigint; begin
 update public.checkout_capacity_reservations set status='expired',updated_at=now() where status='active' and stripe_session_id is null and expires_at<=now(); get diagnostics n=row_count; return n;
end $$;

create or replace function public.fulfill_og_checkout_payment(p_checkout_contract text,p_reservation_id uuid,p_profile_id uuid,p_user_id uuid,p_tier text,p_price_id text,p_customer_id text,p_payment_intent_id text,p_session_id text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.checkout_capacity_reservations%rowtype; t public.subscription_tiers%rowtype; entitlement_ids uuid[];
begin
 if p_checkout_contract<>'sirens_forge_launch_checkout_v1' or p_tier<>'og_throne' or p_price_id='' or p_customer_id='' or p_payment_intent_id='' then raise exception 'invalid_contract'; end if;
 select * into r from public.checkout_capacity_reservations where id=p_reservation_id and profile_id=p_profile_id and tier='og_throne' for update;
 if not found then raise exception 'reservation_unavailable'; end if;
 if r.status='fulfilled' and r.payment_intent_id=p_payment_intent_id then return 'already_fulfilled'; end if;
 if r.status<>'associated' or r.payment_intent_id is not null or (p_session_id is not null and r.stripe_session_id<>p_session_id) then raise exception 'reservation_conflict'; end if;
 if not exists(select 1 from public.profiles p where p.id=p_profile_id and p.user_id=p_user_id and p.stripe_customer_id=p_customer_id) then raise exception 'ownership_mismatch'; end if;
 select * into t from public.subscription_tiers where name='og_throne' and is_active=true for update;
 if not found or t.stripe_price_id<>p_price_id then raise exception 'price_mismatch'; end if;
 select array_agg(id) into entitlement_ids from (select id from public.user_subscriptions where user_id=p_profile_id and tier_name='og_throne' and status in ('active','trialing') for update) s;
 if coalesce(array_length(entitlement_ids,1),0)>1 then raise exception 'ambiguous_entitlement'; end if;
 if coalesce(array_length(entitlement_ids,1),0)=1 then
  update public.user_subscriptions set status='active',stripe_customer_id=p_customer_id,metadata=jsonb_build_object('checkout_contract',p_checkout_contract,'reservation_id',p_reservation_id,'payment_intent_id',p_payment_intent_id,'checkout_session_id',p_session_id,'stripe_price_id',p_price_id,'access_type','one_time_lifetime','tier_name','og_throne') where id=entitlement_ids[1];
 else
  insert into public.user_subscriptions(user_id,tier_id,tier_name,stripe_customer_id,status,metadata) values(p_profile_id,t.id,'og_throne',p_customer_id,'active',jsonb_build_object('checkout_contract',p_checkout_contract,'reservation_id',p_reservation_id,'payment_intent_id',p_payment_intent_id,'checkout_session_id',p_session_id,'stripe_price_id',p_price_id,'access_type','one_time_lifetime','tier_name','og_throne'));
 end if;
 update public.checkout_capacity_reservations set status='fulfilled',payment_intent_id=p_payment_intent_id,fulfilled_at=now(),updated_at=now() where id=p_reservation_id;
 return 'applied';
end $$;

create or replace function public.expire_checkout_capacity_reservation_from_session(p_reservation_id uuid,p_profile_id uuid,p_tier text,p_session_id text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.checkout_capacity_reservations%rowtype; begin
 if p_tier not in ('og_throne','early_bird') then raise exception 'invalid_tier'; end if;
 select * into r from public.checkout_capacity_reservations where id=p_reservation_id and profile_id=p_profile_id and tier=p_tier for update;
 if not found or r.stripe_session_id<>p_session_id then raise exception 'reservation_mismatch'; end if;
 if r.status='expired' then return 'already_expired'; end if;
 if r.status<>'associated' then raise exception 'terminal_conflict'; end if;
 update public.checkout_capacity_reservations set status='expired',updated_at=now() where id=p_reservation_id;
 return 'expired';
end $$;
revoke all on public.checkout_capacity_reservations from public,anon,authenticated;
grant select,insert,update on public.checkout_capacity_reservations to service_role;
revoke all on function public.acquire_checkout_capacity_reservation(uuid,text) from public,anon,authenticated;
revoke all on function public.associate_checkout_capacity_session(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.release_checkout_capacity_reservation(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.expire_checkout_capacity_reservations() from public,anon,authenticated;
revoke all on function public.fulfill_og_checkout_payment(text,uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.expire_checkout_capacity_reservation_from_session(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.acquire_checkout_capacity_reservation(uuid,text) to service_role;
grant execute on function public.associate_checkout_capacity_session(uuid,uuid,text,text) to service_role;
grant execute on function public.release_checkout_capacity_reservation(uuid,uuid,text) to service_role;
grant execute on function public.expire_checkout_capacity_reservations() to service_role;
grant execute on function public.fulfill_og_checkout_payment(text,uuid,uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.expire_checkout_capacity_reservation_from_session(uuid,uuid,text,text) to service_role;
