\set ON_ERROR_STOP on
\ir ../../security/tests/phase10PostgresSetup.sql

create table public.profiles(id uuid primary key,user_id uuid not null unique references auth.users(id),stripe_customer_id text,stripe_connect_account_id text,stripe_connect_onboarded boolean not null default false);
create table public.subscription_tiers(id uuid primary key,name text not null,stripe_price_id text,is_active boolean not null,max_slots integer,slots_remaining integer);
create table public.user_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),tier_id uuid,tier_name text,stripe_customer_id text,stripe_subscription_id text,status text,metadata jsonb default '{}'::jsonb,current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean,canceled_at timestamptz,trial_start timestamptz,trial_end timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.referral_codes(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),code text not null,is_active boolean not null,expires_at timestamptz,total_uses integer default 0);
create table public.affiliate_ledger(id uuid primary key default gen_random_uuid(),affiliate_user_id uuid not null,referred_user_id uuid not null,stripe_event_id text not null unique,stripe_subscription_id text,tier_name text not null,commission_amount_cents integer not null,gross_amount_cents integer not null,commission_percent integer not null,status text not null check(status in('pending','available','paid','void')),created_at timestamptz default now(),updated_at timestamptz default now());
alter table public.affiliate_ledger enable row level security;
create table public.affiliate_payout_batches(id uuid primary key default gen_random_uuid(),notes text,status text default 'draft',created_at timestamptz default now());
create table public.affiliate_payout_items(id uuid primary key default gen_random_uuid(),batch_id uuid,ledger_id uuid unique,affiliate_user_id uuid,amount_cents integer,created_at timestamptz default now());
create function public.release_affiliate_commissions()returns void language plpgsql as 'begin end';
create function public.create_affiliate_payout_batch(text default null)returns uuid language plpgsql as 'begin return gen_random_uuid();end';
create view public.affiliate_balances with(security_invoker=false)as select affiliate_user_id,sum(commission_amount_cents)balance_cents from public.affiliate_ledger group by affiliate_user_id;
insert into public.subscription_tiers values('00000000-0000-4000-8000-000000000001','og_throne','price_og',true,50,50),('00000000-0000-4000-8000-000000000002','early_bird','price_early',true,150,150);
insert into public.profiles(id,user_id,stripe_connect_account_id,stripe_connect_onboarded)values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','acct_referrer',true),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',null,false),('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',null,false);
insert into public.user_subscriptions(user_id,tier_id,tier_name,status)values('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','og_throne','active');
insert into public.referral_codes(user_id,code,is_active)values('10000000-0000-4000-8000-000000000001','PHASE12',true);
