import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const url=process.env.PAYMENT_V2_DATABASE_URL||process.env.DATABASE_URL
if(!url) throw new Error('PAYMENT_V2_DATABASE_URL is required')
let assertions=0
const psql=(args)=>spawnSync('psql',[url,'-XAt','-v','ON_ERROR_STOP=1',...args],{encoding:'utf8'})
const run=(sql)=>{const r=psql(['-c',sql]);if(r.status!==0)throw new Error(r.stderr||r.stdout);return(r.stdout||'').trim()}
const file=(path)=>{const r=psql(['-f',path]);if(r.status!==0)throw new Error(`${path}: ${r.stderr||r.stdout}`);return(r.stdout||'').trim()}
const equal=(sql,value,msg)=>{assert.equal(run(sql).split('\n').at(-1),String(value),msg);assertions++}
const failsFile=(path,pattern,msg)=>{const r=psql(['-f',path]);assert.notEqual(r.status,0,`${msg}: unexpectedly succeeded`);assert.match(r.stderr||r.stdout,pattern,msg);assertions++}
const fails=(sql,pattern,msg)=>{const r=psql(['-c',sql]);assert.notEqual(r.status,0,`${msg}: unexpectedly succeeded`);assert.match(r.stderr||r.stdout,pattern,msg);assertions++}
const ADMIN='879c8a17-f9e8-473d-8de1-1fd1a77c080e'

run(`drop schema if exists lock05f_backup_20260812_pre_cleanup;drop schema public cascade;create schema public;grant all on schema public to postgres;grant usage on schema public to public;
drop schema if exists auth cascade;create schema auth;create schema if not exists extensions;create extension if not exists pgcrypto with schema extensions;
do $$begin if not exists(select from pg_roles where rolname='anon')then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;
create function auth.uid()returns uuid language sql stable as 'select null::uuid';
create table auth.users(id uuid primary key,email text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),last_sign_in_at timestamptz);
create table profiles(id uuid primary key,user_id uuid not null unique references auth.users(id),email text,role text not null default 'user',is_og_vip boolean not null default false,is_tester boolean not null default false,is_beta_tester boolean not null default false,seat_number integer,og_seat_number integer,tier text,subscription_status text,password_hash text,stripe_customer_id text,stripe_connect_account_id text,stripe_connect_onboarded boolean not null default false);
create table subscription_tiers(id uuid primary key,name text not null,stripe_price_id text,is_active boolean not null,max_slots integer,slots_remaining integer);
create table user_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references profiles(id),tier_id uuid,tier_name text,stripe_customer_id text,stripe_subscription_id text,status text,metadata jsonb default '{}');
insert into subscription_tiers values('00000000-0000-4000-8000-000000000001','og_throne','price_og',true,50,10),('00000000-0000-4000-8000-000000000002','early_bird','price_early',true,150,120);`)
file('supabase/migrations/20260801002800_payment_first_v2_contract.sql')
run(`create table referral_codes(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),code text not null,is_active boolean not null,expires_at timestamptz,total_uses integer not null default 0);
create table referral_tracking(id uuid primary key default gen_random_uuid(),referral_code_id uuid not null references referral_codes(id),referrer_user_id uuid not null references auth.users(id),referred_user_id uuid not null references auth.users(id));
create table commission_earnings(id uuid primary key default gen_random_uuid(),referral_code_id uuid not null references referral_codes(id),referrer_user_id uuid not null references auth.users(id),referred_user_id uuid not null references auth.users(id),transaction_reference text,status text,paid_at timestamptz,commission_type text,base_amount numeric,commission_rate numeric,commission_amount numeric,metadata jsonb);
create table affiliate_ledger(id uuid primary key default gen_random_uuid(),affiliate_user_id uuid not null,referred_user_id uuid not null,stripe_event_id text not null unique,stripe_subscription_id text,tier_name text not null,commission_amount_cents integer not null,gross_amount_cents integer not null,commission_percent integer not null,status text not null check(status in('pending','available','paid','void')),created_at timestamptz default now(),updated_at timestamptz default now());alter table affiliate_ledger enable row level security;
create table affiliate_payout_batches(id uuid primary key default gen_random_uuid(),notes text,status text default 'draft',created_at timestamptz default now());
create table affiliate_payout_items(id uuid primary key default gen_random_uuid(),batch_id uuid,ledger_id uuid unique,affiliate_user_id uuid,amount_cents integer,created_at timestamptz default now());
create function release_affiliate_commissions()returns void language plpgsql as 'begin end';create function create_affiliate_payout_batch(text default null)returns uuid language plpgsql as 'begin return gen_random_uuid();end';revoke all on affiliate_ledger from public,anon,authenticated,service_role;`)
file('supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql')
file('supabase/migrations/20260812090000_lock05f_launch_inventory_reset.sql')
equal(`select max_slots||'|'||slots_remaining from subscription_tiers where name='og_throne'`,'50|50','OG bookkeeping reset')
equal(`select max_slots||'|'||slots_remaining from subscription_tiers where name='early_bird'`,'150|150','Early Bird bookkeeping reset')
equal(`select pg_get_functiondef('payment_v2_acquire_hold(bytea,text,timestamptz,text)'::regprocedure) like '%else 150 end%'`,'t','acquire function enforces 150')
equal(`select extnamespace::regnamespace::text from pg_extension where extname='pgcrypto'`,'extensions','pgcrypto uses Production schema')

