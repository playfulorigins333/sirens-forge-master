import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, readFileSync } from "node:fs"
import { execSync } from "node:child_process"

const base = "97f82b12d22133a6e6561d02b7d36605d6416bdf"
const routePath = "app/api/creator-publishing-queue/scheduler/run/route.ts"
const corePath = "lib/creator-publishing-queue/scheduler-runner/serviceCore.ts"
const servicePath = "lib/creator-publishing-queue/scheduler-runner/service.ts"
const docsPath = "docs/creator-publishing/task21-onlyfans-reliability-operations.md"
const all = () => [routePath, corePath, servicePath].map((p) => readFileSync(p, "utf8")).join("\n")

test("dedicated route remains manually gated, GET-only, dynamic node, and no-store", () => {
  assert.equal(existsSync(routePath), true)
  const route = readFileSync(routePath, "utf8")
  const core = readFileSync(corePath, "utf8")
  const service = readFileSync(servicePath, "utf8")
  assert.match(route, /export const runtime = "nodejs"/)
  assert.match(route, /export const dynamic = "force-dynamic"/)
  assert.match(route, /export async function GET\(/)
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE|OPTIONS)\(/)
  assert.match(route, /private, no-store/); assert.match(route, /no-cache/); assert.match(route, /nosniff/)
  assert.match(core, /export const CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED = true as const/)
  assert.match(service, /buildEnabled: CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED/)
})

test("auth contract uses approved headers, timingSafeEqual, and no URL/body/session fallback", () => {
  const src = all()
  assert.match(src, /timingSafeEqual/); assert.match(src, /createHash\("sha256"\)/)
  assert.match(src, /headers\.get\("authorization"\)/); assert.match(src, /headers\.get\("x-vercel-cron-secret"\)/)
  assert.doesNotMatch(src, /candidate\s*===\s*configuredSecret|configuredSecret\s*===\s*candidate|searchParams|\.json\(\)|\.text\(\)|\.formData\(\)|cookies\(|supabaseServer|auth\.getUser|creator_id|operator_id|event_id.*headers|lock_token.*headers/i)
  assert.doesNotMatch(src, /console\.|process\.env\.NEXT_PUBLIC_SUPABASE_URL|process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
})

test("runner source has only authorized RPCs and no scheduling, table, autopost, or platform execution", () => {
  const src = all()
  const rpcNames = [...src.matchAll(/rpc\("([^"]+)"/g)].map((m) => m[1]).sort()
  assert.deepEqual([...new Set(rpcNames)], ["creator_publishing_claim_due_scheduler_events", "creator_publishing_process_scheduler_event"])
  assert.match(src, /p_limit: CREATOR_PUBLISHING_SCHEDULER_CLAIM_LIMIT/); assert.match(src, /p_lock_minutes: CREATOR_PUBLISHING_SCHEDULER_LOCK_MINUTES/)
  for (const forbidden of ["/api/autopost/run", "autopost_rules", "autopost_jobs", "autopost_job_logs", "onlyfans.com", "fansly.com", "fanvue.com", "api.onlyfans", "fetch(", ".from(", ".insert(", ".upsert(", ".delete(", "due_at", "operator_due_at", "intended_publish_at", "timezone", "publication", "Intl.DateTimeFormat", "Date.parse", "setTimeout", "setInterval", "Promise.all"]) assert.equal(src.includes(forbidden), false, forbidden)
})

test("docs include Gate 21B-3A manual-first activation notes and changed files stay in authorized boundary", () => {
  const docs = readFileSync(docsPath, "utf8")
  assert.match(docs, /Gate 21B-3A prepares manual-first scheduler activation without adding a cron\./)
  assert.match(docs, /Merging Gate 21B-3A does not by itself invoke the Creator Publishing scheduler\./)
  assert.match(docs, /read-only production preflight must prove that all claimable pending and expired-processing scheduler events are OnlyFans assisted-mode work/)
  assert.match(docs, /non-OnlyFans-assisted claimable work blocks activation/)
  const changed = execSync(`git diff --name-only HEAD`, { encoding: "utf8" }).trim().split(/\n/).filter(Boolean)
  const allowed = [/^lib\/creator-publishing-queue\/scheduler-runner\/serviceCore\.ts$/, /^backend\/creator-publishing-queue\/tests\/task21SchedulerRunnerServices\.test\.ts$/, /^backend\/creator-publishing-queue\/tests\/task21SchedulerRunnerSourceContract\.test\.ts$/, /^docs\/creator-publishing\/task21-onlyfans-reliability-operations\.md$/]
  for (const file of changed) assert(allowed.some((r) => r.test(file)), `${file} is outside Gate 21B-3A boundary`)
  assert(!changed.includes("vercel.json")); assert(!changed.some((f) => f.startsWith("supabase/migrations/") || f.startsWith(".github/workflows/") || f.includes("autopost") || f.includes("fanvue") || f.includes("reddit") || f.includes("/x")))
})
