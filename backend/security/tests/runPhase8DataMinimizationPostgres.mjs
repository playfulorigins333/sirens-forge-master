import { spawnSync } from "node:child_process";

const databaseUrl = process.env.PHASE8_DATA_MINIMIZATION_DATABASE_URL;
if (!databaseUrl) {
  console.error("PHASE8_DATA_MINIMIZATION_DATABASE_URL is required");
  process.exit(2);
}

const url = new URL(databaseUrl);
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.port !== "5432" ||
  url.pathname !== "/phase8_data_minimization_test" ||
  url.search ||
  url.hash
) {
  console.error("Refusing to run Phase 8B integration outside the disposable local PostgreSQL test database");
  process.exit(2);
}

const run = (args) => {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(["-f", "backend/security/tests/phase8DataMinimizationPostgresSetup.sql"]);
run(["-f", "supabase/migrations/20260905060000_phase8_governance_foundation.sql"]);
run(["-f", "supabase/migrations/20260905070000_phase8_generation_training_data_minimization.sql"]);
run(["-f", "backend/security/tests/phase8DataMinimizationPostgresIntegration.sql"]);
console.log("Phase 8B generation/training data minimization PostgreSQL 17 integration passed.");
