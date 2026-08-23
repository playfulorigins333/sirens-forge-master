import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const read = (path: string) => readFile(path, "utf8")
const [migration, fanvueRoute, xRoute, privacy, xAdapter, jobResults, workflow] = await Promise.all([
  read("supabase/migrations/20260823090000_publishing_provider_disconnect_truth.sql"),
  read("app/api/autopost/connect/fanvue/disconnect/route.ts"),
  read("app/api/autopost/connect/x/disconnect/route.ts"),
  read("app/privacy/page.tsx"),
  read("lib/autopost/xAdapter.ts"),
  read("lib/autopost/jobResults.ts"),
  read(".github/workflows/task21-onlyfans-reliability.yml"),
])

for (const [provider, route] of [["fanvue", fanvueRoute], ["x", xRoute]] as const) {
  assert.match(route, /requireFreshTotpResponse\(\)/, `${provider} disconnect must retain fresh TOTP`)
  assert.match(route, /rpc\("disconnect_publishing_provider"/, `${provider} disconnect must use the atomic RPC`)
  assert(route.includes(`p_provider: "${provider}"`), `${provider} identity must be fixed by the route`)
  assert.match(route, /p_user_id: userId/, `${provider} mutation must remain owner-scoped`)
}

assert.match(migration, /p_provider not in \('fanvue', 'x'\)/)
for (const token of ["access_token = null", "refresh_token = null", "encrypted_access_token = null", "encrypted_refresh_token = null"]) assert(migration.includes(token), `missing credential nullification: ${token}`)
assert.match(migration, /autopost_jobs[\s\S]*state = 'SKIPPED'[\s\S]*state = 'QUEUED'/)
assert.match(migration, /creator_publishing_platform_jobs[\s\S]*job_state = 'cancelled'[\s\S]*posted_at is null/)
assert.match(migration, /creator_publishing_scheduler_events[\s\S]*status = 'cancelled'[\s\S]*status in \('pending', 'processing'\)/)
assert.match(migration, /creator_publishing_queue_tasks[\s\S]*status = 'archived'[\s\S]*j\.job_state = 'cancelled'/)
assert.match(migration, /job_state not in \('published_direct', 'confirmed_posted_manual', 'exported'\)/)
assert.match(migration, /PUBLISHING_DISCONNECT_PROVIDER_CREATE_IN_FLIGHT/)
assert.match(migration, /autopost_begin_x_dispatch[\s\S]*connection_status<>'CONNECTED'[\s\S]*state='RUNNING'/)
assert.match(migration, /creator_publishing_aggregate_plan_status[\s\S]*'cancelled'\)\) failures/)
assert.match(migration, /set status = public\.creator_publishing_aggregate_plan_status\(p\.id\)/)
assert.match(migration, /'publishing_provider_disconnected'/)
for (const fact of ["credentials_nullified", "legacy_unpublished_jobs_cancelled", "cpq_unpublished_jobs_cancelled", "scheduler_events_cancelled", "queue_tasks_archived", "disconnected_at"]) assert(migration.includes(`'${fact}'`), `missing receipt fact: ${fact}`)
assert.match(migration, /revoke all on function public\.disconnect_publishing_provider\(uuid, text\) from public, anon, authenticated/)
assert.match(migration, /grant execute on function public\.disconnect_publishing_provider\(uuid, text\) to service_role/)

assert.match(privacy.replace(/\s+/g, " "), /credentials and access tokens are revoked or deleted, and unpublished scheduled jobs associated with that account are cancelled/i)
assert.match(xAdapter, /autopost_begin_x_dispatch/)
assert(xAdapter.indexOf("autopost_begin_x_dispatch") < xAdapter.indexOf("createXTextPost({"), "dispatch ownership must be acquired before provider create")
assert.match(jobResults, /eq\("state", "RUNNING"\)[\s\S]*eq\("lock_id", input\.execution_lock_id\)[\s\S]*maybeSingle/)
assert(workflow.includes("test:publishing-provider-disconnect-postgres"), "real PostgreSQL behavior suite must run in CI")
console.log("publishing provider disconnect truth source contract: PASS")
