import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const url=process.env.PAYMENT_V2_DATABASE_URL||process.env.DATABASE_URL
if(!url) throw new Error('PAYMENT_V2_DATABASE_URL is required')
let assertions=0
const exec=(args)=>spawnSync('psql',[url,'-XAt','-v','ON_ERROR_STOP=1',...args],{encoding:'utf8'})
const run=(sql)=>{const r=exec(['-c',sql]);if(r.status!==0)throw new Error(r.stderr||r.stdout);return(r.stdout||'').trim()}
const file=(path,expectFailure=false)=>{const r=exec(['-f',path]);if(expectFailure){assert.notEqual(r.status,0,'SQL must fail closed');assert.match(r.stderr,/PFC03100_UNSAFE_DRIFT/);assertions++;return}if(r.status!==0)throw new Error(`${path}: ${r.stderr||r.stdout}`)}
const equal=(sql,value,msg)=>{assert.equal(run(sql).split('\n').at(-1),String(value),msg);assertions++}

const bootstrap=()=>run(`
drop schema public cascade; create schema public; grant all on schema public to postgres; grant usage on schema public to public;
do $$begin if not exists(select from pg_roles where rolname='anon')then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;
create schema if not exists auth; drop table if exists auth.users cascade; create table auth.users(id uuid primary key);
create or replace function auth.uid()returns uuid language sql stable as 'select null::uuid';
create table profiles(id uuid primary key,user_id uuid not null unique references auth.users(id),stripe_customer_id text,stripe_connect_account_id text,stripe_connect_onboarded boolean not null default false);
create table subscription_tiers(id uuid primary key,name text not null,stripe_price_id text,is_active boolean not null);
create table user_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null,tier_id uuid,tier_name text,stripe_customer_id text,stripe_subscription_id text,status text,metadata jsonb default '{}');
insert into subscription_tiers values('00000000-0000-4000-8000-000000000001','og_throne','price_og',true),('00000000-0000-4000-8000-000000000002','early_bird','price_early',true);
`)
const affiliateBaseline=()=>run(`
create table referral_codes(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),code varchar not null,is_active boolean not null default true,expires_at timestamptz,total_uses integer default 0);
create table referral_tracking(id uuid primary key); create table referrals(id uuid primary key,referrer_user_id uuid,referred_user_id uuid); create table commission_earnings(id uuid primary key);
create table commissions(id uuid primary key); create table affiliate_payout_batches(id uuid primary key default gen_random_uuid(),notes text); create table affiliate_payout_items(id uuid primary key,batch_id uuid,ledger_id uuid unique,affiliate_user_id uuid,amount_cents integer);
create table payouts(id uuid primary key); create view affiliate_payout_queue as select id from affiliate_payout_batches;
create table affiliate_ledger(id uuid primary key default gen_random_uuid(),affiliate_user_id uuid not null,referred_user_id uuid not null,stripe_event_id text not null unique,stripe_subscription_id text,tier_name text not null,commission_amount_cents integer not null,gross_amount_cents integer not null,commission_percent integer not null,status text not null check(status in('pending','available','paid','void')),created_at timestamptz default now(),updated_at timestamptz default now());
create function release_affiliate_commissions()returns void language plpgsql as 'begin end'; create function create_affiliate_payout_batch(text default null)returns uuid language plpgsql as 'begin return gen_random_uuid();end';
create table pfc03000_backup_catalog_snapshot(marker text); insert into pfc03000_backup_catalog_snapshot values('UNTOUCHED');
`)
const applyBaseline=()=>{bootstrap();file('supabase/migrations/20260801002800_payment_first_v2_contract.sql');affiliateBaseline()}
const seed=()=>run(`
insert into auth.users values('20000000-0000-4000-8000-000000000001'); insert into profiles(id,user_id) values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
insert into payment_v2_holds(id,purchaser_credential_hash,tier,state,stripe_checkout_session_id,expires_at) values('30000000-0000-4000-8000-000000000001',decode(repeat('ab',32),'hex'),'early_bird','SESSION_ASSOCIATED','cs_pre',now()+interval '1 hour');
insert into payment_v2_purchases(id,hold_id,purchaser_credential_hash,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_subscription_id,provider_event_id,provider_confirmed_at) values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',decode(repeat('ab',32),'hex'),'early_bird','cs_pre','cus_pre','price_early','sub_pre','evt_pre',now());
update payment_v2_holds set state='PAID_UNCLAIMED' where id='30000000-0000-4000-8000-000000000001';
insert into payment_v2_reconciliation_evidence(hold_id,purchase_id,stripe_checkout_session_id,event_kind,provider_event_id,occurred_at) values('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','cs_pre','PAYMENT_CONFIRMED','evt_pre',now());
insert into affiliate_ledger(affiliate_user_id,referred_user_id,stripe_event_id,tier_name,commission_amount_cents,gross_amount_cents,commission_percent,status) values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','legacy_evt','early_bird',20,100,20,'pending');
`)

