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
const failsWith = (sql, expected, message, role) => {
  const r = run(sql, role)
  assert.equal(r.ok, false, `${message}: command unexpectedly succeeded`)
  assert.match(r.err, expected, `${message}: unexpected PostgreSQL failure: ${r.err}`)
  assertions++
}
const equal = (sql, expected, message, role) => { const out = ok(sql, message, role); assert.equal(out.split('\n').at(-1), String(expected), message); return out }
const concurrent = (statements) => Promise.all(statements.map((sql) => new Promise((resolve) => {
  const child = spawn('psql', [url, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''; let err = ''
  child.stdout.on('data', (data) => { out += data })
  child.stderr.on('data', (data) => { err += data })
  child.on('close', (status) => resolve({ ok: status === 0, out: out.trim(), err: err.trim() }))
})))
const MAX_CONCURRENT_CONNECTIONS = 20
const boundedConcurrent = async (statements) => {
  const results = []
  for (let offset = 0; offset < statements.length; offset += MAX_CONCURRENT_CONNECTIONS) {
    results.push(...await concurrent(statements.slice(offset, offset + MAX_CONCURRENT_CONNECTIONS)))
  }
  return results
}
const assertCapacityResults = (results, successes, label) => {
  assert.equal(results.length, label === 'OG' ? 75 : 160, `${label} attempt count`); assertions++
  assert.equal(results.filter((r) => r.ok).length, successes, `${label} successful acquisitions`); assertions++
  const rejected = results.filter((r) => !r.ok)
  assert.equal(rejected.length, results.length - successes, `${label} rejected count`); assertions++
  assert.equal(rejected.every((r) => /ERROR:\s+sold_out\b/.test(r.err)), true, `${label} every rejection is sold_out`); assertions++
}
const ageUnassociatedHold = (holdId, message) => {
  ok(`update payment_v2_holds as h
      set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour', updated_at=now()
      where h.id='${holdId}' and h.state='HELD' and h.stripe_checkout_session_id is null`, message)
  equal(`select (state='HELD' and stripe_checkout_session_id is null and created_at<expires_at and expires_at<=now())::text
         from payment_v2_holds where id='${holdId}'`, 'true', `${message} preserves expired HELD invariants`)
}

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
 ('10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004',null),
 ('10000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000099',null);
insert into public.user_subscriptions(user_id,tier_id,tier_name,status,metadata)
values('10000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000001','og_throne','active','{"internal_admin":true,"customer_facing_allocation":false}');`
ok(bootstrap, 'minimum realistic schema initializes')
const migration = readFileSync('supabase/migrations/20260801002800_payment_first_v2_contract.sql', 'utf8')
ok(migration, 'migration 02800 compiles and applies')
const foundationMigration = readFileSync('supabase/migrations/20260805002900_payment_v2_lifecycle_foundation.sql', 'utf8')
ok(foundationMigration, 'migration 02900 lifecycle foundation compiles and applies')

const acquire = (who, tier, minutes = 60) => `select hold_id||'|'||state from public.payment_v2_acquire_hold(${hash(who)},${sqlLiteral(tier)},now()+interval '${minutes} minutes')`
const firstOg = ok(acquire('first-og','og_throne'), 'first OG acquisition succeeds').split('|')[0]
assert.match(firstOg, /^[0-9a-f-]{36}$/); assertions++
const firstEarly = ok(acquire('first-early','early_bird'), 'first Early Bird acquisition succeeds').split('|')[0]
assert.match(firstEarly, /^[0-9a-f-]{36}$/); assertions++
equal(acquire('first-og','og_throne').replace("select hold_id||'|'||state", "select hold_id"), firstOg, 'same live purchaser retry is idempotent')

const expiredId = ok(acquire('expired-retry','og_throne').replace("select hold_id||'|'||state", 'select hold_id'), 'create expiring hold')
ageUnassociatedHold(expiredId, 'coherently age same-tier disposable hold')
const freshId = ok(acquire('expired-retry','og_throne').replace("select hold_id||'|'||state", 'select hold_id'), 'expired retry gets new hold')
assert.notEqual(freshId, expiredId); assertions++
equal(`select state from payment_v2_holds where id='${expiredId}'`, 'EXPIRED_UNPAID', 'original same-tier hold is expired')
equal(`select (state='HELD' and stripe_checkout_session_id is null and expires_at>now())::text from payment_v2_holds where id='${freshId}'`, 'true', 'new same-tier hold is live and unassociated')
equal(`select count(*) from payment_v2_holds where purchaser_credential_hash=${hash('expired-retry')} and ((state='HELD' and expires_at>now()) or state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))`, 1, 'exactly one same-tier effective hold remains')
const crossExpired = ok(acquire('cross-expired','og_throne').replace("select hold_id||'|'||state", 'select hold_id'), 'create cross-tier stale hold')
ageUnassociatedHold(crossExpired, 'coherently age cross-tier disposable hold')
const crossFresh = ok(acquire('cross-expired','early_bird').replace("select hold_id||'|'||state", 'select hold_id'), 'expired cross-tier hold does not conflict')
equal(`select tier from payment_v2_holds where id='${crossFresh}'`, 'early_bird', 'new cross-tier hold is Early Bird')
equal(`select state from payment_v2_holds where id='${crossExpired}'`, 'EXPIRED_UNPAID', 'old OG hold is expired')
equal(`select (tier='early_bird' and state='HELD' and stripe_checkout_session_id is null and expires_at>now())::text from payment_v2_holds where id='${crossFresh}'`, 'true', 'new cross-tier hold is live Early Bird')
equal(`select count(*) from payment_v2_holds where purchaser_credential_hash=${hash('cross-expired')} and ((state='HELD' and expires_at>now()) or state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))`, 1, 'exactly one cross-tier effective hold remains')
const protectedId = ok(acquire('cross-protected','og_throne').replace("select hold_id||'|'||state", 'select hold_id'), 'create associated cross-tier hold')
equal(`select payment_v2_associate_session('${protectedId}',${hash('cross-protected')},'cs_protected')`, 'associated', 'associate protected hold')
failsWith(acquire('cross-protected','early_bird'), /ERROR:\s+effective_hold_conflict\b/, 'associated cross-tier hold remains protected')

ok("truncate payment_v2_reconciliation_evidence,payment_v2_allocations,payment_v2_purchases,payment_v2_holds cascade", 'reset for capacity concurrency')
const ogBurst = await boundedConcurrent(Array.from({length:75},(_,i)=>acquire(`og-${i}`,'og_throne')))
assertCapacityResults(ogBurst, 50, 'OG')
equal("select count(*) from payment_v2_holds where tier='og_throne' and ((state='HELD' and expires_at>now()) or state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))",50,'OG capacity is exactly 50 and never above capacity')
ok('truncate payment_v2_holds cascade','reset OG holds')
const ebBurst = await boundedConcurrent(Array.from({length:160},(_,i)=>acquire(`eb-${i}`,'early_bird')))
assertCapacityResults(ebBurst, 120, 'Early Bird')
equal("select count(*) from payment_v2_holds where tier='early_bird' and ((state='HELD' and expires_at>now()) or state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'))",120,'Early Bird capacity is exactly 120 and never above capacity')
ok('truncate payment_v2_holds cascade','reset Early Bird holds')
const sameCross = await concurrent([acquire('same-cross','og_throne'),acquire('same-cross','early_bird')])
assert.equal(sameCross.filter(r=>r.ok).length,1,'same-purchaser cross-tier concurrency creates at most one hold'); assertions++
assert.equal(sameCross.filter(r=>!r.ok).every(r=>/ERROR:\s+effective_hold_conflict\b/.test(r.err)),true,'cross-tier concurrency loser is effective_hold_conflict'); assertions++

ok('truncate payment_v2_holds cascade','reset state tests')
const localExpireHold = ok(acquire('local-expire','og_throne').replace("select hold_id||'|'||state",'select hold_id'),'create local-expiration hold')
ageUnassociatedHold(localExpireHold, 'coherently age local-expiration hold')
equal(`select payment_v2_expire_unpaid('${localExpireHold}')`,'expired','local expiration succeeds for an aged unassociated hold')
equal(`select payment_v2_expire_unpaid('${localExpireHold}')`,'already_expired','local expiration exact replay is idempotent')
const stateHold = ok(acquire('state','og_throne').replace("select hold_id||'|'||state",'select hold_id'),'create state hold')
equal(`select payment_v2_associate_session('${stateHold}',${hash('state')},'cs_state')`,'associated','Session association succeeds')
equal(`select payment_v2_associate_session('${stateHold}',${hash('state')},'cs_state')`,'already_associated','Session exact replay is idempotent')
failsWith(`select payment_v2_associate_session('${stateHold}',${hash('state')},'cs_other')`,/ERROR:\s+session_conflict\b/,'Session replacement fails')
failsWith(`select payment_v2_expire_unpaid('${stateHold}')`,/ERROR:\s+not_expirable\b/,'local expiration cannot expire associated hold')
equal(`select payment_v2_record_session_unpaid_terminal('${stateHold}','cs_state','SESSION_EXPIRED_UNPAID','evt_expire',now())`,'expired','provider-confirmed expiration succeeds')
equal(`select payment_v2_record_session_unpaid_terminal('${stateHold}','cs_state','SESSION_EXPIRED_UNPAID','evt_expire',(select occurred_at from payment_v2_reconciliation_evidence where provider_event_id='evt_expire'))`,'already_recorded','provider-event exact replay is idempotent')
failsWith(`select payment_v2_record_session_unpaid_terminal('${stateHold}','cs_wrong','SESSION_EXPIRED_UNPAID','evt_expire',(select occurred_at from payment_v2_reconciliation_evidence where provider_event_id='evt_expire'))`,/ERROR:\s+provider_event_conflict\b/,'same provider event with wrong Session conflicts')
failsWith(`select payment_v2_record_session_unpaid_terminal(gen_random_uuid(),'cs_state','SESSION_EXPIRED_UNPAID','evt_expire',(select occurred_at from payment_v2_reconciliation_evidence where provider_event_id='evt_expire'))`,/ERROR:\s+provider_event_conflict\b/,'same provider event with wrong hold conflicts')
failsWith(`select payment_v2_record_session_unpaid_terminal('${stateHold}','cs_state','PAYMENT_CANCELED_UNPAID','evt_expire',(select occurred_at from payment_v2_reconciliation_evidence where provider_event_id='evt_expire'))`,/ERROR:\s+provider_event_conflict\b/,'same provider event with wrong kind conflicts')
failsWith(`select payment_v2_record_session_unpaid_terminal('${stateHold}','cs_state','SESSION_EXPIRED_UNPAID','evt_expire',(select occurred_at+interval '1 second' from payment_v2_reconciliation_evidence where provider_event_id='evt_expire'))`,/ERROR:\s+provider_event_conflict\b/,'same provider event with changed timestamp conflicts')
failsWith(`select payment_v2_record_session_unpaid_terminal('${stateHold}','cs_state','SESSION_EXPIRED_UNPAID','evt_other',now())`,/ERROR:\s+invalid_state\b/,'conflicting provider replay fails')
const cancelHold = ok(acquire('cancel','early_bird').replace("select hold_id||'|'||state",'select hold_id'),'create cancellation hold')
ok(`select payment_v2_associate_session('${cancelHold}',${hash('cancel')},'cs_cancel')`,'associate cancellation hold')
equal(`select payment_v2_record_session_unpaid_terminal('${cancelHold}','cs_cancel','PAYMENT_CANCELED_UNPAID','evt_cancel',now())`,'canceled','provider-confirmed cancellation succeeds')

const paidHold = ok(acquire('paid','og_throne').replace("select hold_id||'|'||state",'select hold_id'),'create paid hold')
ok(`select payment_v2_associate_session('${paidHold}',${hash('paid')},'cs_paid')`,'associate paid hold')
failsWith(`select payment_v2_record_paid('${paidHold}',${hash('paid')},'cs_paid','cus_paid','price_wrong','pi_paid',null,'evt_wrong_price',now())`,/ERROR:\s+price_mismatch\b/,'wrong Price cannot create paid state')
equal(`select state from payment_v2_holds where id='${paidHold}'`,'SESSION_ASSOCIATED','wrong Price leaves hold unchanged')
failsWith(`select payment_v2_record_paid('${paidHold}',${hash('paid')},'cs_paid','cus_paid','price_og',null,null,'evt_no_pi',now())`,/ERROR:\s+provider_identity_mismatch\b/,'OG requires PaymentIntent')
const noSubHold=ok(acquire('no-sub','early_bird').replace("select hold_id||'|'||state",'select hold_id'),'create Early Bird identity hold')
ok(`select payment_v2_associate_session('${noSubHold}',${hash('no-sub')},'cs_no_sub')`,'associate Early Bird identity hold')
failsWith(`select payment_v2_record_paid('${noSubHold}',${hash('no-sub')},'cs_no_sub','cus_sub','price_early',null,null,'evt_no_sub',now())`,/ERROR:\s+provider_identity_mismatch\b/,'Early Bird requires Subscription')
equal(`select payment_v2_record_paid('${paidHold}',${hash('paid')},'cs_paid','cus_paid','price_og','pi_paid',null,'evt_paid',timestamp '2026-08-01 00:00:00+00')`,'recorded','correct evidence creates paid-unclaimed')
equal(`select count(*) from payment_v2_purchases where hold_id='${paidHold}' and state='PAID_UNCLAIMED'`,1,'exactly one paid-unclaimed purchase exists')
failsWith(`select payment_v2_expire_unpaid('${paidHold}')`,/ERROR:\s+paid_purchase_exists\b/,'paid purchase cannot be locally expired')
failsWith(`select payment_v2_record_session_unpaid_terminal('${paidHold}','cs_paid','PAYMENT_CANCELED_UNPAID','evt_paid_cancel',now())`,/ERROR:\s+paid_purchase_exists\b/,'paid purchase cannot be provider-canceled')
equal(`select count(*) from payment_v2_purchases where hold_id='${noSubHold}'`,0,'redirect or absent provider evidence cannot create paid state')

const purchaseId=ok(`select id from payment_v2_purchases where hold_id='${paidHold}'`,'load paid purchase')
equal(`select payment_v2_claim('${purchaseId}',${hash('paid')},'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')`,'claimed','first authenticated claim succeeds')
equal(`select (select count(*) from payment_v2_allocations where purchase_id='${purchaseId}')||'|'||(select count(*) from user_subscriptions where user_id='10000000-0000-0000-0000-000000000001' and tier_name='og_throne')`,'1|1','claim creates one allocation and entitlement')
equal(`select payment_v2_claim('${purchaseId}',${hash('paid')},'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')`,'already_claimed','same-profile replay is idempotent')
failsWith(`select payment_v2_claim('${purchaseId}',${hash('paid')},'10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002')`,/ERROR:\s+claimed_by_other_profile\b/,'different-profile replay fails')

const conflictHold=ok(acquire('conflict','early_bird').replace("select hold_id||'|'||state",'select hold_id'),'create conflicting entitlement purchase')
ok(`select payment_v2_associate_session('${conflictHold}',${hash('conflict')},'cs_conflict')`,'associate conflict purchase')
ok(`select payment_v2_record_paid('${conflictHold}',${hash('conflict')},'cs_conflict','cus_new','price_early',null,'sub_new','evt_conflict',now())`,'record conflict purchase')
ok("insert into user_subscriptions(user_id,tier_id,tier_name,stripe_customer_id,stripe_subscription_id,status) values('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','early_bird','cus_old','sub_old','active')",'seed conflicting entitlement')
ok("update subscription_tiers set stripe_price_id='price_temporarily_missing' where name='early_bird'",'remove claim tier match')
failsWith(`select payment_v2_claim((select id from payment_v2_purchases where hold_id='${conflictHold}'),${hash('conflict')},'10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002')`,/ERROR:\s+claim_tier_ambiguous_or_missing\b/,'missing or wrong Price claim tier fails')
equal(`select state||'|'||(select count(*) from payment_v2_allocations where purchase_id=payment_v2_purchases.id) from payment_v2_purchases where hold_id='${conflictHold}'`,'PAID_UNCLAIMED|0','missing tier leaves no partial claim')
ok("update subscription_tiers set stripe_price_id='price_early' where name='early_bird'; insert into subscription_tiers values('00000000-0000-0000-0000-000000000022','early_bird','price_early',false)",'create duplicate matching tier')
failsWith(`select payment_v2_claim((select id from payment_v2_purchases where hold_id='${conflictHold}'),${hash('conflict')},'10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002')`,/ERROR:\s+claim_tier_ambiguous_or_missing\b/,'duplicate matching claim tiers fail')
ok("delete from subscription_tiers where id='00000000-0000-0000-0000-000000000022'",'remove duplicate tier')
failsWith(`select payment_v2_claim((select id from payment_v2_purchases where hold_id='${conflictHold}'),${hash('conflict')},'10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002')`,/ERROR:\s+conflicting_existing_entitlement\b/,'conflicting entitlement fails')
equal("select count(*) from user_subscriptions where user_id='10000000-0000-0000-0000-000000000002' and tier_name='early_bird'",1,'conflict creates no duplicate')
ok("insert into user_subscriptions(user_id,tier_id,tier_name,stripe_customer_id,stripe_subscription_id,status) values('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','early_bird','cus_new','sub_new','trialing')",'seed second active entitlement')
failsWith(`select payment_v2_claim((select id from payment_v2_purchases where hold_id='${conflictHold}'),${hash('conflict')},'10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002')`,/ERROR:\s+ambiguous_existing_entitlement\b/,'multiple existing entitlements fail')
equal(`select state||'|'||(select count(*) from payment_v2_allocations where purchase_id=payment_v2_purchases.id) from payment_v2_purchases where hold_id='${conflictHold}'`,'PAID_UNCLAIMED|0','entitlement failures leave no partial claim')
const compatibleHold=ok(acquire('compatible','early_bird').replace("select hold_id||'|'||state",'select hold_id'),'create compatible entitlement purchase')
ok(`select payment_v2_associate_session('${compatibleHold}',${hash('compatible')},'cs_compatible')`,'associate compatible purchase')
ok(`select payment_v2_record_paid('${compatibleHold}',${hash('compatible')},'cs_compatible','cus_compatible','price_early',null,'sub_compatible','evt_compatible',now())`,'record compatible purchase')
ok("insert into user_subscriptions(user_id,tier_id,tier_name,stripe_customer_id,stripe_subscription_id,status) values('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','early_bird','cus_compatible','sub_compatible','active'); update subscription_tiers set is_active=false where name='early_bird'",'seed compatible entitlement and deactivate launch tier')
equal(`select payment_v2_claim((select id from payment_v2_purchases where hold_id='${compatibleHold}'),${hash('compatible')},'10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004')`,'claimed','compatible existing entitlement is reused after tier deactivation')
equal(`select (select count(*) from user_subscriptions where user_id='10000000-0000-0000-0000-000000000004')||'|'||(select count(*) from payment_v2_allocations where purchase_id=(select id from payment_v2_purchases where hold_id='${compatibleHold}'))`,'1|1','compatible reuse creates one allocation and no duplicate entitlement')
failsWith(`select payment_v2_claim(gen_random_uuid(),${hash('none')},'10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003')`,/ERROR:\s+purchase_mismatch\b/,'claim before payment fails')
failsWith(`select * from payment_v2_acquire_hold(decode('00','hex'),'bad_tier',now()+interval '1 hour')`,/ERROR:\s+invalid_request\b/,'malformed hash and tier fail closed')
failsWith('select count(*) from payment_v2_holds',/ERROR:\s+permission denied for table payment_v2_holds\b/,'anon cannot read ledgers','anon')
failsWith(`select * from payment_v2_acquire_hold(${hash('anon')},'og_throne',now()+interval '1 hour')`,/ERROR:\s+permission denied for function payment_v2_acquire_hold\b/,'authenticated cannot execute RPC','authenticated')
equal("select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'payment_v2_%'",'t','service_role can execute every V2 RPC')
equal("select bool_and(not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'payment_v2_%'",'t','browser roles cannot execute any V2 RPC')
equal("select bool_and(has_table_privilege('service_role',c.oid,'SELECT') and not has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE')) from pg_class c where c.relnamespace='public'::regnamespace and c.relname like 'payment_v2_%' and c.relkind='r'",'t','service_role has read-only ledger access')
failsWith("insert into payment_v2_holds(purchaser_credential_hash,tier,expires_at) values(decode(repeat('00',32),'hex'),'og_throne',now()+interval '1 hour')",/ERROR:\s+permission denied for table payment_v2_holds\b/,'service_role cannot directly insert ledger rows','service_role')
failsWith("update payment_v2_holds set updated_at=now()",/ERROR:\s+permission denied for table payment_v2_holds\b/,'service_role cannot directly update ledger rows','service_role')
failsWith("delete from payment_v2_holds",/ERROR:\s+permission denied for table payment_v2_holds\b/,'service_role cannot directly delete ledger rows','service_role')
equal("select bool_and(not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) from pg_class c where c.relnamespace='public'::regnamespace and c.relname like 'payment_v2_%' and c.relkind='r'",'t','browser roles cannot read or mutate any ledger')
equal("select count(*) from user_subscriptions where metadata->>'internal_admin'='true'",1,'internal admin row remains separate from V2 capacity')



// PFC-07E-A1 inbox schema, receipt, transition, security and evidence uniqueness.
equal("select count(*) from information_schema.columns where table_schema='public' and table_name='payment_v2_provider_event_inbox' and column_name in ('id','provider_event_id','provider_event_type','provider_object_id','provider_object_type','provider_created_at','received_at','raw_payload_sha256','lifecycle_phase','processing_status','attempt_count','last_attempt_at','processed_at','last_error_code','lifecycle_version','created_at','updated_at')",17,'inbox table has all required columns')
failsWith("select raw_payload from payment_v2_provider_event_inbox",/ERROR:\s+column \"raw_payload\" does not exist\b/,'raw payload is not stored','service_role')
equal("select count(*) from pg_indexes where schemaname='public' and tablename='payment_v2_provider_event_inbox' and indexname in ('payment_v2_provider_event_inbox_provider_event_id_key','payment_v2_inbox_status_received_at','payment_v2_inbox_type_status_received_at','payment_v2_inbox_object')",4,'inbox unique and lookup indexes exist')
equal("select payment_v2_inbox_receive_event('evt_a1','refund.created','re_a1','refund',timestamp '2026-08-05 00:00:00+00',repeat('a',64),'PFC-07E-A2',1)",'RECEIVED','new inbox event inserts RECEIVED')
equal("select processing_status from payment_v2_provider_event_inbox where provider_event_id='evt_a1'",'RECEIVED','new inbox row durable status is RECEIVED')
equal("select payment_v2_inbox_receive_event('evt_a1','refund.created','re_a1','refund',timestamp '2026-08-05 00:00:00+00',repeat('a',64),'PFC-07E-A2',1)",'RECEIVED','exact inbox replay returns durable status')
failsWith("select payment_v2_inbox_receive_event('evt_a1','refund.updated','re_a1','refund',timestamp '2026-08-05 00:00:00+00',repeat('a',64),'PFC-07E-A2',1)",/ERROR:\s+inbox_event_conflict\b/,'immutable inbox conflict raises stable error')
equal("select provider_event_type||'|'||raw_payload_sha256 from payment_v2_provider_event_inbox where provider_event_id='evt_a1'",'refund.created|'+ 'a'.repeat(64),'immutable fields remain unchanged after conflict')
equal("select payment_v2_inbox_transition_status('evt_a1','RECEIVED','PENDING_PHASE',null,false)",'PENDING_PHASE','RECEIVED to PENDING_PHASE succeeds')
failsWith("select payment_v2_inbox_transition_status('evt_a1','RECEIVED','PROCESSED',null,false)",/ERROR:\s+inbox_status_mismatch\b/,'expected status mismatch fails')
equal("select payment_v2_inbox_receive_event('evt_retry','invoice.paid','in_retry','invoice',timestamp '2026-08-05 00:01:00+00',repeat('b',64),'PFC-07E-A3',1)",'RECEIVED','insert retry fixture')
equal("select payment_v2_inbox_transition_status('evt_retry','RECEIVED','PENDING_RETRY','RETRYABLE',true)",'PENDING_RETRY','RECEIVED to PENDING_RETRY succeeds with attempt')
equal("select (attempt_count=1 and last_attempt_at is not null and processed_at is null)::text from payment_v2_provider_event_inbox where provider_event_id='evt_retry'",'true','attempt_count and last_attempt_at set only for counted attempt')
equal("select payment_v2_inbox_transition_status('evt_retry','PENDING_RETRY','PENDING_RETRY','RETRYABLE',true)",'PENDING_RETRY','PENDING_RETRY self transition succeeds')
equal("select attempt_count from payment_v2_provider_event_inbox where provider_event_id='evt_retry'",2,'self transition increments attempts')
equal("select payment_v2_inbox_transition_status('evt_retry','PENDING_RETRY','PROCESSED',null,false)",'PROCESSED','PENDING_RETRY can become PROCESSED')
equal("select (processed_at is not null)::text from payment_v2_provider_event_inbox where provider_event_id='evt_retry'",'true','processed_at set for terminal status')
failsWith("select payment_v2_inbox_transition_status('evt_retry','PROCESSED','FAILED_TERMINAL',null,false)",/ERROR:\s+inbox_terminal_status\b/,'terminal statuses cannot transition')
failsWith("select payment_v2_inbox_receive_event('evt_bad','invoice.paid','in_bad','invoice',timestamp '2026-08-05 00:01:00+00',repeat('z',64),'PFC-07E-A3',1)",/ERROR:\s+invalid_request\b/,'invalid sha fails validation')
failsWith("select payment_v2_inbox_receive_event('evt_bad2','invoice.paid','in_bad','invoice',timestamp '2026-08-05 00:01:00+00',repeat('c',64),'PFC-07E-A1',1)",/ERROR:\s+invalid_request\b/,'invalid lifecycle phase fails validation')
equal("select relrowsecurity::text from pg_class where oid='public.payment_v2_provider_event_inbox'::regclass",'true','inbox RLS enabled')
equal("select count(*) from pg_policies where schemaname='public' and tablename='payment_v2_provider_event_inbox'",0,'inbox has no public RLS policies')
failsWith("select count(*) from payment_v2_provider_event_inbox",/ERROR:\s+permission denied for table payment_v2_provider_event_inbox\b/,'anon cannot read inbox','anon')
failsWith("select count(*) from payment_v2_provider_event_inbox",/ERROR:\s+permission denied for table payment_v2_provider_event_inbox\b/,'authenticated cannot read inbox','authenticated')
equal("select has_table_privilege('service_role','public.payment_v2_provider_event_inbox','SELECT')::text",'true','service_role can select inbox')
equal("select has_table_privilege('service_role','public.payment_v2_provider_event_inbox','INSERT,UPDATE,DELETE')::text",'false','service_role has no direct inbox mutation privileges')
failsWith("insert into payment_v2_provider_event_inbox(provider_event_id,provider_event_type,provider_object_id,provider_object_type,provider_created_at,raw_payload_sha256,lifecycle_phase,processing_status) values('evt_direct','refund.created','re_direct','refund',now(),repeat('d',64),'PFC-07E-A2','RECEIVED')",/ERROR:\s+permission denied for table payment_v2_provider_event_inbox\b/,'service_role cannot directly insert inbox','service_role')
equal("select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('payment_v2_inbox_receive_event','payment_v2_inbox_transition_status')",'t','service_role can execute inbox RPCs')
equal("select bool_and(not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('payment_v2_inbox_receive_event','payment_v2_inbox_transition_status')",'t','browser roles cannot execute inbox RPCs')
equal("select bool_and(r.rolname='postgres' and p.prosecdef and array_to_string(p.proconfig,',') like '%search_path=public, pg_temp%') from pg_proc p join pg_roles r on r.oid=p.proowner where p.pronamespace='public'::regnamespace and p.proname in ('payment_v2_inbox_receive_event','payment_v2_inbox_transition_status')",'t','inbox RPCs are postgres-owned SECURITY DEFINER with fixed search_path')
equal("select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relname='payment_v2_reconciliation_evidence' and c.contype='u' and (select array_agg(a.attname order by x.ord) from unnest(c.conkey) with ordinality as x(attnum,ord) join pg_attribute a on a.attrelid=t.oid and a.attnum=x.attnum)=array['hold_id','event_kind']::name[]",0,'global hold_id event_kind unique constraint no longer exists')
equal("select count(*) from pg_indexes where schemaname='public' and tablename='payment_v2_reconciliation_evidence' and indexname in ('payment_v2_evidence_one_payment_confirmed_per_hold','payment_v2_evidence_one_session_expired_unpaid_per_hold','payment_v2_evidence_one_payment_canceled_unpaid_per_hold','payment_v2_evidence_one_claimed_per_hold','payment_v2_one_provider_event')",5,'one-time evidence and provider event indexes exist')
failsWith(`insert into payment_v2_reconciliation_evidence(hold_id,purchase_id,stripe_checkout_session_id,event_kind,provider_event_id,occurred_at) values('${paidHold}','${purchaseId}','cs_paid','PAYMENT_CONFIRMED','evt_paid_dupe',now())`,/ERROR:\s+duplicate key value violates unique constraint "payment_v2_evidence_one_payment_confirmed_per_hold"/,'one PAYMENT_CONFIRMED per hold')
failsWith(`insert into payment_v2_reconciliation_evidence(hold_id,purchase_id,event_kind,occurred_at) values('${paidHold}','${purchaseId}','CLAIMED',now())`,/ERROR:\s+duplicate key value violates unique constraint "payment_v2_evidence_one_claimed_per_hold"/,'one CLAIMED per hold')
failsWith(`insert into payment_v2_reconciliation_evidence(hold_id,stripe_checkout_session_id,event_kind,provider_event_id,occurred_at) values('${stateHold}','cs_state','SESSION_EXPIRED_UNPAID','evt_expire_dupe',now())`,/ERROR:\s+duplicate key value violates unique constraint "payment_v2_evidence_one_session_expired_unpaid_per_hold"/,'one SESSION_EXPIRED_UNPAID per hold')
failsWith(`insert into payment_v2_reconciliation_evidence(hold_id,stripe_checkout_session_id,event_kind,provider_event_id,occurred_at) values('${cancelHold}','cs_cancel','PAYMENT_CANCELED_UNPAID','evt_cancel_dupe',now())`,/ERROR:\s+duplicate key value violates unique constraint "payment_v2_evidence_one_payment_canceled_unpaid_per_hold"/,'one PAYMENT_CANCELED_UNPAID per hold')
failsWith(`insert into payment_v2_reconciliation_evidence(hold_id,purchase_id,stripe_checkout_session_id,event_kind,provider_event_id,occurred_at) values('${paidHold}','${purchaseId}','cs_paid','PAYMENT_CONFIRMED','evt_paid',now())`,/ERROR:\s+duplicate key value violates unique constraint "payment_v2_one_provider_event"/,'provider_event_id remains unique')
equal("select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relname='payment_v2_reconciliation_evidence' and pg_get_constraintdef(c.oid) like '%REFUND%'",0,'no future lifecycle event kinds added')
equal("select count(*) >= 4 from payment_v2_reconciliation_evidence",'t','existing evidence rows preserved after migration')


console.log(`Payment-first V2 PostgreSQL integration passed (${assertions} assertions; OG attempts=75; Early Bird attempts=160; max simultaneous connections=${MAX_CONCURRENT_CONNECTIONS})`)
