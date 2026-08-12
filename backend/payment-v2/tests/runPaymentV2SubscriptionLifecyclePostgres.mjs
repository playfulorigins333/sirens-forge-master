import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const url=process.env.PAYMENT_V2_DATABASE_URL||process.env.DATABASE_URL||'postgres://postgres:postgres@127.0.0.1:5432/postgres'
let assertions=0
const run=(sql,role)=>{const r=spawnSync('psql',[url,'-XAt','-v','ON_ERROR_STOP=1','-c',role?`set role ${role};${sql}`:sql],{encoding:'utf8'});return{ok:r.status===0,out:(r.stdout||'').trim(),err:(r.stderr||'').trim()}}
const ok=(sql,msg,role)=>{const r=run(sql,role);assert.equal(r.ok,true,`${msg}: ${r.err}`);assertions++;return r.out.split('\n').at(-1)}
const equal=(sql,want,msg,role)=>assert.equal(ok(sql,msg,role),String(want),msg)
const fails=(sql,re,msg,role)=>{const r=run(sql,role);assert.equal(r.ok,false,msg);assert.match(r.err,re,msg);assertions++}

ok(`drop schema if exists lock05e_backup_20260811_pre_apply cascade;drop schema public cascade;create schema public;grant all on schema public to postgres;grant usage on schema public to public;
do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;
create table public.profiles(id uuid primary key,user_id uuid not null unique,stripe_customer_id text);
create table public.subscription_tiers(id uuid primary key,name text not null,stripe_price_id text,is_active boolean not null default true);
create table public.user_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references profiles(id),tier_id uuid references subscription_tiers(id),tier_name text,stripe_subscription_id text unique,stripe_customer_id text,status text not null,current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean,canceled_at timestamptz,trial_start timestamptz,trial_end timestamptz,metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
insert into subscription_tiers values('00000000-0000-0000-0000-000000000001','og_throne','price_og',true),('00000000-0000-0000-0000-000000000002','early_bird','price_early',true);
insert into profiles values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',null),('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',null);`,'bootstrap')
for(const file of ['supabase/migrations/20260801002800_payment_first_v2_contract.sql','supabase/migrations/20260805002900_payment_v2_lifecycle_foundation.sql'])ok(readFileSync(file,'utf8'),`apply ${file}`)
ok(readFileSync('supabase/manual/lock05e_payment_v2_subscription_lifecycle_backup.sql','utf8'),'backup artifact executes against prestate')
equal(`select has_schema_privilege('service_role','lock05e_backup_20260811_pre_apply','usage')`,'f','backup remains private')
equal(`select count(*) from information_schema.columns where table_schema='lock05e_backup_20260811_pre_apply' and column_name='password_hash'`,0,'backup excludes password hash')
ok(readFileSync('supabase/migrations/20260812080000_lock05e_payment_v2_early_bird_subscription_lifecycle.sql','utf8'),'forward migration applies')
const sig="public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,timestamp with time zone,timestamp with time zone,boolean,timestamp with time zone,timestamp with time zone,timestamp with time zone)"
equal(`select pg_get_userbyid(proowner)||'|'||prosecdef||'|'||array_to_string(proconfig,',') from pg_proc where oid='${sig}'::regprocedure`,'postgres|true|search_path=pg_catalog, pg_temp','secure function properties')
equal(`select has_function_privilege('service_role','${sig}','execute')`,'t','service role executes')
equal(`select has_function_privilege('anon','${sig}','execute')||'|'||has_function_privilege('authenticated','${sig}','execute')`,'false|false','browser roles denied')

