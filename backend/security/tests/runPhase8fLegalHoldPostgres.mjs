import { spawnSync } from "node:child_process"

const databaseUrl = process.env.PHASE8F_LEGAL_HOLD_DATABASE_URL
if (!databaseUrl) {
  console.error("PHASE8F_LEGAL_HOLD_DATABASE_URL is required")
  process.exit(2)
}

const url = new URL(databaseUrl)
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.port !== "5432" ||
  url.pathname !== "/phase8f_legal_hold_test" ||
  url.search ||
  url.hash
) {
  console.error("Refusing to run Phase 8F legal-hold integration outside the disposable local PostgreSQL test database")
  process.exit(2)
}

const psql = (args) => {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

psql(["-f", "backend/security/tests/phase8GovernanceFoundationPostgresSetup.sql"])
psql(["-f", "supabase/migrations/20260905060000_phase8_governance_foundation.sql"])
psql(["-f", "supabase/migrations/20260905110000_phase8f_legal_hold_lifecycle.sql"])
psql(["-f", "backend/security/tests/phase8fLegalHoldPostgresIntegration.sql"])
console.log("Phase 8F legal-hold lifecycle PostgreSQL 17 integration passed.")
