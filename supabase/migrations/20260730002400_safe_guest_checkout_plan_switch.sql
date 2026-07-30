-- Safely expose a cross-tier reservation to the server, then replace it only after
-- the server has expired its Stripe Checkout Session.
drop function public.acquire_guest_checkout_capacity_reservation(bytea,bytea,text);
create function public.acquire_guest_checkout_capacity_reservation(p_purchaser_token_hash bytea,p_network_hash bytea,p_tier text)
returns table(reservation_id uuid,expires_at timestamptz,stripe_session_id text,reservation_tier text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.subscription_tiers%rowtype; r public.checkout_capacity_reservations%rowtype; paid bigint; held bigint; hourly bigint; daily bigint;
begin
 if octet_length(p_purchaser_token_hash)<>32 or octet_length(p_network_hash)<>32 or p_tier not in ('og_throne','early_bird') then raise exception 'invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(encode(p_network_hash,'hex'),2050));
 perform pg_advisory_xact_lock(hashtextextended(encode(p_purchaser_token_hash,'hex'),2049));
 delete from public.checkout_guest_rate_limit_attempts a where a.expires_at<=now();
 update public.checkout_capacity_reservations x set status='expired',updated_at=now() where x.status='active' and x.stripe_session_id is null and x.expires_at<=now();
 select x.* into r from public.checkout_capacity_reservations x where x.purchaser_token_hash=p_purchaser_token_hash and x.status in ('active','associated') for update;
 if found then return query select r.id,r.expires_at,r.stripe_session_id,r.tier; return; end if;
 select count(*) into hourly from public.checkout_guest_rate_limit_attempts a where a.network_hash=p_network_hash and a.created_at>now()-interval '60 minutes'; if hourly>=5 then raise exception 'rate_limit_hourly'; end if;
 select count(*) into daily from public.checkout_guest_rate_limit_attempts a where a.network_hash=p_network_hash and a.created_at>now()-interval '24 hours'; if daily>=10 then raise exception 'rate_limit_daily'; end if;
 select x.* into t from public.subscription_tiers x where x.name=p_tier for update; if not found or not coalesce(t.is_active,false) or t.max_slots is null then raise exception 'plan_unavailable'; end if;
 select count(*) into paid from public.user_subscriptions s where s.tier_name=p_tier and s.status in ('active','trialing') and not (p_tier='og_throne' and coalesce(s.metadata->>'counts_toward_seats','true')='false');
 select count(*) into held from public.checkout_capacity_reservations x where x.tier=p_tier and ((x.status='active' and x.stripe_session_id is null and x.expires_at>now()) or x.status='associated') and (x.profile_id is null or not exists(select 1 from public.user_subscriptions s where s.user_id=x.profile_id and s.tier_name=x.tier and s.status in ('active','trialing')));
 if paid+held>=t.max_slots then raise exception 'sold_out'; end if;
 insert into public.checkout_capacity_reservations as x(profile_id,purchaser_token_hash,tier,expires_at) values(null,p_purchaser_token_hash,p_tier,now()+interval '60 minutes') returning x.* into r;
 insert into public.checkout_guest_rate_limit_attempts(network_hash,purchaser_token_hash,reservation_id,expires_at) values(p_network_hash,p_purchaser_token_hash,r.id,now()+interval '24 hours');
 return query select r.id,r.expires_at,r.stripe_session_id,r.tier;
end $$;

create function public.switch_guest_checkout_capacity_reservation(p_purchaser_token_hash bytea,p_network_hash bytea,p_tier text,p_previous_reservation_id uuid,p_previous_session_id text)
returns table(reservation_id uuid,expires_at timestamptz,stripe_session_id text,reservation_tier text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare old public.checkout_capacity_reservations%rowtype; fresh public.checkout_capacity_reservations%rowtype; t public.subscription_tiers%rowtype; paid bigint; held bigint; hourly bigint; daily bigint;
begin
 if octet_length(p_purchaser_token_hash)<>32 or octet_length(p_network_hash)<>32 or p_tier not in ('og_throne','early_bird') then raise exception 'invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(encode(p_network_hash,'hex'),2050)); perform pg_advisory_xact_lock(hashtextextended(encode(p_purchaser_token_hash,'hex'),2049));
 select x.* into old from public.checkout_capacity_reservations x where x.id=p_previous_reservation_id for update;
 if not found or old.purchaser_token_hash<>p_purchaser_token_hash or old.tier=p_tier or old.status not in ('active','associated') or old.stripe_session_id is distinct from p_previous_session_id then raise exception 'switch_conflict'; end if;
 if (old.status='associated')<>(p_previous_session_id is not null) then raise exception 'switch_conflict'; end if;
 select count(*) into hourly from public.checkout_guest_rate_limit_attempts a where a.network_hash=p_network_hash and a.created_at>now()-interval '60 minutes'; if hourly>=5 then raise exception 'rate_limit_hourly'; end if;
 select count(*) into daily from public.checkout_guest_rate_limit_attempts a where a.network_hash=p_network_hash and a.created_at>now()-interval '24 hours'; if daily>=10 then raise exception 'rate_limit_daily'; end if;
 select x.* into t from public.subscription_tiers x where x.name=p_tier for update; if not found or not coalesce(t.is_active,false) or t.max_slots is null then raise exception 'plan_unavailable'; end if;
 select count(*) into paid from public.user_subscriptions s where s.tier_name=p_tier and s.status in ('active','trialing') and not (p_tier='og_throne' and coalesce(s.metadata->>'counts_toward_seats','true')='false');
 select count(*) into held from public.checkout_capacity_reservations x where x.tier=p_tier and ((x.status='active' and x.stripe_session_id is null and x.expires_at>now()) or x.status='associated');
 if paid+held>=t.max_slots then raise exception 'sold_out'; end if;
 update public.checkout_capacity_reservations set status='expired',updated_at=now() where id=old.id;
 insert into public.checkout_capacity_reservations as x(profile_id,purchaser_token_hash,tier,expires_at) values(null,p_purchaser_token_hash,p_tier,now()+interval '60 minutes') returning x.* into fresh;
 insert into public.checkout_guest_rate_limit_attempts(network_hash,purchaser_token_hash,reservation_id,expires_at) values(p_network_hash,p_purchaser_token_hash,fresh.id,now()+interval '24 hours');
 return query select fresh.id,fresh.expires_at,fresh.stripe_session_id,fresh.tier;
end $$;
revoke all on function public.acquire_guest_checkout_capacity_reservation(bytea,bytea,text), public.switch_guest_checkout_capacity_reservation(bytea,bytea,text,uuid,text) from public,anon,authenticated;
grant execute on function public.acquire_guest_checkout_capacity_reservation(bytea,bytea,text), public.switch_guest_checkout_capacity_reservation(bytea,bytea,text,uuid,text) to service_role;
