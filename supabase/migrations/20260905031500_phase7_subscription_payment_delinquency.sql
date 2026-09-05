-- Phase 7: durable recurring-payment delinquency and retention-deadline contract.
-- Generated manually because the Supabase CLI is unavailable in this environment.
-- Phase 8 owns purge execution; Phase 9 owns notification delivery.

begin;

create table public.subscription_payment_delinquencies (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  subscription_id uuid not null references public.user_subscriptions(id) on delete restrict,
  stripe_subscription_id text not null check (btrim(stripe_subscription_id) = stripe_subscription_id and stripe_subscription_id <> ''),
  state text not null check (state in ('first_miss_frozen','retention_countdown','recovered','superseded','expired')),
  first_missed_invoice_id text not null check (btrim(first_missed_invoice_id) = first_missed_invoice_id and first_missed_invoice_id <> ''),
  first_missed_at timestamptz not null,
  second_missed_invoice_id text,
  second_missed_at timestamptz,
  consecutive_missed_cycles integer not null check (consecutive_missed_cycles >= 1),
  retention_started_at timestamptz,
  retention_until timestamptz,
  recovered_at timestamptz,
  day_0_notification_due_at timestamptz,
  day_30_notification_due_at timestamptz,
  day_45_notification_due_at timestamptz,
  day_55_notification_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, auth_user_id, profile_id, subscription_id, stripe_subscription_id),
  check (state <> 'first_miss_frozen' or (second_missed_at is null and retention_started_at is null and retention_until is null and day_0_notification_due_at is null)),
  check ((second_missed_at is null) = (second_missed_invoice_id is null)),
  check (second_missed_at is null or second_missed_at >= first_missed_at),
  check (retention_started_at is null or retention_started_at = second_missed_at),
  check (retention_until is null or retention_until = retention_started_at + interval '60 days'),
  check (day_0_notification_due_at is null or day_0_notification_due_at = retention_started_at),
  check (day_30_notification_due_at is null or day_30_notification_due_at = retention_started_at + interval '30 days'),
  check (day_45_notification_due_at is null or day_45_notification_due_at = retention_started_at + interval '45 days'),
  check (day_55_notification_due_at is null or day_55_notification_due_at = retention_started_at + interval '55 days'),
  check ((state in ('retention_countdown','expired') or (state in ('recovered','superseded') and second_missed_at is not null)) = (retention_started_at is not null)),
  check ((state = 'recovered') = (recovered_at is not null))
);

create unique index subscription_payment_delinquency_one_open
  on public.subscription_payment_delinquencies(subscription_id)
  where state in ('first_miss_frozen','retention_countdown');
create index subscription_payment_delinquency_owner
  on public.subscription_payment_delinquencies(auth_user_id, profile_id, state);
create index subscription_payment_delinquency_deadline
  on public.subscription_payment_delinquencies(retention_until)
  where state = 'retention_countdown';

create table public.subscription_payment_delinquency_invoices (
  id uuid primary key default gen_random_uuid(),
  delinquency_id uuid not null,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  subscription_id uuid not null references public.user_subscriptions(id) on delete restrict,
  stripe_subscription_id text not null check (btrim(stripe_subscription_id) = stripe_subscription_id and stripe_subscription_id <> ''),
  provider_invoice_id text not null check (btrim(provider_invoice_id) = provider_invoice_id and provider_invoice_id <> ''),
  billing_period_start timestamptz not null,
  billing_period_end timestamptz not null,
  first_failure_observed_at timestamptz not null,
  first_provider_event_id text not null check (btrim(first_provider_event_id) = first_provider_event_id and first_provider_event_id <> ''),
  created_at timestamptz not null default now(),
  check (billing_period_end > billing_period_start),
  unique (stripe_subscription_id, provider_invoice_id),
  unique (stripe_subscription_id, billing_period_start, billing_period_end),
  foreign key (delinquency_id, auth_user_id, profile_id, subscription_id, stripe_subscription_id)
    references public.subscription_payment_delinquencies(id, auth_user_id, profile_id, subscription_id, stripe_subscription_id) on delete restrict
);
create index subscription_payment_delinquency_invoice_episode
  on public.subscription_payment_delinquency_invoices(delinquency_id, first_failure_observed_at);

