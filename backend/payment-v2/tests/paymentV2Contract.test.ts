import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const migrationPath = 'supabase/migrations/20260801002800_payment_first_v2_contract.sql'
const sql = readFileSync(migrationPath, 'utf8')
const foundationSql = readFileSync('supabase/migrations/20260805002900_payment_v2_lifecycle_foundation.sql', 'utf8')
const inboxTableSql = foundationSql.slice(foundationSql.indexOf('create table public.payment_v2_provider_event_inbox'), foundationSql.indexOf('create index payment_v2_inbox_status_received_at'))
const acquireSql = sql.slice(sql.indexOf('create function public.payment_v2_acquire_hold'), sql.indexOf('create function public.payment_v2_associate_session'))
let assertions = 0
const matches = (pattern: RegExp, message: string) => { assert.match(sql, pattern, message); assertions++ }
const absent = (pattern: RegExp, message: string) => { assert.doesNotMatch(sql, pattern, message); assertions++ }

matches(/tier in \('og_throne', 'early_bird'\)/, 'only launch tiers are accepted')
absent(/prime_access/, 'prime access is excluded')
matches(/when 'og_throne' then 50 else 120 end/, 'fixed public limits are 50 and 120')
matches(/payment_v2_credential:[\s\S]*?payment_v2_capacity:early_bird[\s\S]*?payment_v2_capacity:og_throne/, 'credential and tier locks use deterministic order')
matches(/h\.state='HELD' and h\.expires_at>now\(\)/, 'HELD consumes capacity only before expiration')
assert.doesNotMatch(acquireSql, /user_subscriptions/, 'capacity never reads legacy/admin entitlements'); assertions++
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
matches(/SESSION_EXPIRED_UNPAID[^;]+PAYMENT_CANCELED_UNPAID/, 'associated release requires provider event kinds')
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
matches(/revoke all on table[^;]+service_role[\s\S]*?grant select on table[^;]+to service_role/, 'service role has read-only direct ledger access')
matches(/v_evidence\.stripe_checkout_session_id=p_session_id/, 'provider replay requires exact Session identity')
matches(/claim_tier_ambiguous_or_missing/, 'claim requires exactly one tier and Price match')
matches(/authoritative_tier_ambiguous_or_inactive[\s\S]*?price_mismatch/, 'paid recording validates one active authoritative Price')
matches(/ambiguous_existing_entitlement[\s\S]*?conflicting_existing_entitlement/, 'claim fails closed for unsafe existing entitlements')
matches(/pg_notify\('pgrst', 'reload schema'\)/, 'migration reloads the PostgREST schema')
absent(/email|ip_address|raw_payload|token\b/i, 'no email, IP, raw provider dump, or raw token column exists')

assert.match(foundationSql, /create table public\.payment_v2_provider_event_inbox/, 'A1 creates provider event inbox'); assertions++
assert.match(foundationSql, /provider_event_id text not null unique/, 'inbox provider event id is unique'); assertions++
assert.match(foundationSql, /raw_payload_sha256 text not null/, 'inbox stores only raw payload hash'); assertions++
assert.doesNotMatch(inboxTableSql, /raw_payload(?!_sha256)|payload json|purchase_id uuid|hold_id uuid|refund_id|subscription_id|invoice_id|dispute_id/i, 'A1 inbox has no raw payload or lifecycle mapping columns'); assertions++
assert.match(foundationSql, /payment_v2_inbox_receive_event/, 'A1 receive RPC exists'); assertions++
assert.match(foundationSql, /payment_v2_inbox_transition_status/, 'A1 transition RPC exists'); assertions++
assert.match(foundationSql, /inbox_event_conflict/, 'immutable inbox conflicts use stable exception'); assertions++
assert.match(foundationSql, /RECEIVED[\s\S]*PENDING_PHASE[\s\S]*PENDING_PURCHASE[\s\S]*PENDING_RETRY[\s\S]*PROCESSED[\s\S]*IGNORED_NON_V2[\s\S]*FAILED_TERMINAL/, 'status taxonomy is present'); assertions++
assert.match(foundationSql, /payment_v2_evidence_one_payment_confirmed_per_hold/, 'payment confirmed one-time evidence index exists'); assertions++
assert.match(foundationSql, /payment_v2_evidence_one_session_expired_unpaid_per_hold/, 'session expired one-time evidence index exists'); assertions++
assert.match(foundationSql, /payment_v2_evidence_one_payment_canceled_unpaid_per_hold/, 'payment canceled one-time evidence index exists'); assertions++
assert.match(foundationSql, /payment_v2_evidence_one_claimed_per_hold/, 'claimed one-time evidence index exists'); assertions++
assert.doesNotMatch(foundationSql, /REFUND_|INVOICE_|DISPUTE_|ENDED|SUSPENDED/, 'A1 does not add future lifecycle event kinds or terminal states'); assertions++


const changedHistorical = execFileSync('git', ['diff', '--name-only', '3b4e77922e5c3b64fc31418df0aeb047b134694f', '--', 'supabase/migrations/20260729002100_checkout_capacity_reservations.sql', 'supabase/migrations/20260729002200_pay_first_checkout_claims.sql', 'supabase/migrations/20260729002300_fix_guest_checkout_reservation_ambiguity.sql', 'supabase/migrations/20260730002400_safe_guest_checkout_plan_switch.sql', 'supabase/migrations/20260730002500_reload_checkout_rpc_schema.sql', 'supabase/migrations/20260730002600_restore_guest_checkout_acquire_contract.sql', 'supabase/migrations/20260731002700_remove_checkout_incident_objects.sql'], { encoding: 'utf8' }).trim()
assert.equal(changedHistorical, '', 'migrations 02100 through 02700 remain byte-for-byte unchanged'); assertions++

console.log(`Payment-first V2 contract tests passed (${assertions} assertions)`)
