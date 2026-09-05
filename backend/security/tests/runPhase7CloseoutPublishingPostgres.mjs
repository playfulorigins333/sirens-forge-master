import { spawnSync } from "node:child_process";

const url = process.env.PHASE7_CLOSEOUT_PUBLISHING_DATABASE_URL;
if (!url) {
  console.error("PHASE7_CLOSEOUT_PUBLISHING_DATABASE_URL is required");
  process.exit(2);
}

const psql = (args) => {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

psql(["-f", "backend/security/tests/phase7CloseoutPublishingPostgresSetup.sql"]);
psql(["-f", "supabase/migrations/20260905045100_phase7_closeout_publishing_execution_guard.sql"]);
psql(["-f", "backend/security/tests/phase7CloseoutPublishingPostgresIntegration.sql"]);
console.log("Phase 7 closeout publishing PostgreSQL integration passed.");
