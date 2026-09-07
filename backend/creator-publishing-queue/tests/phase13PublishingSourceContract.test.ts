import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { getAutopostPlatformRegistry } from "../../../lib/autopost/platformRegistry"

const read = (path: string) => readFileSync(path, "utf8")

function withFanvueActivation<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.FANVUE_PUBLIC_ACTIVATION_ENABLED
  if (value === undefined) delete process.env.FANVUE_PUBLIC_ACTIVATION_ENABLED
  else process.env.FANVUE_PUBLIC_ACTIVATION_ENABLED = value
  try { return run() } finally {
    if (previous === undefined) delete process.env.FANVUE_PUBLIC_ACTIVATION_ENABLED
    else process.env.FANVUE_PUBLIC_ACTIVATION_ENABLED = previous
  }
}

test("authoritative registry activates only Fanvue while launch-disabled platforms remain unavailable", () => {
  withFanvueActivation("true", () => {
    const registry = getAutopostPlatformRegistry()
    const fanvue = registry.find(platform => platform.id === "fanvue")!
    const onlyfans = registry.find(platform => platform.id === "onlyfans")!
    const x = registry.find(platform => platform.id === "x")!
    const reddit = registry.find(platform => platform.id === "reddit")!
    assert.deepEqual([fanvue.launch_status, fanvue.public_selectable, fanvue.supports_real_posting], ["available", true, true], "Fanvue activation must come from the authoritative registry")
    assert.equal(onlyfans.supports_assisted_workflow, true, "OnlyFans must remain assisted/manual")
    assert.equal(onlyfans.supports_real_posting, false, "OnlyFans must not become a native posting provider")
    assert.equal(x.public_selectable, false, "X must remain unavailable to creators")
    assert.equal(x.launch_status, "coming_soon", "X must remain Coming Soon")
    assert.deepEqual([reddit.public_selectable, reddit.supports_real_posting, reddit.supports_async_dispatch], [false, false, false], "Reddit must remain native-disabled")
  })
  withFanvueActivation(undefined, () => {
    const fanvue = getAutopostPlatformRegistry().find(platform => platform.id === "fanvue")!
    assert.deepEqual([fanvue.launch_status, fanvue.public_selectable], ["coming_soon", false], "Fanvue must fail closed without explicit server activation")
  })
})

test("creator presentation follows supplied registry facts, per-user readiness, and server-side history truth", () => {
  const client = read("app/autopost/AutopostPageClient.tsx")
  const history = read("app/creator/publishing-queue/fanvue/page.tsx")
  const statusRoute = read("app/api/autopost/platforms/me/route.ts")

  assert.match(client, /isFanvueScheduledPublishingActive\(platform\)/, "Fanvue card must derive copy from supplied platform facts")
  for (const fact of [/launch_status === "available"/, /public_selectable === true/, /supports_real_posting === true/]) assert.match(client, fact)
  assert.match(client, /SCHEDULED PUBLISHING/)
  assert.match(client, /FINAL ACTIVATION PENDING/)

  assert.match(statusRoute, /if \(platform\.id !== "fanvue" \|\| platform\.public_selectable !== true\) return status/)
  assert.match(statusRoute, /const ready = status\.user_connected === true && status\.supports_text_posting === true/)
  assert.match(statusRoute, /public_selectable: ready/)
  assert.match(statusRoute, /can_schedule: ready/)
  assert.match(statusRoute, /native_posting_available: ready/)

  assert.match(history, /getAutopostPlatformRegistry/)
  assert.match(history, /scheduledPublishingActive=fanvue\?\.launch_status==="available"&&fanvue\.public_selectable===true&&fanvue\.supports_real_posting===true/)
  assert.match(history, /Scheduled publishing active/)
  assert.match(history, /Final activation pending/)
  assert.doesNotMatch(history, /fanvueFetch|createFanvue(?:Text|Media)?Post|runProductionFanvueCpqWorker|\/api\/creator-publishing-queue\/fanvue\/run/, "read-only history must never become a provider execution surface")
})

