import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const url=process.env.PAYMENT_V2_DATABASE_URL||process.env.DATABASE_URL
if(!url) throw new Error('PAYMENT_V2_DATABASE_URL is required')
let assertions=0
const exec=(args)=>spawnSync('psql',[url,'-XAt','-v','ON_ERROR_STOP=1',...args],{encoding:'utf8'})
const run=(sql)=>{const r=exec(['-c',sql]);if(r.status!==0)throw new Error(r.stderr||r.stdout);return(r.stdout||'').trim()}
const file=(path,expectFailure=false)=>{const r=exec(['-f',path]);if(expectFailure){assert.notEqual(r.status,0,'SQL must fail closed');assert.match(r.stderr,/PFC03100_UNSAFE_DRIFT/);assertions++;return}if(r.status!==0)throw new Error(`${path}: ${r.stderr||r.stdout}`)}
const equal=(sql,value,msg)=>{assert.equal(run(sql).split('\n').at(-1),String(value),msg);assertions++}
const same=(actual,expected,msg)=>{assert.equal(actual,expected,msg);assertions++}

const affectedTables=`array['public.payment_v2_holds'::regclass,'public.payment_v2_purchases'::regclass,'public.payment_v2_reconciliation_evidence'::regclass,'public.affiliate_ledger'::regclass]`
const tableCatalogFingerprint=()=>run(`select jsonb_agg(jsonb_build_object(
 'table',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forced_rls',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',x.conname,'type',x.contype,'definition',pg_get_constraintdef(x.oid,true)) order by x.conname),'[]') from pg_constraint x where x.conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.relname,'definition',pg_get_indexdef(i.oid)) order by i.relname),'[]') from pg_index ix join pg_class i on i.oid=ix.indexrelid where ix.indrelid=c.oid),
 'acl',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when e.grantee=0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end,'privilege',e.privilege_type,'grantable',e.is_grantable) order by e.grantee,e.privilege_type),'[]') from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) e),
 'column_acl',(select coalesce(jsonb_agg(jsonb_build_object('column',a.attname,'grantee',case when e.grantee=0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end,'privilege',e.privilege_type,'grantable',e.is_grantable) order by a.attnum,e.grantee,e.privilege_type),'[]') from pg_attribute a cross join lateral aclexplode(a.attacl) e where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attacl is not null)
) order by c.oid::regclass::text) from pg_class c where c.oid=any(${affectedTables})`)
const functionCatalogFingerprint=()=>run(`select jsonb_agg(jsonb_build_object(
 'signature',p.oid::regprocedure::text,'identity_arguments',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),
 'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'proconfig',coalesce(to_jsonb(p.proconfig),'[]'),
 'acl',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when e.grantee=0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end,'privilege',e.privilege_type,'grantable',e.is_grantable) order by e.grantee,e.privilege_type),'[]') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) e)
) order by p.oid::regprocedure::text) from pg_proc p where p.oid=any(array['public.payment_v2_acquire_hold(bytea,text,timestamptz)'::regprocedure,'public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz)'::regprocedure,'public.payment_v2_claim(uuid,bytea,uuid,uuid)'::regprocedure,'public.release_affiliate_commissions()'::regprocedure,'public.create_affiliate_payout_batch(text)'::regprocedure])`)
const dataFingerprint=()=>run(`select jsonb_build_object('holds',(select jsonb_agg(to_jsonb(x) order by id) from payment_v2_holds x),'purchases',(select jsonb_agg(to_jsonb(x) order by id) from payment_v2_purchases x),'evidence',(select jsonb_agg(to_jsonb(x) order by id) from payment_v2_reconciliation_evidence x),'affiliate',(select jsonb_agg(to_jsonb(x) order by id) from affiliate_ledger x))`)
const pfc03000Names=['profiles','referral_codes','referral_tracking','referrals','commission_earnings','commissions','affiliate_ledger','affiliate_payout_batches','affiliate_payout_items','payouts','catalog_snapshot'].map(n=>`pfc03000_backup_${n}`)
const pfc03000Fingerprint=()=>pfc03000Names.map(n=>`${n}:${run(`select jsonb_agg(to_jsonb(x) order by marker) from ${n} x`)}`).join('|')

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
const pre03000Fixture=()=>run(`
create table referral_codes(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),code varchar not null,is_active boolean not null default true,expires_at timestamptz,total_uses integer default 0);
create table referral_tracking(id uuid primary key); create table referrals(id uuid primary key,referrer_user_id uuid,referred_user_id uuid); create table commission_earnings(id uuid primary key);
create table commissions(id uuid primary key); create table affiliate_payout_batches(id uuid primary key default gen_random_uuid(),notes text); create table affiliate_payout_items(id uuid primary key,batch_id uuid,ledger_id uuid unique,affiliate_user_id uuid,amount_cents integer);
create table payouts(id uuid primary key); create view affiliate_payout_queue as select id from affiliate_payout_batches;
create table affiliate_ledger(id uuid primary key default gen_random_uuid(),affiliate_user_id uuid not null,referred_user_id uuid not null,stripe_event_id text not null unique,stripe_subscription_id text,tier_name text not null,commission_amount_cents integer not null,gross_amount_cents integer not null,commission_percent integer not null,status text not null check(status in('pending','available','paid','void')),created_at timestamptz default now(),updated_at timestamptz default now());
create function apply_referral_code(uuid,varchar) returns jsonb language plpgsql as 'begin return null; end';
create function calculate_affiliate_commission(uuid,varchar,numeric,boolean) returns table(commission_amount numeric,commission_rate numeric,tier_name varchar) language plpgsql as 'begin return; end';
create function calculate_commission(uuid,varchar,numeric) returns jsonb language plpgsql as 'begin return null; end';
create function calculate_commission_rate(text,text,integer) returns numeric language plpgsql as 'begin return 0; end';
create function clawback_affiliate_commission(text,text) returns void language plpgsql as 'begin end';
create function complete_referral_reward(uuid) returns boolean language plpgsql as 'begin return false; end';
create function create_affiliate_payout_batch(text default null) returns uuid language plpgsql as 'begin return gen_random_uuid(); end';
create function generate_referral_code() returns text language plpgsql as 'begin return null; end';
create function generate_referral_code(uuid,varchar) returns varchar language plpgsql as 'begin return null; end';
create function generate_unique_referral_code() returns text language plpgsql as 'begin return null; end';
create function get_profile_by_referral_code(text) returns table(user_id uuid,email text,referral_code text) language plpgsql as 'begin return; end';
create function process_referral_reward(uuid,text) returns boolean language plpgsql as 'begin return false; end';
create function release_affiliate_commissions() returns void language plpgsql as 'begin end';
create function get_user_stats(uuid) returns table(total_generations bigint,total_collections bigint,total_tokens_spent integer,total_referrals bigint,current_streak integer) language plpgsql as 'begin return; end';
create function handle_new_user() returns trigger language plpgsql as 'begin return new; end';
create function initialize_new_user() returns trigger language plpgsql as 'begin return new; end';
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
create trigger on_profile_created after insert on profiles for each row execute function initialize_new_user();
`)
const pfc03000Artifacts=()=>run(`do $$declare n text;begin foreach n in array array['profiles','referral_codes','referral_tracking','referrals','commission_earnings','commissions','affiliate_ledger','affiliate_payout_batches','affiliate_payout_items','payouts','catalog_snapshot'] loop execute format('create table pfc03000_backup_%I(marker text)',n);execute format('insert into pfc03000_backup_%I values(''UNTOUCHED'')',n);end loop;end$$;`)
const applyBaseline=()=>{bootstrap();file('supabase/migrations/20260801002800_payment_first_v2_contract.sql');pre03000Fixture();file('supabase/migrations/20260806003000_payment_first_affiliate_security.sql');pfc03000Artifacts();equal(`select prosecdef and proconfig=array['search_path=pg_catalog, pg_temp'] from pg_proc where oid='release_affiliate_commissions()'::regprocedure`,'t','real 03000 executed and hardened functions')}
const seed=()=>run(`
insert into auth.users values('20000000-0000-4000-8000-000000000001'); insert into profiles(id,user_id) values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
insert into payment_v2_holds(id,purchaser_credential_hash,tier,state,stripe_checkout_session_id,expires_at) values('30000000-0000-4000-8000-000000000001',decode(repeat('ab',32),'hex'),'early_bird','SESSION_ASSOCIATED','cs_pre',now()+interval '1 hour');
insert into payment_v2_purchases(id,hold_id,purchaser_credential_hash,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_subscription_id,provider_event_id,provider_confirmed_at) values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',decode(repeat('ab',32),'hex'),'early_bird','cs_pre','cus_pre','price_early','sub_pre','evt_pre',now());
update payment_v2_holds set state='PAID_UNCLAIMED' where id='30000000-0000-4000-8000-000000000001';
insert into payment_v2_reconciliation_evidence(hold_id,purchase_id,stripe_checkout_session_id,event_kind,provider_event_id,occurred_at) values('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','cs_pre','PAYMENT_CONFIRMED','evt_pre',now());
insert into affiliate_ledger(affiliate_user_id,referred_user_id,stripe_event_id,tier_name,commission_amount_cents,gross_amount_cents,commission_percent,status) values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','legacy_evt','early_bird',20,100,20,'pending');
`)

