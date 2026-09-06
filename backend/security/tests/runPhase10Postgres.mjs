import { spawnSync } from "node:child_process"

const databaseUrl = process.env.PHASE10_DATABASE_URL
if (!databaseUrl) { console.error("PHASE10_DATABASE_URL is required"); process.exit(2) }
const url = new URL(databaseUrl)
if (!["postgres:","postgresql:"].includes(url.protocol) || !["localhost","127.0.0.1","[::1]"].includes(url.hostname) || url.port!=="5432" || url.pathname!=="/phase10_test" || url.search || url.hash) {
  console.error("Refusing to run Phase 10 integration outside the disposable local PostgreSQL test database")
  process.exit(2)
}
const run = (file) => {
  const result=spawnSync("psql",[databaseUrl,"-X","-v","ON_ERROR_STOP=1","-f",file],{stdio:"inherit"})
  if(result.status!==0) process.exit(result.status??1)
}
for(const file of[
  "backend/security/tests/phase10PostgresSetup.sql",
  "supabase/migrations/20260905060000_phase8_governance_foundation.sql",
  "supabase/migrations/20260906070000_phase10_admin_support_security.sql",
  "supabase/migrations/20260906093000_phase10_support_resolution_message.sql",
  "backend/security/tests/phase10PostgresIntegration.sql",
]) run(file)
console.log("Phase 10 PostgreSQL 17 integration passed.")