// Preserve the prior affiliate/referral/claim integration scenario.
run(`insert into auth.users(id,email) values('20000000-0000-4000-8000-000000000001','referrer@example.invalid');insert into profiles(id,user_id,stripe_connect_account_id,stripe_connect_onboarded)values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','acct_authoritative',true);insert into user_subscriptions(user_id,tier_id,tier_name,status)values('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','og_throne','active');insert into referral_codes(user_id,code,is_active)values('20000000-0000-4000-8000-000000000001','SAFE_CODE',true);`)
const hold=run(`select hold_id from payment_v2_acquire_hold(decode(repeat('ab',32),'hex'),'early_bird',now()+interval '1 hour','safe_code')`)
equal(`select referrer_affiliate_tier||'|'||stripe_connect_destination from payment_v2_holds where id='${hold}'`,'og_throne|acct_authoritative','referrer snapshot')
run(`select payment_v2_associate_session('${hold}',decode(repeat('ab',32),'hex'),'cs_attributed')`)
equal(`select payment_v2_record_paid('${hold}',decode(repeat('ab',32),'hex'),'cs_attributed','cus_referred','price_early',null,'sub_initial','evt_authoritative',now(),900,'usd')`,'recorded','attributed payment records')
run(`insert into auth.users(id,email)values('20000000-0000-4000-8000-000000000002','buyer@example.invalid');insert into profiles(id,user_id)values('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002')`)
const purchase=run(`select id from payment_v2_purchases where hold_id='${hold}'`)
equal(`select payment_v2_claim('${purchase}',decode(repeat('ab',32),'hex'),'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002')`,'claimed','valid claim')
equal(`select attribution_status from affiliate_ledger where payment_v2_purchase_id='${purchase}'`,'PURCHASER_ATTACHED','affiliate claim preserved')
run(`update user_subscriptions set tier_name='early_bird',status='inactive' where user_id='10000000-0000-4000-8000-000000000001'`)

