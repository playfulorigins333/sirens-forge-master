import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, readFileSync } from "node:fs"

const routePath = "app/api/creator-publishing-queue/scheduler/run/route.ts"
const corePath = "lib/creator-publishing-queue/scheduler-runner/serviceCore.ts"
const servicePath = "lib/creator-publishing-queue/scheduler-runner/service.ts"
const docsPath = "docs/creator-publishing/task21-onlyfans-reliability-operations.md"
const all = () => [routePath, corePath, servicePath].map((path) => readFileSync(path, "utf8")).join("\n")

test("dedicated route remains manually gated, GET-only, dynamic node, no-store, and duration-bounded", () => {
  assert.equal(existsSync(routePath), true)
  const route = readFileSync(routePath, "utf8")
  const core = readFileSync(corePath, "utf8")
  const service = readFileSync(servicePath, "utf8")
  assert.match(route, /export const runtime = "nodejs"/)
  assert.match(route, /export const dynamic = "force-dynamic"/)
  assert.match(route, /export const maxDuration = 60/)
  assert.match(route, /export async function GET\(/)
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE|OPTIONS)\(/)
  assert.match(route, /private, no-store/)
  assert.match(route, /no-cache/)
  assert.match(route, /nosniff/)
  assert.match(core, /export const CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED = true as const/)
  assert.match(service, /buildEnabled: CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED/)
})

test("auth contract uses approved headers, timingSafeEqual, and no URL, body, cookie, or session fallback", () => {
  const src = all()
  const route = readFileSync(routePath, "utf8")
  const core = readFileSync(corePath, "utf8")
  const service = readFileSync(servicePath, "utf8")
  assert.match(src, /timingSafeEqual/)
  assert.match(src, /createHash\("sha256"\)/)
  assert.match(src, /headers\.get\("authorization"\)/)
  assert.match(src, /headers\.get\("x-vercel-cron-secret"\)/)
  assert.doesNotMatch(src, /candidate\s*===\s*configuredSecret|configuredSecret\s*===\s*candidate|searchParams|\.json\(\)|\.text\(\)|\.formData\(\)|cookies\(|supabaseServer|auth\.getUser|creator_id|operator_id|event_id.*headers|lock_token.*headers/i)
  assert.doesNotMatch(route, /process\.env\.NEXT_PUBLIC_SUPABASE_URL|process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(core, /console\./)
  assert.doesNotMatch(service, /console\./)
})

test("runner source has only authorized RPCs and no scheduling, table, autopost, or platform execution", () => {
  const src = all()
  const rpcNames = [...src.matchAll(/rpc\("([^"]+)"/g)].map((match) => match[1]).sort()
  assert.deepEqual([...new Set(rpcNames)], ["creator_publishing_claim_due_scheduler_events", "creator_publishing_process_scheduler_event"])
  assert.match(src, /p_limit: CREATOR_PUBLISHING_SCHEDULER_CLAIM_LIMIT/)
  assert.match(src, /p_lock_minutes: CREATOR_PUBLISHING_SCHEDULER_LOCK_MINUTES/)
  for (const forbidden of ["/api/autopost/run", "autopost_rules", "autopost_jobs", "autopost_job_logs", "onlyfans.com", "fansly.com", "fanvue.com", "api.onlyfans", "fetch(", ".insert(", ".upsert(", ".delete(", "due_at", "operator_due_at", "intended_publish_at", "timezone", "publication", "Intl.DateTimeFormat", "Date.parse", "setTimeout", "setInterval", "Promise.all"]) assert.equal(src.includes(forbidden), false, forbidden)
  const core = readFileSync(corePath, "utf8")
  assert.equal((core.match(/\.from\(/g) ?? []).length, 1)
  assert.equal((core.match(/\.from\("creator_publishing_scheduler_events"\)/g) ?? []).length, 1)
  assert.match(core, /select\(reconciliationProjection\)\.eq\("id", eventId\)\.limit\(1\)/)
  assert.doesNotMatch(core, /\.eq\("event_id",/)
  assert.match(core, /const reconciliationProjection = "status,processed_at,superseded_at,safe_error_code,lock_token,locked_at" as const/)
  assert.doesNotMatch(core, /\.from\("creator_publishing_scheduler_events"\)[^\n]*(?:\.insert|\.update|\.upsert|\.delete)\(/)
})

test("operations documentation records the accepted manual proof and telemetry-only hardening boundary", () => {
  const docs = readFileSync(docsPath, "utf8")
  assert.match(docs, /Gate 21B-4A is complete, verified, and closed/)
  assert.match(docs, /Exactly one manual scheduler invocation returned `SCHEDULER_RUN_COMPLETED` with all aggregate counts equal to zero/)
  assert.match(docs, /`CREATOR_PUBLISHING_SCHEDULER_ENABLED` is absent in Production/)
  assert.match(docs, /Gate 21B-3B1 adds sanitized route telemetry and `maxDuration = 60` only/)
  assert.match(docs, /The user-agent is telemetry-only/)
  assert.match(docs, /No cron is registered by Gate 21B-3B1/)
  assert.match(docs, /No fake, fixture, placeholder, fabricated, or direct-database Production event is authorized/)
  assert.match(docs, /locked_at < db_now - lock_ttl/)
  assert.match(docs, /approximately 15–30 minutes/)
})
