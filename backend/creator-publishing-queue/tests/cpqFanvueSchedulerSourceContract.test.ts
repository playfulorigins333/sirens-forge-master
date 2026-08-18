import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const migrationPath = "supabase/migrations/20260818180000_enable_pg_net_for_cpq_fanvue_scheduler.sql"
const activationPath = "supabase/manual/cpq_fanvue_scheduler_activation.sql"
const deactivationPath = "supabase/manual/cpq_fanvue_scheduler_deactivation.sql"
const migration = readFileSync(migrationPath, "utf8")
const activation = readFileSync(activationPath, "utf8")
const deactivation = readFileSync(deactivationPath, "utf8")
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { version?: number; crons?: Array<{ path?: string; schedule?: string }> }
const route = readFileSync("app/api/creator-publishing-queue/fanvue/run/route.ts", "utf8")
const schedulerCore = readFileSync("lib/creator-publishing-queue/scheduler-runner/serviceCore.ts", "utf8")
const workerRuntime = readFileSync("lib/creator-publishing-queue/fanvue/workerRuntime.ts", "utf8")
const registry = readFileSync("lib/autopost/platformRegistry.ts", "utf8")
const schedulingUi = readFileSync("app/autopost/Task15PlanScheduling.tsx", "utf8")
const policyCorrection = readFileSync("supabase/migrations/20260818164748_cpq_fanvue_ai_persona_policy_correction.sql", "utf8")
const consent = readFileSync("lib/creator-publishing-queue/consent/copy.ts", "utf8")

const endpoint = "https://www.sirensforge.vip/api/creator-publishing-queue/fanvue/run"
const jobName = "sirens_forge_cpq_fanvue_runner"
const businessTerms = /autopost_accounts|creator_platform_accounts|creator_publishing_(content_packages|platform_jobs|fanvue_attempts|media_assets|ai_twin_consents|creator_verifications)/i

test("forward migration enables only the pg_net prerequisite", () => {
  assert.match(migration, /^create extension if not exists pg_net with schema extensions;$/m)
  assert.doesNotMatch(migration, /cron\.(schedule|unschedule)|net\.http|https?:\/\/|\/api\/|fanvue\.com|vault|decrypted_secret|authorization|bearer/i)
  assert.doesNotMatch(migration, businessTerms)
})

test("activation has the exact canonical endpoint, cadence, job, and dynamic Vault authorization", () => {
  assert.match(activation, new RegExp(`'${jobName}'`))
  assert.match(activation, /'\* \* \* \* \*'/)
  assert.equal((activation.match(new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 2)
  assert.doesNotMatch(activation, /\/api\/autopost\/run/i)
  assert.match(activation, /net\.http_get\(/)
  assert.match(activation, /vault\.decrypted_secrets/)
  assert.ok((activation.match(/fanvue_cpq_cron_secret/g) ?? []).length >= 3)
  assert.doesNotMatch(activation, /cpq_fanvue_scheduler_(base_url|cron_secret)/)
  assert.match(activation, /'Authorization',\s*'Bearer ' \|\| \(select decrypted_secret from vault\.decrypted_secrets where name = 'fanvue_cpq_cron_secret'\)/s)
  assert.match(activation, /timeout_milliseconds := 55000/)
})

test("activation fails closed for missing, ambiguous, null, empty, and whitespace-only secret state", () => {
  assert.match(activation, /count\(\*\).*fanvue_cpq_cron_secret[\s\S]*?<> 1[\s\S]*?raise exception 'CPQ Fanvue scheduler secret is not uniquely configured'/)
  assert.match(activation, /nullif\(btrim\(decrypted_secret\), ''\) is null/)
  assert.match(activation, /raise exception 'CPQ Fanvue scheduler secret is empty'/)
  assert.doesNotMatch(activation, /raise (notice|warning)|decrypted_secret\s*\|\||format\s*\([^)]*decrypted_secret/i)
})

test("activation is idempotent, rejects a differently named duplicate, and avoids business state", () => {
  assert.match(activation, new RegExp(`jobname <> '${jobName}'`))
  assert.match(activation, /raise exception 'A different recurring trigger already targets the CPQ Fanvue runner'/)
  assert.match(activation, new RegExp(`where jobname = '${jobName}'`))
  assert.match(activation, /cron\.unschedule\(v_existing_job_id\)/)
  assert.doesNotMatch(activation, businessTerms)
  assert.doesNotMatch(activation, /\b(insert|update|delete|truncate|alter|drop)\b\s+(?:table\s+)?public\./i)
})

test("deactivation removes only the canonical job and preserves extensions, Vault, env, and business state", () => {
  const executable = deactivation.replace(/^--.*$/gm, "")
  assert.equal((deactivation.match(new RegExp(jobName, "g")) ?? []).length, 1)
  assert.match(deactivation, /for v_job_id in[\s\S]*?select jobid from cron\.job[\s\S]*?loop[\s\S]*?cron\.unschedule\(v_job_id\)/)
  assert.doesNotMatch(deactivation, /drop\s+extension|pg_net|pg_cron|vault\.(secrets|decrypted_secrets)|FANVUE_.*ENABLED/i)
  assert.doesNotMatch(deactivation, businessTerms)
  assert.doesNotMatch(executable, /\b(delete|insert|update|truncate|alter|drop)\b/i)
})

test("Vercel retains only the two unchanged affiliate payout crons", () => {
  assert.deepEqual(vercel, { version: 2, crons: [
    { path: "/api/admin/affiliate-payouts/execute", schedule: "59 3 * * 0" },
    { path: "/api/admin/affiliate-payouts/execute", schedule: "59 4 * * 0" },
  ] })
})

test("launch execution remains authenticated, sequential, and single-claim/single-worker", () => {
  const auth = route.indexOf("authenticateSchedulerRequest")
  const scheduler = route.indexOf("const scheduler=await runCreatorPublishingScheduler")
  const worker = route.indexOf("const worker=await runProductionFanvueCpqWorker")
  assert(auth >= 0 && scheduler > auth && worker > scheduler)
  assert.match(schedulerCore, /CREATOR_PUBLISHING_SCHEDULER_CLAIM_LIMIT = 1 as const/)
  assert.match(workerRuntime, /const BATCH_SIZE = 1/)
})

test("platform and V2 persona-consent launch contracts do not drift", () => {
  assert.match(registry, /id:\s*"x"[\s\S]*?public_selectable:\s*false/)
  assert.match(registry, /id:\s*"reddit"[\s\S]*?public_selectable:\s*false/)
  assert.match(schedulingUi, /OnlyFans remains assisted\/manual/)
  assert.match(policyCorrection, /platform_blocks_fictional_personas = false/)
  assert.match(policyCorrection, /creator-ai-content-persona-consent-v2/)
  assert.match(consent, /AI_TWIN_CONSENT_VERSION = "creator-ai-content-persona-consent-v2"/)
  assert.match(consent, /Fanvue personas may be fully synthetic and do not have to resemble me\./)
})