// Exercise real database boundaries: the claimed Early Bird row is seat one.
run(`select hold_id from generate_series(1,149) g cross join lateral payment_v2_acquire_hold(extensions.digest('lock05f-eb-'||g::text,'sha256'),'early_bird',now()+interval '1 hour',null)`)
equal(`select count(*) from payment_v2_holds where tier='early_bird' and ((state='HELD' and expires_at>now()) or state in('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))`,150,'Early Bird seat 150 consumes')
fails(`select * from payment_v2_acquire_hold(extensions.digest('lock05f-eb-151','sha256'),'early_bird',now()+interval '1 hour',null)`,/ERROR:\s+sold_out\b/,'Early Bird seat 151 rejected')
equal(`select count(*) from payment_v2_holds where tier='early_bird' and ((state='HELD' and expires_at>now()) or state in('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))`,150,'no 151st Early Bird hold')
run(`select hold_id from generate_series(1,50) g cross join lateral payment_v2_acquire_hold(extensions.digest('lock05f-og-'||g::text,'sha256'),'og_throne',now()+interval '1 hour',null)`)
equal(`select count(*) from payment_v2_holds where tier='og_throne' and ((state='HELD' and expires_at>now()) or state in('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))`,50,'OG hold 50 accepted')
fails(`select * from payment_v2_acquire_hold(extensions.digest('lock05f-og-51','sha256'),'og_throne',now()+interval '1 hour',null)`,/ERROR:\s+sold_out\b/,'OG hold 51 rejected')
equal(`select count(*) from payment_v2_holds where tier='og_throne' and ((state='HELD' and expires_at>now()) or state in('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))`,50,'no OG hold 51')

