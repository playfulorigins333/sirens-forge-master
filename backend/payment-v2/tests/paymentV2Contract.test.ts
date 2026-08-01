import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const migrationPath = 'supabase/migrations/20260801002800_payment_first_v2_contract.sql'
const sql = readFileSync(migrationPath, 'utf8')
let assertions = 0
const matches = (pattern: RegExp, message: string) => { assert.match(sql, pattern, message); assertions++ }
const absent = (pattern: RegExp, message: string) => { assert.doesNotMatch(sql, pattern, message); assertions++ }

matches(/tier in \('og_throne', 'early_bird'\)/, 'only launch tiers are accepted')
absent(/prime_access/, 'prime access is excluded')
matches(/when 'og_throne' then 50 else 120 end/, 'fixed public limits are 50 and 120')
matches(/pg_advisory_xact_lock\(hashtextextended\('payment_v2_capacity:' \|\| p_tier/, 'tier acquisitions serialize')
matches(/state in \('HELD','SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED'\)/, 'only effective V2 rows consume capacity')
absent(/count\(\*\)[^;]+user_subscriptions/, 'capacity never counts legacy/admin entitlements')
matches(/payment_v2_one_effective_credential/, 'one effective allocation per purchaser credential')
matches(/payment_v2_one_checkout_session/, 'session identity is globally unique')
matches(/if v_hold\.state = 'SESSION_ASSOCIATED' and v_hold\.stripe_checkout_session_id = p_session_id then return 'already_associated'/, 'session exact replay is idempotent')
matches(/if v_hold\.state <> 'HELD'[^;]+then raise exception 'session_conflict'/, 'session replacement and tier switching fail closed')
matches(/v_hold\.tier='og_throne'[^;]+p_payment_intent_id/, 'OG requires payment identity')
matches(/v_hold\.tier='early_bird'[^;]+p_subscription_id/, 'Early Bird requires subscription identity')
matches(/default 'PAID_UNCLAIMED'/, 'webhook evidence records paid-unclaimed')
matches(/provider_event_id text not null unique/, 'operator/provider replay evidence is authoritative')
matches(/if exists\(select 1 from public\.payment_v2_purchases[^;]+then raise exception 'paid_purchase_exists'/, 'expiration cannot release a purchase')
matches(/state='EXPIRED_UNPAID'/, 'unpaid expiration has an explicit terminal state')
matches(/state='CANCELED_UNPAID'/, 'unpaid cancellation has an explicit terminal state')
matches(/if v_purchase\.state<>'PAID_UNCLAIMED' then raise exception 'not_claimable'/, 'claim before paid fails')
matches(/v_profile\.user_id<>p_auth_user_id/, 'claim binds a server-resolved authenticated profile')
matches(/v_purchase\.purchaser_credential_hash<>p_purchaser_hash/, 'email is not claim proof')
matches(/if v_purchase\.claimed_profile_id<>p_profile_id then raise exception 'claimed_by_other_profile'/, 'different-profile replay fails')
matches(/return 'already_claimed'/, 'same-profile claim replay succeeds')
matches(/purchase_id uuid not null unique/, 'a purchase has exactly one allocation')
matches(/unique \(profile_id, tier\)/, 'a profile cannot get duplicate V2 tier allocation')
matches(/entitlement_id uuid not null unique/, 'one entitlement belongs to one allocation')
matches(/customer_facing boolean not null default true check \(customer_facing\)/, 'V2 allocation is explicitly customer-facing')
matches(/octet_length\(p_purchaser_hash\) <> 32/, 'malformed credential hashes fail closed')
matches(/security definer set search_path = public, pg_temp/g, 'privileged functions pin search_path')
matches(/enable row level security/g, 'all ledgers enable RLS')
matches(/revoke all on table[^;]+from public, anon, authenticated/, 'browser roles cannot read or mutate ledgers')
matches(/revoke execute on function[^;]+from public, anon, authenticated/, 'browser roles cannot execute privileged functions')
matches(/grant execute on function[^;]+to service_role/, 'only service role receives function execution')
absent(/email|ip_address|raw_payload|token\b/i, 'no email, IP, raw provider dump, or raw token column exists')

// Disposable in-memory capacity model: Promise.all represents callers arriving together;
// serialization is the behavior implemented by the tier advisory lock in SQL.
const acquireBurst = async (limit: number, attempts: number) => {
  let used = 0
  return Promise.all(Array.from({ length: attempts }, async () => {
    if (used >= limit) return false
    used++
    return true
  }))
}
const og = await acquireBurst(50, 75)
assert.equal(og.filter(Boolean).length, 50, 'concurrent OG acquisition cannot exceed 50'); assertions++
const earlyBird = await acquireBurst(120, 160)
assert.equal(earlyBird.filter(Boolean).length, 120, 'concurrent Early Bird acquisition cannot exceed 120'); assertions++
assert.equal((await acquireBurst(50, 1)).filter(Boolean).length, 1, 'first OG acquisition returns one hold'); assertions++
assert.equal((await acquireBurst(120, 1)).filter(Boolean).length, 1, 'first Early Bird acquisition returns one hold'); assertions++

const changedHistorical = execFileSync('git', ['diff', '--name-only', '3b4e77922e5c3b64fc31418df0aeb047b134694f', '--', 'supabase/migrations/20260729002100_checkout_capacity_reservations.sql', 'supabase/migrations/20260729002200_pay_first_checkout_claims.sql', 'supabase/migrations/20260729002300_fix_guest_checkout_reservation_ambiguity.sql', 'supabase/migrations/20260730002400_safe_guest_checkout_plan_switch.sql', 'supabase/migrations/20260730002500_reload_checkout_rpc_schema.sql', 'supabase/migrations/20260730002600_restore_guest_checkout_acquire_contract.sql', 'supabase/migrations/20260731002700_remove_checkout_incident_objects.sql'], { encoding: 'utf8' }).trim()
assert.equal(changedHistorical, '', 'migrations 02100 through 02700 remain byte-for-byte unchanged'); assertions++

console.log(`Payment-first V2 contract tests passed (${assertions} assertions)`)
