\set ON_ERROR_STOP on

drop schema if exists public cascade;
drop schema if exists auth cascade;
drop schema if exists extensions cascade;
create schema public authorization postgres;
create schema auth authorization postgres;
create schema extensions authorization postgres;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end
$$;
alter role service_role bypassrls;
grant usage on schema public,auth,extensions to anon,authenticated,service_role;

create table auth.users(id uuid primary key);
create table public.profiles(
  id uuid primary key,
  user_id uuid unique references auth.users(id) on delete set null,
  email text,
  badge text,
  seat_number integer,
  stripe_customer_id text,
  updated_at timestamptz not null default now()
);
create table public.user_subscriptions(
  id uuid primary key,
  user_id uuid not null references public.profiles(id),
  tier_id uuid,
  tier_name text,
  stripe_subscription_id text,
  stripe_customer_id text,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  canceled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
insert into public.profiles(id,user_id,email) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','one@example.invalid'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','two@example.invalid'),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','three@example.invalid');

create table public.payment_v2_holds(
  id uuid primary key,
  purchaser_credential_hash bytea not null,
  tier text not null,
  state text not null,
  stripe_checkout_session_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  referral_code_id uuid
);

create table public.payment_v2_purchases(
  id uuid primary key,
  hold_id uuid not null references public.payment_v2_holds(id),
  purchaser_credential_hash bytea not null,
  tier text not null,
  stripe_checkout_session_id text not null,
  stripe_customer_id text not null,
  stripe_price_id text not null,
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  state text not null,
  claimed_profile_id uuid references public.profiles(id),
  claimed_at timestamptz,
  provider_event_id text,
  provider_confirmed_at timestamptz,
  gross_amount_cents integer,
  currency text,
  stripe_source_charge_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_v2_provider_event_inbox(
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  provider_event_type text not null,
  provider_object_id text not null,
  provider_object_type text not null,
  provider_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  raw_payload_sha256 text not null,
  lifecycle_phase text not null,
  processing_status text not null,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  processed_at timestamptz,
  last_error_code text,
  lifecycle_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);