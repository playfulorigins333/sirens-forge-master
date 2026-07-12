import { strict as assert } from "node:assert"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import test from "node:test"
import { isValidIanaTimeZone, localWallTimeToZonedRfc3339, validateScheduleInstant } from "../../../lib/creator-publishing-queue/autopost/schedulerTime"
import { classifyLegacyQueueCompatibility, classifySchedulerProcessorResult, compareIdempotencyRecord, evaluateSchedulerGateFacts, normalizeExpectedRevisionMap, normalizeSchedulerErrorCode, parseSchedulerTrustedIso, schedulerHttpStatusForErrorCode, stableScheduleRequestFingerprint, stableTrustedSnapshotFingerprint } from "../../../lib/creator-publishing-queue/autopost/schedulerFacts"
import { applyCancellationUiResults, applyScheduleUiResults, preserveUncertainScheduleUiState, selectInitialScheduleTargets, selectRescheduleTargets } from "../../../lib/creator-publishing-queue/autopost/schedulerUiState"
import { AI_TWIN_CONSENT_VERSION } from "../../../lib/creator-publishing-queue/consent/copy"
import { getAiTwinConsentTextSha256 } from "../../../lib/creator-publishing-queue/consent/hash"

const migrationPath="supabase/migrations/20260711001300_creator_publishing_scheduler_due_state.sql"
const migration=readFileSync(migrationPath,"utf8")
const pkg=readFileSync("package.json","utf8")
const vercel=readFileSync("vercel.json","utf8")
const service=readFileSync("lib/creator-publishing-queue/autopost/scheduler.ts","utf8")
const ui=readFileSync("app/autopost/Task14AutopostOrchestration.tsx","utf8")
const route=readFileSync("app/api/creator-publishing-queue/scheduler/run/route.ts","utf8")
const postgresWorkflow=readFileSync(".github/workflows/task15-scheduler-postgres.yml","utf8")
const postgresRunner=readFileSync("backend/creator-publishing-queue/tests/runTask15PostgresIntegration.mjs","utf8")
const postgresSql=readFileSync("backend/creator-publishing-queue/tests/task15PostgresIntegration.sql","utf8")

test("Task 15 creates exactly one forward 01300 migration and leaves prior migrations intact",()=>{
 const files=readdirSync("supabase/migrations")
 assert.deepEqual(files.filter(f=>f.includes("20260711001300")),["20260711001300_creator_publishing_scheduler_due_state.sql"])
 for(const n of ["00100","00200","00300","00400","00500","00600","00700","00800","00900","01000","01100","01200"]) assert.equal(files.some(f=>f.includes(n)),true)
 assert.match(pkg,/autopostScheduler\.test\.ts/)
})

test("migration adds trusted schedule columns, scheduler events, ownership FKs, RLS, and service-role-only mutation",()=>{
 for(const col of ["intended_publish_at timestamptz","schedule_timezone text","operator_due_at timestamptz","schedule_revision integer","scheduled_at timestamptz","scheduled_by uuid","rescheduled_at timestamptz","cancelled_at timestamptz","cancelled_by uuid","cancellation_reason text"]) assert.match(migration,new RegExp(col.replace(/[()]/g,"\\$&")))
 assert.match(migration,/create table if not exists public\.creator_publishing_scheduler_events/)
 assert.match(migration,/event_type text not null check \(event_type in \('operator_due','publish_due'\)\)/)
 assert.match(migration,/event_status text not null default 'pending' check \(event_status in \('pending','processing','processed','blocked','superseded','cancelled'\)\)/)
 assert.match(migration,/foreign key \(publishing_plan_id, creator_id\)/)
 assert.match(migration,/foreign key \(platform_job_id, publishing_plan_id, creator_id\)/)
 assert.match(migration,/enable row level security/)
 assert.match(migration,/revoke all on table public\.creator_publishing_scheduler_events from public, anon, authenticated/)
 assert.match(migration,/grant all on table public\.creator_publishing_scheduler_events to service_role/)
 assert.match(migration,/unique \(platform_job_id, event_type, schedule_revision\)/)
 assert.match(migration,/where event_status in \('pending','processing'\)/)
 assert.doesNotMatch(migration,/insert into public\.creator_publishing_queue_tasks|update public\.creator_publishing_queue_tasks/)
})

test("database consistency rejects missing timezone, invalid assisted due, stale active events, and browser-owned protected fields",()=>{
 assert.match(migration,/schedule_timezone_required/)
 assert.match(migration,/assisted_operator_due_required/)
 assert.match(migration,/operator_due_at <= intended_publish_at/)
 assert.match(migration,/schedule_revision > 0/)
 assert.match(migration,/cancelled_metadata_consistent/)
 assert.match(migration,/event_status='superseded',superseded_at=v_now,lock_token=null,locked_at=null/)
 assert.match(service,/p_creator_id:creator/)
 assert.doesNotMatch(service,/creatorId\s*:\s*input|publishingMode|capability_registry_version|source_package_fingerprint/)
})

