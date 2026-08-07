import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const url=process.env.PAYMENT_V2_DATABASE_URL||process.env.DATABASE_URL
if(!url) throw new Error('PAYMENT_V2_DATABASE_URL is required')
let assertions=0
const run=(sql)=>{const r=spawnSync('psql',[url,'-XAt','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||r.stdout);return(r.stdout||'').trim()}
const file=(path)=>{const r=spawnSync('psql',[url,'-XAt','-v','ON_ERROR_STOP=1','-f',path],{encoding:'utf8'});if(r.status!==0)throw new Error(`${path}: ${r.stderr||r.stdout}`)}
const equal=(sql,value,msg)=>{assert.equal(run(sql).split('\n').at(-1),String(value),msg);assertions++}
run(`drop schema public cascade;create schema public;grant all on schema public to postgres;grant usage on schema public to public;
do $$begin if not exists(select from pg_roles where rolname='anon')then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;
create schema if not exists auth;create or replace function auth.uid()returns uuid language sql stable as 'select null::uuid';create table auth.users(id uuid primary key);
create table profiles(id uuid primary key,user_id uuid not null,stripe_customer_id text,stripe_connect_account_id text,stripe_connect_onboarded boolean not null default false);
create table subscription_tiers(id uuid primary key,name text not null,stripe_price_id text,is_active boolean not null);
create table user_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null,tier_id uuid,tier_name text,stripe_customer_id text,stripe_subscription_id text,status text,metadata jsonb default '{}');
insert into subscription_tiers values('00000000-0000-4000-8000-000000000001','og_throne','price_og',true),('00000000-0000-4000-8000-000000000002','early_bird','price_early',true);`)
file('supabase/migrations/20260801002800_payment_first_v2_contract.sql')
run(`create table referral_codes(id bigint generated always as identity primary key,user_id uuid not null,code text not null,is_active boolean not null,expires_at timestamptz,total_uses integer default 0);
create table affiliate_ledger(id uuid primary key default gen_random_uuid(),affiliate_user_id uuid not null,referred_user_id uuid not null,commission_amount_cents integer not null,gross_amount_cents integer,commission_percent numeric,status text not null check(status in('pending','available','paid','void')),created_at timestamptz default now(),updated_at timestamptz default now());alter table affiliate_ledger enable row level security;
create table affiliate_payout_batches(id uuid primary key default gen_random_uuid(),notes text,status text default 'draft',created_at timestamptz default now());
create table affiliate_payout_items(id uuid primary key default gen_random_uuid(),batch_id uuid,ledger_id uuid unique,affiliate_user_id uuid,amount_cents integer,created_at timestamptz default now());
create function release_affiliate_commissions()returns void language plpgsql as 'begin end';create function create_affiliate_payout_batch(text default null)returns uuid language plpgsql as 'begin return gen_random_uuid();end';
revoke all on affiliate_ledger from public,anon,authenticated,service_role;`)
file('supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql')
equal(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='payment_v2_acquire_hold' and pg_get_function_identity_arguments(oid)='p_purchaser_hash bytea, p_tier text, p_expires_at timestamp with time zone, p_referral_code text'`,1,'exact hold signature')
equal(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='payment_v2_acquire_hold'`,1,'obsolete hold overload absent')
equal(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='payment_v2_record_paid'`,1,'obsolete paid overload absent')
equal(`select bool_and(c.relrowsecurity) from pg_class c where c.oid in('affiliate_ledger'::regclass,'payment_v2_holds'::regclass,'payment_v2_purchases'::regclass)`, 't','RLS remains enabled')
equal(`select has_table_privilege('service_role','public.affiliate_ledger','INSERT,UPDATE,DELETE')`, 'f','service role ledger writes blocked')
equal(`select has_function_privilege('service_role','public.payment_v2_acquire_hold(bytea,text,timestamptz,text)','EXECUTE') and not has_function_privilege('anon','public.payment_v2_acquire_hold(bytea,text,timestamptz,text)','EXECUTE')`, 't','hold RPC ACL exact')
run(`insert into auth.users values('20000000-0000-4000-8000-000000000001');insert into profiles values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',null,'acct_authoritative',true);insert into user_subscriptions(user_id,tier_id,tier_name,status)values('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','og_throne','active');insert into referral_codes(user_id,code,is_active)values('20000000-0000-4000-8000-000000000001','SAFE_CODE',true);`)
const hold=run(`select hold_id from payment_v2_acquire_hold(decode(repeat('ab',32),'hex'),'early_bird',now()+interval '1 hour','safe_code')`)
equal(`select referrer_affiliate_tier||'|'||stripe_connect_destination from payment_v2_holds where id='${hold}'`,'og_throne|acct_authoritative','referrer tier and Connect snapshot bind authoritatively')
equal(`select commission_percent from payment_v2_acquire_hold(decode(repeat('ab',32),'hex'),'early_bird',now()+interval '1 hour','SAFE_CODE')`,50,'OG subscription rate snapshot')
console.log(`PFC-CORE-03B PostgreSQL integration passed (${assertions} assertions; 02800 + production-equivalent affiliate security + 03100; 02900 not applied).`)
