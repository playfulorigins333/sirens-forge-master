import assert from "node:assert/strict"
import { normalizeOnlyFansHistory } from "../../../lib/creator-publishing-queue/onlyfans-history/core"
import { chooseHistoryQueueTask, resolveQueueTaskIdFromJobLinks } from "../../../lib/creator-publishing-queue/onlyfans-history/resolution"

const shared={content_package_id:"pkg",creator_id:"creator",platform_account_id:"acct",target_platform:"onlyfans"}
const jobA={id:"job-a",job_state:"confirmed_posted_manual",schedule_timezone:"UTC",created_at:"2026-07-18T08:00:00Z",...shared}
const jobB={id:"job-b",job_state:"confirmed_posted_manual",schedule_timezone:"UTC",created_at:"2026-07-18T08:05:00Z",...shared}
const taskA={id:"task-a",status:"confirmed_posted_manual",posted_at:"2026-07-18T09:00:00Z",final_post_url:"https://onlyfans.com/101/first",...shared}
const taskB={id:"task-b",status:"confirmed_posted_manual",posted_at:"2026-07-18T09:30:00Z",final_post_url:"https://onlyfans.com/202/second",...shared}
const proof=(job:string,task:string,evidence:string,url:string,id:number)=>({id,entity_type:"creator_publishing_platform_job",entity_id:job,action:"operator_onlyfans_manual_completion_proof_recorded",after_state:{platform_job_id:job,queue_task_id:task,evidence_intent_id:evidence,final_post_url:url},created_at:id===1?taskA.posted_at:taskB.posted_at})
const evidence=(job:string,task:string,id:string,offset:string)=>({id,platform_job_id:job,queue_task_id:task,status:"consumed",created_at:`2026-07-18T${offset}:00Z`,verified_at:`2026-07-18T${offset}:30Z`,consumed_at:job==="job-a"?taskA.posted_at:taskB.posted_atlverified_sha256:(job==="job-a"?"a":"b").repeat(64),actual_size_bytes:job==="job-a"?100:200,normalized_mime_type:job==="job-a"?"image/jpeg":"image/png"})
const proofA=proof("job-a","task-a","evidence-a",taskA.final_post_url,1)
const proofB=proof("job-b","task-b","evidence-b",taskB.final_post_url,2)
const evidenceA=evidence("job-a","task-a","evidence-a","08:40")
const evidenceB=evidence("job-b","task-b","evidence-b","09:10")

assert.deepEqual(resolveQueueTaskIdFromJobLinks({auditEvents:[proofA],idempotencyRows:[{action_type:"manual_completion",queue_task_id:"task-b"}],evidenceIntents:[evidenceB]}),{queueTaskId:"task-a",source:"completion_proof_audit",ambiguous:false})
assert.deepEqual(resolveQueueTaskIdFromJobLinks({idempotencyRows:[{action_type:"manual_completion",queue_task_id:"task-b"}],evidenceIntents:[evidenceA]}),{queueTaskId:"task-b",source:"manual_completion_idempotency",ambiguous:false})
assert.deepEqual(resolveQueueTaskIdFromJobLinks({evidenceIntents:[evidenceA]}),{queueTaskId:"task-a",source:"completion_evidence",ambiguous:false})
assert.equal(chooseHistoryQueueTask(jobA,[taskA,taskB],{auditEvents:[proofA]}),taskA)
assert.equal(chooseHistoryQueueTask(jobB,[taskA,taskB],{idempotencyRows:[{action_type:"manual_completion",queue_task_id:"task-b"}]}),taskB)
const ambiguous={evidenceIntents:[{queue_task_id:"task-a"},{queue_task_id:"task-b"}]}
assert.deepEqual(resolveQueueTaskIdFromJobLinks(ambiguous),{queueTaskId:null,source:"completion_evidence",ambiguous:true})
assert.equal(chooseHistoryQueueTask(jobA,[taskA,taskB],ambiguous),null)
assert.equal(chooseHistoryQueueTask(jobA,[taskA,taskB],{}),null)

