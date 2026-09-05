import { spawnSync } from "node:child_process";
const url = process.env.PHASE7_SUBSCRIPTION_RETENTION_DATABASE_URL;
if (!url) { console.error("PHASE7_SUBSCRIPTION_RETENTION_DATABASE_URL is required"); process.exit(2); }
for (const file of [
  "backend/security/tests/phase7SubscriptionCancellationPostgresSetup.sql",
  "supabase/migrations/20260905031300_phase7_subscription_cancellation_retention.sql",
  "backend/security/tests/phase7SubscriptionCancellationPostgresIntegration.sql",
]) {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("Phase 7 subscription cancellation retention PostgreSQL integration passed.");