applyBaseline(); seed(); file('supabase/manual/pfc03100_pre_migration_backup.sql')
equal(`select source_counts=backup_counts from pfc03100_backup_manifest`,'t','manifest counts match')
equal(`select bool_and(c.relrowsecurity) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'pfc03100\\_backup\\_%' escape '\\'`,'t','every artifact has RLS')
equal(`select bool_and(not has_table_privilege('anon',c.oid,'select') and not has_table_privilege('authenticated',c.oid,'select') and not has_table_privilege('service_role',c.oid,'select')) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'pfc03100\\_backup\\_%' escape '\\'`,'t','recovery artifacts are inaccessible')
file('supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql')
equal(`select to_regprocedure('payment_v2_acquire_hold(bytea,text,timestamptz,text)') is not null`,'t','03100 applied')
file('supabase/manual/pfc03100_rollback.sql')
equal(`select to_regprocedure('payment_v2_acquire_hold(bytea,text,timestamptz)') is not null and to_regprocedure('payment_v2_acquire_hold(bytea,text,timestamptz,text)') is null`,'t','PRE signature restored')
equal(`select count(*) from information_schema.columns where table_schema='public' and table_name in('payment_v2_holds','payment_v2_purchases','affiliate_ledger') and column_name in('payment_v2_purchase_id','referral_code_id','referrer_affiliate_tier','attribution_status','void_reason','voided_at','referral_bound_at','stripe_connect_destination','currency')`,0,'03100-only columns removed')
equal(`select count(*) from pfc03100_backup_manifest`,'1','backup retained')
equal(`select marker from pfc03000_backup_catalog_snapshot`,'UNTOUCHED','03000 artifact untouched')
equal(`select count(*) from payment_v2_holds`,'1','representative data retained')
equal(`select bool_and((s.metadata->>'definition')=pg_get_functiondef(to_regprocedure(s.object_identity))) from pfc03100_backup_catalog_snapshot s where object_kind='function'`,'t','function definitions exactly restored')
equal(`select count(*) from pg_constraint where conrelid='payment_v2_reconciliation_evidence'::regclass and conname in('payment_v2_reconciliation_evidence_event_kind_check','payment_v2_reconciliation_evidence_check','payment_v2_reconciliation_evidence_check1','payment_v2_reconciliation_evidence_check2')`,4,'PRE reconciliation constraints restored')

// A separate disposable reset proves drift aborts before any destructive action.
applyBaseline(); seed(); file('supabase/manual/pfc03100_pre_migration_backup.sql'); file('supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql')
run(`update payment_v2_holds set updated_at=updated_at+interval '1 second' where id='30000000-0000-4000-8000-000000000001'`)
file('supabase/manual/pfc03100_rollback.sql',true)
equal(`select to_regprocedure('payment_v2_acquire_hold(bytea,text,timestamptz,text)') is not null`,'t','failed rollback left 03100 schema intact')
equal(`select updated_at<>(select updated_at from pfc03100_backup_payment_v2_holds where id='30000000-0000-4000-8000-000000000001') from payment_v2_holds where id='30000000-0000-4000-8000-000000000001'`,'t','newer state was not overwritten')
equal(`select to_regclass('public.pfc03000_backup_catalog_snapshot') is not null`,'t','02900 was never used and 03000 sentinel remains')
console.log(`PFC-CORE-03C PostgreSQL backup/rollback integration passed (${assertions} assertions; 02800 + Production-equivalent 03000 baseline; 02900 never applied).`)
