import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path: string) => readFileSync(path, "utf8")
const migration = read("supabase/migrations/20260905110000_phase8f_legal_hold_lifecycle.sql")
const mfa = read("lib/security/mfa.ts")
const service = read("lib/governance/legalHolds.ts")
const registerRoute = read("app/api/admin/governance/legal-holds/route.ts")
const reviewRoute = read("app/api/admin/governance/legal-holds/[holdId]/review/route.ts")
const releaseRoute = read("app/api/admin/governance/legal-holds/[holdId]/release/route.ts")
const expiryRoute = read("app/api/internal/governance/legal-holds/expire/route.ts")

const adminRoutes = [registerRoute, reviewRoute, releaseRoute]

test("Phase 8F remains bounded to legal-hold lifecycle and excludes notification delivery", () => {
  assert.match(migration, /Phase 8F: legal-hold preservation, review, release, expiry reconciliation/)
  assert.doesNotMatch(migration, /\b(?:send_email|send_notification|deliver_notification)\s*\(/i)
  assert.doesNotMatch(migration, /cron\.schedule|pg_cron/i)
  assert.match(migration, /Production application requires separate explicit authorization/)
})

test("account-wide holds inherit through the central active-hold helper", () => {
  assert.match(migration, /target_type='account'[\s\S]*target_id is distinct from new\.subject_user_id::text/)
  assert.match(migration, /t\.target_type='account'[\s\S]*t\.target_id=p_subject_user_id::text/)
  assert.match(migration, /h\.status='active'[\s\S]*h\.expires_at>statement_timestamp\(\)/)
})

test("legal-hold review evidence is immutable, fresh-TOTP gated, and cannot shorten preservation", () => {
  assert.match(migration, /create table public\.governance_legal_hold_reviews/)
  assert.match(migration, /governance_legal_hold_reviews_reject_update_delete/)
  assert.match(migration, /phase8f_assert_founder_admin_fresh_totp/)
  assert.match(migration, /interval '10 minutes'/)
  assert.match(migration, /GOVERNANCE_LEGAL_HOLD_REVIEW_CANNOT_SHORTEN/)
  assert.match(migration, /legal_hold_reviewed/)
  assert.match(migration, /legal-hold-review-v1/)
})

test("expiry is bounded, audited as system action, and distinct from manual release", () => {
  assert.match(migration, /phase8f_expire_governance_legal_holds\(p_limit integer default 50\)/)
  assert.match(migration, /p_limit<1 or p_limit>100/)
  assert.match(migration, /for update skip locked/)
  assert.match(migration, /'system','legal_hold_expired'/)
  assert.match(migration, /GOVERNANCE_LEGAL_HOLD_EXPIRED/)
})

test("admin hold reads use an audited RPC instead of direct service-role table access", () => {
  assert.match(migration, /revoke select on table public\.governance_legal_holds from service_role/)
  assert.match(migration, /revoke select on table public\.governance_legal_hold_targets from service_role/)
  assert.match(migration, /list_governance_legal_holds_for_admin/)
  assert.match(migration, /legal_hold_register_read/)
  assert.match(migration, /grant execute on function public\.list_governance_legal_holds_for_admin[\s\S]*to service_role/)
})

test("fresh TOTP helper returns the authoritative AMR timestamp to high-risk routes", () => {
  assert.match(mfa, /const freshTotpMs = newestFreshTotpTimestamp/)
  assert.match(mfa, /freshTotpAt: new Date\(freshTotpMs\)\.toISOString\(\)/)
  assert.doesNotMatch(service, /p_fresh_auth_at:\s*new Date\(\)/)
  assert.match(service, /p_fresh_auth_at: args\.freshTotpAt/)
})

test("Founder/Admin legal-hold routes authenticate before creating a service-role client", () => {
  for (const route of adminRoutes) {
    assert.match(route, /requireAdminCapability\("governance\.legal_hold\.manage"\)/)
    assert.match(route, /mfa\.freshTotpAt/)
  }
  assert.match(service, /getSupabaseAdmin\(\)\.rpc\("open_governance_legal_hold"/)
  assert.match(service, /getSupabaseAdmin\(\)\.rpc\("review_governance_legal_hold"/)
  assert.match(service, /getSupabaseAdmin\(\)\.rpc\("release_governance_legal_hold"/)
  assert.match(service, /getSupabaseAdmin\(\)\.rpc\("list_governance_legal_holds_for_admin"/)
})

test("mutating legal-hold routes require strict idempotency and bounded inputs", () => {
  assert.match(registerRoute, /idempotency-key/)
  assert.match(reviewRoute, /idempotency-key/)
  assert.match(releaseRoute, /idempotency-key/)
  assert.match(service, /LEGAL_HOLD_IDEMPOTENCY_PATTERN/)
  assert.match(service, /targets\.length < 1 \|\| input\.targets\.length > 100/)
})

test("automatic expiry route is scheduler-secret controlled and no-store", () => {
  assert.match(expiryRoute, /authenticateSchedulerRequest/)
  assert.match(expiryRoute, /CRON_SECRET \|\| process\.env\.VERCEL_CRON_SECRET/)
  assert.match(expiryRoute, /expireLegalHolds\(50\)/)
  assert.match(expiryRoute, /private, no-store/)
})