const view=(job:any,task:any,proofRow:any,evidenceRow:any)=>normalizeOnlyFansHistory({job,task,auditEvents:[proofRow],evidenceIntents:[evidenceRow],idempotencyRows:[{action_type:"manual_completion",queue_task_id:task.id,internal_request_snapshot:{evidence_intent_id:evidenceRow.id}}]},"operator")
const viewA=view(jobA,taskA,proofA,evidenceA)
const viewB=view(jobB,taskB,proofB,evidenceB)
assert.equal(viewA.ok,true); assert.equal(viewB.ok,true)
if(viewA.ok&&viewB.ok){
  assert.equal(viewA.entries.some(e=>e.finalPostUrl===taskA.final_post_url),true)
  assert.equal(viewA.entries.some(e=>e.finalPostUrl===taskB.final_post_url),false)
  assert.equal(viewA.entries.some(e=>e.metadata?.evidenceIntentId==="evidence-b"),false)
  assert.equal(viewB.entries.some(e=>e.finalPostUrl===taskB.final_post_url),true)
  assert.equal(viewB.entries.some(e=>e.finalPostUrl===taskA.final_post_url),false)
  assert.equal(viewB.entries.some(e=>e.metadata?.evidenceIntentId==="evidence-a"),false)
}
const limited=normalizeOnlyFansHistory({job:jobA,task:null,evidenceIntents:ambiguous.evidenceIntents},"operator")
assert.equal(limited.ok,true)
if(limited.ok){assert.equal(limited.entries.some(e=>Boolean(e.finalPostUrl)),false);assert.equal(limited.entries.some(e=>e.provenance==="reconstructed_completion_state"),false)}

function actions(row:any){const result=normalizeOnlyFansHistory({job:{id:"job",schedule_timezone:"UTC"},evidenceIntents:[row]},"operator");assert.equal(result.ok,true);return result.ok?result.entries.filter(e=>e.kind==="evidence").map(e=>[e.action,e.occurredAt]):[]}
assert.deepEqual(actions({id:"pending",created_at:"2026-07-18T10:00:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"]])
assert.deepEqual(actions({id:"verified",created_at:"2026-07-18T10:00:00Z",verified_at:"2026-07-18T10:01:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"],["evidence_verified","2026-07-18T10:01:00Z"]])
assert.deepEqual(actions({id:"invalidated",created_at:"2026-07-18T10:00:00Z",verified_at:"2026-07-18T10:01:00Z",invalidated_at:"2026-07-18T10:03:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"],["evidence_verified","2026-07-18T10:01:00Z"],["evidence_superseded","2026-07-18T10:03:00Z"]])
assert.deepEqual(actions({id:"expired",created_at:"2026-07-18T10:00:00Z",verified_at:"2026-07-18T10:01:00Z",expired_at:"2026-07-18T10:04:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"],["evidence_verified","2026-07-18T10:01:00Z"],["evidence_expired","2026-07-18T10:04:00Z"]])
assert.deepEqual(actions({id:"consumed",created_at:"2026-07-18T10:00:00Z",verified_at:"2026-07-18T10:01:00Z",consumed_at:"2026-07-18T10:05:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"],["evidence_verified","2026-07-18T10:01:00Z"],["evidence_consumed","2026-07-18T10:05:00Z"]])

const chain=normalizeOnlyFansHistory({job:{id:"job",schedule_timezone:"UTC"},evidenceIntents:[
{id:"old",operation:"create",created_at:"2026-07-18T11:00:00Z",verified_at:"2026-07-18T11:01:00Z",invalidated_at:"2026-07-18T11:03:00Z",replaced_by_intent_id:"new"},
{id:"new",operation:"replace",created_at:"2026-07-18T11:02:00Z",verified_at:"2026-07-18T11:04:00Z",consumed_at:"2026-07-18T11:05:00Z",replaces_intent_id:"old"},
]},"operator")
assert.equal(chain.ok,true)
if(chain.ok){const entries=chain.entries.filter(e=>e.kind==="evidence");assert.deepEqual(entries.map(e=>e.occurredAt),["2026-07-18T11:00:00Z","2026-07-18T11:01:00Z","2026-07-18T11:02:00Z","2026-07-18T11:03:00Z","2026-07-18T11:04:00Z","2026-07-18T11:05:00Z"]);assert.equal(entries.some(e=>e.metadata?.replacedByIntentId==="new"),true);assert.equal(entries.some(e=>e.metadata?.replacesIntentId==="old"),true);assert.equal(new Set(entries.map(e=>e.id)).size,6)}

console.log("task20 exact resolution and evidence lifecycle tests passed")
