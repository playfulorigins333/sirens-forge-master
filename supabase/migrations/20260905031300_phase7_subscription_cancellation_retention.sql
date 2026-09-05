-- Phase 7: recurring-subscription cancellation retention contract.
-- Generated manually because the Supabase CLI is unavailable in this environment.
-- Phase 8 owns scheduling/purge and Phase 9 owns notification delivery.

create table public.subscription_cancellation_retentions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  subscription_id uuid not null references public.user_subscriptions(id) on delete restrict,
  state text not null check (state in ('pending_paid_access_end','retained_read_only','reactivated','superseded','expired')),
  paid_access_ends_at timestamptz not null,
  retention_started_at timestamptz not null,
  retention_until timestamptz not null,
  cancellation_observed_at timestamptz not null default now(),
  reactivated_at timestamptz,
  day_0_notification_due_at timestamptz not null,
  day_30_notification_due_at timestamptz not null,
  day_45_notification_due_at timestamptz not null,
  day_55_notification_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (retention_started_at = paid_access_ends_at),
  check (retention_until >= paid_access_ends_at + interval '60 days'),
  check (day_0_notification_due_at = paid_access_ends_at),
  check (day_30_notification_due_at = paid_access_ends_at + interval '30 days'),
  check (day_45_notification_due_at = paid_access_ends_at + interval '45 days'),
  check (day_55_notification_due_at = paid_access_ends_at + interval '55 days')
);

create unique index subscription_cancellation_one_open_lifecycle
  on public.subscription_cancellation_retentions(subscription_id)
  where state in ('pending_paid_access_end','retained_read_only','expired');
create index subscription_cancellation_owner_lookup
  on public.subscription_cancellation_retentions(auth_user_id, profile_id);
create index subscription_cancellation_due_lookup
  on public.subscription_cancellation_retentions(retention_until, state)
  where state in ('pending_paid_access_end','retained_read_only','expired');

