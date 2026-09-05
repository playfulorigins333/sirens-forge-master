import { spawnSync } from "node:child_process";

const url = process.env.PHASE8D_CANCELED_ACCOUNT_DATABASE_URL;
if (!url) {
  console.error("PHASE8D_CANCELED_ACCOUNT_DATABASE_URL is required");
  process.exit(2);
}

for (const file of [
  "backend/security/tests/phase8dCanceledAccountPostgresSetup.sql",
  "supabase/migrations/20260905031300_phase7_subscription_cancellation_retention.sql",
  "supabase/migrations/20260905090000_phase8_canceled_account_enforcement.sql",
  "backend/security/tests/phase8dCanceledAccountPostgresIntegration.sql",
]) {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("Phase 8D canceled-account PostgreSQL integration passed.");
