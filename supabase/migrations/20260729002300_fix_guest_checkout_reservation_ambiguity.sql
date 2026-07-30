create or replace function public.acquire_guest_checkout_capacity_reservation(p_purchaser_token_hash bytea,p_network_hash bytea,p_tier text)
returns table(reservation_id uuid,expires_at timestamptz,stripe_session_id text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.subscription_tiers%rowtype; r public.checkout_capacity_reservations%rowtype; paid bigint; held bigint; hourly bigint; daily bigint;
begin
 if octet_length(p_purchaser_token_hash)<>32 then raise exception 'invalid_request'; end if;
 if octet_length(p_network_hash)<>32 then raise exception 'malformed_network_hash'; end if;
 if p_tier not in ('og_throne','early_bird') then raise exception 'invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(encode(p_network_hash,'hex'),2050));
 perform pg_advisory_xact_lock(hashtextextended(encode(p_purchaser_token_hash,'hex'),2049));
 delete from public.checkout_guest_rate_limit_attempts as rate_attempt where rate_attempt.expires_at<=now();
 update public.checkout_capacity_reservations as expired_reservation set status='expired',updated_at=now() where expired_reservation.status='active' and expired_reservation.stripe_session_id is null and expired_reservation.expires_at<=now();
 select existing_reservation.* into r from public.checkout_capacity_reservations as existing_reservation where existing_reservation.purchaser_token_hash=p_purchaser_token_hash and existing_reservation.status in ('active','associated') for update;
 if found and r.tier<>p_tier then raise exception 'reservation_conflict'; end if;
 if found then return query select r.id,r.expires_at,r.stripe_session_id; return; end if;
 select count(*) into hourly from public.checkout_guest_rate_limit_attempts as hourly_attempt where hourly_attempt.network_hash=p_network_hash and hourly_attempt.created_at>now()-interval '60 minutes';
 if hourly>=5 then raise exception 'rate_limit_hourly'; end if;
 select count(*) into daily from public.checkout_guest_rate_limit_attempts as daily_attempt where daily_attempt.network_hash=p_network_hash and daily_attempt.created_at>now()-interval '24 hours';
 if daily>=10 then raise exception 'rate_limit_daily'; end if;
 select selected_tier.* into t from public.subscription_tiers as selected_tier where selected_tier.name=p_tier for update;
 if not found or not coalesce(t.is_active,false) or t.max_slots is null then raise exception 'plan_unavailable'; end if;
 select count(*) into paid from public.user_subscriptions as s where s.tier_name=p_tier and s.status in ('active','trialing') and not (p_tier='og_throne' and coalesce(s.metadata->>'counts_toward_seats','true')='false');
 select count(*) into held from public.checkout_capacity_reservations as x where x.tier=p_tier and ((x.status='active' and x.stripe_session_id is null and x.expires_at>now()) or x.status='associated')
  and (x.profile_id is null or not exists(select 1 from public.user_subscriptions as s where s.user_id=x.profile_id and s.tier_name=x.tier and s.status in ('active','trialing')));
 if paid+held>=t.max_slots then raise exception 'sold_out'; end if;
 insert into public.checkout_capacity_reservations as inserted_reservation(profile_id,purchaser_token_hash,tier,expires_at) values(null,p_purchaser_token_hash,p_tier,now()+interval '60 minutes') returning inserted_reservation.* into r;
 insert into public.checkout_guest_rate_limit_attempts as inserted_attempt(network_hash,purchaser_token_hash,reservation_id,expires_at) values(p_network_hash,p_purchaser_token_hash,r.id,now()+interval '24 hours');
 return query select r.id,r.expires_at,r.stripe_session_id;
end $$;