create table public.subscription_retention_extensions (
  id uuid primary key default gen_random_uuid(),
  retention_id uuid not null references public.subscription_cancellation_retentions(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  previous_retention_until timestamptz not null,
  new_retention_until timestamptz not null,
  reason text not null check (char_length(reason) between 3 and 500),
  actor_identifier text not null check (char_length(actor_identifier) between 3 and 200),
  action_id uuid not null unique,
  created_at timestamptz not null default now(),
  check (new_retention_until = previous_retention_until + interval '30 days')
);
create index subscription_retention_extensions_retention_history
  on public.subscription_retention_extensions(retention_id, created_at);

alter table public.subscription_cancellation_retentions enable row level security;
alter table public.subscription_cancellation_retentions force row level security;
alter table public.subscription_retention_extensions enable row level security;
alter table public.subscription_retention_extensions force row level security;
revoke all on public.subscription_cancellation_retentions from public, anon, authenticated;
revoke all on public.subscription_retention_extensions from public, anon, authenticated;
grant select, insert, update on public.subscription_cancellation_retentions to service_role;
grant select, insert on public.subscription_retention_extensions to service_role;

create or replace function public.sync_subscription_cancellation_retention()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid;
  v_boundary timestamptz;
  v_state text;
begin
  -- A recurring entitlement has both provider subscription authority and a paid boundary.
  -- Lifetime/OG and delinquency states are deliberately outside this observer.
  if new.stripe_subscription_id is null or new.current_period_end is null or new.tier_name = 'og_throne' then
    return new;
  end if;

  if lower(new.status) in ('active','trialing') and not coalesce(new.cancel_at_period_end, false) then
    update public.subscription_cancellation_retentions
       set state = 'reactivated', reactivated_at = now(), updated_at = now()
     where subscription_id = new.id
       and state in ('pending_paid_access_end','retained_read_only','expired');
    return new;
  end if;

  if not ((lower(new.status) in ('active','trialing') and coalesce(new.cancel_at_period_end, false))
          or lower(new.status) = 'canceled') then
    return new;
  end if;

  select p.user_id into v_auth_user_id from public.profiles p where p.id = new.user_id;
  if v_auth_user_id is null then return new; end if;

  v_boundary := new.current_period_end;
  v_state := case
    when now() < v_boundary then 'pending_paid_access_end'
    when now() < v_boundary + interval '60 days' then 'retained_read_only'
    else 'expired'
  end;

  insert into public.subscription_cancellation_retentions (
    auth_user_id, profile_id, subscription_id, state, paid_access_ends_at,
    retention_started_at, retention_until, cancellation_observed_at,
    day_0_notification_due_at, day_30_notification_due_at,
    day_45_notification_due_at, day_55_notification_due_at
  ) values (
    v_auth_user_id, new.user_id, new.id, v_state, v_boundary,
    v_boundary, v_boundary + interval '60 days', now(),
    v_boundary, v_boundary + interval '30 days',
    v_boundary + interval '45 days', v_boundary + interval '55 days'
  )
  on conflict (subscription_id) where state in ('pending_paid_access_end','retained_read_only','expired')
  do update set
    paid_access_ends_at = greatest(public.subscription_cancellation_retentions.paid_access_ends_at, excluded.paid_access_ends_at),
    retention_started_at = greatest(public.subscription_cancellation_retentions.paid_access_ends_at, excluded.paid_access_ends_at),
    retention_until = greatest(public.subscription_cancellation_retentions.retention_until, excluded.retention_until),
    day_0_notification_due_at = greatest(public.subscription_cancellation_retentions.paid_access_ends_at, excluded.paid_access_ends_at),
    day_30_notification_due_at = greatest(public.subscription_cancellation_retentions.paid_access_ends_at, excluded.paid_access_ends_at) + interval '30 days',
    day_45_notification_due_at = greatest(public.subscription_cancellation_retentions.paid_access_ends_at, excluded.paid_access_ends_at) + interval '45 days',
    day_55_notification_due_at = greatest(public.subscription_cancellation_retentions.paid_access_ends_at, excluded.paid_access_ends_at) + interval '55 days',
    state = case
      when now() < greatest(public.subscription_cancellation_retentions.paid_access_ends_at, excluded.paid_access_ends_at) then 'pending_paid_access_end'
      when now() < greatest(public.subscription_cancellation_retentions.retention_until, excluded.retention_until) then 'retained_read_only'
      else 'expired'
    end,
    updated_at = now();
  return new;
end;
$$;
revoke all on function public.sync_subscription_cancellation_retention() from public, anon, authenticated, service_role;

create trigger sync_subscription_cancellation_retention_after_write
after insert or update of status, current_period_end, cancel_at_period_end, stripe_subscription_id, tier_name
on public.user_subscriptions
for each row execute function public.sync_subscription_cancellation_retention();

create or replace function public.extend_subscription_cancellation_retention(
  p_retention_id uuid,
  p_actor_identifier text,
  p_reason text,
  p_action_id uuid
) returns table(retention_id uuid, previous_retention_until timestamptz, new_retention_until timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_record public.subscription_cancellation_retentions%rowtype;
  v_existing public.subscription_retention_extensions%rowtype;
begin
  if char_length(btrim(p_actor_identifier)) not between 3 and 200
     or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'invalid_extension_metadata';
  end if;
  select * into v_existing from public.subscription_retention_extensions where action_id = p_action_id;
  if found then
    if v_existing.retention_id <> p_retention_id then
      raise exception using errcode = '22023', message = 'action_id_conflict';
    end if;
    return query select v_existing.retention_id, v_existing.previous_retention_until, v_existing.new_retention_until;
    return;
  end if;
  select * into v_record from public.subscription_cancellation_retentions
   where id = p_retention_id and state in ('pending_paid_access_end','retained_read_only','expired') for update;
  if not found then raise exception using errcode = 'P0002', message = 'ineligible_retention'; end if;

  insert into public.subscription_retention_extensions(
    retention_id, auth_user_id, profile_id, previous_retention_until,
    new_retention_until, reason, actor_identifier, action_id
  ) values (
    v_record.id, v_record.auth_user_id, v_record.profile_id, v_record.retention_until,
    v_record.retention_until + interval '30 days', btrim(p_reason), btrim(p_actor_identifier), p_action_id
  );
  update public.subscription_cancellation_retentions
     set retention_until = v_record.retention_until + interval '30 days',
         state = case when now() < paid_access_ends_at then 'pending_paid_access_end' else 'retained_read_only' end,
         updated_at = now()
   where id = v_record.id;
  return query select v_record.id, v_record.retention_until, v_record.retention_until + interval '30 days';
end;
$$;
revoke all on function public.extend_subscription_cancellation_retention(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.extend_subscription_cancellation_retention(uuid,text,text,uuid) to service_role;

-- Safe forward backfill: only provider-backed recurring cancellations with a valid boundary.
insert into public.subscription_cancellation_retentions(
  auth_user_id, profile_id, subscription_id, state, paid_access_ends_at,
  retention_started_at, retention_until, cancellation_observed_at,
  day_0_notification_due_at, day_30_notification_due_at, day_45_notification_due_at, day_55_notification_due_at
)
select p.user_id, s.user_id, s.id,
  case when now() < s.current_period_end then 'pending_paid_access_end'
       when now() < s.current_period_end + interval '60 days' then 'retained_read_only' else 'expired' end,
  s.current_period_end, s.current_period_end, s.current_period_end + interval '60 days', now(),
  s.current_period_end, s.current_period_end + interval '30 days',
  s.current_period_end + interval '45 days', s.current_period_end + interval '55 days'
from public.user_subscriptions s join public.profiles p on p.id = s.user_id
where s.stripe_subscription_id is not null and s.current_period_end is not null
  and s.tier_name <> 'og_throne'
  and ((lower(s.status) in ('active','trialing') and coalesce(s.cancel_at_period_end,false)) or lower(s.status) = 'canceled')
on conflict do nothing;
