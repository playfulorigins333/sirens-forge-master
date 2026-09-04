import { spawnSync } from "node:child_process";

const url = process.env.PHASE7_PRIVATE_MEDIA_DATABASE_URL;
if (!url) {
  console.error("PHASE7_PRIVATE_MEDIA_DATABASE_URL is required");
  process.exit(2);
}

const psql = (args) => {
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

psql(["-f", "backend/security/tests/privateCreatorMediaPostgresSetup.sql"]);
psql(["-f", "supabase/migrations/20260824090000_private_creator_generation_media.sql"]);

// Reproduce the currently deployed generation Data API surface so the Phase 7
// migration proves it removes both the DELETE policy and table grant.
psql(["-c", `
  grant select,insert,update,delete on table public.generations to anon,authenticated,service_role;
  alter table public.generations enable row level security;
  create policy "Users can delete own generations" on public.generations for delete using (true);
`]);

psql(["-f", "supabase/migrations/20260904032000_phase7_private_media_lifecycle.sql"]);
psql(["-f", "backend/security/tests/phase7PrivateMediaLifecyclePostgresIntegration.sql"]);
console.log("Phase 7 private media lifecycle PostgreSQL integration passed.");
