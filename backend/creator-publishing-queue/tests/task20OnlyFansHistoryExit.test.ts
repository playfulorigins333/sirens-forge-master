import assert from "node:assert/strict"
import { filterAndSortOnlyFansHistoryEntries, ONLYFANS_HISTORY_FILTER_OPTIONS, ONLYFANS_HISTORY_SORT_OPTIONS } from "../../../lib/creator-publishing-queue/onlyfans-history/controls"
import { normalizeOnlyFansHistory } from "../../../lib/creator-publishing-queue/onlyfans-history/core"
import { INTENTIONALLY_EXCLUDED_ONLYFANS_HISTORY_ACTIONS, ONLYFANS_HISTORY_ACTIONS, PERSISTED_ONLYFANS_HISTORY_ACTIONS, jobStateLabel } from "../../../lib/creator-publishing-queue/onlyfans-history/presentation"

const persisted=[
  "operator_task_claimed","operator_task_released","operator_expired_claim_recovered","operator_preparation_started","operator_package_prepared","operator_handoff_ready",
  "creator_publishing_schedule_created","creator_publishing_schedule_rescheduled","creator_publishing_schedule_cancelled","creator_publishing_job_schedule_cancelled",
  "operator_task_claim_cleared_by_schedule","operator_task_claim_cleared_by_reschedule","operator_task_claim_cancelled_by_schedule_cancellation","operator_task_archived_by_schedule_cancellation","operator_task_claim_cleared_by_scheduler_gate",
  "creator_publishing_scheduler_event_claimed","creator_publishing_scheduler_event_superseded","creator_publishing_scheduler_gate_failed","creator_publishing_scheduler_event_processed",
  "operator_onlyfans_manual_completion_scheduler_superseded","operator_onlyfans_manual_completion","operator_onlyfans_manual_completion_plan_recomputed","operator_onlyfans_manual_completion_proof_recorded","operator_onlyfans_manual_completion_rejected",
]
assert.deepEqual([...PERSISTED_ONLYFANS_HISTORY_ACTIONS],persisted)
for(const action of persisted){assert.ok(ONLYFANS_HISTORY_ACTIONS[action],`missing ${action}`);assert.ok(ONLYFANS_HISTORY_ACTIONS[action].creator);assert.ok(ONLYFANS_HISTORY_ACTIONS[action].operator)}
for(const invented of ["operator_onlyfans_task_claimed","operator_onlyfans_task_released","operator_onlyfans_package_prepared","creator_publishing_job_scheduled","creator_publishing_job_rescheduled"]) assert.equal(invented in ONLYFANS_HISTORY_ACTIONS,false)
assert.ok(INTENTIONALLY_EXCLUDED_ONLYFANS_HISTORY_ACTIONS.creator_publishing_plan_created)
assert.ok(INTENTIONALLY_EXCLUDED_ONLYFANS_HISTORY_ACTIONS.creator_publishing_platform_job_created)
assert.equal(jobStateLabel("confirmed_posted_manual","creator"),"Manual publication confirmed")
assert.equal(jobStateLabel("unknown_internal_state","creator"),"Publication attempt")

