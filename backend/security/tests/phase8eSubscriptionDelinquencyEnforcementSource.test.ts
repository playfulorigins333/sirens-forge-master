import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260905100000_phase8_subscription_delinquency_enforcement.sql");
const hardeningMigration = read("supabase/migrations/20260905100100_phase8e_remove_purge_reason_normalizers.sql");
const runner = read("lib/retention/phase8e.ts");
const phase8dRunner = read("lib/retention/phase8d.ts");
const route = read("app/api/internal/retention/phase8e/run/route.ts");
const workflow = read(".github/workflows/phase8e-subscription-delinquency-enforcement.yml");
const postgresRunner = read("backend/security/tests/runPhase8eSubscriptionDelinquencyPostgres.mjs");
const vercel = read("vercel.json");
const inventory = read("docs/security/api-authorization-inventory-phase8d.md");
const phase7 = read("supabase/migrations/20260905031500_phase7_subscription_payment_delinquency.sql");
const subscriptionChecker = read("lib/subscription-checker.ts");
const publishingGuard = read("supabase/migrations/20260905045100_phase7_closeout_publishing_execution_guard.sql");

test("Phase 7 delinquency contract remains the source of freeze and deadline truth", () => {
  assert.match(phase7, /state = 'first_miss_frozen'/);
  assert.match(phase7, /state = 'retention_countdown'/);
  assert.match(phase7, /second_missed_at = coalesce\(second_missed_at, p_failure_observed_at\)/);
  assert.match(phase7, /retention_until = coalesce\(retention_until, p_failure_observed_at \+ interval '60 days'\)/);
  assert.match(subscriptionChecker, /first_miss_frozen/);
  assert.match(subscriptionChecker, /retention_countdown/);
  assert.match(subscriptionChecker, /PAYMENT_DELINQUENT/);
  assert.match(publishingGuard, /first_miss_frozen/);
  assert.match(publishingGuard, /retention_countdown/);
});

test("Phase 8E preserves billing and identity evidence", () => {
  assert.doesNotMatch(migration, /delete\s+from\s+(?:auth\.)?users/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.profiles/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.user_subscriptions/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.subscription_payment_delinquencies/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.subscription_payment_delinquency_invoices/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.payment_v2_/i);
  assert.match(migration, /purge_completed_at/);
  assert.match(migration, /retention\.subscription_delinquency_purged/);
});

test("old delinquency cannot purge after recovery or a newer billing lifecycle", () => {
  assert.match(migration, /phase8e_delinquency_has_successor/);
  assert.match(migration, /phase8e_supersede_delinquency/);
  assert.match(migration, /newer\.second_missed_at>p_second_missed_at/);
  assert.match(migration, /subscription_cancellation_retentions/);
  assert.match(migration, /d\.state='recovered'/);
  assert.match(migration, /d\.state='superseded'/);
  assert.match(runner, /delinquency_state === "recovered"/);
  assert.match(runner, /delinquency_state === "superseded"/);
});

test("destructive work is bounded to the second-miss retention deadline and fails closed", () => {
  assert.match(migration, /p\.created_at<=d\.retention_until/);
  assert.match(migration, /c\.created_at<=d\.retention_until/);
  assert.match(migration, /g\.created_at<=\(d\.retention_until at time zone 'UTC'\)/);
  assert.match(migration, /g\.created_at is null/);
  assert.match(migration, /g\.r2_key is not null or g\.image_url is not null/);
  assert.equal((runner.match(/\.lte\("created_at", retentionUntil\)/g) ?? []).length, 2);
  assert.match(migration, /a\.lifecycle_state<>'purged'/);
  assert.match(migration, /l\.lifecycle_state<>'purged'/);
});

test("legal holds block both account and resource destruction", () => {
  assert.match(migration, /phase8e_delinquent_account_has_active_hold/);
  assert.match(migration, /subscription_payment_delinquency/);
  assert.match(migration, /phase8_retention_resource_has_active_hold/);
  assert.match(migration, /phase8c_private_media_governance_hold/);
  assert.match(migration, /phase8d_assert_twin_purge_allowed/);
});

test("retention physical purge evidence is explicit and ambiguous normalizers are removed", () => {
  assert.match(runner, /purgePrivateGenerationAsset\(asset\.id, authUserId, "retention_expired"\)/);
  assert.match(runner, /purgeTwin\(twin\.id, twin\.user_id, "retention_expired"\)/);
  assert.match(phase8dRunner, /purgePrivateGenerationAsset\(asset\.id, authUserId, "retention_expired"\)/);
  assert.match(phase8dRunner, /purgeTwin\(twin\.id, twin\.user_id, "retention_expired"\)/);
  assert.match(hardeningMigration, /drop trigger if exists phase8_retention_generation_asset_purge_reason/);
  assert.match(hardeningMigration, /drop trigger if exists phase8_retention_twin_purge_reason/);
  assert.match(hardeningMigration, /drop function if exists public\.phase8_retention_normalize_generation_asset_purge_reason\(\)/);
  assert.match(hardeningMigration, /drop function if exists public\.phase8_retention_normalize_twin_purge_reason\(\)/);
  assert.match(hardeningMigration, /drop function if exists public\.phase8_retention_purge_claim_active\(uuid\)/);
  assert.match(postgresRunner, /20260905100000_phase8_subscription_delinquency_enforcement\.sql[\s\S]+20260905100100_phase8e_remove_purge_reason_normalizers\.sql/);
});

test("claim validation and finalization are service-role-only", () => {
  for (const signature of [
    "phase8e_claim_expired_delinquent_accounts(integer)",
    "phase8e_validate_delinquent_account_purge(uuid,uuid,uuid)",
    "phase8e_finalize_delinquent_account_purge(uuid,uuid,uuid)",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")} from public,anon,authenticated`, "i"));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")} to service_role`, "i"));
  }
});

test("scheduled route is internal and inventory-covered", () => {
  assert.match(route, /authenticateSchedulerRequest/);
  assert.match(route, /CRON_SECRET \|\| process\.env\.VERCEL_CRON_SECRET/);
  assert.match(route, /private, no-store/);
  assert.match(vercel, /\/api\/internal\/retention\/phase8e\/run/);
  assert.match(inventory, /\/api\/internal\/retention\/phase8e\/run/);
});

test("dedicated CI runs source, PostgreSQL, and authorization inventory gates", () => {
  assert.match(workflow, /Phase 8E source and boundary contracts/);
  assert.match(workflow, /Phase 8E PostgreSQL integration/);
  assert.match(workflow, /API authorization inventory contract/);
  assert.match(workflow, /postgres:17/);
});
