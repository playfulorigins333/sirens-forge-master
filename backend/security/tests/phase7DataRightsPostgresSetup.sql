\set ON_ERROR_STOP on
create schema if not exists auth;
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create table auth.users(id uuid primary key);
create table public.profiles(
  id uuid primary key,
  user_id uuid unique references auth.users(id),
  email text,
  badge text,
  seat_number integer,
  stripe_customer_id text,
  updated_at timestamptz not null default now()
);
create table public.user_subscriptions(
  id uuid primary key,
  user_id uuid not null references public.profiles(id),
  status text not null,
  tier_name text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  canceled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
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
insert into public.user_subscriptions(id,user_id,status,tier_name,current_period_end,cancel_at_period_end) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','active','monthly',now()+interval '20 days',false);
