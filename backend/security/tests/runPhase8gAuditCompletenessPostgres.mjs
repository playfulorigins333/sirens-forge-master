import { spawnSync } from "node:child_process"

const url = process.env.PHASE8G_AUDIT_DATABASE_URL
if (!url) {
  console.error("PHASE8G_AUDIT_DATABASE_URL is required")
  process.exit(2)
}

const psql = (args) => {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

psql(["-f", "backend/security/tests/phase8gAuditCompletenessPostgresSetup.sql"])
psql(["-f", "supabase/migrations/20260905031000_phase7_data_export_account_deletion.sql"])
psql(["-f", "supabase/migrations/20260905031100_phase7_export_claim_notification_hardening.sql"])
psql(["-f", "supabase/migrations/20260905031200_phase7_export_expiry_hardening.sql"])
psql(["-f", "supabase/migrations/20260905045000_phase7_closeout_account_deletion_billing_guard.sql"])
psql(["-f", "supabase/migrations/20260905060000_phase8_governance_foundation.sql"])
psql(["-f", "supabase/migrations/20260905120000_phase8g_deletion_billing_export_audit.sql"])
psql(["-f", "backend/security/tests/phase8gAuditCompletenessPostgresIntegration.sql"])
console.log("Phase 8G deletion/billing/export audit completeness PostgreSQL 17 integration passed.")