ok(`insert into payment_v2_holds(id,purchaser_credential_hash,tier,state,stripe_checkout_session_id,expires_at)values('30000000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),'early_bird','CLAIMED','cs_early',now()+interval '1 hour');
insert into payment_v2_purchases(id,hold_id,purchaser_credential_hash,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_subscription_id,state,claimed_profile_id,claimed_at,provider_event_id,provider_confirmed_at)values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),'early_bird','cs_early','cus_early','price_early','sub_early','CLAIMED','10000000-0000-4000-8000-000000000001',now(),'evt_paid',now());
insert into user_subscriptions(id,user_id,tier_id,tier_name,stripe_subscription_id,stripe_customer_id,status,metadata)values('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000002','early_bird','sub_early','cus_early','past_due','{"preserve":true}');
insert into payment_v2_allocations(purchase_id,tier,profile_id,entitlement_id)values('40000000-0000-4000-8000-000000000001','early_bird','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001');`,'seed exact chain')
const call=(status='active',customer='cus_early',hold='30000000-0000-4000-8000-000000000001')=>`select payment_v2_apply_early_bird_subscription_lifecycle('${hold}','sub_early','${customer}','${status}',timestamp '2026-08-01Z',timestamp '2026-09-01Z',true,null,null,null)`
equal(call(),'applied','claimed lifecycle applies','service_role')
equal(`select status||'|'||cancel_at_period_end||'|'||(metadata->>'preserve') from user_subscriptions where id='50000000-0000-4000-8000-000000000001'`,'active|true|true','only lifecycle fields synchronize')
for(const status of ['trialing','past_due','canceled','unpaid','paused','incomplete','incomplete_expired']){equal(call(status),'applied',`${status} applies`,'service_role');equal(`select status from user_subscriptions where id='50000000-0000-4000-8000-000000000001'`,status,`${status} stored`)}
equal(call('active'),'applied','recovery applies','service_role');equal(call('active'),'applied','replay applies','service_role')
fails(call('active','cus_wrong'),/subscription_customer_mismatch/,'wrong customer fails','service_role')
fails(call('active','cus_early','30000000-0000-4000-8000-000000000099'),/subscription_hold_mismatch/,'wrong hold fails','service_role')
equal(`select status||'|'||(metadata->>'preserve') from user_subscriptions where id='50000000-0000-4000-8000-000000000001'`,'active|true','hold mismatch leaves entitlement unchanged')
fails(call('bogus'),/invalid_subscription_snapshot/,'arbitrary status fails','service_role')
equal(`select state from payment_v2_purchases where id='40000000-0000-4000-8000-000000000001'`,'CLAIMED','purchase unchanged')
equal(`select state from payment_v2_holds where id='30000000-0000-4000-8000-000000000001'`,'CLAIMED','hold unchanged')
equal(`select count(*) from payment_v2_allocations where purchase_id='40000000-0000-4000-8000-000000000001'`,1,'allocation unchanged')
equal(`select payment_v2_apply_early_bird_subscription_lifecycle('30000000-0000-4000-8000-000000000099','sub_missing','cus_missing','active',null,null,false,null,null,null)`,'purchase_pending','missing purchase pending','service_role')
ok(`insert into payment_v2_holds(id,purchaser_credential_hash,tier,state,stripe_checkout_session_id,expires_at)values('30000000-0000-4000-8000-000000000002',decode(repeat('bb',32),'hex'),'early_bird','PAID_UNCLAIMED','cs_unclaimed',now()+interval '1 hour');insert into payment_v2_purchases(id,hold_id,purchaser_credential_hash,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_subscription_id,state,provider_event_id,provider_confirmed_at)values('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',decode(repeat('bb',32),'hex'),'early_bird','cs_unclaimed','cus_unclaimed','price_early','sub_unclaimed','PAID_UNCLAIMED','evt_unclaimed',now())`,'seed unclaimed')
equal(`select payment_v2_apply_early_bird_subscription_lifecycle('30000000-0000-4000-8000-000000000002','sub_unclaimed','cus_unclaimed','canceled',null,null,false,now(),null,null)`,'unclaimed','unclaimed no-op','service_role')
equal(`select count(*) from payment_v2_allocations where purchase_id='40000000-0000-4000-8000-000000000002'`,0,'unclaimed allocation absent')
ok(`insert into payment_v2_holds(id,purchaser_credential_hash,tier,state,stripe_checkout_session_id,expires_at)values('30000000-0000-4000-8000-000000000003',decode(repeat('cc',32),'hex'),'og_throne','CLAIMED','cs_og',now()+interval '1 hour');insert into payment_v2_purchases(id,hold_id,purchaser_credential_hash,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_payment_intent_id,state,claimed_profile_id,claimed_at,provider_event_id,provider_confirmed_at)values('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',decode(repeat('cc',32),'hex'),'og_throne','cs_og','cus_og','price_og','pi_og','CLAIMED','10000000-0000-4000-8000-000000000002',now(),'evt_og',now());insert into user_subscriptions(id,user_id,tier_id,tier_name,stripe_customer_id,status,metadata)values('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001','og_throne','cus_og','active','{"lifetime":true}');insert into payment_v2_allocations(purchase_id,tier,profile_id,entitlement_id)values('40000000-0000-4000-8000-000000000003','og_throne','10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003')`,'seed OG chain')
equal(`select payment_v2_apply_early_bird_subscription_lifecycle('30000000-0000-4000-8000-000000000003','sub_og','cus_og','canceled',null,null,false,now(),null,null)`,'purchase_pending','OG is outside lifecycle','service_role')
equal(`select status||'|'||(metadata->>'lifetime') from user_subscriptions where id='50000000-0000-4000-8000-000000000003'`,'active|true','OG entitlement cannot mutate')
assert.doesNotMatch(readFileSync('supabase/manual/lock05e_payment_v2_subscription_lifecycle_backup.sql','utf8'),/profiles\.password_hash/i);assertions++
ok(readFileSync('supabase/manual/lock05e_payment_v2_subscription_lifecycle_rollback.sql','utf8'),'rollback applies')
equal(`select to_regprocedure('${sig}') is null`,'t','rollback removes only RPC')
equal(`select has_schema_privilege('service_role','lock05e_backup_20260811_pre_apply','usage')`,'f','rollback preserves private backup')
console.log(`LOCK-05E PostgreSQL integration passed (${assertions} assertions)`)
