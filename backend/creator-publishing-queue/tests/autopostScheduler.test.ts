import { strict as assert } from "node:assert"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { isValidIanaTimeZone, localWallTimeToZonedRfc3339, validateScheduleInstant } from "../../../lib/creator-publishing-queue/autopost/schedulerTime"
import { compareIdempotencyRecord, evaluateSchedulerGateFacts, normalizeExpectedRevisionMap, stableScheduleRequestFingerprint } from "../../../lib/creator-publishing-queue/autopost/schedulerFacts"

const migrationPath="supabase/migrations/20260711001300_creator_publishing_scheduler_due_state.sql"
const migration=readFileSync(migrationPath,"utf8")
const pkg=readFileSync("package.json","utf8")
const vercel=readFileSync("vercel.json","utf8")
const service=readFileSync("lib/creator-publishing-queue/autopost/scheduler.ts","utf8")
const ui=readFileSync("app/autopost/Task14AutopostOrchestration.tsx","utf8")
const route=readFileSync("app/api/creator-publishing-queue/scheduler/run/route.ts","utf8")

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
 assert.match(migration,/p_expected_schedule_revision/)
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
  ["creator_publishing_scheduler_fact_snapshot","creator_publishing_scheduler_fact_snapshot\\(uuid\\)"],
  ["creator_publishing_scheduler_gate","creator_publishing_scheduler_gate\\(uuid\\)"],
  ["creator_publishing_schedule_plan","creator_publishing_schedule_plan\\(uuid,uuid,timestamptz,text,text,uuid\\[\\],jsonb,text\\)"],
  ["creator_publishing_cancel_schedule","creator_publishing_cancel_schedule\\(uuid,uuid,uuid,text\\)"],
  ["creator_publishing_claim_due_scheduler_events","creator_publishing_claim_due_scheduler_events\\(integer,integer\\)"],
  ["creator_publishing_process_scheduler_event","creator_publishing_process_scheduler_event\\(uuid,uuid\\)"],
 ]
 for(const [name,sig] of funcs){
  assert.match(migration,new RegExp(`create or replace function public\\.${name}[\\s\\S]+security definer[\\s\\S]+set search_path=public,pg_temp`,"i"))
  assert.match(migration,new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated`))
  assert.match(migration,new RegExp(`grant execute on function public\\.${sig} to service_role`))
 }
})

test("review fixes: canonical gate covers required trusted facts with narrow safe codes",()=>{
 assert.match(migration,/creator_publishing_scheduler_gate/)
 for(const code of ["PLAN_OWNERSHIP_INVALID","PACKAGE_OWNERSHIP_INVALID","DESTINATION_ACCOUNT_INVALID","CAPABILITY_SNAPSHOT_STALE","FANVUE_NOT_AVAILABLE","COMPLIANCE_NOT_PASSED","COMPLIANCE_BLOCKED","CREATOR_APPROVAL_REQUIRED","CREATOR_VERIFICATION_REQUIRED","DESTINATION_ACCOUNT_VERIFICATION_REQUIRED","AI_TWIN_CONSENT_REQUIRED","CO_PERFORMER_RELEASE_REQUIRED","BLOCKING_MANUAL_REVIEW","GENERATED_MEDIA_PROVENANCE_REQUIRED","STALE_SOURCE_FINGERPRINT","ACTIVE_QUEUE_TASK_CONFLICT","ACTIVE_PUBLICATION_JOB_CONFLICT"]) assert.match(migration,new RegExp(code))
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
 assert.match(migration,/select \* into p from public\.creator_publishing_plans[\s\S]+for update;\n select \* into j from public\.creator_publishing_platform_jobs[\s\S]+for update;\n select \* into e from public\.creator_publishing_scheduler_events/)
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
 assert.match(ui,/scheduleRevision:r\.scheduleRevision/)
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
 const base={creatorId:"11111111-1111-4111-8111-111111111111",profileId:"22222222-2222-4222-8222-222222222222",jobState:"draft",planOk:true,packageOk:true,accountOk:true,targetPlatform:"onlyfans",publishingMode:"assisted",capability:{available:true,mode:"assisted",registryVersionMatches:true,requiresTrustedAccountVerification:true},package:{complianceStatus:"passed",creatorApprovalStatus:"approved",creatorApprovedAt:"2026-07-12T00:00:00Z",creatorApprovedBy:"11111111-1111-4111-8111-111111111111",aiFlag:"ai_generated",secondPersonPresent:false},latestHumanReview:null,creatorVerificationStatus:"verified",accountVerificationStatus:"verified",aiTwinConsent:{status:"granted",revokedAt:null,attestationVersion:"v1"},coPerformers:[],media:[{source:"ai_pipeline",generationId:"33333333-3333-4333-8333-333333333333",storageKey:"private/key",mimeType:"image/png",sha256:"a".repeat(64),generation:{id:"33333333-3333-4333-8333-333333333333",userId:"11111111-1111-4111-8111-111111111111",status:"completed",r2Bucket:"b",r2Key:"k",metadata:{}}}],sourceIsCurrent:true,activeQueueConflict:false,activePublicationJobConflict:false}
 assert.deepEqual(evaluateSchedulerGateFacts(base as any),{ok:true,code:"OK",hard:false})
 assert.deepEqual(evaluateSchedulerGateFacts({...base,package:{...base.package,complianceStatus:"escalated_approved"},latestHumanReview:{outcome:"escalate",reason:"approved by reviewer"}} as any),{ok:true,code:"OK",hard:false})
 assert.equal(evaluateSchedulerGateFacts({...base,latestHumanReview:{outcome:"manual_review"}} as any).code,"BLOCKING_MANUAL_REVIEW")
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
