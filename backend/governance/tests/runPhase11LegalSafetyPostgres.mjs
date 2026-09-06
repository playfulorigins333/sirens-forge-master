import { spawnSync } from "node:child_process";

const databaseUrl = process.env.PHASE11_DATABASE_URL;
if (!databaseUrl) {
  console.error("PHASE11_DATABASE_URL is required");
  process.exit(2);
}
let url;
try { url = new URL(databaseUrl); } catch {
  console.error("PHASE11_DATABASE_URL must be a valid URL");
  process.exit(2);
}
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.port !== "5432" || url.pathname !== "/phase11_test" || url.search || url.hash
) {
  console.error("Refusing to run Phase 11 integration outside 127.0.0.1:5432/phase11_test");
  process.exit(2);
}
const run = (file) => {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
for (const file of [
  "backend/security/tests/phase10PostgresSetup.sql",
  "supabase/migrations/20260905060000_phase8_governance_foundation.sql",
  "supabase/migrations/20260906070000_phase10_admin_support_security.sql",
  "supabase/migrations/20260906093000_phase10_support_resolution_message.sql",
  "supabase/migrations/20260906110000_phase11_legal_safety_cases.sql",
  "backend/governance/tests/phase11LegalSafetyPostgresIntegration.sql",
]) run(file);
console.log("Phase 11 PostgreSQL integration passed against phase11_test using real Phase 8/10 prerequisites.");