alter table public.subscription_payment_delinquencies enable row level security;
alter table public.subscription_payment_delinquencies force row level security;
alter table public.subscription_payment_delinquency_invoices enable row level security;
alter table public.subscription_payment_delinquency_invoices force row level security;
revoke all on public.subscription_payment_delinquencies, public.subscription_payment_delinquency_invoices from public, anon, authenticated, service_role;
grant select, insert, update on public.subscription_payment_delinquencies to service_role;
grant select, insert on public.subscription_payment_delinquency_invoices to service_role;

create function public.payment_v2_record_subscription_payment_failure(
  p_hold_id uuid, p_subscription_id text, p_customer_id text, p_price_id text,
  p_invoice_id text, p_provider_event_id text, p_failure_observed_at timestamptz,
  p_billing_period_start timestamptz, p_billing_period_end timestamptz
) returns text
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_subscription public.user_subscriptions%rowtype;
  v_profile public.profiles%rowtype;
  v_delinquency public.subscription_payment_delinquencies%rowtype;
  v_count integer;
begin
  if p_hold_id is null or p_failure_observed_at is null or p_billing_period_start is null or p_billing_period_end <= p_billing_period_start
     or btrim(coalesce(p_subscription_id,'')) = '' or p_subscription_id <> btrim(p_subscription_id)
     or btrim(coalesce(p_customer_id,'')) = '' or p_customer_id <> btrim(p_customer_id)
     or btrim(coalesce(p_price_id,'')) = '' or p_price_id <> btrim(p_price_id)
     or btrim(coalesce(p_invoice_id,'')) = '' or p_invoice_id <> btrim(p_invoice_id)
     or btrim(coalesce(p_provider_event_id,'')) = '' or p_provider_event_id <> btrim(p_provider_event_id)
  then raise exception 'invalid_delinquency_evidence'; end if;

  perform pg_advisory_xact_lock(hashtextextended('payment_v2:delinquency:' || p_subscription_id, 2800));
  select s.* into v_subscription
  from public.payment_v2_purchases buy
  join public.payment_v2_allocations a on a.purchase_id = buy.id
  join public.user_subscriptions s on s.id = a.entitlement_id
  where buy.hold_id = p_hold_id and buy.state = 'CLAIMED' and buy.tier = 'early_bird'
    and buy.stripe_subscription_id = p_subscription_id and buy.stripe_customer_id = p_customer_id
    and buy.stripe_price_id = p_price_id and a.profile_id = buy.claimed_profile_id
    and s.user_id = a.profile_id and s.tier_name = 'early_bird'
    and s.stripe_subscription_id = p_subscription_id and s.stripe_customer_id = p_customer_id;
  if not found then raise exception 'delinquency_identity_mismatch'; end if;
  select * into strict v_profile from public.profiles where id = v_subscription.user_id;

  if exists (select 1 from public.subscription_payment_delinquency_invoices
             where stripe_subscription_id = p_subscription_id and provider_invoice_id = p_invoice_id) then
    return 'already_recorded';
  end if;

  if exists (select 1 from public.subscription_payment_delinquency_invoices
             where stripe_subscription_id = p_subscription_id
               and billing_period_start = p_billing_period_start and billing_period_end = p_billing_period_end) then
    return 'already_recorded_cycle';
  end if;

  select * into v_delinquency from public.subscription_payment_delinquencies
   where subscription_id = v_subscription.id and state in ('first_miss_frozen','retention_countdown') for update;
  if found and exists (
    select 1 from public.subscription_payment_delinquency_invoices i
    where i.delinquency_id = v_delinquency.id
      and (i.billing_period_start, i.billing_period_end) >= (p_billing_period_start, p_billing_period_end)
  ) then
    return 'stale_failure_ignored';
  end if;
  if not found then
    insert into public.subscription_payment_delinquencies(
      auth_user_id, profile_id, subscription_id, stripe_subscription_id, state,
      first_missed_invoice_id, first_missed_at, consecutive_missed_cycles
    ) values (v_profile.user_id, v_profile.id, v_subscription.id, p_subscription_id,
      'first_miss_frozen', p_invoice_id, p_failure_observed_at, 1) returning * into v_delinquency;
  else
    update public.subscription_payment_delinquencies
       set consecutive_missed_cycles = consecutive_missed_cycles + 1,
           state = case when state = 'first_miss_frozen' then 'retention_countdown' else state end,
           second_missed_invoice_id = coalesce(second_missed_invoice_id, p_invoice_id),
           second_missed_at = coalesce(second_missed_at, p_failure_observed_at),
           retention_started_at = coalesce(retention_started_at, p_failure_observed_at),
           retention_until = coalesce(retention_until, p_failure_observed_at + interval '60 days'),
           day_0_notification_due_at = coalesce(day_0_notification_due_at, p_failure_observed_at),
           day_30_notification_due_at = coalesce(day_30_notification_due_at, p_failure_observed_at + interval '30 days'),
           day_45_notification_due_at = coalesce(day_45_notification_due_at, p_failure_observed_at + interval '45 days'),
           day_55_notification_due_at = coalesce(day_55_notification_due_at, p_failure_observed_at + interval '55 days'),
           updated_at = now()
     where id = v_delinquency.id returning * into v_delinquency;
  end if;

  insert into public.subscription_payment_delinquency_invoices(
    delinquency_id, auth_user_id, profile_id, subscription_id, stripe_subscription_id,
    provider_invoice_id, billing_period_start, billing_period_end,
    first_failure_observed_at, first_provider_event_id
  ) values (v_delinquency.id, v_profile.user_id, v_profile.id, v_subscription.id, p_subscription_id,
    p_invoice_id, p_billing_period_start, p_billing_period_end, p_failure_observed_at, p_provider_event_id);
  return case when v_delinquency.state = 'first_miss_frozen' then 'first_miss_frozen' else 'retention_countdown' end;
