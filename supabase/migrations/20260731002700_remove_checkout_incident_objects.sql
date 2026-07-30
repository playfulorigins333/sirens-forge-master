-- Forward-only cleanup for the Checkout incident introduced by migrations
-- 20260729002100 through 20260730002600.
--
-- This migration intentionally preserves those applied migration files and
-- removes only the database objects they introduced.
--
-- Production application traffic was rolled back to commit:
-- 8a52c720f33101781bb38a80a7ebe08bbb7fa72d

do $cleanup$
declare
  v_cleanup_not_before constant timestamptz :=
    '2026-07-31T16:19:03.582480Z'::timestamptz;

  v_purchase_count bigint;
  v_payment_evidence_count bigint;
  v_entitlement_count bigint;
  v_reservation_count bigint;
  v_invalid_reservation_count bigint;
  v_rate_attempt_count bigint;
  v_invalid_rate_attempt_count bigint;
  v_job_id bigint;
begin
  if clock_timestamp() < v_cleanup_not_before then
    raise exception
      'checkout_incident_cleanup_before_authorized_cutoff';
  end if;

  if to_regclass('public.checkout_capacity_reservations') is null
     or to_regclass('public.pay_first_purchases') is null
     or to_regclass('public.checkout_guest_rate_limit_attempts') is null then
    raise exception
      'checkout_incident_cleanup_expected_tables_missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('sirens_forge_checkout_incident_cleanup_02700', 2700)
  );

  execute
    'lock table public.checkout_capacity_reservations in access exclusive mode';

  execute
    'lock table public.pay_first_purchases in access exclusive mode';

  execute
    'lock table public.checkout_guest_rate_limit_attempts in access exclusive mode';

  execute
    'lock table public.user_subscriptions in share mode';

  select count(*)
  into v_purchase_count
  from public.pay_first_purchases;

  if v_purchase_count <> 0 then
    raise exception
      'checkout_incident_cleanup_blocked_pay_first_purchases:%',
      v_purchase_count;
  end if;

  select count(*)
  into v_payment_evidence_count
  from public.checkout_capacity_reservations
  where payment_intent_id is not null
     or stripe_subscription_id is not null
     or fulfilled_at is not null
     or status = 'fulfilled';

  if v_payment_evidence_count <> 0 then
    raise exception
      'checkout_incident_cleanup_blocked_payment_or_fulfillment:%',
      v_payment_evidence_count;
  end if;

  select count(*)
  into v_entitlement_count
  from public.user_subscriptions
  where metadata ->> 'checkout_contract' in (
    'sirens_forge_launch_checkout_v1',
    'sirens_forge_pay_first_v1'
  );

  if v_entitlement_count <> 0 then
    raise exception
      'checkout_incident_cleanup_blocked_entitlements:%',
      v_entitlement_count;
  end if;

  select count(*)
  into v_reservation_count
  from public.checkout_capacity_reservations;

  if v_reservation_count > 1 then
    raise exception
      'checkout_incident_cleanup_unexpected_reservation_count:%',
      v_reservation_count;
  end if;

  select count(*)
  into v_invalid_reservation_count
  from public.checkout_capacity_reservations
  where not coalesce(
    profile_id is null
    and purchaser_token_hash is not null
    and octet_length(purchaser_token_hash) = 32
    and tier = 'early_bird'
    and status in ('associated', 'expired')
    and stripe_session_id is not null
    and payment_intent_id is null
    and stripe_subscription_id is null
    and fulfilled_at is null,
    false
  );

  if v_invalid_reservation_count <> 0 then
    raise exception
      'checkout_incident_cleanup_unexpected_reservation_state:%',
      v_invalid_reservation_count;
  end if;

  select count(*)
  into v_rate_attempt_count
  from public.checkout_guest_rate_limit_attempts;

  if v_rate_attempt_count > 1 then
    raise exception
      'checkout_incident_cleanup_unexpected_rate_attempt_count:%',
      v_rate_attempt_count;
  end if;

  select count(*)
  into v_invalid_rate_attempt_count
  from public.checkout_guest_rate_limit_attempts attempts
  left join public.checkout_capacity_reservations reservations
    on reservations.id = attempts.reservation_id
  where reservations.id is null
     or not coalesce(
       reservations.profile_id is null
       and reservations.purchaser_token_hash is not null
       and octet_length(reservations.purchaser_token_hash) = 32
       and reservations.tier = 'early_bird'
       and reservations.status in ('associated', 'expired')
       and reservations.stripe_session_id is not null
       and reservations.payment_intent_id is null
       and reservations.stripe_subscription_id is null
       and reservations.fulfilled_at is null,
       false
     );

  if v_invalid_rate_attempt_count <> 0 then
    raise exception
      'checkout_incident_cleanup_unexpected_rate_attempt_state:%',
      v_invalid_rate_attempt_count;
  end if;

  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'sirens_forge_checkout_guest_rate_limit_cleanup'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  execute 'drop function if exists public.switch_guest_checkout_capacity_reservation(bytea,bytea,text,uuid,text)';
  execute 'drop function if exists public.claim_pay_first_purchase(uuid,bytea,text,uuid,uuid,text)';
  execute 'drop function if exists public.record_pay_first_purchase(uuid,bytea,text,text,text,text,text,text)';
  execute 'drop function if exists public.expire_guest_checkout_session(uuid,text,text)';
  execute 'drop function if exists public.bind_guest_checkout_session(uuid,bytea,text,text)';
  execute 'drop function if exists public.acquire_guest_checkout_capacity_reservation(bytea,bytea,text)';
  execute 'drop function if exists public.cleanup_checkout_guest_rate_limit_attempts()';

  execute 'drop function if exists public.expire_checkout_capacity_reservation_from_session(uuid,uuid,text,text)';
  execute 'drop function if exists public.fulfill_og_checkout_payment(text,uuid,uuid,uuid,text,text,text,text,text)';
  execute 'drop function if exists public.expire_checkout_capacity_reservations()';
  execute 'drop function if exists public.release_checkout_capacity_reservation(uuid,uuid,text)';
  execute 'drop function if exists public.associate_checkout_capacity_session(uuid,uuid,text,text)';
  execute 'drop function if exists public.acquire_checkout_capacity_reservation(uuid,text)';

  execute 'drop table public.checkout_guest_rate_limit_attempts';
  execute 'drop table public.pay_first_purchases';
  execute 'drop table public.checkout_capacity_reservations';

  perform pg_notify('pgrst', 'reload schema');
end
$cleanup$;