// Production-shaped protected admin, exact stale population and verified referral artifacts.
const REFERRER='40000000-0000-4000-8000-000000000001'
const REFERRER_CODE='50000000-0000-4000-8000-000000000001'
const TRACKING='60000000-0000-4000-8000-000000000001'
const COMMISSION='70000000-0000-4000-8000-000000000001'
const STALE1='30000000-0000-4000-8000-000000000001'
run(`insert into auth.users(id,email)values('${ADMIN}','admin@sirensforge.vip'),('${REFERRER}','non-target-referrer@example.invalid');
insert into profiles(id,user_id,email,role,is_og_vip,is_tester,is_beta_tester,tier,subscription_status)values('${ADMIN}','${ADMIN}','admin@sirensforge.vip','admin',false,false,false,'og_throne','none'),('${REFERRER}','${REFERRER}','non-target-referrer@example.invalid','user',false,false,false,null,'none');
insert into user_subscriptions(user_id,tier_id,tier_name,status)values('${ADMIN}','00000000-0000-4000-8000-000000000001','og_throne','inactive');
insert into auth.users(id,email,created_at,updated_at,last_sign_in_at)select ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'legacy-'||g||'@example.invalid',now(),now(),case when g<=20 then now() end from generate_series(1,21)g;
insert into profiles(id,user_id,email,role,is_og_vip,is_tester,is_beta_tester,seat_number,og_seat_number,tier,subscription_status,password_hash)select ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'legacy-'||g||'@example.invalid','user',true,g<=20,false,g,g,'og_throne','active','must-not-back-up' from generate_series(1,21)g;
insert into user_subscriptions(user_id,tier_id,tier_name,status)select ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000001','og_throne','active' from generate_series(1,20)g;
insert into referral_codes(user_id,code,is_active,total_uses)select ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'STALE_'||g,true,0 from generate_series(1,21)g;
insert into referral_codes(id,user_id,code,is_active,total_uses)values('${REFERRER_CODE}','${REFERRER}','TEST_REFERRER',true,0);
insert into referral_tracking(id,referral_code_id,referrer_user_id,referred_user_id)values('${TRACKING}','${REFERRER_CODE}','${REFERRER}','${STALE1}');
insert into commission_earnings(id,referral_code_id,referrer_user_id,referred_user_id,transaction_reference,status,paid_at,commission_type,base_amount,commission_rate,commission_amount,metadata)values('${COMMISSION}','${REFERRER_CODE}','${REFERRER}','${STALE1}','TEST_TXN_001','pending',null,'subscription',100,10,10,'{}');`)
file('supabase/manual/lock05f_legacy_og_cleanup_backup.sql')
equal(`select (select count(*) from lock05f_backup_20260812_pre_cleanup.profiles)||'|'||(select count(*) from lock05f_backup_20260812_pre_cleanup.auth_user_audit)||'|'||(select count(*) from lock05f_backup_20260812_pre_cleanup.user_subscriptions)||'|'||(select count(*) from lock05f_backup_20260812_pre_cleanup.referral_codes)||'|'||(select count(*) from lock05f_backup_20260812_pre_cleanup.referral_tracking)||'|'||(select count(*) from lock05f_backup_20260812_pre_cleanup.commission_earnings)`,'21|21|20|21|1|1','all approved backup row counts')
equal(`select count(*) from lock05f_backup_20260812_pre_cleanup.profiles where profile_id='${ADMIN}'`,0,'admin excluded from backup')
equal(`select count(*) from lock05f_backup_20260812_pre_cleanup.profiles where profile_without_password_hash?'password_hash'`,0,'password hash absent')
equal(`select count(*) from information_schema.columns where table_schema='lock05f_backup_20260812_pre_cleanup' and column_name~'(encrypted_password|recovery_token|confirmation_token|refresh_token|mfa|oauth)'`,0,'auth credentials absent')
equal(`select pg_get_userbyid(nspowner)||'|'||has_schema_privilege('public','lock05f_backup_20260812_pre_cleanup','USAGE')||'|'||has_schema_privilege('anon','lock05f_backup_20260812_pre_cleanup','USAGE')||'|'||has_schema_privilege('authenticated','lock05f_backup_20260812_pre_cleanup','USAGE')||'|'||has_schema_privilege('service_role','lock05f_backup_20260812_pre_cleanup','USAGE') from pg_namespace where nspname='lock05f_backup_20260812_pre_cleanup'`,'postgres|false|false|false|false','backup schema private')
equal(`select bool_and(not has_table_privilege('anon',c.oid,'SELECT') and not has_table_privilege('authenticated',c.oid,'SELECT') and not has_table_privilege('service_role',c.oid,'SELECT')) from pg_class c where c.relnamespace='lock05f_backup_20260812_pre_cleanup'::regnamespace and c.relkind='r'`,'t','backup tables inaccessible')
const untouched=()=>equal(`select (select count(*) from profiles where is_og_vip)||'|'||(select count(*) from auth.users where id::text like '30000000-0000-4000-8000-%')||'|'||(select count(*) from referral_codes where user_id::text like '30000000-0000-4000-8000-%')`,'21|21|21','refusal leaves stale population untouched')
const refusal=(mutation,pattern,msg,restore)=>{run(mutation);failsFile('supabase/manual/lock05f_legacy_og_cleanup_delete.sql',pattern,msg);untouched();run(restore)}
refusal(`update referral_codes set total_uses=1 where user_id='${STALE1}'`,/lock05f_stale_referral_code_used/,'used stale code refuses',`update referral_codes set total_uses=0 where user_id='${STALE1}'`)
refusal(`insert into referral_tracking(referral_code_id,referrer_user_id,referred_user_id)values('${REFERRER_CODE}','${REFERRER}','${STALE1}')`,/lock05f_tracking_contract_mismatch/,'second tracking refuses',`delete from referral_tracking where id<>'${TRACKING}'`)
refusal(`insert into commission_earnings(referral_code_id,referrer_user_id,referred_user_id,transaction_reference,status,commission_type,base_amount,commission_rate,commission_amount,metadata)values('${REFERRER_CODE}','${REFERRER}','${STALE1}','OTHER','pending','subscription',100,10,10,'{}')`,/lock05f_commission_contract_mismatch/,'second commission refuses',`delete from commission_earnings where id<>'${COMMISSION}'`)
for(const [column,value,label] of [[`status`,`'paid'`,'paid status'],[`paid_at`,`now()`,'paid_at'],[`commission_amount`,`11`,'changed amount'],[`transaction_reference`,`'WRONG'`,'wrong transaction']] ) refusal(`update commission_earnings set ${column}=${value} where id='${COMMISSION}'`,/lock05f_commission_contract_mismatch/,`${label} refuses`,`update commission_earnings set status='pending',paid_at=null,commission_amount=10,transaction_reference='TEST_TXN_001' where id='${COMMISSION}'`)
const staleCode=run(`select id from referral_codes where user_id='${STALE1}'`)
refusal(`update referral_tracking set referral_code_id='${staleCode}' where id='${TRACKING}';update commission_earnings set referral_code_id='${staleCode}' where id='${COMMISSION}'`,/lock05f_test_referrer_contract_mismatch/,'stale-owned test code refuses',`update referral_tracking set referral_code_id='${REFERRER_CODE}' where id='${TRACKING}';update commission_earnings set referral_code_id='${REFERRER_CODE}' where id='${COMMISSION}'`)
refusal(`update referral_tracking set referrer_user_id='${STALE1}' where id='${TRACKING}';update commission_earnings set referrer_user_id='${STALE1}' where id='${COMMISSION}'`,/lock05f_test_referrer_contract_mismatch/,'stale referrer refuses',`update referral_tracking set referrer_user_id='${REFERRER}' where id='${TRACKING}';update commission_earnings set referrer_user_id='${REFERRER}' where id='${COMMISSION}'`)
refusal(`update profiles set role='admin' where id='${STALE1}'`,/lock05f_protected_admin_or_role_targeted/,'protected admin inclusion refuses',`update profiles set role='user' where id='${STALE1}'`)
run(`create table unexpected_dependency(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id));insert into unexpected_dependency(user_id)values('${STALE1}')`)
failsFile('supabase/manual/lock05f_legacy_og_cleanup_delete.sql',/lock05f_unexpected_dependency/,'unexpected FK dependency refuses');untouched();run(`drop table unexpected_dependency`)
const before=run(`select (select count(*) from payment_v2_holds)||'|'||(select count(*) from payment_v2_purchases)||'|'||(select count(*) from payment_v2_allocations)||'|'||(select count(*) from affiliate_ledger)`)
file('supabase/manual/lock05f_legacy_og_cleanup_delete.sql')
equal(`select (select count(*) from profiles where is_og_vip)||'|'||(select count(*) from auth.users where id::text like '30000000-0000-4000-8000-%')||'|'||(select count(*) from user_subscriptions where user_id::text like '30000000-0000-4000-8000-%')||'|'||(select count(*) from referral_codes where user_id::text like '30000000-0000-4000-8000-%')||'|'||(select count(*) from referral_tracking where referred_user_id='${STALE1}')||'|'||(select count(*) from commission_earnings where referred_user_id='${STALE1}')`,'0|0|0|0|0|0','all stale and exact test artifacts deleted')
equal(`select (select count(*) from profiles where id='${ADMIN}')||'|'||(select count(*) from auth.users where id='${ADMIN}' and email='admin@sirensforge.vip')||'|'||(select count(*) from user_subscriptions where user_id='${ADMIN}' and tier_name='og_throne')`,'1|1|1','protected admin retained')
equal(`select (select count(*) from auth.users where id='${REFERRER}')||'|'||(select count(*) from profiles where id='${REFERRER}')||'|'||(select count(*) from referral_codes where id='${REFERRER_CODE}')`,'1|1|1','non-target referrer and code retained')
equal(`select (select count(*) from payment_v2_holds)||'|'||(select count(*) from payment_v2_purchases)||'|'||(select count(*) from payment_v2_allocations)||'|'||(select count(*) from affiliate_ledger)`,before,'Payment V2 and affiliate rows unchanged')
equal(`select count(*) from profiles where is_beta_tester`,0,'no beta users created')
console.log(`LOCK-05F PostgreSQL integration passed (${assertions} assertions; fail-closed referral contracts, private backup, and exact cleanup executed).`)
