import assert from "node:assert/strict"
import { normalizeOnlyFansHistory } from "../../../lib/creator-publishing-queue/onlyfans-history/core"
import { chooseHistoryQueueTask, resolveQueueTaskIdFromJobLinks } from "../../../lib/creator-publishing-queue/onlyfans-history/resolution"

const relation={content_package_id:"pkg",creator_id:"creator",platform_account_id:"acct",target_platform:"onlyfans"}
const job=(id:string)=>({id,job_state:"confirmed_posted_manual",schedule_timezone:"UTC",created_at:"2026-07-18T08:00:00Z",...relation})
const task=(id:string,url:string,postedAt:string)=>({id,status:"confirmed_posted_manual",posted_at:postedAt,final_post_url:url,...relation})
const jobA=job("job-a"), jobB=job("job-b")
const taskA=task("task-a","https://onlyfans.com/101/first","2026-07-18T09:00:00Z")
const taskB=task("task-b","https://onlyfans.com/202/second","2026-07-18T09:30:00Z")
const proof=(jobId:string,taskId:string,evidenceId:string,url:string,id:number)=>({id,entity_type:"creator_publishing_platform_job",entity_id:jobId,action:"operator_onlyfans_manual_completion_proof_recorded",after_state:{platform_job_id:jobId,queue_task_id:taskId,evidence_intent_id:evidenceId,final_post_url:url},created_at:id===1?taskA.posted_at:taskB.posted_at})
const evidence=(jobId:string,taskId:string,id:string,createdAt:string,verifiedAt:string,consumedAt:string)=>({id,platform_job_id:jobId,queue_task_id:taskId,status:"consumed",created_at:createdAt,verified_at:verifiedAt,consumed_at:consumedAt,verified_sha256:(jobId==="job-a"?"a":"b").repeat(64),actual_size_bytes:jobId==="job-a"?100:200,normalized_mime_type:jobId==="job-a"?"image/jpeg":"image/png"})
const proofA=proof("job-a","task-a","evidence-a",taskA.final_post_url,1)
const proofB=proof("job-b","task-b","evidence-b",taskB.final_post_url,2)
const evidenceA=evidence("job-a","task-a","evidence-a","2026-07-18T08:40:00Z","2026-07-18T08:50:00Z",taskA.posted_at)
const evidenceB=evidence("job-b","task-b","evidence-b","2026-07-18T09:10:00Z","2026-07-18T09:20:00Z",taskB.posted_at)

assert.deepEqual(resolveQueueTaskIdFromJobLinks({auditEvents:[proofA],idempotencyRows:[{action_type:"manual_completion",queue_task_id:"task-b"}],evidenceIntents:[evidenceB]}),{queueTaskId:"task-a",source:"completion_proof_audit",ambiguous:false})
assert.deepEqual(resolveQueueTaskIdFromJobLinks({idempotencyRows:[{action_type:"manual_completion",queue_task_id:"task-b"}],evidenceIntents:[evidenceA]}),{queueTaskId:"task-b",source:"manual_completion_idempotency",ambiguous:false})
assert.deepEqual(resolveQueueTaskIdFromJobLinks({evidenceIntents:[evidenceA]}),{queueTaskId:"task-a",source:"completion_evidence",ambiguous:false})
assert.equal(chooseHistoryQueueTask(jobA,[taskA,taskB],{auditEvents:[proofA]}),taskA)
assert.equal(chooseHistoryQueueTask(jobB,[taskA,taskB],{idempotencyRows:[{action_type:"manual_completion",queue_task_id:"task-b"}]}),taskB)
const ambiguous={evidenceIntents:[{queue_task_id:"task-a"},{queue_task_id:"task-b"}]}
assert.deepEqual(resolveQueueTaskIdFromJobLinks(ambiguous),{queueTaskId:null,source:"completion_evidence",ambiguous:true})
assert.equal(chooseHistoryQueueTask(jobA,[taskA,taskB],ambiguous),null)
assert.equal(chooseHistoryQueueTask(jobA,[taskA,taskB],{}),null)

