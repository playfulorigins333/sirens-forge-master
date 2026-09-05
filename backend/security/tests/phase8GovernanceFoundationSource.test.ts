import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync("supabase/migrations/20260905060000_phase8_governance_foundation.sql", "utf8")

test("Phase 8 foundation stays inside governance scope", () => {
  assert.match(migration, /create table public\.retention_policy_versions/)
  assert.match(migration, /create table public\.governance_audit_events/)
  assert.match(migration, /create table public\.governance_action_receipts/)
  assert.match(migration, /create table public\.governance_legal_holds/)
  assert.match(migration, /create table public\.governance_legal_hold_targets/)
  assert.doesNotMatch(migration, /send[_ ]?(email|notification)|deliver[_ ]?notification/i)
  assert.doesNotMatch(migration, /cron\.schedule|pg_cron|delete\s+from\s+auth\.users/i)
})

test("governance evidence is append-only and survives later Auth deletion", () => {
  for (const table of ["retention_policy_versions", "governance_audit_events", "governance_action_receipts", "governance_legal_hold_targets"]) {
    assert.match(migration, new RegExp(`create trigger ${table}[^\\n]*reject_update_delete|create trigger [^\\n]*${table}[^\\n]*\\nbefore update or delete`, "i"))
  }
  assert.match(migration, /before update or delete on public\.governance_audit_events/)
  assert.match(migration, /before update or delete on public\.governance_action_receipts/)
  assert.doesNotMatch(migration, /actor_user_id uuid[^\n]*references auth\.users/i)
  assert.doesNotMatch(migration, /subject_user_id uuid[^\n]*references auth\.users/i)
  assert.match(migration, /previous_event_hash text/)
  assert.match(migration, /event_hash text not null unique/)
  assert.match(migration, /pg_advisory_xact_lock/)
})

test("governance internals are not browser callable", () => {
  for (const fn of [
    "governance_jsonb_has_forbidden_private_key",
    "governance_actor_is_founder_admin",
    "append_governance_audit_event",
    "record_governance_action_receipt",
    "open_governance_legal_hold",
    "release_governance_legal_hold",
    "governance_target_has_active_legal_hold",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\(`, "i"))
  }
  assert.doesNotMatch(migration, /grant execute on function public\.[^(]+\([^;]+\) to (?:anon|authenticated)/i)
  assert.doesNotMatch(migration, /grant select on table public\.governance_audit_events to service_role/i)
})

test("Founder/Admin legal holds are finite, scoped, and fresh-auth protected", () => {
  assert.match(migration, /governance_actor_is_founder_admin/)
  assert.match(migration, /sole_production_admin_guard/)
  assert.match(migration, /GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED/)
  assert.match(migration, /p_fresh_auth_method<>'totp'/)
  assert.match(migration, /interval '10 minutes'/)
  assert.match(migration, /review_due_at > opened_at and expires_at >= review_due_at/)
  assert.match(migration, /t\.subject_user_id=p_subject_user_id/)
  assert.match(migration, /h\.expires_at>statement_timestamp\(\)/)
})

test("action receipts enforce creator ownership and admin-only private access", () => {
  assert.match(migration, /actor_type='creator' and actor_user_id=subject_user_id/)
  assert.match(migration, /actor_type='founder_admin' and receipt_type='admin_private_content_access'/)
  assert.match(migration, /GOVERNANCE_RECEIPT_ACTOR_SCOPE_INVALID/)
  assert.match(migration, /GOVERNANCE_RECEIPT_ADMIN_REQUIRED/)
  assert.match(migration, /statement_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(migration, /octet_length\(facts::text\)<=8192/)
})

test("retention policies are versioned without rewriting Phase 7 deadlines", () => {
  assert.match(migration, /private_generation_asset_trash[^\n]+interval '30 days'/)
  assert.match(migration, /twin_trash[^\n]+interval '30 days'/)
  assert.match(migration, /voluntary_account_deletion[^\n]+interval '60 days'/)
  assert.match(migration, /subscription_cancellation[^\n]+interval '60 days'/)
  assert.match(migration, /subscription_delinquency_after_second_miss[^\n]+interval '60 days'/)
  assert.doesNotMatch(migration, /update public\.(?:private_generation_assets|profiles|account_deletion_requests|subscription_cancellation_retentions|subscription_payment_delinquencies)/i)
})
