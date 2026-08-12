import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { LAUNCH_CAPACITY } from '../../../lib/launch-capacity'
import { calculatePaymentV2Inventory, PAYMENT_V2_PUBLIC_CAPACITY } from '../../../lib/payment-v2/inventory'

let assertions=0
const equal=(actual:unknown,expected:unknown,message:string)=>{assert.deepEqual(actual,expected,message);assertions++}
const match=(text:string,re:RegExp,message:string)=>{assert.match(text,re,message);assertions++}
const absent=(text:string,re:RegExp,message:string)=>{assert.doesNotMatch(text,re,message);assertions++}
const now=new Date('2026-08-12T12:00:00Z')
const row=(tier:'og_throne'|'early_bird',state:string,expires_at:string|null=null)=>({tier,state,expires_at})

equal(LAUNCH_CAPACITY,{beta_reserved:25,og_throne:50,early_bird:150},'canonical contract')
equal(PAYMENT_V2_PUBLIC_CAPACITY,{og_throne:50,early_bird:150},'beta reservation does not reduce sales')
equal(calculatePaymentV2Inventory([],now),{og_throne:{max_slots:50,slots_remaining:50},early_bird:{max_slots:150,slots_remaining:150}},'zero holds')
equal(calculatePaymentV2Inventory([row('early_bird','EXPIRED_UNPAID')],now).early_bird.slots_remaining,150,'expired unpaid does not consume')
equal(calculatePaymentV2Inventory([row('og_throne','HELD','2026-08-12T12:01:00Z')],now).og_throne.slots_remaining,49,'live HELD consumes')
equal(calculatePaymentV2Inventory([row('og_throne','HELD','2026-08-12T11:59:00Z')],now).og_throne.slots_remaining,50,'expired HELD does not consume')
for(const state of ['SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED']) equal(calculatePaymentV2Inventory([row('early_bird',state)],now).early_bird.slots_remaining,149,`${state} consumes`)
equal(calculatePaymentV2Inventory([],now).og_throne.slots_remaining,50,'legacy fixtures are outside inventory row input')
equal(calculatePaymentV2Inventory(Array.from({length:50},()=>row('og_throne','CLAIMED')),now).og_throne.slots_remaining,0,'OG sold out at 50')
equal(calculatePaymentV2Inventory(Array.from({length:150},()=>row('early_bird','CLAIMED')),now).early_bird.slots_remaining,0,'Early Bird sold out at 150')
assert.throws(()=>calculatePaymentV2Inventory(Array.from({length:151},()=>row('early_bird','CLAIMED')),now),/inventory_unavailable/);assertions++

const pricing=readFileSync('app/pricing/PricingClient.tsx','utf8')
const route=readFileSync('app/api/subscription/seat-count/route.ts','utf8')
const migration=readFileSync('supabase/migrations/20260812090000_lock05f_launch_inventory_reset.sql','utf8')
const previous=readFileSync('supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql','utf8')
const backup=readFileSync('supabase/manual/lock05f_legacy_og_cleanup_backup.sql','utf8')
const cleanup=readFileSync('supabase/manual/lock05f_legacy_og_cleanup_delete.sql','utf8')
const workflow=readFileSync('.github/workflows/lock05f-launch-inventory.yml','utf8')
const postgresRunner=readFileSync('backend/payment-v2/tests/runLock05fLaunchInventoryPostgres.mjs','utf8')
match(pricing,/ebTotal !== 150[\s\S]*ebRemaining > 150/,'client validates 150')
match(pricing,/150 total seats/g,'pricing copy says 150 seats')
match(route,/calculatePaymentV2Inventory\(holdsQuery\.data/,'endpoint calculates V2 inventory')
absent(route,/slots_remaining[^\n]*select|select\([^)]*slots_remaining/,'endpoint never reads stale remaining bookkeeping')
match(migration,/slots_remaining=50-og_used[\s\S]*slots_remaining=150-early_used/,'bookkeeping derives from consumption')
absent(migration,/stripe_price_id\s*=/,'migration preserves Stripe prices')
match(migration,/when 'og_throne' then 50 else 150 end/,'database limits 50 and 150')
const oldFn=previous.slice(previous.indexOf('create function public.payment_v2_acquire_hold'),previous.indexOf('\n\nrevoke all on function public.payment_v2_record_paid'))
const newFn=migration.slice(migration.indexOf('create or replace function public.payment_v2_acquire_hold'),migration.indexOf('\n\nALTER FUNCTION'))
const normalize=(s:string)=>s.replace('create or replace function','create function').replace('else 150 end','else 120 end')
equal(normalize(newFn),oldFn,'acquire_hold differs only by capacity and replace syntax')
const historical=execFileSync('git',['diff','--name-only','e47e641048b48ed858b9fe21af7c0169fe0575c2','--','supabase/migrations',':(exclude)supabase/migrations/20260812090000_lock05f_launch_inventory_reset.sql'],{encoding:'utf8'}).trim()
equal(historical,'','historical migrations unchanged')
absent(backup,/encrypted_password|recovery_token|confirmation_token|refresh_token|mfa|oauth/i,'backup excludes auth credentials')
match(backup,/to_jsonb\(p\)-'password_hash'/,'backup strips password hash')
for(const sql of [backup,cleanup]){match(sql,/admin@sirensforge\.vip/,'admin email protected');match(sql,/879c8a17-f9e8-473d-8de1-1fd1a77c080e/,'admin UUID protected');match(sql,/count\(\*\).*<>21/s,'exact target count required');match(sql,/payment_v2_(purchases|relationship)/,'Payment V2 relationship guard')}
match(cleanup,/(creator\|publishing\|platform\|autopost\|generation\|lora\|dataset\|crypto\|commission\|payout\|affiliate\|referral)/,'meaningful dependencies guarded')
match(cleanup,/protected_admin_postcondition_failed/,'admin survival verified')
absent(backup+cleanup,/insert[^;]*(is_beta_tester|auth\.users)/i,'no beta users created')
match(workflow,/fetch-depth: 0/,'CI fetches the baseline commit')
match(workflow,/image: postgres:15[\s\S]*npm run test:lock05f-postgres/,'CI runs PostgreSQL 15 integration')
absent(workflow,/\bpush:/,'CI has no stale branch push trigger')
match(backup,/extensions\.digest/,'backup pins Production pgcrypto schema')
for(const sql of [backup,cleanup]) match(sql,/protected_admin_subscription_precondition/,'retained admin subscription is a precondition')
match(postgresRunner,/Early Bird seat 151 rejected[\s\S]*OG hold 51 rejected/,'PostgreSQL runner exercises both sold-out boundaries')
match(postgresRunner,/lock05f_legacy_og_cleanup_backup\.sql[\s\S]*lock05f_legacy_og_cleanup_delete\.sql/,'PostgreSQL runner executes both manual artifacts')
console.log(`LOCK-05F focused tests passed (${assertions} assertions)`)
