import { spawnSync } from "node:child_process";
const url = process.env.PHASE7_PAYMENT_DELINQUENCY_DATABASE_URL;
if (!url) { console.error("PHASE7_PAYMENT_DELINQUENCY_DATABASE_URL is required"); process.exit(2); }
for (const file of [
  "backend/security/tests/phase7PaymentDelinquencyPostgresSetup.sql",
  "supabase/migrations/20260905031500_phase7_subscription_payment_delinquency.sql",
  "backend/security/tests/phase7PaymentDelinquencyPostgresIntegration.sql",
]) {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("Phase 7 payment delinquency PostgreSQL 17 integration passed.");
