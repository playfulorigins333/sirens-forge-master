import assert from "node:assert/strict"
import { normalizeOnlyFansHistory } from "../../../lib/creator-publishing-queue/onlyfans-history/core"
import {
  chooseHistoryQueueTask,
  resolveQueueTaskIdFromJobLinks,
  scopeHistoryAuditEvents,
} from "../../../lib/creator-publishing-queue/onlyfans-history/resolution"
import {
  compareTerminalHistoryRowsNewestFirst,
  paginateTerminalHistoryRows,
  TERMINAL_HISTORY_PAGE_SIZE,
} from "../../../lib/creator-publishing-queue/onlyfans-history/terminal-history"

const relation={content_package_id:"pkg",creator_id:"creator",platform_account_id:"acct",target_platform:"onlyfans"}
const archivedJob={id:"job-archived",job_state:"archived",schedule_timezone:"UTC",...relation}
const siblingJob={id:"job-sibling",job_state:"archived",schedule_timezone:"UTC",...relation}
const archivedTask={id:"task-archived",status:"archived",...relation}
const siblingTask={id:"task-sibling",status:"archived",...relation}
const task17Rows=[
  {action_type:"claim",platform_job_id:archivedJob.id,queue_task_id:archivedTask.id,claim_token:"do-not-expose"},
  {action_type:"progress_update",platform_job_id:archivedJob.id,queue_task_id:archivedTask.id,request_fingerprint:"do-not-expose"},
  {action_type:"release",platform_job_id:archivedJob.id,queue_task_id:archivedTask.id,stored_result:{secret:true}},
  {action_type:"expired_claim_recovery",platform_job_id:archivedJob.id,queue_task_id:archivedTask.id,internal_request_snapshot:{secret:true}},
]
assert.deepEqual(resolveQueueTaskIdFromJobLinks({platformJobId:archivedJob.id,idempotencyRows:task17Rows}),{queueTaskId:archivedTask.id,source:"operator_action_idempotency",ambiguous:false})
assert.equal(chooseHistoryQueueTask(archivedJob,[siblingTask,archivedTask],{platformJobId:archivedJob.id,idempotencyRows:task17Rows}),archivedTask)

const baseTime="2026-07-18T12:00:00.000Z"
const taskAudits=[
  {id:201,entity_type:"creator_publishing_queue_task",entity_id:archivedTask.id,action:"operator_task_claimed",after_state:{platform_job_id:archivedJob.id,queue_task_id:archivedTask.id},created_at:baseTime},
  {id:202,entity_type:"creator_publishing_queue_task",entity_id:archivedTask.id,action:"operator_preparation_started",after_state:{platform_job_id:archivedJob.id,queue_task_id:archivedTask.id},created_at:"2026-07-18T12:01:00.000Z"},
  {id:203,entity_type:"creator_publishing_queue_task",entity_id:archivedTask.id,action:"operator_handoff_ready",after_state:{platform_job_id:archivedJob.id,queue_task_id:archivedTask.id},created_at:"2026-07-18T12:02:00.000Z"},
  {id:204,entity_type:"creator_publishing_queue_task",entity_id:archivedTask.id,action:"operator_task_released",after_state:{platform_job_id:archivedJob.id,queue_task_id:archivedTask.id},created_at:"2026-07-18T12:03:00.000Z"},
  {id:205,entity_type:"creator_publishing_queue_task",entity_id:archivedTask.id,action:"operator_expired_claim_recovered",after_state:{platform_job_id:archivedJob.id,queue_task_id:archivedTask.id},created_at:"2026-07-18T12:04:00.000Z"},
  {id:206,entity_type:"creator_publishing_queue_task",entity_id:siblingTask.id,action:"operator_task_claimed",after_state:{platform_job_id:siblingJob.id,queue_task_id:siblingTask.id},created_at:"2026-07-18T12:05:00.000Z"},
]
const archivedScoped=scopeHistoryAuditEvents(taskAudits,archivedJob.id,archivedTask.id,[])
assert.deepEqual(archivedScoped.map(row=>row.id),[201,202,203,204,205])
const siblingScoped=scopeHistoryAuditEvents(taskAudits,siblingJob.id,siblingTask.id,[])
assert.deepEqual(siblingScoped.map(row=>row.id),[206])
const archivedView=normalizeOnlyFansHistory({job:archivedJob,task:archivedTask,auditEvents:archivedScoped,idempotencyRows:task17Rows},"operator")
assert.equal(archivedView.ok,true)
if(archivedView.ok){
  for(const action of ["operator_task_claimed","operator_preparation_started","operator_handoff_ready","operator_task_released","operator_expired_claim_recovered"]) assert.equal(archivedView.entries.some(entry=>entry.action===action),true)
  assert.doesNotMatch(JSON.stringify(archivedView),/do-not-expose|claim_token|request_fingerprint|stored_result|internal_request_snapshot/)
}
const creatorArchivedView=normalizeOnlyFansHistory({job:archivedJob,task:archivedTask,auditEvents:archivedScoped,idempotencyRows:task17Rows},"creator")
assert.doesNotMatch(JSON.stringify(creatorArchivedView),/do-not-expose|claim_token|request_fingerprint|stored_result|internal_request_snapshot/)

