import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

const url = process.env.PAYMENT_V2_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
let assertions = 0
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`
const hash = (value) => `decode('${createHash('sha256').update(value).digest('hex')}','hex')`
const run = (sql, role = null) => {
  const wrapped = role ? `set role ${role}; ${sql}` : sql
  const result = spawnSync('psql', [url, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', wrapped], { encoding: 'utf8' })
  return { ok: result.status === 0, out: (result.stdout || '').trim(), err: result.error?.message || (result.stderr || '').trim() }
}
const ok = (sql, message, role) => { const r = run(sql, role); assert.equal(r.ok, true, `${message}: ${r.err}`); assertions++; return r.out }
const fails = (sql, message, role) => { const r = run(sql, role); assert.equal(r.ok, false, message); assertions++ }
const equal = (sql, expected, message, role) => { const out = ok(sql, message, role); assert.equal(out.split('\n').at(-1), String(expected), message); return out }
const concurrent = (statements) => Promise.all(statements.map((sql) => new Promise((resolve) => {
  const child = spawn('psql', [url, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''; let err = ''
  child.stdout.on('data', (data) => { out += data })
  child.stderr.on('data', (data) => { err += data })
  child.on('close', (status) => resolve({ ok: status === 0, out: out.trim(), err: err.trim() }))
})))

const bootstrap = `
drop schema public cascade; create schema public; grant all on schema public to postgres; grant usage on schema public to public;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create table public.profiles(id uuid primary key, user_id uuid not null unique, stripe_customer_id text);
create table public.subscription_tiers(id uuid primary key, name text not null, stripe_price_id text, is_active boolean not null default true);
create table public.user_subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), tier_id uuid references public.subscription_tiers(id), tier_name text not null, stripe_customer_id text, stripe_subscription_id text, status text not null, metadata jsonb default '{}'::jsonb);
insert into public.subscription_tiers values
 ('00000000-0000-0000-0000-000000000001','og_throne','price_og',true),
 ('00000000-0000-0000-0000-000000000002','early_bird','price_early',true);
insert into public.profiles values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',null),
 ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003',null),
 ('10000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000099',null);