test("CPQ Fanvue runner preserves authenticated GET-only bounded execution ordering", () => {
  const route = read("app/api/creator-publishing-queue/fanvue/run/route.ts")
  const runtime = read("lib/creator-publishing-queue/fanvue/workerRuntime.ts")
  const core = read("lib/creator-publishing-queue/fanvue/workerCore.ts")
  assert.match(route, /export async function GET\(req:Request\)/)
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
  assert.match(route, /authenticateSchedulerRequest\(req\.headers,secret\)/)
  assert.match(route, /FANVUE_PUBLIC_ACTIVATION_ENABLED!=="true"/)
  assert.match(runtime, /FANVUE_CPQ_WORKER_ENABLED === "true"/)

  const schedulerCall = "const scheduler=await runCreatorPublishingScheduler(req.headers)"
  const workerCall = "const worker=await runProductionFanvueCpqWorker()"
  const schedulerIndex = route.indexOf(schedulerCall)
  const workerIndex = route.indexOf(workerCall)
  assert.ok(schedulerIndex >= 0, "runner must contain the scheduler execution call")
  assert.ok(workerIndex >= 0, "runner must contain the provider-worker execution call")
  assert.ok(schedulerIndex < workerIndex, "scheduler execution must occur before the provider worker")

  assert.match(runtime, /const BATCH_SIZE\s*=\s*1/)
  assert.match(core, /Math\.min\(FANVUE_CPQ_MAX_BATCH_SIZE/)
})

test("provider success requires durable proof and uncertain outcomes remain fail closed", () => {
  const core = read("lib/creator-publishing-queue/fanvue/workerCore.ts")
  assert.match(core, /result\.ok && result\.provider_post_uuid_present\) return "success"/)
  assert.match(core, /result\.create_attempted && !result\.provider_post_uuid_present\) return "uncertain"/)
  assert.match(core, /let nextAttemptAt = outcome === "retryable_pre_create" \? nextFanvueAttemptAt/)
  assert.doesNotMatch(core, /outcome === "uncertain" \? nextFanvueAttemptAt/, "uncertain provider outcomes must never schedule an automatic retry")
})

test("legacy Autopost and browser code are not promoted to Fanvue execution authority", () => {
  const client = read("app/autopost/AutopostPageClient.tsx")
  const route = read("app/api/creator-publishing-queue/fanvue/run/route.ts")
  assert.match(route, /creator-publishing-queue/)
  assert.doesNotMatch(route, /api\/autopost\/run|autopost_jobs|autopost_rules/)
  assert.doesNotMatch(client, /fanvueFetch|createFanvue(Text|Media)Post|\/api\/creator-publishing-queue\/fanvue\/run/)
})

test("scheduler architecture remains operator-run and is not duplicated in Vercel", () => {
  const vercel = read("vercel.json")
  const activation = read("supabase/manual/cpq_fanvue_scheduler_activation.sql")
  assert.doesNotMatch(vercel, /creator-publishing-queue\/fanvue\/run/)
  assert.match(activation, /sirens_forge_cpq_fanvue_runner/)
  assert.match(activation, /fanvue_cpq_cron_secret/)
})

test("OnlyFans remains assisted/manual and final verification dependency remains explicit", () => {
  const registry = read("lib/autopost/platformRegistry.ts")
  const schedulingUi = read("app/autopost/Task15PlanScheduling.tsx")
  const closeout = read("docs/operations/phase13-publishing-closeout.md")

  assert.match(registry, /OnlyFans uses assisted\/manual publishing through the internal queue; Sirens Forge does not post directly\./)
  assert.match(schedulingUi, /OnlyFans remains assisted\/manual/)
  assert.doesNotMatch(schedulingUi, /OnlyFans[^\n]{0,120}(?:direct scheduled publishing|publish directly)/i)

  assert.match(closeout, /GitHub issue #230 remains open/)
  assert.match(closeout, /human publishing required = true/)
  assert.match(closeout, /FINAL ACCEPTANCE PENDING/)
  assert.match(closeout, /No fake\/direct-database Production canary is acceptable/)
})