applyBaseline(); seed()
const preTables=tableCatalogFingerprint(),preFunctions=functionCatalogFingerprint(),preData=dataFingerprint()
const pre03000Artifacts=pfc03000Fingerprint()
file('supabase/manual/pfc03100_pre_migration_backup.sql')
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
same(tableCatalogFingerprint(),preTables,'normalized table catalog exactly restored')
same(functionCatalogFingerprint(),preFunctions,'normalized function catalog exactly restored')
same(dataFingerprint(),preData,'representative PRE-03100 data exactly restored')
same(pfc03000Fingerprint(),pre03000Artifacts,'all PFC03000 artifacts remain untouched')
equal(`select to_regclass('public.payment_v2_provider_event_inbox') is null and to_regprocedure('public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)') is null`,'t','02900-only objects are absent')
equal(`select to_regclass('supabase_migrations.schema_migrations') is null`,'t','migration history was never created or mutated')

// A separate disposable reset proves drift aborts before any destructive action.
applyBaseline(); seed(); file('supabase/manual/pfc03100_pre_migration_backup.sql'); file('supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql')
run(`update payment_v2_holds set updated_at=updated_at+interval '1 second' where id='30000000-0000-4000-8000-000000000001'`)
file('supabase/manual/pfc03100_rollback.sql',true)
equal(`select to_regprocedure('payment_v2_acquire_hold(bytea,text,timestamptz,text)') is not null`,'t','failed rollback left 03100 schema intact')
equal(`select updated_at<>(select updated_at from pfc03100_backup_payment_v2_holds where id='30000000-0000-4000-8000-000000000001') from payment_v2_holds where id='30000000-0000-4000-8000-000000000001'`,'t','newer state was not overwritten')