insert into public.user_subscriptions(user_id,tier_id,tier_name,status,metadata)
values('10000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000001','og_throne','active','{"internal_admin":true,"customer_facing_allocation":false}');`
ok(bootstrap, 'minimum realistic schema initializes')
const migration = readFileSync('supabase/migrations/20260801002800_payment_first_v2_contract.sql', 'utf8')
ok(migration, 'migration 02800 compiles and applies')

const acquire = (who, tier, minutes = 60) => `select hold_id||'|'||state from public.payment_v2_acquire_hold(${hash(who)},${sqlLiteral(tier)},now()+interval '${minutes} minutes')`
const firstOg = ok(acquire('first-og','og_throne'), 'first OG acquisition succeeds').split('|')[0]
assert.match(firstOg, /^[0-9a-f-]{36}$/); assertions++
const firstEarly = ok(acquire('first-early','early_bird'), 'first Early Bird acquisition succeeds').split('|')[0]
assert.match(firstEarly, /^[0-9a-f-]{36}$/); assertions++
equal(acquire('first-og','og_throne').replace("select hold_id||'|'||state", "select hold_id"), firstOg, 'same live purchaser retry is idempotent')

const expiredId = ok(acquire('expired-retry','og_throne').replace("select hold_id||'|'||state", 'select hold_id'), 'create expiring hold')
ok(`update payment_v2_holds set expires_at=now()-interval '1 second' where id='${expiredId}'`, 'age disposable hold')
const freshId = ok(acquire('expired-retry','og_throne').replace("select hold_id||'|'||state", 'select hold_id'), 'expired retry gets new hold')
assert.notEqual(freshId, expiredId); assertions++
const crossExpired = ok(acquire('cross-expired','og_throne').replace("select hold_id||'|'||state", 'select hold_id'), 'create cross-tier stale hold')
ok(`update payment_v2_holds set expires_at=now()-interval '1 second' where id='${crossExpired}'`, 'age cross-tier hold')
equal(acquire('cross-expired','early_bird').replace("select hold_id||'|'||state", 'select tier'), 'early_bird', 'expired cross-tier hold does not conflict')
const protectedId = ok(acquire('cross-protected','og_throne').replace("select hold_id||'|'||state", 'select hold_id'), 'create associated cross-tier hold')
equal(`select payment_v2_associate_session('${protectedId}',${hash('cross-protected')},'cs_protected')`, 'associated', 'associate protected hold')
fails(acquire('cross-protected','early_bird'), 'associated cross-tier hold remains protected')

ok("truncate payment_v2_reconciliation_evidence,payment_v2_allocations,payment_v2_purchases,payment_v2_holds cascade", 'reset for capacity concurrency')
const ogBurst = await concurrent(Array.from({length:75},(_,i)=>acquire(`og-${i}`,'og_throne')))
assert.equal(ogBurst.filter(r=>r.ok).length,50,'75 concurrent OG requests create 50 holds'); assertions++
equal("select count(*) from payment_v2_holds where tier='og_throne' and ((state='HELD' and expires_at>now()) or state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))",50,'OG capacity is exactly 50 and never above capacity')
ok('truncate payment_v2_holds cascade','reset OG holds')
const ebBurst = await concurrent(Array.from({length:160},(_,i)=>acquire(`eb-${i}`,'early_bird')))
assert.equal(ebBurst.filter(r=>r.ok).length,120,'160 concurrent Early Bird requests create 120 holds'); assertions++
equal("select count(*) from payment_v2_holds where tier='early_bird' and ((state='HELD' and expires_at>now()) or state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))",120,'Early Bird capacity is exactly 120 and never above capacity')
ok('truncate payment_v2_holds cascade','reset Early Bird holds')
const sameCross = await concurrent([acquire('same-cross','og_throne'),acquire('same-cross','early_bird')])
assert.equal(sameCross.filter(r=>r.ok).length,1,'same-purchaser cross-tier concurrency creates at most one hold'); assertions++

ok('truncate payment_v2_holds cascade','reset state tests')
const stateHold = ok(acquire('state','og_throne').replace("select hold_id||'|'||state",'select hold_id'),'create state hold')
equal(`select payment_v2_associate_session('${stateHold}',${hash('state')},'cs_state')`,'associated','Session association succeeds')
equal(`select payment_v2_associate_session('${stateHold}',${hash('state')},'cs_state')`,'already_associated','Session exact replay is idempotent')
fails(`select payment_v2_associate_session('${stateHold}',${hash('state')},'cs_other')`,'Session replacement fails')
fails(`select payment_v2_expire_unpaid('${stateHold}')`,'local expiration cannot expire associated hold')
equal(`select payment_v2_record_session_unpaid_terminal('${stateHold}','cs_state','SESSION_EXPIRED_UNPAID','evt_expire',now())`,'expired','provider-confirmed expiration succeeds')
equal(`select payment_v2_record_session_unpaid_terminal('${stateHold}','cs_state','SESSION_EXPIRED_UNPAID','evt_expire',(select occurred_at from payment_v2_reconciliation_evidence where provider_event_id='evt_expire'))`,'already_recorded','provider-event exact replay is idempotent')
fails(`select payment_v2_record_session_unpaid_terminal('${stateHold}','cs_state','SESSION_EXPIRED_UNPAID','evt_other',now())`,'conflicting provider replay fails')
const cancelHold = ok(acquire('cancel','early_bird').replace("select hold_id||'|'||state",'select hold_id'),'create cancellation hold')
ok(`select payment_v2_associate_session('${cancelHold}',${hash('cancel')},'cs_cancel')`,'associate cancellation hold')
equal(`select payment_v2_record_session_unpaid_terminal('${cancelHold}','cs_cancel','PAYMENT_CANCELED_UNPAID','evt_cancel',now())`,'canceled','provider-confirmed cancellation succeeds')

const paidHold = ok(acquire('paid','og_throne').replace("select hold_id||'|'||state",'select hold_id'),'create paid hold')
ok(`select payment_v2_associate_session('${paidHold}',${hash('paid')},'cs_paid')`,'associate paid hold')
fails(`select payment_v2_record_paid('${paidHold}',${hash('paid')},'cs_paid','cus_paid','price_wrong','pi_paid',null,'evt_wrong_price',now())`,'wrong Price cannot create paid state')
equal(`select state from payment_v2_holds where id='${paidHold}'`,'SESSION_ASSOCIATED','wrong Price leaves hold unchanged')
fails(`select payment_v2_record_paid('${paidHold}',${hash('paid')},'cs_paid','cus_paid','price_og',null,null,'evt_no_pi',now())`,'OG requires PaymentIntent')
const noSubHold=ok(acquire('no-sub','early_bird').replace("select hold_id||'|'||state",'select hold_id'),'create Early Bird identity hold')
ok(`select payment_v2_associate_session('${noSubHold}',${hash('no-sub')},'cs_no_sub')`,'associate Early Bird identity hold')
fails(`select payment_v2_record_paid('${noSubHold}',${hash('no-sub')},'cs_no_sub','cus_sub','price_early',null,null,'evt_no_sub',now())`,'Early Bird requires Subscription')
equal(`select payment_v2_record_paid('${paidHold}',${hash('paid')},'cs_paid','cus_paid','price_og','pi_paid',null,'evt_paid',timestamp '2026-08-01 00:00:00+00')`,'recorded','correct evidence creates paid-unclaimed')
equal(`select count(*) from payment_v2_purchases where hold_id='${paidHold}' and state='PAID_UNCLAIMED'`,1,'exactly one paid-unclaimed purchase exists')
fails(`select payment_v2_expire_unpaid('${paidHold}')`,'paid purchase cannot be locally expired')
fails(`select payment_v2_record_session_unpaid_terminal('${paidHold}','cs_paid','PAYMENT_CANCELED_UNPAID','evt_paid_cancel',now())`,'paid purchase cannot be provider-canceled')
equal(`select count(*) from payment_v2_purchases where hold_id='${noSubHold}'`,0,'redirect or absent provider evidence cannot create paid state')

const purchaseId=ok(`select id from payment_v2_purchases where hold_id='${paidHold}'`,'load paid purchase')
equal(`select payment_v2_claim('${purchaseId}',${hash('paid')},'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')`,'claimed','first authenticated claim succeeds')
equal(`select (select count(*) from payment_v2_allocations where purchase_id='${purchaseId}')||'|'||(select count(*) from user_subscriptions where user_id='10000000-0000-0000-0000-000000000001' and tier_name='og_throne')`,'1|1','claim creates one allocation and entitlement')
equal(`select payment_v2_claim('${purchaseId}',${hash('paid')},'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')`,'already_claimed','same-profile replay is idempotent')
fails(`select payment_v2_claim('${purchaseId}',${hash('paid')},'10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002')`,'different-profile replay fails')

const conflictHold=ok(acquire('conflict','early_bird').replace("select hold_id||'|'||state",'select hold_id'),'create conflicting entitlement purchase')
ok(`select payment_v2_associate_session('${conflictHold}',${hash('conflict')},'cs_conflict')`,'associate conflict purchase')
ok(`select payment_v2_record_paid('${conflictHold}',${hash('conflict')},'cs_conflict','cus_new','price_early',null,'sub_new','evt_conflict',now())`,'record conflict purchase')
ok("insert into user_subscriptions(user_id,tier_id,tier_name,stripe_customer_id,stripe_subscription_id,status) values('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','early_bird','cus_old','sub_old','active')",'seed conflicting entitlement')
fails(`select payment_v2_claim((select id from payment_v2_purchases where hold_id='${conflictHold}'),${hash('conflict')},'10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002')`,'conflicting entitlement fails')
equal("select count(*) from user_subscriptions where user_id='10000000-0000-0000-0000-000000000002' and tier_name='early_bird'",1,'conflict creates no duplicate')
fails(`select payment_v2_claim(gen_random_uuid(),${hash('none')},'10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003')`,'claim before payment fails')
fails(`select * from payment_v2_acquire_hold(decode('00','hex'),'bad_tier',now()+interval '1 hour')`,'malformed hash and tier fail closed')
fails('select count(*) from payment_v2_holds','anon cannot read ledgers','anon')
fails(`select * from payment_v2_acquire_hold(${hash('anon')},'og_throne',now()+interval '1 hour')`,'authenticated cannot execute RPC','authenticated')
equal("select has_function_privilege('service_role','public.payment_v2_acquire_hold(bytea,text,timestamptz)','EXECUTE') and not has_function_privilege('anon','public.payment_v2_acquire_hold(bytea,text,timestamptz)','EXECUTE')",'t','service_role alone has intended function execution')
equal("select count(*) from user_subscriptions where metadata->>'internal_admin'='true'",1,'internal admin row remains separate from V2 capacity')

console.log(`Payment-first V2 PostgreSQL integration passed (${assertions} assertions)`) 