const conflictingRows=[...task17Rows,{action_type:"manual_completion_rejection",platform_job_id:archivedJob.id,queue_task_id:siblingTask.id}]
assert.deepEqual(resolveQueueTaskIdFromJobLinks({platformJobId:archivedJob.id,idempotencyRows:conflictingRows}),{queueTaskId:null,source:"operator_action_idempotency",ambiguous:true})
assert.equal(chooseHistoryQueueTask(archivedJob,[archivedTask,siblingTask],{platformJobId:archivedJob.id,idempotencyRows:conflictingRows}),null)
assert.deepEqual(resolveQueueTaskIdFromJobLinks({platformJobId:archivedJob.id,auditEvents:taskAudits.slice(0,5)}),{queueTaskId:archivedTask.id,source:"queue_task_audit",ambiguous:false})
assert.deepEqual(resolveQueueTaskIdFromJobLinks({platformJobId:archivedJob.id,auditEvents:[taskAudits[0],taskAudits[5]]}),{queueTaskId:archivedTask.id,source:"queue_task_audit",ambiguous:false})

const supersededAt="2026-07-18T13:00:00.000Z"
const schedulerView=normalizeOnlyFansHistory({job:{id:"job-scheduler",schedule_timezone:"UTC"},auditEvents:[
  {id:301,entity_type:"creator_publishing_scheduler_event",entity_id:"scheduler-one",action:"operator_onlyfans_manual_completion_scheduler_superseded",after_state:{status:"superseded"},created_at:supersededAt},
],schedulerEvents:[
  {id:"scheduler-one",event_type:"publish_due",status:"superseded",updated_at:supersededAt,superseded_at:supersededAt},
  {id:"scheduler-two",event_type:"operator_due",status:"processed",updated_at:"2026-07-18T13:01:00.000Z",processed_at:"2026-07-18T13:01:00.000Z"},
]},"operator")
assert.equal(schedulerView.ok,true)
if(schedulerView.ok){
  const supersessions=schedulerView.entries.filter(entry=>entry.metadata?.schedulerEventId==="scheduler-one" && entry.metadata?.status==="superseded")
  assert.equal(supersessions.length,1)
  assert.equal(supersessions[0].action,"operator_onlyfans_manual_completion_scheduler_superseded")
  assert.equal(supersessions[0].provenance,"append_only_audit_evidence")
  assert.equal(supersessions[0].auditEventId,"301")
  assert.equal(schedulerView.entries.some(entry=>entry.metadata?.schedulerEventId==="scheduler-two" && entry.action==="creator_publishing_scheduler_event_processed"),true)
}

function uuid(value:number){return `00000000-0000-4000-8000-${String(value).padStart(12,"0")}`}
const authorizedCreator="00000000-0000-4000-8000-000000009001"
const unauthorizedCreator="00000000-0000-4000-8000-000000009002"
const terminalRows=Array.from({length:53},(_,index)=>({
  id:uuid(index+1),creator_id:authorizedCreator,content_package_id:"pkg",target_platform:"onlyfans",publishing_mode:"assisted",job_state:index%2===0?"archived":"blocked",updated_at:index<30?"2026-07-18T15:00:00.000Z":"2026-07-18T14:00:00.000Z",
}))
terminalRows.push({id:uuid(999),creator_id:unauthorizedCreator,content_package_id:"other",target_platform:"onlyfans",publishing_mode:"assisted",job_state:"archived",updated_at:"2026-07-18T16:00:00.000Z"})
let cursor:string|null=null
const reached:string[]=[]
const pageSizes:number[]=[]
do{
  const page=paginateTerminalHistoryRows(terminalRows,[authorizedCreator],cursor)
  pageSizes.push(page.rows.length)
  reached.push(...page.rows.map(row=>row.id))
  cursor=page.nextCursor
}while(cursor)
assert.deepEqual(pageSizes,[TERMINAL_HISTORY_PAGE_SIZE,TERMINAL_HISTORY_PAGE_SIZE,3])
assert.equal(new Set(reached).size,53)
assert.equal(reached.includes(uuid(999)),false)
const expected=terminalRows.filter(row=>row.creator_id===authorizedCreator).sort(compareTerminalHistoryRowsNewestFirst).map(row=>row.id)
assert.deepEqual(reached,expected)

console.log("task20 terminal resolution, scheduler deduplication, and pagination tests passed")