const scheduleAt="2026-07-18T12:00:00.000Z"
const scheduleAudit={id:101,entity_type:"creator_publishing_plan",entity_id:"plan",action:"creator_publishing_schedule_created",created_at:scheduleAt,after_state:{request_fingerprint:"secret",jobs:[{job_id:"job-success",status:"scheduled",schedule_revision:1,mutated:true},{job_id:"job-failed",status:"failed",safe_error_code:"CREATOR_APPROVAL_MISSING",mutated:false}]}}
const creatorSuccess=normalizeOnlyFansHistory({job:{id:"job-success",schedule_timezone:"UTC"},auditEvents:[scheduleAudit]},"creator")
const creatorFailed=normalizeOnlyFansHistory({job:{id:"job-failed",schedule_timezone:"UTC"},auditEvents:[scheduleAudit]},"creator")
const operatorFailed=normalizeOnlyFansHistory({job:{id:"job-failed",schedule_timezone:"UTC"},auditEvents:[scheduleAudit]},"operator")
assert.equal(creatorSuccess.ok,true);assert.equal(creatorFailed.ok,true);assert.equal(operatorFailed.ok,true)
if(creatorSuccess.ok&&creatorFailed.ok&&operatorFailed.ok){
  assert.equal(creatorSuccess.entries.length,1);assert.equal(creatorSuccess.entries[0].scheduleOutcome,"scheduled");assert.equal(creatorSuccess.entries[0].scheduleRevision,1)
  assert.equal(creatorFailed.entries.length,1);assert.equal(creatorFailed.entries[0].scheduleOutcome,"failed");assert.match(creatorFailed.entries[0].explanation,/approval/i);assert.doesNotMatch(JSON.stringify(creatorFailed),/request_fingerprint|secret/)
  assert.match(operatorFailed.entries[0].explanation,/CREATOR_APPROVAL_MISSING/);assert.equal(operatorFailed.entries[0].metadata?.safeGateCode,"CREATOR_APPROVAL_MISSING");assert.doesNotMatch(JSON.stringify(operatorFailed),/request_fingerprint|secret/)
}

const mixed=normalizeOnlyFansHistory({job:{id:"job-mixed",schedule_timezone:"UTC"},auditEvents:[
  {id:2,entity_type:"creator_publishing_queue_task",entity_id:"task",action:"operator_task_claimed",after_state:{},created_at:scheduleAt},
  {id:10,entity_type:"creator_publishing_platform_job",entity_id:"job-mixed",action:"operator_onlyfans_manual_completion_proof_recorded",after_state:{platform_job_id:"job-mixed",queue_task_id:"task",evidence_intent_id:"evidence",final_post_url:"https://onlyfans.com/1/user",verified_sha256:"a".repeat(64),actual_size_bytes:100,normalized_mime_type:"image/png"},created_at:scheduleAt},
  {id:3,entity_type:"creator_publishing_plan",entity_id:"plan",action:"creator_publishing_schedule_cancelled",after_state:{},created_at:scheduleAt},
],evidenceIntents:[{id:"evidence",created_at:"2026-07-18T11:00:00.000Z"}]},"operator")
assert.equal(mixed.ok,true)
if(mixed.ok){
  assert.deepEqual(ONLYFANS_HISTORY_FILTER_OPTIONS.map(option=>option.label),["All events","Scheduling","Operator activity","Evidence","Completion and rejection"])
  assert.deepEqual(ONLYFANS_HISTORY_SORT_OPTIONS.map(option=>option.label),["Oldest first","Newest first"])
  assert.equal(filterAndSortOnlyFansHistoryEntries(mixed.entries,"operator","oldest").every(entry=>entry.category==="operator"),true)
  assert.equal(filterAndSortOnlyFansHistoryEntries(mixed.entries,"completion","oldest").every(entry=>entry.category==="completion"),true)
  const sameTime=mixed.entries.filter(entry=>entry.occurredAt===scheduleAt)
  assert.deepEqual(filterAndSortOnlyFansHistoryEntries(sameTime,"all","oldest").filter(entry=>entry.auditEventId).map(entry=>entry.auditEventId),["2","3","10"])
  assert.deepEqual(filterAndSortOnlyFansHistoryEntries(sameTime,"all","newest").filter(entry=>entry.auditEventId).map(entry=>entry.auditEventId),["2","3","10"])
  assert.equal(mixed.entries.filter(entry=>entry.provenance==="append_only_audit_evidence").every(entry=>Boolean(entry.auditEventId)),true)
}
const creatorProtected=normalizeOnlyFansHistory({job:{id:"job",schedule_timezone:"UTC"},auditEvents:[{id:7,entity_type:"creator_publishing_queue_task",entity_id:"task",action:"operator_task_claimed",after_state:{claim_token:"secret-token",request_fingerprint:"secret-fingerprint",server_path:"secret-path"},created_at:scheduleAt}]},"creator")
assert.doesNotMatch(JSON.stringify(creatorProtected),/secret-token|secret-fingerprint|secret-path|claim_token|request_fingerprint|server_path/)
console.log("task20 persisted catalog, schedule normalization, controls, and immutable-reference tests passed")
