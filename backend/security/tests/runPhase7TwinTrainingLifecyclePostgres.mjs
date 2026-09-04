import { spawnSync } from "node:child_process";

const url = process.env.PHASE7_TWIN_TRAINING_DATABASE_URL;
if (!url) {
  console.error("PHASE7_TWIN_TRAINING_DATABASE_URL is required");
  process.exit(2);
}

const psql = (args) => {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

psql(["-f", "backend/security/tests/phase7TwinTrainingPostgresPrelude.sql"]);
psql(["-f", "backend/security/tests/phase7TwinTrainingPostgresSetup.sql"]);
psql(["-f", "supabase/migrations/20260904223000_phase7_twin_training_lifecycle.sql"]);
psql(["-f", "supabase/migrations/20260904223100_phase7_twin_training_lifecycle_race_hardening.sql"]);
psql(["-f", "supabase/migrations/20260904223200_phase7_twin_active_read_boundary.sql"]);
psql(["-f", "supabase/migrations/20260904223300_phase7_twin_finalize_qualification.sql"]);
psql(["-f", "supabase/migrations/20260904223400_phase7_twin_new_use_trigger_hardening.sql"]);
psql(["-f", "backend/security/tests/phase7TwinTrainingLifecyclePostgresIntegration.sql"]);
console.log("Phase 7 Twin and training-data lifecycle PostgreSQL integration passed.");
