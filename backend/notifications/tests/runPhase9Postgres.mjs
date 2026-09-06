import { spawn, spawnSync } from "node:child_process"

const url = process.env.PHASE9_DATABASE_URL
if (!url) { console.error("PHASE9_DATABASE_URL is required"); process.exit(2) }
const psql = args => {
  const result = spawnSync("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
for (const file of ["backend/notifications/tests/phase9PostgresSetup.sql", "supabase/migrations/20260906040000_phase9_transactional_notifications.sql", "backend/notifications/tests/phase9PostgresIntegration.sql"]) psql(["-f", file])

const concurrentMaterialize = () => new Promise((resolve, reject) => {
  const child = spawn("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", "-c", "select public.materialize_phase9_notifications(1)"], { stdio: "inherit" })
  child.on("error", reject)
  child.on("exit", code => code === 0 ? resolve() : reject(new Error(`concurrent materializer exited ${code}`)))
})
await Promise.all([concurrentMaterialize(), concurrentMaterialize()])
const unique = spawnSync("psql", [url, "-X", "-Atc", "select count(*) from public.transactional_notification_deliveries where source_type='creator_data_export' and source_id='50000000-0000-4000-8000-000000000001' and notification_kind='export_ready'"], { encoding: "utf8" })
if (unique.status !== 0 || unique.stdout.trim() !== "1") throw new Error("concurrent materialization violated unique outbox identity")
console.log("Phase 9 PostgreSQL integration passed.")