// A second negative reset changes only 03100-added fields on a PRE-03100 row.
applyBaseline(); seed(); file('supabase/manual/pfc03100_pre_migration_backup.sql'); file('supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql')
run(`update payment_v2_purchases set gross_amount_cents=900,currency='usd' where id='40000000-0000-4000-8000-000000000001'`)
file('supabase/manual/pfc03100_rollback.sql',true)
equal(`select to_regprocedure('payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz,integer,text)') is not null`,'t','03100 schema remains after added-column drift rejection')
equal(`select gross_amount_cents||'|'||currency from payment_v2_purchases where id='40000000-0000-4000-8000-000000000001'`,'900|usd','03100-only state remains intact')
equal(`select count(*) from pfc03100_backup_manifest`,'1','backup artifacts remain after added-column drift rejection')
equal(`select (to_jsonb(x)-array['gross_amount_cents','currency','referral_code_id','referrer_auth_user_id','referrer_profile_id','referrer_affiliate_tier','referral_bound_at'])=to_jsonb(b) from payment_v2_purchases x join pfc03100_backup_payment_v2_purchases b using(id)`,'t','PRE-03100 data was not overwritten')
console.log(`PFC-CORE-03C PostgreSQL backup/rollback integration passed (${assertions} assertions; real 02800 + real 03000 + real 03100; 02900 never applied).`)
