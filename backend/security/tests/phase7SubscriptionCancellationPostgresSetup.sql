\set ON_ERROR_STOP on
create schema if not exists auth;
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end$$;
create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key, user_id uuid unique references auth.users(id), account_lifecycle_state text default 'active');
create table public.user_subscriptions(
  id uuid primary key, user_id uuid not null references public.profiles(id), status text not null,
  tier_name text, stripe_subscription_id text, current_period_end timestamptz,
  cancel_at_period_end boolean default false, created_at timestamptz default now(), updated_at timestamptz default now()
);
grant usage on schema public to anon, authenticated, service_role;