test("trusted scheduling command implements per-destination isolation, gates, modes, idempotency, and 60-minute assisted lead time",()=>{
 assert.match(service,/ASSISTED_OPERATOR_LEAD_MINUTES = 60/)
 assert.match(migration,/p_intended_publish_at - interval '60 minutes'/)
 assert.match(migration,/ASSISTED_LEAD_TIME_REQUIRED/)
 assert.match(migration,/scheduler_locked_jobs[\s\S]+order by j\.id for update/)
 assert.match(migration,/creator_publishing_schedule_idempotency/)
 assert.match(migration,/IDEMPOTENCY_CONFLICT/)
 assert.match(migration,/creator_publishing_job_source_is_current/)
 assert.match(migration,/j\.target_platform='fanvue'/)
 assert.match(migration,/cap\.availability_status <> 'available' or cap\.publishing_mode='disabled' or j\.publishing_mode='disabled'/)
 assert.match(migration,/when 'assisted' then 'scheduled_internally'/)
 assert.match(migration,/when 'direct' then 'ready_to_publish'/)
 assert.match(migration,/when 'planner' then 'package_ready'/)
 assert.doesNotMatch(service,/fetch\(|postXTextOnlyAutopost|credentials|cookies|proxy|2FA/i)
})

test("rescheduling and cancellation preserve history and use expected revisions",()=>{
 assert.match(migration,/p_expected_schedule_revisions/)
 assert.match(migration,/STALE_SCHEDULE_REVISION/)
 assert.match(migration,/v_rev:=coalesce\(j\.schedule_revision,0\)\+1/)
 assert.match(migration,/event_status='superseded'/)
 assert.match(migration,/creator_publishing_job_rescheduled/)
 assert.match(migration,/creator_publishing_cancel_schedule/)
 assert.match(migration,/CANCELLATION_REASON_REQUIRED/)
 assert.match(migration,/job_state='archived'/)
 assert.match(migration,/event_status='cancelled'/)
 assert.match(migration,/creator_publishing_plan_cancelled/)
 assert.doesNotMatch(migration,/delete from public\.creator_publishing_scheduler_events|delete from public\.creator_publishing_platform_jobs|delete from public\.creator_publishing_plans/)
})

test("worker uses cron secret, bounded batch, lock tokens, SKIP LOCKED, expired lock recovery, safe summary, and mode-specific due states",()=>{
 assert.match(route,/runtime="nodejs"/)
 assert.match(route,/dynamic="force-dynamic"/)
 assert.match(service,/process\.env\.CRON_SECRET\|\|process\.env\.VERCEL_CRON_SECRET/)
 assert.match(service,/if\(!secret\)return false/)
 assert.match(service,/authorization/)
 assert.match(migration,/for update of e skip locked/)
 assert.match(migration,/limit least\(greatest\(coalesce\(p_limit,25\),1\),50\)/)
 assert.match(migration,/lock_token=gen_random_uuid\(\)/)
 assert.match(migration,/locked_at < now\(\) - make_interval/)
 assert.match(migration,/processing_attempts=processing_attempts\+1/)
 assert.match(migration,/event_type='operator_due'[\s\S]+then 'awaiting_operator'/)
 assert.match(migration,/event_type='publish_due'[\s\S]+publishing_mode='assisted'[\s\S]+then 'due_now'/)
 assert.match(migration,/event_type='publish_due'[\s\S]+publishing_mode='direct'[\s\S]+connector_can_publish_immediately[\s\S]+direct_publish_queued/)
 assert.match(migration,/event_type='publish_due'[\s\S]+publishing_mode='planner'[\s\S]+ready_for_export/)
 assert.doesNotMatch(migration,/set job_state='confirmed_posted_manual'|set job_state='published_direct'|platform_post_id/)
 assert.match(service,/summary=\{scanned:0,claimed:0,processed:0,blocked:0,skipped:0,failed:0\}/)
})

test("due-time gate rechecks block stale or invalidated jobs and aggregate parent through canonical helper",()=>{
 assert.match(migration,/creator_publishing_job_source_is_current\(j\.id\)/)
 assert.match(migration,/creator_publishing_due_state_transition_blocked/)
 assert.match(migration,/job_state=case when coalesce\(\(v_gate->>'hard'\)::boolean,false\) then 'blocked' else 'needs_fix' end/)
 assert.match(migration,/event_status='blocked'/)
 assert.match(migration,/event_status='superseded'[\s\S]+schedule_revision=e\.schedule_revision/)
 assert.match(migration,/creator_publishing_recalculate_plan_status/)
 assert.match(migration,/creator_publishing_aggregate_plan_status/)
 assert.match(migration,/creator_publishing_due_state_transition_completed/)
})

test("strict IANA timezone and RFC3339 validation covers DST and calendar edge cases",()=>{
 assert.equal(isValidIanaTimeZone("America/New_York"),true)
 assert.equal(isValidIanaTimeZone("Asia/Kolkata"),true)
 assert.equal(isValidIanaTimeZone("Etc/GMT+5"),false)
 for(const bad of ["","UTC+05:00","+05:00","Mars/Olympus"," America/New_York"]) assert.equal(isValidIanaTimeZone(bad),false)
 assert.throws(()=>validateScheduleInstant("2026-03-08T02:30:00-05:00","America/New_York"),/OFFSET_TIMEZONE_INCOMPATIBLE/)
 assert.doesNotThrow(()=>validateScheduleInstant("2026-11-01T01:30:00-04:00","America/New_York"))
 assert.doesNotThrow(()=>validateScheduleInstant("2026-11-01T01:30:00-05:00","America/New_York"))
 assert.throws(()=>validateScheduleInstant("2026-11-01T01:30:00-06:00","America/New_York"),/OFFSET_TIMEZONE_INCOMPATIBLE/)
 assert.throws(()=>validateScheduleInstant("2026-02-29T12:00:00Z","UTC"))
 assert.doesNotThrow(()=>validateScheduleInstant("2028-02-29T12:00:00Z","UTC"))
 assert.doesNotThrow(()=>validateScheduleInstant("2026-07-12T17:30:00+05:30","Asia/Kolkata"))
 assert.doesNotThrow(()=>validateScheduleInstant("2026-07-12T09:00:00-07:00","America/Los_Angeles"))
 assert.doesNotThrow(()=>validateScheduleInstant("2026-07-12T13:00:00+04:00","Asia/Dubai"))
 for(const bad of ["2026-13-01T00:00:00Z","2026-04-31T00:00:00Z","2026-01-01T24:00:00Z","2026-01-01T00:00:00+25:00","not a date"]) assert.throws(()=>validateScheduleInstant(bad,"UTC"))
})

test("minimal creator API/UI and cron preserve platform-neutral safety boundaries",()=>{
 assert.match(ui,/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/)
 assert.match(ui,/Schedule Publishing Plan/)
 assert.match(ui,/Reschedule/)
 assert.match(ui,/Cancel plan/)
 assert.match(ui,/Cancel destination/)
 assert.match(vercel,/"path": "\/api\/autopost\/run"[\s\S]*"schedule": "\*\/5 \* \* \* \*"/)
 assert.match(vercel,/"path": "\/api\/creator-publishing-queue\/scheduler\/run"[\s\S]*"schedule": "\*\/5 \* \* \* \*"/)
 assert.doesNotMatch(ui,/proof upload|credentials|cookie|2FA|browser automation|proxy/i)
 for(const f of ["app/api/autopost/run/route.ts","lib/autopost/fanvueOAuth.ts"]) assert.ok(readFileSync(f,"utf8").length>0)
})

test("review fixes: composite FK has unique key and raw scheduler internals stay service-role-only",()=>{
 assert.match(migration,/creator_publishing_jobs_id_plan_creator_unique unique \(id, publishing_plan_id, creator_id\)/)
 assert.match(migration,/foreign key \(platform_job_id, publishing_plan_id, creator_id\) references public\.creator_publishing_platform_jobs\(id, publishing_plan_id, creator_id\)/)
 assert.doesNotMatch(migration,/grant select on table public\.creator_publishing_scheduler_events to authenticated/)
 assert.doesNotMatch(migration,/creator_publishing_scheduler_events_creator_read/)
 for(const field of ["lock_token","locked_at","processing_attempts","last_error_code"]) assert.match(migration,new RegExp(field))
 assert.match(migration,/grant all on table public\.creator_publishing_scheduler_events to service_role/)
})

test("review fixes: every Task 15 security definer has explicit service-role-only privilege contract",()=>{
 const funcs=[
  ["creator_publishing_recalculate_plan_status","creator_publishing_recalculate_plan_status\\(uuid\\)"],
  ["creator_publishing_scheduler_fact_snapshot","creator_publishing_scheduler_fact_snapshot\\(uuid,text,text\\)"],
  ["creator_publishing_scheduler_gate","creator_publishing_scheduler_gate\\(uuid,text,text\\)"],
  ["creator_publishing_schedule_plan","creator_publishing_schedule_plan\\(uuid,uuid,timestamptz,text,text,text,text,uuid\\[\\],jsonb,text\\)"],
  ["creator_publishing_cancel_schedule","creator_publishing_cancel_schedule\\(uuid,uuid,uuid,text\\)"],
  ["creator_publishing_claim_due_scheduler_events","creator_publishing_claim_due_scheduler_events\\(integer,integer\\)"],
  ["creator_publishing_process_scheduler_event","creator_publishing_process_scheduler_event\\(uuid,uuid,text,text\\)"],
 ]
 for(const [name,sig] of funcs){
  assert.match(migration,new RegExp(`create or replace function public\\.${name}[\\s\\S]+security definer[\\s\\S]+set search_path=public,pg_temp`,"i"))
  assert.match(migration,new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated`))
  assert.match(migration,new RegExp(`grant execute on function public\\.${sig} to service_role`))
 }
})

test("review fixes: canonical gate covers required trusted facts with narrow safe codes",()=>{
 assert.match(migration,/creator_publishing_scheduler_gate/)
 for(const code of ["PLAN_OWNERSHIP_INVALID","PACKAGE_OWNERSHIP_INVALID","DESTINATION_ACCOUNT_INVALID","CAPABILITY_SNAPSHOT_STALE","FANVUE_NOT_AVAILABLE","COMPLIANCE_NOT_PASSED","COMPLIANCE_BLOCKED","COMPLIANCE_CURRENT_EVIDENCE_REQUIRED","COMPLIANCE_LATER_BLOCKING_REVIEW","CREATOR_APPROVAL_REQUIRED","CREATOR_VERIFICATION_REQUIRED","DESTINATION_ACCOUNT_VERIFICATION_REQUIRED","AI_TWIN_CONSENT_REQUIRED","CO_PERFORMER_RELEASE_REQUIRED","GENERATED_MEDIA_PROVENANCE_REQUIRED","STALE_SOURCE_FINGERPRINT","ACTIVE_QUEUE_TASK_CONFLICT","ACTIVE_PUBLICATION_JOB_CONFLICT"]) assert.match(migration,new RegExp(code))
 assert.doesNotMatch(migration,/creator_publishing_build_compliance_facts/)
 assert.match(migration,/g\.user_id <> j\.creator_id and g\.user_id is distinct from v_profile_id/)
 assert.match(migration,/g\.status is distinct from 'completed'/)
 assert.match(migration,/r2_bucket/) ; assert.match(migration,/r2_key/)
 assert.match(migration,/placeholder/) ; assert.match(migration,/is_test/) ; assert.match(migration,/unsafe/)
})

test("review fixes: idempotency uses a stable request fingerprint before mutations and locks snapshot facts before new writes",()=>{
 assert.match(migration,/pg_advisory_xact_lock/)
 assert.match(migration,/select \* into v_plan[\s\S]+for update/)
 assert.match(migration,/v_request_canonical:=jsonb_build_object[\s\S]+expected_schedule_revisions[\s\S]+assisted_lead_policy/)
 assert.match(migration,/select \* into v_existing[\s\S]+return v_existing\.result/)
 assert.match(migration,/create temp table scheduler_locked_jobs[\s\S]+order by j\.id for update/)
 assert.match(migration,/create temp table scheduler_locked_capabilities/)
 assert.match(migration,/create temp table scheduler_locked_media/)
 assert.match(migration,/create temp table scheduler_locked_generations/)
 assert.match(migration,/create temp table scheduler_gate_snapshot/)
 const request=migration.indexOf("v_request_canonical:=jsonb_build_object")
 const idem=migration.indexOf("select * into v_existing")
 const locks=migration.indexOf("create temp table scheduler_locked_jobs")
 const mutate=migration.indexOf("update public.creator_publishing_platform_jobs set intended_publish_at")
 assert.ok(request>0 && idem>request && locks>idem && mutate>locks)
})

test("review fixes: processing locks job before event and clears lock fields for final statuses",()=>{
 assert.match(migration,/select id, platform_job_id, publishing_plan_id, creator_id, schedule_revision into e0/)
 const planLock=migration.indexOf("select * into p from public.creator_publishing_plans")
 const jobLock=migration.indexOf("select * into j from public.creator_publishing_platform_jobs",planLock)
 const eventLock=migration.indexOf("select * into e from public.creator_publishing_scheduler_events",jobLock)
 assert.ok(planLock>0&&jobLock>planLock&&eventLock>jobLock)
 for(const status of ["processed","blocked","superseded","cancelled"]) assert.match(migration,new RegExp(`${status}[\\s\\S]+lock_token=null,locked_at=null`))
 assert.match(migration,/j\.schedule_revision<>e\.schedule_revision/)
 assert.match(migration,/event_status='processing'/)
})

test("review fixes: terminal truth and predecessor states are preserved",()=>{
 for(const state of ["published_direct","confirmed_posted_manual","exported","direct_publish_failed","failed_manual_upload","skipped","blocked","platform_rejected","archived"]) assert.match(migration,new RegExp(state))
 assert.match(migration,/if j\.cancelled_at is not null then/)
 assert.match(migration,/if j\.job_state = any\(terminal_states\) then/)
 assert.match(migration,/JOB_NOT_FOUND/)
 assert.match(migration,/already_cancelled/)
 assert.match(migration,/already_terminal/)
 assert.match(migration,/j\.job_state='scheduled_internally' then 'awaiting_operator'/)
 assert.match(migration,/j\.job_state in \('scheduled_internally','awaiting_operator'\) then 'due_now'/)
 assert.match(migration,/j\.job_state='ready_to_publish'[\s\S]+connector_can_publish_immediately[\s\S]+direct_publish_queued/)
 assert.match(migration,/j\.job_state='package_ready' then 'ready_for_export'/)
 assert.doesNotMatch(migration,/set job_state='published_direct'|set job_state='confirmed_posted_manual'/)
})

test("review fixes: local wall-time helper does not use browser timezone and handles DST ambiguity",()=>{
 assert.deepEqual(localWallTimeToZonedRfc3339("2026-03-08T02:30","America/New_York"),{ok:false,code:"NONEXISTENT_LOCAL_TIME"})
 const amb=localWallTimeToZonedRfc3339("2026-11-01T01:30","America/New_York")
 assert.equal(amb.ok,false); if(!amb.ok&&amb.code==="AMBIGUOUS_LOCAL_TIME") assert.deepEqual(amb.offsets.sort(),["-04:00","-05:00"])
 assert.equal(localWallTimeToZonedRfc3339("2026-11-01T01:30","America/New_York","-04:00").ok,true)
 assert.equal(localWallTimeToZonedRfc3339("2026-11-01T01:30","America/New_York","-05:00").ok,true)
 assert.deepEqual(localWallTimeToZonedRfc3339("2026-11-01T01:30","America/New_York","-06:00"),{ok:false,code:"INVALID_OFFSET"})
 assert.equal(localWallTimeToZonedRfc3339("2026-07-12T00:00","UTC").ok,true)
 assert.match((localWallTimeToZonedRfc3339("2026-07-12T17:30","Asia/Kolkata") as any).rfc3339,/\+05:30$/)
 assert.match((localWallTimeToZonedRfc3339("2026-07-12T09:00","America/Los_Angeles") as any).rfc3339,/-07:00$/)
 assert.match((localWallTimeToZonedRfc3339("2026-07-12T13:00","Asia/Dubai") as any).rfc3339,/\+04:00$/)
})

test("review fixes: UI uses stable action key, explicit timezone conversion, and real returned revisions",()=>{
 assert.match(ui,/localWallTimeToZonedRfc3339\(publishAt,timezone,explicitOffset\|\|undefined\)/)
 assert.doesNotMatch(ui,/new Date\(publishAt\)\.toISOString\(\)/)
 assert.match(ui,/actionKey/) ; assert.match(ui,/actionCanonical/)
 assert.match(ui,/Retry will reuse the same action key/)
 assert.match(ui,/hasScheduled&&<button/)
 assert.match(ui,/applyScheduleUiResults\(s,body\.results\?\?\[\],reschedule\?"reschedule":"schedule"\)/)
 assert.doesNotMatch(ui,/Math\.max\(1|map\(\(\)=>1\)/)
})

test("review fixes: scheduler service has server-only boundary and safe DTO parser",()=>{
 assert.match(service,/import "server-only"/)
 assert.match(service,/parseScheduleResult/)
 assert.match(service,/allowedScheduleKeys/)
 assert.match(service,/INVALID_REQUEST_FIELD/)
 assert.match(service,/MALFORMED_TRUSTED_RESPONSE/)
 assert.doesNotMatch(service,/return data\}/)
 assert.doesNotMatch(service,/last_error_code|source_package_fingerprint/)
})


test("behavioral gate tests cover approved packages, escalations, media, consent, co-performer, ownership, and conflicts",()=>{
 const base={creatorId:"11111111-1111-4111-8111-111111111111",profileId:"22222222-2222-4222-8222-222222222222",jobState:"draft",planOk:true,packageOk:true,accountOk:true,targetPlatform:"onlyfans",publishingMode:"assisted",capability:{available:true,mode:"assisted",registryVersionMatches:true,requiresTrustedAccountVerification:true},contentPackageId:"66666666-6666-4666-8666-666666666666",platformAccountId:"77777777-7777-4777-8777-777777777777",package:{complianceStatus:"passed",compliancePolicyVersion:"v1",creatorApprovalStatus:"approved",creatorApprovedAt:"2026-07-12T00:00:00Z",creatorApprovedBy:"11111111-1111-4111-8111-111111111111",aiFlag:"ai_generated",secondPersonPresent:false},complianceReviews:[{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",reviewSource:"automated",outcome:"pass",compliancePolicyVersion:"v1",createdAt:"2026-07-12T00:00:00Z"}],creatorVerificationStatus:"verified",accountVerificationStatus:"verified",aiTwinConsent:{creatorId:"11111111-1111-4111-8111-111111111111",status:"granted",revokedAt:null,attestationVersion:AI_TWIN_CONSENT_VERSION,attestationTextSha256:getAiTwinConsentTextSha256()},coPerformers:[],media:[{source:"ai_pipeline",generationId:"33333333-3333-4333-8333-333333333333",storageKey:"private/key",mimeType:"image/png",sha256:"a".repeat(64),generation:{id:"33333333-3333-4333-8333-333333333333",userId:"11111111-1111-4111-8111-111111111111",status:"completed",r2Bucket:"b",r2Key:"k",metadata:{}}}],sourceIsCurrent:true,activeQueueConflict:false,activePublicationJobConflict:false}
 assert.deepEqual(evaluateSchedulerGateFacts(base as any),{ok:true,code:"OK",hard:false})
 assert.deepEqual(evaluateSchedulerGateFacts({...base,package:{...base.package,complianceStatus:"escalated_approved"},complianceReviews:[{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",reviewSource:"human",outcome:"escalate",reason:"approved by reviewer",compliancePolicyVersion:"v1",createdAt:"2026-07-12T00:00:00Z"}]} as any),{ok:true,code:"OK",hard:false})
 assert.equal(evaluateSchedulerGateFacts({...base,complianceReviews:[...(base as any).complianceReviews,{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",reviewSource:"human",outcome:"manual_review",compliancePolicyVersion:"v1",createdAt:"2026-07-12T00:01:00Z"}]} as any).code,"COMPLIANCE_LATER_BLOCKING_REVIEW")
 assert.equal(evaluateSchedulerGateFacts({...base,media:[]} as any).code,"MEDIA_REQUIRED")
 assert.equal(evaluateSchedulerGateFacts({...base,media:[{...base.media[0],sha256:"bad"}]} as any).code,"GENERATED_MEDIA_PROVENANCE_REQUIRED")
 assert.equal(evaluateSchedulerGateFacts({...base,package:{...base.package,secondPersonPresent:true},coPerformers:[]} as any).code,"CO_PERFORMER_RELEASE_REQUIRED")
 assert.equal(evaluateSchedulerGateFacts({...base,media:[{...base.media[0],generation:{...base.media[0].generation!,userId:base.profileId!}}]} as any).code,"OK")
 assert.equal(evaluateSchedulerGateFacts({...base,media:[{...base.media[0],generation:{...base.media[0].generation!,userId:"44444444-4444-4444-8444-444444444444"}}]} as any).code,"GENERATED_MEDIA_PROVENANCE_REQUIRED")
 assert.equal(evaluateSchedulerGateFacts({...base,activeQueueConflict:true} as any).code,"ACTIVE_QUEUE_TASK_CONFLICT")
 assert.equal(evaluateSchedulerGateFacts({...base,capability:{...base.capability,registryVersionMatches:false}} as any).code,"CAPABILITY_SNAPSHOT_STALE")
})

test("behavioral idempotency and per-job revision helpers reject stale or missing concurrency data",()=>{
 const req={creatorId:"11111111-1111-4111-8111-111111111111",planId:"22222222-2222-4222-8222-222222222222",targetJobIds:["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],intendedPublishAt:"2026-07-12T12:00:00Z",scheduleTimezone:"UTC",actionType:"schedule" as const,expectedScheduleRevisions:{},assistedLeadPolicyVersion:"task15_60_minutes_v1"}
 const fp=stableScheduleRequestFingerprint(req)
 const record={requestFingerprint:fp,result:{planId:req.planId,results:[{jobId:req.targetJobIds[0],scheduleRevision:1}]}}
 assert.deepEqual(compareIdempotencyRecord(record,fp),{kind:"replay",result:record.result})
 assert.deepEqual(compareIdempotencyRecord(record,stableScheduleRequestFingerprint({...req,intendedPublishAt:"2026-07-12T13:00:00Z"})),{kind:"conflict",code:"IDEMPOTENCY_CONFLICT"})
 assert.deepEqual(normalizeExpectedRevisionMap({"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":2,"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb":7},req.targetJobIds,true),{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":2,"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb":7})
 assert.throws(()=>normalizeExpectedRevisionMap({"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":2},req.targetJobIds,true),/EXPECTED_REVISIONS_REQUIRED/)
 assert.throws(()=>normalizeExpectedRevisionMap({"cccccccc-cccc-4ccc-8ccc-cccccccccccc":2},req.targetJobIds,true),/UNEXPECTED_REVISION_JOB/)
})

test("behavioral UTC and explicit offset parser reject malformed choices and retain DST behavior",()=>{
 assert.equal(isValidIanaTimeZone("UTC"),true)
 assert.deepEqual(localWallTimeToZonedRfc3339("2026-07-12T00:00","UTC"),{ok:true,rfc3339:"2026-07-12T00:00:00Z",offset:"+00:00",ambiguous:false})
 for(const bad of ["Zjunk","junk-05:00","+05:99","+14:30"]) assert.deepEqual(localWallTimeToZonedRfc3339("2026-07-12T00:00","UTC",bad),{ok:false,code:"INVALID_OFFSET"})
 assert.equal(localWallTimeToZonedRfc3339("2026-07-12T00:00","Pacific/Kiritimati","+14:00").ok,true)
 assert.deepEqual(localWallTimeToZonedRfc3339("2026-03-08T02:30","America/New_York"),{ok:false,code:"NONEXISTENT_LOCAL_TIME"})
 const amb=localWallTimeToZonedRfc3339("2026-11-01T01:30","America/New_York")
 assert.equal(amb.ok,false)
})


test("remaining blockers: lock queries use existing creator_id keys and no nonexistent id columns",()=>{
 assert.match(migration,/scheduler_locked_creator_verifications[\s\S]+order by v\.creator_id for update/)
 assert.match(migration,/scheduler_locked_ai_consents[\s\S]+order by c\.creator_id for update/)
 assert.doesNotMatch(migration,/creator_publishing_creator_verifications v[\s\S]{0,120}order by v\.id/)
 assert.doesNotMatch(migration,/creator_publishing_ai_twin_consents c[\s\S]{0,120}order by c\.id/)
 assert.match(readFileSync("supabase/migrations/20260710000900_creator_publishing_trusted_verification.sql","utf8"),/creator_id uuid primary key/)
 assert.match(readFileSync("supabase/migrations/20260710001000_creator_publishing_ai_twin_consent.sql","utf8"),/creator_id uuid primary key/)
})

test("remaining blockers: plan cancellation metadata satisfies Task 14 constraint and individual cancellation recalculates",()=>{
 const task14=readFileSync("supabase/migrations/20260711001200_creator_publishing_autopost_orchestration.sql","utf8")
 assert.match(task14,/creator_publishing_plans_cancelled_metadata check \(status <> 'cancelled' or cancelled_at is not null\)/)
 assert.match(migration,/update public\.creator_publishing_plans set status='cancelled',cancelled_at=v_now,cancelled_by=p_creator_id,cancellation_reason=btrim\(p_reason\),updated_at=v_now/)
 assert.match(migration,/if p_platform_job_id is not null and v_plan\.status <> 'cancelled' then perform public\.creator_publishing_recalculate_plan_status/)
 assert.match(migration,/already_terminal/)
 assert.match(migration,/already_cancelled/)
 assert.match(migration,/event_status='cancelled'[\s\S]+event_status in \('pending','processing'\)/)
})

test("remaining blockers: initial schedule cannot bypass reschedule concurrency",()=>{
 assert.match(migration,/p_action_type='schedule'[\s\S]+ALREADY_SCHEDULED/)
 assert.match(migration,/coalesce\(j\.schedule_revision,0\)<>0/)
 assert.match(migration,/j\.job_state <> 'draft'/)
 assert.match(migration,/exists\(select 1 from pg_temp\.scheduler_locked_events/)
 assert.match(migration,/p_action_type='reschedule'[\s\S]+EXPECTED_REVISION_REQUIRED[\s\S]+INVALID_RESCHEDULE_STATE/)
 assert.match(ui,/initialTargetIds/)
 assert.match(ui,/rescheduleTargetIds/)
 assert.match(ui,/No unscheduled destinations remain available for initial scheduling/)
})

test("remaining blockers: cross-plan idempotency reuses creator-key lookup and conflicts before mutation",()=>{
 assert.match(migration,/primary key \(creator_id, idempotency_key\)/)
 assert.match(migration,/where creator_id=p_creator_id and idempotency_key=v_key for update/)
 assert.doesNotMatch(migration,/idempotency_key=v_key and publishing_plan_id=p_publishing_plan_id for update/)
 const req={creatorId:"11111111-1111-4111-8111-111111111111",planId:"22222222-2222-4222-8222-222222222222",targetJobIds:["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],intendedPublishAt:"2026-07-12T12:00:00Z",scheduleTimezone:"UTC",actionType:"schedule" as const}
 const fp=stableScheduleRequestFingerprint(req)
 assert.equal(compareIdempotencyRecord({requestFingerprint:fp,result:{ok:true}},stableScheduleRequestFingerprint({...req,planId:"33333333-3333-4333-8333-333333333333"})).kind,"conflict")
})

test("remaining blockers: due-time facts are locked after plan-job-event and before transition",()=>{
 const plan=migration.indexOf("select * into p from public.creator_publishing_plans")
 const job=migration.indexOf("select * into j from public.creator_publishing_platform_jobs", plan)
 const event=migration.indexOf("select * into e from public.creator_publishing_scheduler_events", job)
 const facts=migration.indexOf("create temp table process_locked_capabilities", event)
 const gate=migration.indexOf("v_gate:=public.creator_publishing_scheduler_gate", facts)
 const transition=migration.indexOf("v_state:=case", gate)
 assert.ok(plan>0&&job>plan&&event>job&&facts>event&&gate>facts&&transition>gate)
 for(const name of ["process_locked_capabilities","process_locked_packages","process_locked_accounts","process_locked_creator_verifications","process_locked_ai_consents","process_locked_reviews","process_locked_coperformers","process_locked_media","process_locked_generations","process_locked_queue_conflicts","process_locked_publication_conflicts"]) assert.match(migration,new RegExp(name))
 assert.doesNotMatch(migration,/creator_publishing_scheduler_facts:/)
})

test("remaining blockers: generation ownership rejects null and unrelated owners",()=>{
 const base={creatorId:"11111111-1111-4111-8111-111111111111",profileId:"22222222-2222-4222-8222-222222222222",jobState:"draft",planOk:true,packageOk:true,accountOk:true,targetPlatform:"onlyfans",publishingMode:"assisted",capability:{available:true,mode:"assisted",registryVersionMatches:true,requiresTrustedAccountVerification:true},contentPackageId:"66666666-6666-4666-8666-666666666666",platformAccountId:"77777777-7777-4777-8777-777777777777",package:{complianceStatus:"passed",compliancePolicyVersion:"v1",creatorApprovalStatus:"approved",creatorApprovedAt:"2026-07-12T00:00:00Z",creatorApprovedBy:"11111111-1111-4111-8111-111111111111",aiFlag:"ai_generated"},complianceReviews:[{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",reviewSource:"automated",outcome:"pass",compliancePolicyVersion:"v1",createdAt:"2026-07-12T00:00:00Z"}],creatorVerificationStatus:"verified",accountVerificationStatus:"verified",aiTwinConsent:{creatorId:"11111111-1111-4111-8111-111111111111",status:"granted",revokedAt:null,attestationVersion:AI_TWIN_CONSENT_VERSION,attestationTextSha256:getAiTwinConsentTextSha256()},media:[{source:"ai_pipeline",generationId:"33333333-3333-4333-8333-333333333333",storageKey:"private/key",mimeType:"image/png",sha256:"a".repeat(64),generation:{id:"33333333-3333-4333-8333-333333333333",userId:"11111111-1111-4111-8111-111111111111",status:"completed",r2Bucket:"b",r2Key:"k",metadata:{}}}],sourceIsCurrent:true}
 assert.equal(evaluateSchedulerGateFacts(base as any).code,"OK")
 assert.equal(evaluateSchedulerGateFacts({...base,media:[{...base.media[0],generation:{...base.media[0].generation,userId:base.profileId}}]} as any).code,"OK")
 for(const owner of [null,"44444444-4444-4444-8444-444444444444","55555555-5555-4555-8555-555555555555"]) assert.equal(evaluateSchedulerGateFacts({...base,media:[{...base.media[0],generation:{...base.media[0].generation,userId:owner}}]} as any).code,"GENERATED_MEDIA_PROVENANCE_REQUIRED")
 assert.match(migration,/g\.user_id is null/)
})

test("remaining blockers: snapshot fingerprint covers trusted facts and separates request fingerprint",()=>{
 for(const name of ["locked_jobs","capabilities","packages","accounts","creator_verifications","ai_consents","reviews","co_performers","media","generations","active_queue_conflicts","active_publication_conflicts","gates"]) assert.match(migration,new RegExp(name))
 const request={creatorId:"11111111-1111-4111-8111-111111111111",planId:"22222222-2222-4222-8222-222222222222",targetJobIds:["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],intendedPublishAt:"2026-07-12T12:00:00Z",scheduleTimezone:"UTC",actionType:"schedule" as const}
 const requestFp=stableScheduleRequestFingerprint(request)
 assert.equal(requestFp,stableScheduleRequestFingerprint(request))
 const snap={jobs:[{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",revision:0}],ai_consents:[{attestation_version:"v1",attestation_text_sha256:"a".repeat(64),revoked_at:null}],gates:[{code:"OK"}]}
 assert.notEqual(stableTrustedSnapshotFingerprint(snap),stableTrustedSnapshotFingerprint({...snap,ai_consents:[{attestation_version:"v2",attestation_text_sha256:"b".repeat(64),revoked_at:null}]}))
})

test("remaining blockers: cancellation not-found and strict cancellation DTO behavior are safe",()=>{
 assert.match(migration,/jsonb_build_object\('ok',false,'code','JOB_NOT_FOUND'/)
 assert.match(service,/if\(data\?\.ok===false\)/)
 assert.match(service,/cancelledJobs=Number\(raw\.cancelledJobs/)
 assert.match(service,/context\.jobId&&rows\.length!==1/)
 assert.match(service,/outcome==="archived"&&\(r\.jobState!=="archived"/)
 assert.match(service,/outcome==="already_terminal"\|\|outcome==="already_cancelled"/)
})

test("remaining blockers: processor verifies protected row counts before audit and processed response",()=>{
 assert.match(migration,/get diagnostics v_job_rows = row_count/)
 assert.match(migration,/get diagnostics v_event_rows = row_count/)
 assert.match(migration,/raise exception 'PROTECTED_UPDATE_MISSED'/)
 assert.doesNotMatch(migration,/return jsonb_build_object\('ok',false,'failed',true,'code','PROTECTED_UPDATE_MISSED'\)/)
 assert.doesNotMatch(migration,/job_state <> any\(terminal_states\)/)
 const successUpdate=migration.indexOf("update public.creator_publishing_platform_jobs set job_state=v_state")
 const eventUpdate=migration.indexOf("update public.creator_publishing_scheduler_events set event_status='processed'", successUpdate)
 const rowCheck=migration.indexOf("if v_job_rows<>1 or v_event_rows<>1", eventUpdate)
 const audit=migration.indexOf("creator_publishing_due_state_transition_completed", rowCheck)
 assert.ok(successUpdate>0&&eventUpdate>successUpdate&&rowCheck>eventUpdate&&audit>rowCheck)
 assert.match(migration,/p\.status='cancelled'/)
})

test("final review: legacy Task 5 queue compatibility allows only the matching ready_for_handoff artifact",()=>{
 const base={creatorId:"11111111-1111-4111-8111-111111111111",contentPackageId:"22222222-2222-4222-8222-222222222222",targetPlatform:"onlyfans",platformAccountId:"33333333-3333-4333-8333-333333333333"}
 const task={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",...base,status:"ready_for_handoff"}
 const before=JSON.stringify(task)
 assert.deepEqual(classifyLegacyQueueCompatibility({...base,queueTasks:[task]}),{ok:true,code:"OK",compatibleLegacyQueueTask:task})
 assert.equal(JSON.stringify(task),before)
 for(const status of ["scheduled_internally","due_now","claimed","draft","needs_compliance_review","needs_creator_approval","needs_fix","mystery"]) assert.equal(classifyLegacyQueueCompatibility({...base,queueTasks:[{...task,status}]}).code,"ACTIVE_QUEUE_TASK_CONFLICT")
 assert.equal(classifyLegacyQueueCompatibility({...base,queueTasks:[{...task,creatorId:"99999999-9999-4999-8999-999999999999"}]}).code,"ACTIVE_QUEUE_TASK_CONFLICT")
 assert.equal(classifyLegacyQueueCompatibility({...base,queueTasks:[{...task,platformAccountId:"99999999-9999-4999-8999-999999999999"}]}).code,"ACTIVE_QUEUE_TASK_CONFLICT")
 assert.equal(classifyLegacyQueueCompatibility({...base,queueTasks:[{...task,targetPlatform:"fansly"}]}).code,"ACTIVE_QUEUE_TASK_CONFLICT")
 assert.equal(classifyLegacyQueueCompatibility({...base,queueTasks:[task,{...task,id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}]}).code,"ACTIVE_QUEUE_TASK_CONFLICT")
 assert.equal(classifyLegacyQueueCompatibility({...base,queueTasks:[{...task,status:"confirmed_posted_manual"},{...task,status:"archived"}]}).code,"OK")
 assert.match(migration,/creator_publishing_scheduler_queue_gate/)
 assert.match(migration,/status='ready_for_handoff'/)
 assert.match(migration,/compatible_legacy_queue_task/)
 assert.doesNotMatch(migration,/update public\.creator_publishing_queue_tasks|delete from public\.creator_publishing_queue_tasks/)
})

test("final review: current policy-version compliance evidence semantics are behavioral",()=>{
 const base={creatorId:"11111111-1111-4111-8111-111111111111",profileId:"22222222-2222-4222-8222-222222222222",jobState:"draft",planOk:true,packageOk:true,accountOk:true,targetPlatform:"onlyfans",publishingMode:"assisted",contentPackageId:"66666666-6666-4666-8666-666666666666",platformAccountId:"77777777-7777-4777-8777-777777777777",capability:{available:true,mode:"assisted",registryVersionMatches:true,requiresTrustedAccountVerification:true},package:{complianceStatus:"passed",compliancePolicyVersion:"v2",creatorApprovalStatus:"approved",creatorApprovedAt:"2026-07-12T00:00:00Z",creatorApprovedBy:"11111111-1111-4111-8111-111111111111"},creatorVerificationStatus:"verified",accountVerificationStatus:"verified",media:[{source:"ai_pipeline",generationId:"33333333-3333-4333-8333-333333333333",storageKey:"private/key",mimeType:"image/png",sha256:"a".repeat(64),generation:{id:"33333333-3333-4333-8333-333333333333",userId:"11111111-1111-4111-8111-111111111111",status:"completed",r2Bucket:"b",r2Key:"k",metadata:{}}}],sourceIsCurrent:true}
 const pass={id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",reviewSource:"automated",outcome:"pass",compliancePolicyVersion:"v2",createdAt:"2026-07-12T00:02:00Z"}
 assert.equal(evaluateSchedulerGateFacts({...base,complianceReviews:[{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",reviewSource:"human",outcome:"manual_review",compliancePolicyVersion:"v2",createdAt:"2026-07-12T00:01:00Z"},pass]} as any).code,"OK")
 assert.equal(evaluateSchedulerGateFacts({...base,complianceReviews:[pass,{id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",reviewSource:"human",outcome:"manual_review",compliancePolicyVersion:"v2",createdAt:"2026-07-12T00:03:00Z"}]} as any).code,"COMPLIANCE_LATER_BLOCKING_REVIEW")
 assert.equal(evaluateSchedulerGateFacts({...base,complianceReviews:[{...pass,compliancePolicyVersion:"v1"}]} as any).code,"COMPLIANCE_CURRENT_EVIDENCE_REQUIRED")
 assert.equal(evaluateSchedulerGateFacts({...base,package:{...base.package,complianceStatus:"escalated_approved"},complianceReviews:[{id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",reviewSource:"human",outcome:"escalate",reason:"valid",compliancePolicyVersion:"v2",createdAt:"2026-07-12T00:02:00Z"}]} as any).code,"OK")
 assert.equal(evaluateSchedulerGateFacts({...base,package:{...base.package,complianceStatus:"escalated_approved"},complianceReviews:[{id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",reviewSource:"human",outcome:"escalate",reason:"valid",compliancePolicyVersion:"v1",createdAt:"2026-07-12T00:02:00Z"}]} as any).code,"COMPLIANCE_CURRENT_EVIDENCE_REQUIRED")
 assert.equal(evaluateSchedulerGateFacts({...base,package:{...base.package,complianceStatus:"escalated_approved"},complianceReviews:[{id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",reviewSource:"human",outcome:"escalate",reason:" ",compliancePolicyVersion:"v2",createdAt:"2026-07-12T00:02:00Z"}]} as any).code,"COMPLIANCE_CURRENT_EVIDENCE_REQUIRED")
 assert.equal(evaluateSchedulerGateFacts({...base,complianceReviews:[pass,{id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",reviewSource:"human",outcome:"block",compliancePolicyVersion:"v2",createdAt:"2026-07-12T00:03:00Z"}]} as any).code,"COMPLIANCE_LATER_BLOCKING_REVIEW")
 assert.equal(evaluateSchedulerGateFacts({...base,complianceReviews:[]} as any).code,"COMPLIANCE_CURRENT_EVIDENCE_REQUIRED")
 assert.match(migration,/review_source='automated' and r\.outcome='pass'/)
 assert.match(migration,/r\.compliance_policy_version=pkg\.compliance_policy_version/)
 assert.match(migration,/COMPLIANCE_LATER_BLOCKING_REVIEW/)
})

test("final review: needs_fix can reschedule but blocked remains terminal",()=>{
 assert.match(migration,/j\.job_state not in \('scheduled_internally','awaiting_operator','due_now','ready_to_publish','package_ready','ready_for_export','needs_fix'\)/)
 assert.match(migration,/event_status='superseded'/)
 assert.match(migration,/creator_publishing_job_rescheduled/)
 assert.match(migration,/STALE_SCHEDULE_REVISION/)
 assert.match(migration,/terminal_states constant text\[\].*'blocked'/s)
})

test("final review: worker classification never treats failed or malformed processor results as processed",()=>{
 assert.equal(classifySchedulerProcessorResult({ok:false,blocked:true}),"blocked")
 assert.equal(classifySchedulerProcessorResult({ok:true,skipped:true}),"skipped")
 assert.equal(classifySchedulerProcessorResult({ok:true,processed:true}),"processed")
 assert.equal(classifySchedulerProcessorResult({ok:false,failed:true}),"failed")
 assert.equal(classifySchedulerProcessorResult({ok:false}),"failed")
 assert.equal(classifySchedulerProcessorResult({processed:true}),"failed")
 assert.equal(classifySchedulerProcessorResult(null),"failed")
 assert.match(service,/classifySchedulerProcessorResult\(r\.data\)/)
 assert.match(service,/summary\[classification\]\+\+/)
 assert.doesNotMatch(service,/else summary\.processed\+\+/)
})


test("closure: authoritative AI-twin consent policy version and hash are server-owned and enforced",()=>{
 const hash=getAiTwinConsentTextSha256()
 assert.equal(hash.length,64)
 assert.match(hash,/^[a-f0-9]{64}$/)
 const base={creatorId:"11111111-1111-4111-8111-111111111111",profileId:"22222222-2222-4222-8222-222222222222",jobState:"draft",planOk:true,packageOk:true,accountOk:true,targetPlatform:"onlyfans",publishingMode:"assisted",contentPackageId:"66666666-6666-4666-8666-666666666666",platformAccountId:"77777777-7777-4777-8777-777777777777",capability:{available:true,mode:"assisted",registryVersionMatches:true,requiresTrustedAccountVerification:true},package:{complianceStatus:"passed",compliancePolicyVersion:"v2",creatorApprovalStatus:"approved",creatorApprovedAt:"2026-07-12T00:00:00Z",creatorApprovedBy:"11111111-1111-4111-8111-111111111111",aiFlag:"ai_generated"},complianceReviews:[{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",reviewSource:"automated",outcome:"pass",compliancePolicyVersion:"v2",createdAt:"2026-07-12T00:02:00Z"}],creatorVerificationStatus:"verified",accountVerificationStatus:"verified",aiTwinConsent:{creatorId:"11111111-1111-4111-8111-111111111111",status:"granted",revokedAt:null,attestationVersion:AI_TWIN_CONSENT_VERSION,attestationTextSha256:hash},media:[{source:"ai_pipeline",generationId:"33333333-3333-4333-8333-333333333333",storageKey:"private/key",mimeType:"image/png",sha256:"a".repeat(64),generation:{id:"33333333-3333-4333-8333-333333333333",userId:"11111111-1111-4111-8111-111111111111",status:"completed",r2Bucket:"b",r2Key:"k",metadata:{}}}],sourceIsCurrent:true}
 assert.equal(evaluateSchedulerGateFacts(base as any).code,"OK")
 assert.equal(evaluateSchedulerGateFacts({...base,aiTwinConsent:{...base.aiTwinConsent,attestationVersion:"old"}} as any).code,"AI_TWIN_CONSENT_POLICY_STALE")
 assert.equal(evaluateSchedulerGateFacts({...base,aiTwinConsent:{...base.aiTwinConsent,attestationTextSha256:"b".repeat(64)}} as any).code,"AI_TWIN_CONSENT_HASH_INVALID")
 assert.equal(evaluateSchedulerGateFacts({...base,aiTwinConsent:{...base.aiTwinConsent,attestationTextSha256:"not-a-hash"}} as any).code,"AI_TWIN_CONSENT_HASH_INVALID")
 assert.equal(evaluateSchedulerGateFacts({...base,aiTwinConsent:{...base.aiTwinConsent,revokedAt:"2026-07-12T00:00:00Z"}} as any).code,"AI_TWIN_CONSENT_REQUIRED")
 assert.equal(evaluateSchedulerGateFacts({...base,aiTwinConsent:null} as any).code,"AI_TWIN_CONSENT_REQUIRED")
 assert.equal(evaluateSchedulerGateFacts({...base,aiTwinConsent:{...base.aiTwinConsent,creatorId:"99999999-9999-4999-8999-999999999999"}} as any).code,"AI_TWIN_CONSENT_REQUIRED")
 assert.match(service,/p_expected_ai_twin_consent_version:AI_TWIN_CONSENT_VERSION/)
 assert.match(service,/p_expected_ai_twin_consent_text_sha256:getAiTwinConsentTextSha256\(\)/)
 assert.match(migration,/attestation_version is distinct from p_expected_ai_twin_consent_version/)
 assert.match(migration,/attestation_text_sha256.*p_expected_ai_twin_consent_text_sha256/)
 assert.doesNotMatch(service.match(/const allowedScheduleKeys[^\n]+/)?.[0]??"",/expected_ai_twin|attestation/i)
})

test("closure: cancellation closes active events even for terminal and already-cancelled jobs and audits closures",()=>{
 assert.match(migration,/create temp table cancel_locked_events[\s\S]+order by e\.id for update/)
 assert.match(migration,/update public\.creator_publishing_scheduler_events set event_status='cancelled',cancelled_at=v_now,lock_token=null,locked_at=null,last_error_code='CANCELLED_BY_CREATOR'/)
 assert.match(migration,/creator_publishing_scheduler_events_cancelled/)
 const eventUpdate=migration.indexOf("last_error_code='CANCELLED_BY_CREATOR'")
 const alreadyCancelled=migration.indexOf("outcome','already_cancelled'",eventUpdate)
 const alreadyTerminal=migration.indexOf("outcome','already_terminal'",eventUpdate)
 const archive=migration.indexOf("job_state='archived'",eventUpdate)
 assert.ok(eventUpdate>0&&alreadyCancelled>eventUpdate&&alreadyTerminal>eventUpdate&&archive>eventUpdate)
 assert.match(migration,/closedSchedulerEvents/)
 assert.match(migration,/idempotent',\(not v_plan_changed and v_count=0 and v_events_changed=0 and not v_audit_created\)/)
})

test("closure: pure UI schedule state keeps failed reschedules as reschedule targets",()=>{
 const jobs=[{id:"job-a",jobState:"draft"},{id:"job-b",jobState:"draft"}]
 let state={}
 assert.deepEqual(selectInitialScheduleTargets(jobs,state),["job-a","job-b"])
 state=applyScheduleUiResults(state,[{jobId:"job-a",ok:true,jobState:"scheduled_internally",scheduleRevision:1}],"schedule")
 assert.deepEqual(selectInitialScheduleTargets(jobs,state),["job-b"])
 assert.deepEqual(selectRescheduleTargets(state),["job-a"])
 state=applyScheduleUiResults(state,[{jobId:"job-a",ok:false,code:"STALE_SCHEDULE_REVISION",scheduleRevision:2}],"reschedule")
 assert.deepEqual(selectInitialScheduleTargets(jobs,state),["job-b"])
 assert.deepEqual(selectRescheduleTargets(state),["job-a"])
 assert.equal(state["job-a"].currentJobState,"scheduled_internally")
 assert.equal(state["job-a"].currentScheduleRevision,2)
 assert.equal(state["job-a"].lastActionCode,"STALE_SCHEDULE_REVISION")
 assert.equal(preserveUncertainScheduleUiState(state),state)
})

test("closure: malformed trusted responses are internal failures and invalid timestamps are sanitized",()=>{
 assert.equal(schedulerHttpStatusForErrorCode("UNAUTHENTICATED"),401)
 assert.equal(schedulerHttpStatusForErrorCode("INVALID_REQUEST_FIELD"),400)
 assert.equal(schedulerHttpStatusForErrorCode("IDEMPOTENCY_CONFLICT"),409)
 assert.equal(schedulerHttpStatusForErrorCode("PLAN_CANCELLED"),409)
 assert.equal(schedulerHttpStatusForErrorCode("AUTOPOST_SCHEMA_UNAVAILABLE"),503)
 assert.equal(schedulerHttpStatusForErrorCode("MALFORMED_TRUSTED_RESPONSE"),500)
 assert.throws(()=>parseSchedulerTrustedIso("not-a-date"),(e:any)=>e.code==="MALFORMED_TRUSTED_RESPONSE"&&!String(e.message).includes("RangeError"))
 assert.equal(parseSchedulerTrustedIso("2026-07-12T00:00:00Z"),"2026-07-12T00:00:00.000Z")
})

test("closure: cancelled plans fail closed for new schedule or reschedule requests while exact replay remains before validation",()=>{
 const existing=migration.indexOf("select * into v_existing from public.creator_publishing_schedule_idempotency")
 const replay=migration.indexOf("return v_existing.result || jsonb_build_object('idempotent',true)",existing)
 const cancelled=migration.indexOf("v_plan.status='cancelled'",replay)
 const locks=migration.indexOf("create temp table scheduler_locked_jobs",cancelled)
 assert.ok(existing>0&&replay>existing&&cancelled>replay&&locks>cancelled)
 assert.match(migration,/code','PLAN_CANCELLED'/)
 assert.match(service,/"PLAN_CANCELLED"/)
})

test("runtime correction: cancelled plans are top-level PLAN_CANCELLED conflicts, not successful per-job results",()=>{
 const replay=migration.indexOf("return v_existing.result || jsonb_build_object('idempotent',true)")
 const cancelled=migration.indexOf("v_plan.status='cancelled' then raise exception 'PLAN_CANCELLED'",replay)
 const locks=migration.indexOf("create temp table scheduler_locked_jobs",cancelled)
 assert.ok(replay>0&&cancelled>replay&&locks>cancelled)
 assert.doesNotMatch(migration,/code','PLAN_CANCELLED','scheduleRevision',0/)
 assert.equal(schedulerHttpStatusForErrorCode("PLAN_CANCELLED"),409)
 assert.match(service,/PLAN_CANCELLED:"This publishing plan has been cancelled/)
})

test("runtime correction: Assisted claim ordering claims only earliest active event per job",()=>{
 assert.match(migration,/not exists \([\s\S]+prior\.platform_job_id=e\.platform_job_id[\s\S]+prior\.event_status in \('pending','processing'\)[\s\S]+prior\.due_at,case when prior\.event_type='operator_due' then 0 else 1 end,prior\.id/)
 assert.match(migration,/order by e\.due_at,case when e\.event_type='operator_due' then 0 else 1 end,e\.id/)
 assert.match(migration,/for update of e skip locked/)
 assert.match(migration,/limit least\(greatest\(coalesce\(p_limit,25\),1\),50\)[\s\S]+for update of e skip locked/)
 assert.match(migration,/select claimed\.id,claimed\.lock_token from claimed order by claimed\.due_at,claimed\.event_order,claimed\.id/)
})

test("runtime correction: Assisted obsolete operator events are superseded, not blocked",()=>{
 const obsolete=migration.indexOf("OBSOLETE_OPERATOR_DUE")
 const unsupported=migration.indexOf("UNSUPPORTED_DUE_TRANSITION",obsolete)
 assert.ok(obsolete>0&&unsupported>obsolete)
 assert.match(migration,/e\.event_type='operator_due' and j\.publishing_mode='assisted' and j\.job_state='due_now'[\s\S]+event_status='superseded'/)
 assert.match(migration,/e\.event_type='publish_due' and j\.publishing_mode='assisted' and v_state='due_now'[\s\S]+event_type='operator_due'[\s\S]+event_status in \('pending','processing'\)/)
 assert.doesNotMatch(migration,/OBSOLETE_OPERATOR_DUE[\s\S]{0,200}creator_publishing_due_state_transition_blocked/)
})

test("runtime correction: UI target selectors exactly match SQL predecessor contract",()=>{
 const states=["scheduled_internally","awaiting_operator","due_now","ready_to_publish","package_ready","ready_for_export","needs_fix"]
 const state=Object.fromEntries(states.map((jobState,i)=>[`job-${i}`,{jobId:`job-${i}`,currentJobState:jobState,currentScheduleRevision:1,hasEverScheduled:true}]))
 assert.deepEqual(selectRescheduleTargets(state).sort(),states.map((_,i)=>`job-${i}`))
 for(const bad of ["direct_publish_queued","publishing_direct","retry_scheduled","authentication_required","claimed","scheduled_on_platform","awaiting_post_confirmation","published_direct","blocked","archived","future_state"]){
   assert.deepEqual(selectRescheduleTargets({bad:{jobId:"bad",currentJobState:bad,currentScheduleRevision:1,hasEverScheduled:true}}),[])
 }
 assert.deepEqual(selectInitialScheduleTargets([{id:"draft",jobState:"draft"},{id:"unknown",jobState:"future_state"}],{}),["draft"])
 assert.deepEqual(selectInitialScheduleTargets([{id:"scheduled",jobState:"draft"}],{scheduled:{jobId:"scheduled",currentJobState:"draft",currentScheduleRevision:1,hasEverScheduled:true}}),[])
 assert.match(migration,/j\.job_state not in \('scheduled_internally','awaiting_operator','due_now','ready_to_publish','package_ready','ready_for_export','needs_fix'\)/)
})

test("runtime correction: UI revisions are monotonic after failed schedule and cancellation results",()=>{
 let state=applyScheduleUiResults({},[{jobId:"job-a",ok:true,jobState:"scheduled_internally",scheduleRevision:1}],"schedule")
 state=applyScheduleUiResults(state,[{jobId:"job-a",ok:false,code:"STALE_SCHEDULE_REVISION",scheduleRevision:0}],"reschedule")
 assert.equal(state["job-a"].currentScheduleRevision,1)
 assert.deepEqual(selectInitialScheduleTargets([{id:"job-a",jobState:"draft"}],state),[])
 assert.deepEqual(selectRescheduleTargets(state),["job-a"])
 state=applyScheduleUiResults(state,[{jobId:"job-a",ok:false,code:"STALE_SCHEDULE_REVISION",scheduleRevision:3}],"reschedule")
 assert.equal(state["job-a"].currentScheduleRevision,3)
 state=applyCancellationUiResults(state,[{jobId:"job-a",outcome:"already_terminal",jobState:"scheduled_internally",scheduleRevision:0}])
 assert.equal(state["job-a"].currentScheduleRevision,3)
})

test("runtime correction: strict parser source enforces successful revision progression",()=>{
 assert.match(service,/context\.actionType==="schedule"&&rev!==1/)
 assert.match(service,/context\.actionType==="reschedule"[\s\S]+rev!==Number\(expectedRevision\)\+1/)
 assert.match(service,/parseScheduleResult\(data,\{planId:cleanId\(input\.publishingPlanId\),targetJobIds,actionType:action,expectedScheduleRevisions:expected\}\)/)
})

test("runtime correction: revision-map validation errors carry safe HTTP 400 codes",()=>{
 assert.throws(()=>normalizeExpectedRevisionMap({extra:1},["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],true),(e:any)=>e.code==="UNEXPECTED_REVISION_JOB")
 assert.throws(()=>normalizeExpectedRevisionMap({"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":"1"},["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],true),(e:any)=>e.code==="INVALID_EXPECTED_REVISION")
 assert.throws(()=>normalizeExpectedRevisionMap({},["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],true),(e:any)=>e.code==="EXPECTED_REVISIONS_REQUIRED")
 assert.equal(schedulerHttpStatusForErrorCode("UNEXPECTED_REVISION_JOB"),400)
 assert.equal(schedulerHttpStatusForErrorCode("INVALID_EXPECTED_REVISION"),400)
 assert.equal(schedulerHttpStatusForErrorCode("EXPECTED_REVISIONS_REQUIRED"),400)
 assert.match(service,/UNEXPECTED_REVISION_JOB/)
})

test("runtime correction: cancellation DTO validates counts, terminal states, and event audit fields",()=>{
 assert.match(service,/results\.filter\(r=>r\.outcome==="archived"\)\.length!==cancelledJobs/)
 assert.match(service,/outcome==="already_terminal"&&!terminalCancellationStates\.has/)
 assert.match(service,/r\.closedSchedulerEventIds!=null\) parseStringArrayStrict\(r\.closedSchedulerEventIds\)/)
 assert.match(service,/r\.eventAuditEventId!=null/)
 assert.match(service,/context\.jobId&&rows\.length!==1/)
})


test("database-runtime closure: normalizes PostgreSQL, schema, local, and malformed errors safely",()=>{
 for(const [error,code,status] of [
   [{code:"P0001",message:"PLAN_CANCELLED"},"PLAN_CANCELLED",409],
   [{code:"P0001",message:"IDEMPOTENCY_CONFLICT"},"IDEMPOTENCY_CONFLICT",409],
   [{code:"PGRST202",message:"Could not find the function public.creator_publishing_schedule_plan"},"AUTOPOST_SCHEMA_UNAVAILABLE",503],
   [{code:"42883",message:"function public.creator_publishing_schedule_plan does not exist"},"AUTOPOST_SCHEMA_UNAVAILABLE",503],
   [{code:"42P01",message:"relation creator_publishing_scheduler_events does not exist"},"AUTOPOST_SCHEMA_UNAVAILABLE",503],
   [{code:"P0001",message:"some internal exception"},"SCHEDULE_FAILED",500],
   [{code:"INVALID_EXPECTED_REVISION",message:"INVALID_EXPECTED_REVISION"},"INVALID_EXPECTED_REVISION",400],
   [{code:"MALFORMED_TRUSTED_RESPONSE",message:"RangeError: invalid time value"},"MALFORMED_TRUSTED_RESPONSE",500]
 ] as const){
   assert.equal(normalizeSchedulerErrorCode(error),code)
   assert.equal(schedulerHttpStatusForErrorCode(code),status)
 }
 assert.match(service,/normalizeSchedulerErrorCode\(e\)/)
 assert.doesNotMatch(service,/e\.code\|\|dbCode/)
})

test("database-runtime closure: bounded claim SQL limits in the locking select and audits claims",()=>{
 const fn=migration.slice(migration.indexOf("create or replace function public.creator_publishing_claim_due_scheduler_events"),migration.indexOf("create or replace function public.creator_publishing_process_scheduler_event"))
 const limit=fn.indexOf("limit least(greatest(coalesce(p_limit,25),1),50)")
 const lock=fn.indexOf("for update of e skip locked")
 assert.ok(limit>0&&lock>limit)
 assert.doesNotMatch(fn,/row_number\(\)/)
 assert.match(fn,/not exists \([\s\S]+prior\.platform_job_id=e\.platform_job_id[\s\S]+prior\.event_status in \('pending','processing'\)/)
 assert.match(fn,/order by e\.due_at,case when e\.event_type='operator_due' then 0 else 1 end,e\.id[\s\S]+limit least[\s\S]+for update of e skip locked/)
 assert.match(fn,/creator_publishing_scheduler_event_claimed/)
 assert.doesNotMatch(fn,/lock_token[^\n]+jsonb_build_object/)
})

test("database-runtime closure: processor validates token before every mutation and audits cleanup",()=>{
 const fn=migration.slice(migration.indexOf("create or replace function public.creator_publishing_process_scheduler_event"),migration.indexOf("revoke all on function public.creator_publishing_recalculate_plan_status"))
 const planLock=fn.indexOf("select * into p")
 const jobLock=fn.indexOf("select * into j")
 const eventLock=fn.indexOf("select * into e")
 const tokenCheck=fn.indexOf("e.lock_token is distinct from p_lock_token")
 const cancelledPlan=fn.indexOf("PLAN_CANCELLED")
 assert.ok(planLock>0&&jobLock>planLock&&eventLock>jobLock&&tokenCheck>eventLock&&cancelledPlan>tokenCheck)
 for(const code of ["PLAN_CANCELLED","JOB_NOT_FOUND","REVISION_SUPERSEDED","CANCELLED","TERMINAL_JOB","OBSOLETE_OPERATOR_DUE"]){
   const idx=fn.indexOf(code)
   assert.ok(idx>0,code)
   assert.ok(fn.slice(Math.max(0,idx-700),idx+900).includes("lock_token is not distinct from p_lock_token"),code)
   assert.ok(fn.slice(idx,idx+1000).includes("get diagnostics v_event_rows = row_count")||fn.slice(Math.max(0,idx-700),idx+900).includes("get diagnostics v_event_rows = row_count"),code)
 }
 assert.match(fn,/creator_publishing_scheduler_event_cancelled/)
 assert.match(fn,/creator_publishing_scheduler_event_superseded/)
 assert.match(fn,/superseded_event_ids/)
})


test("database-runtime closure: mocked scheduler service boundaries normalize safe database errors",async()=>{
 mkdirSync("node_modules/server-only",{recursive:true})
 writeFileSync("node_modules/server-only/package.json",JSON.stringify({name:"server-only",version:"0.0.0",type:"module",main:"index.js"}))
 writeFileSync("node_modules/server-only/index.js","")
 const {schedulePublishingPlan,cancelPublishingSchedule,httpStatusForSchedulerError}=await import("../../../lib/creator-publishing-queue/autopost/scheduler")
 const creator="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
 const plan="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
 const job="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
 const base={publishingPlanId:plan,intendedPublishAt:"2026-07-12T00:00:00Z",scheduleTimezone:"UTC",idempotencyKey:"runtime-key-004",targetJobIds:[job],actionType:"schedule"}
 const deps=(error:any)=>({getAuthenticatedUserId:async()=>creator,getAdminClient:()=>({rpc:async()=>({data:null,error})})})
 for(const [error,code,status] of [
   [{code:"P0001",message:"PLAN_CANCELLED"},"PLAN_CANCELLED",409],
   [{code:"P0001",message:"IDEMPOTENCY_CONFLICT"},"IDEMPOTENCY_CONFLICT",409],
   [{code:"PGRST202",message:"Could not find the function public.creator_publishing_schedule_plan"},"AUTOPOST_SCHEMA_UNAVAILABLE",503],
   [{code:"42883",message:"function public.creator_publishing_schedule_plan does not exist"},"AUTOPOST_SCHEMA_UNAVAILABLE",503],
   [{code:"42P01",message:"relation creator_publishing_scheduler_events does not exist"},"AUTOPOST_SCHEMA_UNAVAILABLE",503],
   [{code:"P0001",message:"internal exception"},"SCHEDULE_FAILED",500]
 ] as const){
   const result=await schedulePublishingPlan(base,deps(error))
   assert.equal(result.ok,false)
   assert.equal(result.code,code)
   assert.equal(httpStatusForSchedulerError(result.code),status)
 }
 const cancel=await cancelPublishingSchedule({publishingPlanId:plan,reason:"test cancellation"},deps({code:"P0001",message:"PLAN_CANCELLED"}))
 assert.equal(cancel.ok,false)
 assert.equal(cancel.code,"PLAN_CANCELLED")
 assert.equal(httpStatusForSchedulerError(cancel.code),409)
 const invalidOffset=await schedulePublishingPlan({...base,intendedPublishAt:"2026-07-12T00:00:00+15:00",idempotencyKey:"runtime-key-005"},{getAuthenticatedUserId:async()=>creator,getAdminClient:()=>({rpc:async()=>({data:null,error:null})})})
 assert.equal(invalidOffset.ok,false)
 assert.equal(invalidOffset.code,"INVALID_RFC3339_OFFSET")
 assert.equal(httpStatusForSchedulerError(invalidOffset.code),400)
 const malformed=await schedulePublishingPlan({...base,idempotencyKey:"runtime-key-006"},{getAuthenticatedUserId:async()=>creator,getAdminClient:()=>({rpc:async()=>({data:{ok:true,planId:plan,results:[{jobId:job,ok:true,jobState:"scheduled_internally",scheduleRevision:2,schedulerEventIds:["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],auditEventId:"1"}],auditEventIds:["1"]},error:null})})})
 assert.equal(malformed.ok,false)
 assert.equal(malformed.code,"MALFORMED_TRUSTED_RESPONSE")
 assert.equal(httpStatusForSchedulerError(malformed.code),500)
})

test("database-runtime closure: invalid RFC3339 offsets are safe creator-input errors",()=>{
 for(const instant of ["2026-07-12T00:00:00+14:30","2026-07-12T00:00:00+15:00","2026-07-12T00:00:00+05:99","2026-07-12T00:00:00Zjunk"]){
   assert.throws(()=>validateScheduleInstant(instant,"UTC"),(e:any)=>e.code==="INVALID_RFC3339_OFFSET"||e.code==="INVALID_RFC3339_INSTANT"||e.code==="OFFSET_TIMEZONE_INCOMPATIBLE")
 }
 assert.equal(validateScheduleInstant("2026-07-12T14:00:00+14:00","Pacific/Kiritimati").iso,"2026-07-12T00:00:00.000Z")
 assert.equal(schedulerHttpStatusForErrorCode("INVALID_RFC3339_OFFSET"),400)
 assert.match(service,/INVALID_RFC3339_OFFSET:"The publication instant contains an invalid UTC offset\."/)
})


test("database-runtime closure: PostgreSQL integration workflow installs migration chain and exercises real SQL scenarios",()=>{
 assert.match(postgresWorkflow,/postgres:15/)
 assert.match(postgresWorkflow,/node backend\/creator-publishing-queue\/tests\/runTask15PostgresIntegration\.mjs/)
 assert.match(postgresRunner,/ON_ERROR_STOP=1/)
 for(const migration of ["20260710000100","20260710000400","20260710001100","20260711001200","20260711001300"]){
   assert.match(postgresRunner,new RegExp(migration))
 }
 for(const scenario of ["initial schedule ok","exact schedule retry idempotent","changed request conflicts","reschedule increments once","new schedule on cancelled plan rejected","operator_due claimed first","expired recovery audit starts from processing","obsolete operator skipped before gate","direct path stops at direct_publish_queued","planner path stops at ready_for_export"]){
   assert.match(postgresSql,new RegExp(scenario.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")))
 }
 assert.match(postgresSql,/has_table_privilege\('anon','public\.creator_publishing_scheduler_events','SELECT'\)/)
 assert.match(postgresSql,/has_function_privilege\('service_role','public\.creator_publishing_claim_due_scheduler_events\(integer,integer\)'/)
})
