import { spawnSync } from "node:child_process";

const url = process.env.PHASE7_DATA_RIGHTS_DATABASE_URL;
if (!url) {
  console.error("PHASE7_DATA_RIGHTS_DATABASE_URL is required");
  process.exit(2);
}

const psql = (args) => {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

psql(["-f", "backend/security/tests/phase7DataRightsPostgresSetup.sql"]);
psql(["-f", "supabase/migrations/20260905031000_phase7_data_export_account_deletion.sql"]);
psql(["-f", "supabase/migrations/20260905031100_phase7_export_claim_notification_hardening.sql"]);
psql(["-f", "supabase/migrations/20260905031200_phase7_export_expiry_hardening.sql"]);
psql(["-f", "supabase/migrations/20260905045000_phase7_closeout_account_deletion_billing_guard.sql"]);
psql(["-f", "backend/security/tests/phase7DataRightsPostgresIntegration.sql"]);
console.log("Phase 7 data export and voluntary account deletion PostgreSQL integration passed.");
