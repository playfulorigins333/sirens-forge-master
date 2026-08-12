-- LOCK-05E: apply authoritative Stripe subscription truth only to the exact
-- claimed Payment V2 Early Bird entitlement. Inventory and finance are frozen.

create function public.payment_v2_apply_early_bird_subscription_lifecycle(
  p_hold_id uuid,
  p_subscription_id text,
  p_customer_id text,
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
    and p.stripe_customer_id = p_customer_id;

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

alter function public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz) owner to postgres;
revoke execute on function public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz) to service_role;
