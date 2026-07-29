create table if not exists public.checkout_capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null check (tier in ('og_throne','early_bird')),
  status text not null default 'active' check (status in ('active','associated','released','expired')),
  expires_at timestamptz not null,
  stripe_session_id text,
  idempotency_identity uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.checkout_capacity_reservations enable row level security;
create index checkout_capacity_reservations_capacity_idx on public.checkout_capacity_reservations(tier,status,expires_at);
create unique index checkout_capacity_one_effective_profile_tier on public.checkout_capacity_reservations(profile_id,tier)
  where status in ('active','associated');

create or replace function public.acquire_checkout_capacity_reservation(p_profile_id uuid, p_tier text)
returns table(reservation_id uuid, expires_at timestamptz, stripe_session_id text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tier public.subscription_tiers%rowtype; v_paid bigint; v_reserved bigint; v_existing public.checkout_capacity_reservations%rowtype;
begin
  if p_tier not in ('og_throne','early_bird') then raise exception 'plan_unavailable'; end if;
  select * into v_tier from public.subscription_tiers where name=p_tier for update;
  if not found or not coalesce(v_tier.is_active,false) or v_tier.max_slots is null then raise exception 'plan_unavailable'; end if;
  update public.checkout_capacity_reservations set status='expired',updated_at=now() where status in ('active','associated') and expires_at<=now();
  select * into v_existing from public.checkout_capacity_reservations where profile_id=p_profile_id and tier=p_tier and status in ('active','associated') and expires_at>now() limit 1;
  if found then return query select v_existing.id,v_existing.expires_at,v_existing.stripe_session_id; return; end if;
  select count(*) into v_paid from public.user_subscriptions s where s.tier_name=p_tier and s.status in ('active','trialing')
    and not (p_tier='og_throne' and coalesce(s.metadata->>'counts_toward_seats','true')='false');
  select count(*) into v_reserved from public.checkout_capacity_reservations r where r.tier=p_tier and r.status in ('active','associated') and r.expires_at>now()
    and not exists (select 1 from public.user_subscriptions s where s.user_id=r.profile_id and s.tier_name=r.tier and s.status in ('active','trialing'));
  if v_paid+v_reserved>=v_tier.max_slots then raise exception 'sold_out'; end if;
  insert into public.checkout_capacity_reservations(profile_id,tier,expires_at) values(p_profile_id,p_tier,now()+interval '30 minutes') returning * into v_existing;
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
 update public.checkout_capacity_reservations set status='expired',updated_at=now() where status in ('active','associated') and expires_at<=now(); get diagnostics n=row_count; return n;
end $$;
revoke all on public.checkout_capacity_reservations from public,anon,authenticated;
grant select,insert,update on public.checkout_capacity_reservations to service_role;
revoke all on function public.acquire_checkout_capacity_reservation(uuid,text) from public,anon,authenticated;
revoke all on function public.associate_checkout_capacity_session(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.release_checkout_capacity_reservation(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.expire_checkout_capacity_reservations() from public,anon,authenticated;
grant execute on function public.acquire_checkout_capacity_reservation(uuid,text) to service_role;
grant execute on function public.associate_checkout_capacity_session(uuid,uuid,text,text) to service_role;
grant execute on function public.release_checkout_capacity_reservation(uuid,uuid,text) to service_role;
grant execute on function public.expire_checkout_capacity_reservations() to service_role;
