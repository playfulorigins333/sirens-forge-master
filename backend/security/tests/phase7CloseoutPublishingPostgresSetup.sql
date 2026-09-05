drop schema if exists public cascade;
create schema public;
grant all on schema public to postgres;
create extension if not exists pgcrypto with schema public;

do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.profiles(
  id uuid primary key,
  user_id uuid not null unique,
  account_lifecycle_state text not null default 'active'
);

create table public.user_subscriptions(
  id uuid primary key,
  user_id uuid not null references public.profiles(id),
  status text not null,
  tier_name text,
  stripe_subscription_id text,
  current_period_end timestamptz
);

create table public.subscription_payment_delinquencies(
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  profile_id uuid not null,
  subscription_id uuid not null,
  state text not null
);

create table public.autopost_accounts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  platform text not null,
  connection_status text not null,
  encrypted_access_token text
);

create table public.autopost_jobs(
  id uuid primary key,
  user_id uuid not null,
  platform text not null,
  state text not null,
  completed_at timestamptz,
  lock_id text,
  locked_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.creator_publishing_platform_jobs(
  id uuid primary key,
  creator_id uuid not null,
  target_platform text not null,
  job_state text not null,
  leased_at timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  intended_publish_at timestamptz not null,
  cancelled_at timestamptz,
  schedule_revision integer not null default 1,
  lease_token uuid,
  terminal_classification text,
  safe_error_code text,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.creator_publishing_scheduler_events(
  id uuid primary key default gen_random_uuid(),
  platform_job_id uuid not null references public.creator_publishing_platform_jobs(id),
  event_type text not null,
  schedule_revision integer not null,
  status text not null,
  due_at timestamptz not null
);

create table public.creator_publishing_fanvue_attempts(
  id uuid primary key,
  job_id uuid not null references public.creator_publishing_platform_jobs(id),
  creator_id uuid not null,
  attempt_ordinal integer not null,
  lease_token uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  provider_create_dispatched_at timestamptz,
  finished_at timestamptz,
  outcome_class text,
  provider_create_attempted boolean not null default false,
  safe_error_code text,
  uncertainty_classification text,
  unique(job_id,attempt_ordinal)
);

grant select,insert,update on all tables in schema public to service_role;

-- active recurring user
insert into public.profiles values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','active');
insert into public.user_subscriptions values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','active','early_bird','sub_active',clock_timestamp()+interval '20 days');
insert into public.autopost_accounts(user_id,platform,connection_status,encrypted_access_token) values ('10000000-0000-4000-8000-000000000001','x','CONNECTED','ciphertext');

-- voluntary-deletion frozen user
insert into public.profiles values ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','voluntary_deletion_pending');
insert into public.user_subscriptions values ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','active','early_bird','sub_delete',clock_timestamp()+interval '20 days');

-- OG lifetime user
insert into public.profiles values ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','active');
insert into public.user_subscriptions values ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','active','og_throne',null,null);

-- malformed OG-shaped recurring row must not inherit lifetime access
insert into public.profiles values ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','active');
insert into public.user_subscriptions values ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','active','og_throne','sub_malformed_og',null);

-- delinquent recurring user
insert into public.profiles values ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','active');
insert into public.user_subscriptions values ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005','past_due','early_bird','sub_due',clock_timestamp()+interval '20 days');
insert into public.subscription_payment_delinquencies(auth_user_id,profile_id,subscription_id,state) values ('10000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005','first_miss_frozen');