function history(j:any,t:any,p:any,e:any){return normalizeOnlyFansHistory({job:j,task:t,auditEvents:[p],evidenceIntents:[e],idempotencyRows:[{action_type:"manual_completion",queue_task_id:t.id,internal_request_snapshot:{evidence_intent_id:e.id}}]},"operator")}
const viewA=history(jobA,taskA,proofA,evidenceA), viewB=history(jobB,taskB,proofB,evidenceB)
assert.equal(viewA.ok,true); assert.equal(viewB.ok,true)
if(viewA.ok&&viewB.ok){
  assert.equal(viewA.entries.some(e=>e.finalPostUrl===taskA.final_post_url),true)
  assert.equal(viewA.entries.some(e=>e.finalPostUrl===taskB.final_post_url||e.metadata?.evidenceIntentId==="evidence-b"),false)
  assert.equal(viewB.entries.some(e=>e.finalPostUrl===taskB.final_post_url),true)
  assert.equal(viewB.entries.some(e=>e.finalPostUrl===taskA.final_post_url||e.metadata?.evidenceIntentId==="evidence-a"),false)
}
const limited=normalizeOnlyFansHistory({job:jobA,task:null,evidenceIntents:ambiguous.evidenceIntents},"operator")
assert.equal(limited.ok,true)
if(limited.ok){assert.equal(limited.entries.some(e=>Boolean(e.finalPostUrl)||e.provenance==="reconstructed_completion_state"),false)}

function lifecycle(row:any){const r=normalizeOnlyFansHistory({job:{id:"job",schedule_timezone:"UTC"},evidenceIntents:[row]},"operator");assert.equal(r.ok,true);return r.ok?r.entries.filter(e=>e.kind==="evidence").map(e=>[e.action,e.occurredAt]):[]}
assert.deepEqual(lifecycle({id:"pending",created_at:"2026-07-18T10:00:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"]])
assert.deepEqual(lifecycle({id:"verified",created_at:"2026-07-18T10:00:00Z",verified_at:"2026-07-18T10:01:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"],["evidence_verified","2026-07-18T10:01:00Z"]])
assert.deepEqual(lifecycle({id:"invalidated",created_at:"2026-07-18T10:00:00Z",verified_at:"2026-07-18T10:01:00Z",invalidated_at:"2026-07-18T10:03:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"],["evidence_verified","2026-07-18T10:01:00Z"],["evidence_superseded","2026-07-18T10:03:00Z"]])
assert.deepEqual(lifecycle({id:"expired",created_at:"2026-07-18T10:00:00Z",verified_at:"2026-07-18T10:01:00Z",expired_at:"2026-07-18T10:04:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"],["evidence_verified","2026-07-18T10:01:00Z"],["evidence_expired","2026-07-18T10:04:00Z"]])
assert.deepEqual(lifecycle({id:"consumed",created_at:"2026-07-18T10:00:00Z",verified_at:"2026-07-18T10:01:00Z",consumed_at:"2026-07-18T10:05:00Z"}),[["evidence_reserved","2026-07-18T10:00:00Z"],["evidence_verified","2026-07-18T10:01:00Z"],["evidence_consumed","2026-07-18T10:05:00Z"]])

const chain=normalizeOnlyFansHistory({job:{id:"job",schedule_timezone:"UTC"},evidenceIntents:[
  {id:"old",operation:"create",created_at:"2026-07-18T11:00:00Z",verified_at:"2026-07-18T11:01:00Z",invalidated_at:"2026-07-18T11:03:00Z",replaced_by_intent_id:"new"},
  {id:"new",operation:"replace",created_at:"2026-07-18T11:02:00Z",verified_at:"2026-07-18T11:04:00Z",consumed_at:"2026-07-18T11:05:00Z",replaces_intent_id:"old"},
]},"operator")
assert.equal(chain.ok,true)
if(chain.ok){const entries=chain.entries.filter(e=>e.kind==="evidence");assert.deepEqual(entries.map(e=>e.occurredAt),["2026-07-18T11:00:00Z","2026-07-18T11:01:00Z","2026-07-18T11:02:00Z","2026-07-18T11:03:00Z","2026-07-18T11:04:00Z","2026-07-18T11:05:00Z"]);assert.equal(entries.some(e=>e.metadata?.replacedByIntentId==="new"),true);assert.equal(entries.some(e=>e.metadata?.replacesIntentId==="old"),true);assert.equal(new Set(entries.map(e=>e.id)).size,6)}

console.log("task20 exact resolution and evidence lifecycle tests passed")
