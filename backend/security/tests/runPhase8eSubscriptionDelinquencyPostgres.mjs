import { spawnSync } from "node:child_process";

const url = process.env.PHASE8E_DELINQUENCY_DATABASE_URL;
if (!url) {
  console.error("PHASE8E_DELINQUENCY_DATABASE_URL is required");
  process.exit(2);
}

for (const file of [
  "backend/security/tests/phase8eSubscriptionDelinquencyPostgresSetup.sql",
  "supabase/migrations/20260905100000_phase8_subscription_delinquency_enforcement.sql",
  "backend/security/tests/phase8eSubscriptionDelinquencyPostgresIntegration.sql",
]) {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("Phase 8E subscription delinquency PostgreSQL integration passed.");
