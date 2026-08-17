import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration=readFileSync("supabase/migrations/20260817170000_cpq_fanvue_public_activation.sql","utf8")
const rollback=readFileSync("supabase/manual/cpq_fanvue_public_activation_rollback.sql","utf8")
const registry=readFileSync("lib/autopost/platformRegistry.ts","utf8")
const autopostService=readFileSync("lib/creator-publishing-queue/autopost/service.ts","utf8")
const schedulingService=readFileSync("lib/creator-publishing-queue/scheduling/service.ts","utf8")
const directScheduling=readFileSync("lib/creator-publishing-queue/scheduling/fanvueDirect.ts","utf8")
const schedulingUi=readFileSync("app/autopost/Task15PlanScheduling.tsx","utf8")
const workerRoute=readFileSync("app/api/creator-publishing-queue/fanvue/run/route.ts","utf8")
const workerRuntime=readFileSync("lib/creator-publishing-queue/fanvue/workerRuntime.ts","utf8")
const envExample=readFileSync(".env.example","utf8")
const vercel=readFileSync("vercel.json","utf8")

test("activation migration publishes one coherent Fanvue direct capability release without provider execution",()=>{
 assert.match(migration,/registry_version = 'task14\.20260817\.002'/)
 assert.match(migration,/where platform = 'fanvue'/)
 assert.match(migration,/publishing_mode = 'direct'/)
 assert.match(migration,/availability_status = 'available'/)
 assert.match(migration,/connector_can_publish_immediately = true/)
 assert.match(migration,/connector_can_upload_media = true/)
 assert.match(migration,/connector_can_schedule_directly = false/)
 assert.match(migration,/human_publishing_required = false/)
 assert.doesNotMatch(migration,/fetch\s*\(|fanvueFetch|provider_create|createPost|signedUrl|upload_session/i)
})

test("OAuth destination activation backfill is idempotent and does not update credential rows",()=>{
 assert.match(migration,/from public\.autopost_accounts a/)
 assert.match(migration,/a\.connection_status = 'CONNECTED'/)
 assert.match(migration,/not exists \(\s*select 1 from public\.creator_platform_accounts d\s*where d\.oauth_account_id = a\.id/s)
 assert.match(migration,/insert into public\.creator_platform_accounts/)
 assert.doesNotMatch(migration,/update public\.autopost_accounts/)
 assert.match(migration,/credentials_mutated', false/)
})

test("dedicated Fanvue plan creator is service-role only and server-derives execution shape",()=>{
 assert.match(migration,/create or replace function public\.creator_publishing_create_fanvue_autopost_plan/)
 assert.match(migration,/security definer/)
 assert.match(migration,/set search_path = public, pg_temp/)
 assert.match(migration,/oauth_account_id/)
 assert.match(migration,/publication_type/)
 assert.match(migration,/server_idempotency_key/)
 assert.match(migration,/grant execute on function public\.creator_publishing_create_fanvue_autopost_plan\([^;]+\) to service_role/)
 assert.match(migration,/revoke execute on function public\.creator_publishing_create_fanvue_autopost_plan\([^;]+\) from authenticated/)
 assert.match(migration,/revoke execute on function public\.creator_publishing_create_fanvue_autopost_plan\([^;]+\) from anon/)
})

test("rollback freezes new Fanvue plans without destructively deleting OAuth destinations",()=>{
 assert.match(rollback,/publishing_mode = 'disabled'/)
 assert.match(rollback,/availability_status = 'frozen'/)
 assert.match(rollback,/drop function if exists public\.creator_publishing_create_fanvue_autopost_plan/)
 assert.doesNotMatch(rollback,/delete\s+from\s+public\.creator_platform_accounts/i)
 assert.doesNotMatch(rollback,/delete\s+from\s+public\.autopost_accounts/i)
})

test("public registry activation is exact-env gated and X Reddit remain unavailable",()=>{
 assert.match(registry,/process\.env\.FANVUE_PUBLIC_ACTIVATION_ENABLED === "true"/)
 assert.match(registry,/platform\.id==="fanvue"/)
 assert.match(registry,/public_selectable:fanvueActive/)
 assert.match(registry,/id:"x"[\s\S]*public_selectable:false/)
 assert.match(registry,/id:"reddit"[\s\S]*public_selectable:false/)
})

test("Fanvue plan creation and scheduling route only Fanvue into dedicated direct paths",()=>{
 assert.match(autopostService,/creator_publishing_create_fanvue_autopost_plan/)
 assert.match(autopostService,/creator_publishing_create_autopost_plan/)
 assert.match(autopostService,/platforms\.has\("fanvue"\)/)
 assert.match(schedulingService,/data\?\.target_platform==="fanvue"/)
 assert.match(schedulingService,/scheduleFanvueDirectPlanCore/)
 assert.match(schedulingService,/cancelFanvueDirectPlanCore/)
 assert.match(schedulingService,/return schedulePlanCore\(input,deps\)/)
 assert.match(schedulingService,/return cancelPlanCore\(input,deps\)/)
 assert.match(directScheduling,/creator_publishing_schedule_plan/)
 assert.match(directScheduling,/operator_claim_cleanup/)
 assert.match(directScheduling,/performed!==false/)
})

test("launch worker is cron-authenticated, doubly gated, bounded, and processes scheduler before provider worker",()=>{
 assert.match(workerRoute,/authenticateSchedulerRequest/)
 assert.match(workerRoute,/process\.env\.FANVUE_PUBLIC_ACTIVATION_ENABLED!=="true"/)
 assert.match(workerRoute,/fanvueWorkerEnabled\(\)/)
 const scheduler=workerRoute.indexOf("runCreatorPublishingScheduler")
 const worker=workerRoute.indexOf("runProductionFanvueCpqWorker")
 assert(scheduler>0&&worker>scheduler)
 assert.doesNotMatch(workerRoute,/export async function POST/)
 assert.match(workerRuntime,/FANVUE_PUBLIC_ACTIVATION_ENABLED === "true"/)
 assert.match(workerRuntime,/FANVUE_CPQ_WORKER_ENABLED === "true"/)
 assert.match(workerRuntime,/const BATCH_SIZE = 1/)
 assert.match(workerRuntime,/runDormantFanvueCpqWorker/)
 assert.match(workerRuntime,/GENERATED_MEDIA_BUCKET/)
 assert.match(workerRuntime,/refreshFanvueAccessToken/)
})

test("scheduling UI stays truthful for Fanvue direct and OnlyFans assisted modes",()=>{
 assert.match(schedulingUi,/Fanvue direct plans publish through your connected Fanvue account/)
 assert.match(schedulingUi,/OnlyFans remains assisted\/manual/)
 assert.match(schedulingUi,/Schedulable Fanvue direct plan/)
 assert.match(schedulingUi,/!fanvueDirect/)
})

test("activation runtime gates remain false by default and this PR does not add a Fanvue cron blindly",()=>{
 assert.match(envExample,/CREATOR_PUBLISHING_SCHEDULER_ENABLED=false/)
 assert.match(envExample,/FANVUE_PUBLIC_ACTIVATION_ENABLED=false/)
 assert.match(envExample,/FANVUE_CPQ_WORKER_ENABLED=false/)
 assert.doesNotMatch(vercel,/creator-publishing-queue\/fanvue\/run/)
})

console.log("fanvuePublicActivation ok")