end $$;

create function public.payment_v2_recover_subscription_payment_delinquency(
  p_hold_id uuid, p_subscription_id text, p_customer_id text, p_price_id text,
  p_invoice_id text, p_billing_period_start timestamptz, p_billing_period_end timestamptz,
  p_recovered_at timestamptz
) returns text
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_entitlement_id uuid; v_delinquency_id uuid; v_latest_start timestamptz; v_latest_end timestamptz;
begin
  if p_hold_id is null or p_recovered_at is null or p_billing_period_start is null or p_billing_period_end <= p_billing_period_start
     or (p_invoice_id is not null and (btrim(p_invoice_id) = '' or p_invoice_id <> btrim(p_invoice_id)))
  then raise exception 'invalid_delinquency_recovery'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment_v2:delinquency:' || coalesce(p_subscription_id,''), 2800));
  select s.id into v_entitlement_id
  from public.payment_v2_purchases buy
  join public.payment_v2_allocations a on a.purchase_id = buy.id
  join public.user_subscriptions s on s.id = a.entitlement_id
  where buy.hold_id = p_hold_id and buy.state = 'CLAIMED' and buy.tier = 'early_bird'
    and buy.stripe_subscription_id = p_subscription_id and buy.stripe_customer_id = p_customer_id
    and buy.stripe_price_id = p_price_id and a.profile_id = buy.claimed_profile_id
    and s.user_id = a.profile_id and s.tier_name = 'early_bird'
    and s.stripe_subscription_id = p_subscription_id and s.stripe_customer_id = p_customer_id;
  if not found then raise exception 'delinquency_identity_mismatch'; end if;
  select id into v_delinquency_id from public.subscription_payment_delinquencies
   where subscription_id = v_entitlement_id and state in ('first_miss_frozen','retention_countdown') for update;
  if not found then return 'no_open_delinquency'; end if;
  select billing_period_start, billing_period_end into strict v_latest_start, v_latest_end
    from public.subscription_payment_delinquency_invoices where delinquency_id = v_delinquency_id
    order by billing_period_start desc, billing_period_end desc limit 1;
  if (p_billing_period_start, p_billing_period_end) < (v_latest_start, v_latest_end) then
    return 'stale_recovery_ignored';
  end if;
  update public.subscription_payment_delinquencies
     set state = 'recovered', recovered_at = p_recovered_at, updated_at = now()
   where id = v_delinquency_id;
  return 'recovered';
end $$;

alter function public.payment_v2_record_subscription_payment_failure(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz) owner to postgres;
alter function public.payment_v2_recover_subscription_payment_delinquency(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz) owner to postgres;
revoke all on function public.payment_v2_record_subscription_payment_failure(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz), public.payment_v2_recover_subscription_payment_delinquency(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.payment_v2_record_subscription_payment_failure(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz), public.payment_v2_recover_subscription_payment_delinquency(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz) to service_role;

select pg_notify('pgrst', 'reload schema');
commit;
