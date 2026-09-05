import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260905090000_phase8_canceled_account_enforcement.sql", "utf8");
const runner = readFileSync("lib/retention/phase8d.ts", "utf8");
const route = readFileSync("app/api/internal/retention/phase8d/run/route.ts", "utf8");
const readGate = readFileSync("lib/creator-read-access.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");
const twinLifecycle = readFileSync("lib/twin-lifecycle.ts", "utf8");

test("cancellation enforcement keeps the locked sixty-day minimum and central policy authority", () => {
  assert.match(migration, /current_retention_policy\('subscription_cancellation'/);
  assert.match(migration, /retention_until\s*>?=\s*paid_access_ends_at\s*\+\s*interval '60 days'/i);
  assert.match(migration, /phase8d_claim_expired_canceled_accounts/);
  assert.match(migration, /retention_until<=statement_timestamp\(\)/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /p_limit>50/);
});

test("newer billing lifecycles supersede old cancellation purge authority", () => {
  assert.match(migration, /phase8d_canceled_retention_has_successor/);
  assert.match(migration, /active','trialing','past_due','unpaid/);
  assert.match(migration, /phase8d_supersede_canceled_retention/);
  assert.match(migration, /retention\.subscription_cancellation_superseded/);
  assert.match(migration, /phase8d_validate_canceled_account_purge/);
  assert.match(runner, /phase8d_validate_canceled_account_purge/g);
  assert.match(runner, /accountsSuperseded/);
});

test("destructive work is bounded to the old cancellation retention deadline", () => {
  assert.match(migration, /p\.created_at<=r\.retention_until/);
  assert.match(migration, /c\.created_at<=r\.retention_until/);
  assert.match(migration, /g\.created_at<=\(r\.retention_until at time zone 'UTC'\)/);
  assert.match(migration, /a\.created_at<=r\.retention_until/);
  assert.match(migration, /l\.created_at<=\(r\.retention_until at time zone 'UTC'\)/);
  assert.match(runner, /\.lte\("created_at", retentionUntil\)/);
});

test("legal holds preserve data but do not extend creator read access", () => {
  assert.match(migration, /subscription_cancellation_retention/);
  assert.match(migration, /governance_target_has_active_legal_hold\('subscription'/);
  assert.match(migration, /governance_target_has_active_legal_hold\('account'/);
  assert.match(migration, /phase8d_twin_purge_hold_guard/);
  assert.match(migration, /phase8c_private_media_governance_hold/);
  assert.match(readGate, /\.gt\("retention_until", now\)/);
  assert.doesNotMatch(readGate, /legal.?hold/i);
});

test("runner reuses controlled binary purge authorities instead of direct storage credentials", () => {
  assert.match(runner, /trashPrivateGenerationAsset/);
  assert.match(runner, /purgePrivateGenerationAsset/);
  assert.match(runner, /trashTwin/);
  assert.match(runner, /purgeTwin/);
  assert.match(twinLifecycle, /TWIN_LEGAL_HOLD/);
  assert.doesNotMatch(runner, /R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|DeleteObjectCommand|deleteObject/i);
});

test("account shell, billing evidence, voluntary deletion, delinquency, and Phase 9 delivery stay outside Phase 8D", () => {
  assert.doesNotMatch(migration, /delete\s+from\s+auth\.users/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.profiles/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.payment_v2_/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.account_deletion_requests/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.subscription_payment_delinquencies/i);
  assert.doesNotMatch(migration + runner + route, /send_email|send_notification|deliver_notification/i);
});

test("finalization is audited and cannot complete while creator working data remains", () => {
  assert.match(migration, /phase8d_finalize_canceled_account_purge/);
  assert.match(migration, /generation_assets[\s\S]+lifecycle_state<>'purged'/);
  assert.match(migration, /user_loras[\s\S]+lifecycle_state<>'purged'/);
  assert.match(migration, /retention\.subscription_cancellation_purged/);
  assert.match(migration, /append_governance_audit_event/);
});

test("scheduled execution is internal-only and authenticated", () => {
  assert.match(route, /authenticateSchedulerRequest/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /VERCEL_CRON_SECRET/);
  assert.match(vercel, /\/api\/internal\/retention\/phase8d\/run/);
});
