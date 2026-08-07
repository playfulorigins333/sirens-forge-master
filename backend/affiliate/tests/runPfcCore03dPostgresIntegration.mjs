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
drop schema if exists auth cascade;create schema auth;create function auth.uid()returns uuid language sql stable as 'select null::uuid';create table auth.users(id uuid primary key);
create table profiles(id uuid primary key,user_id uuid not null references auth.users(id),stripe_customer_id text,stripe_connect_account_id text,stripe_connect_onboarded boolean not null default false);
create table subscription_tiers(id uuid primary key,name text not null,stripe_price_id text,is_active boolean not null);
create table user_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null,tier_id uuid,tier_name text,stripe_customer_id text,stripe_subscription_id text,status text,metadata jsonb default '{}');
insert into subscription_tiers values('00000000-0000-4000-8000-000000000001','og_throne','price_og',true),('00000000-0000-4000-8000-000000000002','early_bird','price_early',true);`)
file('supabase/migrations/20260801002800_payment_first_v2_contract.sql')
run(`create table referral_codes(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),code text not null,is_active boolean not null,expires_at timestamptz,total_uses integer default 0);
create table affiliate_ledger(id uuid primary key default gen_random_uuid(),affiliate_user_id uuid not null,referred_user_id uuid not null,stripe_event_id text not null unique,stripe_subscription_id text,tier_name text not null,commission_amount_cents integer not null,gross_amount_cents integer not null,commission_percent integer not null,status text not null check(status in('pending','available','paid','void')),created_at timestamptz default now(),updated_at timestamptz default now());alter table affiliate_ledger enable row level security;
create table affiliate_payout_batches(id uuid primary key default gen_random_uuid(),notes text,status text default 'draft',created_at timestamptz default now());
create table affiliate_payout_items(id uuid primary key default gen_random_uuid(),batch_id uuid,ledger_id uuid unique,affiliate_user_id uuid,amount_cents integer,created_at timestamptz default now());
create function release_affiliate_commissions()returns void language plpgsql as 'begin end';create function create_affiliate_payout_batch(text default null)returns uuid language plpgsql as 'begin return gen_random_uuid();end';
revoke all on affiliate_ledger from public,anon,authenticated,service_role;
create view affiliate_balances with(security_invoker=false) as select affiliate_user_id,sum(commission_amount_cents) balance_cents from affiliate_ledger group by affiliate_user_id;grant select on affiliate_balances to anon,authenticated,service_role;`)
file('supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql')
file('supabase/migrations/20260807003200_affiliate_public_cutover_hardening.sql')
equal(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='payment_v2_acquire_hold' and pg_get_function_identity_arguments(oid)='p_purchaser_hash bytea, p_tier text, p_expires_at timestamp with time zone, p_referral_code text'`,1,'exact hold signature')
equal(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='payment_v2_acquire_hold'`,1,'obsolete hold overload absent')
equal(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='payment_v2_record_paid'`,1,'obsolete paid overload absent')
equal(`select bool_and(c.relrowsecurity) from pg_class c where c.oid in('affiliate_ledger'::regclass,'payment_v2_holds'::regclass,'payment_v2_purchases'::regclass)`, 't','RLS remains enabled')
equal(`select has_table_privilege('service_role','public.affiliate_ledger','INSERT,UPDATE,DELETE')`, 'f','service role ledger writes blocked')
equal(`select has_function_privilege('service_role','public.payment_v2_acquire_hold(bytea,text,timestamptz,text)','EXECUTE') and not has_function_privilege('anon','public.payment_v2_acquire_hold(bytea,text,timestamptz,text)','EXECUTE')`, 't','hold RPC ACL exact')
equal(`select data_type from information_schema.columns where table_schema='public' and table_name='payment_v2_holds' and column_name='referral_code_id'`,'uuid','hold referral code uses Production UUID')
equal(`select data_type from information_schema.columns where table_schema='public' and table_name='payment_v2_purchases' and column_name='referral_code_id'`,'uuid','purchase referral code uses Production UUID')
equal(`select data_type from information_schema.columns where table_schema='public' and table_name='affiliate_ledger' and column_name='referral_code_id'`,'uuid','ledger referral code uses Production UUID')
run(`insert into auth.users values('20000000-0000-4000-8000-000000000001');insert into profiles values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',null,'acct_authoritative',true);insert into user_subscriptions(user_id,tier_id,tier_name,status)values('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','og_throne','active');insert into referral_codes(user_id,code,is_active)values('20000000-0000-4000-8000-000000000001','SAFE_CODE',true);`)
const hold=run(`select hold_id from payment_v2_acquire_hold(decode(repeat('ab',32),'hex'),'early_bird',now()+interval '1 hour','safe_code')`)
equal(`select referrer_affiliate_tier||'|'||stripe_connect_destination from payment_v2_holds where id='${hold}'`,'og_throne|acct_authoritative','referrer tier and Connect snapshot bind authoritatively')
equal(`select commission_percent from payment_v2_acquire_hold(decode(repeat('ab',32),'hex'),'early_bird',now()+interval '1 hour','SAFE_CODE')`,50,'OG subscription rate snapshot')
run(`update user_subscriptions set tier_name='early_bird',status='inactive' where user_id='10000000-0000-4000-8000-000000000001';update profiles set stripe_connect_account_id='acct_changed',stripe_connect_onboarded=false where id='10000000-0000-4000-8000-000000000001'`)
equal(`select commission_percent||'|'||connect_destination from payment_v2_acquire_hold(decode(repeat('ab',32),'hex'),'early_bird',now()+interval '1 hour','SAFE_CODE')`,'50|acct_authoritative','existing hold preserves tier and Connect snapshots')
run(`select payment_v2_associate_session('${hold}',decode(repeat('ab',32),'hex'),'cs_attributed')`)
equal(`select payment_v2_record_paid('${hold}',decode(repeat('ab',32),'hex'),'cs_attributed','cus_referred','price_early',null,'sub_initial','evt_authoritative',now(),900,'usd')`,'recorded','authoritative attributed payment records')
equal(`select stripe_event_id||'|'||tier_name||'|'||affiliate_user_id||'|'||gross_amount_cents||'|'||commission_percent||'|'||commission_amount_cents||'|'||attribution_status||'|'||(referred_user_id is null) from affiliate_ledger where payment_v2_purchase_id is not null`,'evt_authoritative|early_bird|10000000-0000-4000-8000-000000000001|900|50|450|PURCHASER_UNCLAIMED|true','Production ledger obligation is complete and purchaser unclaimed')
run(`insert into auth.users values('20000000-0000-4000-8000-000000000002');insert into profiles(id,user_id)values('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002')`)
const purchase=run(`select id from payment_v2_purchases where hold_id='${hold}'`)
equal(`select payment_v2_claim('${purchase}',decode(repeat('ab',32),'hex'),'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002')`,'claimed','valid claim attaches purchaser')
equal(`select attribution_status||'|'||referred_user_id from affiliate_ledger where payment_v2_purchase_id='${purchase}'`,'PURCHASER_ATTACHED|20000000-0000-4000-8000-000000000002','claim records purchaser auth namespace')
equal(`select has_table_privilege('anon','affiliate_balances','select')`, 'f','anon cannot read balances')
equal(`select has_table_privilege('authenticated','affiliate_balances','select')`, 'f','authenticated cannot read balances')
equal(`select has_table_privilege('service_role','affiliate_balances','select')`, 'f','aggregate view remains unavailable to server role')
equal(`select has_column_privilege('service_role','affiliate_ledger','affiliate_user_id','select')`, 't','server summary path retains scoped ledger read')
run(`select payment_v2_record_paid_recurring_invoice('${hold}','sub_initial','cus_referred','in_month_1','evt_month_1','subscription_create',now(),900,'usd')`)
for(let month=2;month<=7;month++) run(`select payment_v2_record_paid_recurring_invoice('${hold}','sub_initial','cus_referred','in_month_${month}','evt_month_${month}','subscription_cycle',now(),1000,'usd')`)
equal(`select string_agg(l.commission_percent::text,',' order by r.paid_month_number) from affiliate_ledger l join payment_v2_affiliate_recurring_invoices r on r.id=l.payment_v2_recurring_invoice_id`,'50,50,50,50,50,25','OG recurring months 2-6 are 50 and month 7 is 25')
equal(`select count(*) from affiliate_ledger where stripe_event_id='evt_month_7'`,1,'recurring invoice creates one commission')
run(`select payment_v2_record_paid_recurring_invoice('${hold}','sub_initial','cus_referred','in_month_7','evt_month_7','subscription_cycle',now(),1000,'usd')`)
equal(`select count(*) from affiliate_ledger where stripe_event_id='evt_month_7'`,1,'duplicate invoice is idempotent')
run(`insert into auth.users values('20000000-0000-4000-8000-000000000003');insert into profiles values('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',null,'acct_early',true);insert into user_subscriptions(user_id,tier_id,tier_name,status)values('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','early_bird','active');insert into referral_codes(user_id,code,is_active)values('20000000-0000-4000-8000-000000000003','EARLY_CODE',true)`)
const earlyHold=run(`select hold_id from payment_v2_acquire_hold(decode(repeat('cd',32),'hex'),'early_bird',now()+interval '1 hour','EARLY_CODE')`)
run(`select payment_v2_associate_session('${earlyHold}',decode(repeat('cd',32),'hex'),'cs_early');select payment_v2_record_paid('${earlyHold}',decode(repeat('cd',32),'hex'),'cs_early','cus_early','price_early',null,'sub_early','evt_early_initial',now(),900,'usd')`)
const earlyPurchase=run(`select id from payment_v2_purchases where hold_id='${earlyHold}'`)
run(`select payment_v2_claim('${earlyPurchase}',decode(repeat('cd',32),'hex'),'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002');select payment_v2_record_paid_recurring_invoice('${earlyHold}','sub_early','cus_early','in_early_1','evt_early_1','subscription_create',now(),900,'usd')`)
for(let month=2;month<=7;month++) run(`select payment_v2_record_paid_recurring_invoice('${earlyHold}','sub_early','cus_early','in_early_${month}','evt_early_${month}','subscription_cycle',now(),1000,'usd')`)
equal(`select string_agg(l.commission_percent::text,',' order by r.paid_month_number) from affiliate_ledger l join payment_v2_affiliate_recurring_invoices r on r.id=l.payment_v2_recurring_invoice_id where r.stripe_subscription_id='sub_early'`,'20,20,20,20,20,10','Early Bird recurring months 2-6 are 20 and month 7 is 10')
run(`insert into affiliate_ledger(affiliate_user_id,referred_user_id,stripe_event_id,tier_name,commission_amount_cents,gross_amount_cents,commission_percent,status) values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','legacy_below','early_bird',4999,4999,20,'available'),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','legacy_exact','early_bird',5000,5000,20,'available')`)
run(`select create_affiliate_payout_batch('zero-money-test')`)
equal(`select status from affiliate_ledger where stripe_event_id='legacy_below'`,'available','4999-cent affiliate excluded')
equal(`select status from affiliate_ledger where stripe_event_id='legacy_exact'`,'paid','5000-cent affiliate included')
equal(`select count(*) from affiliate_payout_items i join affiliate_ledger l on l.id=i.ledger_id where l.stripe_event_id='legacy_below'`,0,'only inserted ledger IDs paid')
console.log(`PFC-CORE-03D PostgreSQL integration passed (${assertions} assertions; 02800 + 03100 + 03200; 02900 not applied).`)
