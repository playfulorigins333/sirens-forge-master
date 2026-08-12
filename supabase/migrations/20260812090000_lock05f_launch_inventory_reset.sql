-- LOCK-05F: reset launch bookkeeping from authoritative Payment V2 consumption.
BEGIN;

create or replace function public.payment_v2_acquire_hold(p_purchaser_hash bytea,p_tier text,p_expires_at timestamptz,p_referral_code text default null)
returns table(hold_id uuid,state text,expires_at timestamptz,connect_destination text,commission_percent numeric)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare h public.payment_v2_holds%rowtype; lim integer; normalized text; rc public.referral_codes%rowtype; submitted_referral_id uuid; referral_count bigint; auth_id uuid; profile public.profiles%rowtype; profile_count bigint; entitlement_count bigint; affiliate_tier text; rate numeric; destination text;
begin
 if octet_length(p_purchaser_hash)<>32 or p_tier not in ('og_throne','early_bird') or p_expires_at<=now() or p_expires_at>now()+interval '2 hours' then raise exception 'invalid_request'; end if;
 normalized:=case when p_referral_code is null then null else upper(p_referral_code) end;
 if normalized is not null and normalized !~ '^[A-Z0-9_-]{4,20}$' then raise exception 'invalid_referral'; end if;
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_credential:'||encode(p_purchaser_hash,'hex'),3100));
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_capacity:early_bird',3100)); perform pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_capacity:og_throne',3100));
 update public.payment_v2_holds x set state='EXPIRED_UNPAID',updated_at=now() where x.purchaser_credential_hash=p_purchaser_hash and x.state='HELD' and x.stripe_checkout_session_id is null and x.expires_at<=now();
 select * into h from public.payment_v2_holds x where x.purchaser_credential_hash=p_purchaser_hash and ((x.state='HELD' and x.expires_at>now()) or x.state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED')) for update;
 if found then
  if h.tier<>p_tier then raise exception 'effective_hold_conflict'; end if;
  if normalized is not null then
   select count(*),(array_agg(r.id order by r.id))[1] into referral_count,submitted_referral_id from public.referral_codes r where upper(r.code)=normalized;
   if referral_count<>1 then raise exception 'attribution_conflict'; end if;
  end if;
  if h.referral_code_id is distinct from submitted_referral_id then raise exception 'attribution_conflict'; end if;
  rate:=case when h.referral_code_id is null then null when h.tier='og_throne' and h.referrer_affiliate_tier='og_throne' then 25 when h.tier='og_throne' then 10 when h.referrer_affiliate_tier='og_throne' then 50 else 20 end;
  return query select h.id,h.state,h.expires_at,h.stripe_connect_destination,rate; return;
 end if;
 if normalized is not null then
  select count(*),(array_agg(r.id order by r.id))[1] into referral_count,submitted_referral_id from public.referral_codes r where upper(r.code)=normalized and r.is_active is true and (r.expires_at is null or r.expires_at>now());
  if referral_count<>1 then raise exception 'invalid_referral'; end if;
  select * into rc from public.referral_codes r where r.id=submitted_referral_id;
  auth_id:=rc.user_id;
  select count(*) into profile_count from public.profiles p where p.user_id=auth_id;
  if profile_count<>1 then raise exception 'invalid_referral_profile'; end if;
  select * into profile from public.profiles p where p.user_id=auth_id;
  select count(*) into entitlement_count from public.user_subscriptions s where s.user_id=profile.id and s.status='active' and s.tier_name in ('og_throne','early_bird');
  if entitlement_count<>1 then raise exception 'invalid_referral_entitlement'; end if;
  select s.tier_name into affiliate_tier from public.user_subscriptions s where s.user_id=profile.id and s.status='active' and s.tier_name in ('og_throne','early_bird');
  if profile.stripe_connect_onboarded and (profile.stripe_connect_account_id is null or profile.stripe_connect_account_id !~ '^acct_[A-Za-z0-9]+$') then raise exception 'invalid_referral_connect'; end if;
  destination:=case when profile.stripe_connect_onboarded then profile.stripe_connect_account_id else null end;
  rate:=case when p_tier='og_throne' and affiliate_tier='og_throne' then 25 when p_tier='og_throne' then 10 when affiliate_tier='og_throne' then 50 else 20 end;
 end if;
 update public.payment_v2_holds x set state='EXPIRED_UNPAID',updated_at=now() where x.tier=p_tier and x.state='HELD' and x.stripe_checkout_session_id is null and x.expires_at<=now();
 lim:=case p_tier when 'og_throne' then 50 else 150 end;
 if (select count(*) from public.payment_v2_holds x where x.tier=p_tier and ((x.state='HELD' and x.expires_at>now()) or x.state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED')))>=lim then raise exception 'sold_out'; end if;
 insert into public.payment_v2_holds(purchaser_credential_hash,tier,expires_at,referral_code_id,referrer_auth_user_id,referrer_profile_id,referrer_affiliate_tier,referral_bound_at,stripe_connect_destination)
 values(p_purchaser_hash,p_tier,p_expires_at,rc.id,auth_id,profile.id,affiliate_tier,case when rc.id is null then null else now() end,destination) returning * into h;
 return query select h.id,h.state,h.expires_at,h.stripe_connect_destination,rate;
end $$;

ALTER FUNCTION public.payment_v2_acquire_hold(bytea,text,timestamptz,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.payment_v2_acquire_hold(bytea,text,timestamptz,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payment_v2_acquire_hold(bytea,text,timestamptz,text) TO service_role;

DO $lock05f$
DECLARE og_used bigint; early_used bigint;
BEGIN
  -- Serialize with acquire_hold's deterministic capacity locks before measuring.
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_capacity:early_bird',3100));
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_capacity:og_throne',3100));
  SELECT count(*) FILTER (WHERE tier='og_throne'), count(*) FILTER (WHERE tier='early_bird')
    INTO og_used,early_used
    FROM public.payment_v2_holds
   WHERE (state='HELD' AND expires_at>now()) OR state IN ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED');
  IF og_used>50 OR early_used>150 THEN RAISE EXCEPTION 'lock05f_capacity_exceeded'; END IF;
  UPDATE public.subscription_tiers SET max_slots=50,slots_remaining=50-og_used WHERE name='og_throne';
  IF NOT FOUND THEN RAISE EXCEPTION 'lock05f_og_tier_missing'; END IF;
  UPDATE public.subscription_tiers SET max_slots=150,slots_remaining=150-early_used WHERE name='early_bird';
  IF NOT FOUND THEN RAISE EXCEPTION 'lock05f_early_bird_tier_missing'; END IF;
  IF (SELECT count(*) FROM public.subscription_tiers WHERE name IN ('og_throne','early_bird'))<>2 THEN
    RAISE EXCEPTION 'lock05f_tier_catalog_ambiguous';
  END IF;
END $lock05f$;

SELECT pg_notify('pgrst','reload schema');
COMMIT;
