import assert from "node:assert/strict"
import { loadCreatorOnlyFansPackageHistoryCore } from "../../../lib/creator-publishing-queue/onlyfans-history/creator-package"
import { normalizeOnlyFansHistory } from "../../../lib/creator-publishing-queue/onlyfans-history/core"
import { scopeHistoryAuditEvents } from "../../../lib/creator-publishing-queue/onlyfans-history/resolution"

const completionAt="2026-07-18T12:00:00.000Z"
const job={id:"job-proof",creator_id:"creator",content_package_id:"pkg",platform_account_id:"acct",target_platform:"onlyfans",publishing_mode:"assisted",job_state:"confirmed_posted_manual",schedule_timezone:"UTC",created_at:"2026-07-18T10:00:00.000Z"}
const task={id:"task-proof",creator_id:"creator",content_package_id:"pkg",platform_account_id:"acct",target_platform:"onlyfans",status:"confirmed_posted_manual",posted_at:completionAt,final_post_url:"https://onlyfans.com/100/user"}
const sameTimestampAudit=[
  {id:10,entity_type:"creator_publishing_queue_task",entity_id:task.id,action:"operator_onlyfans_manual_completion",after_state:{status:"confirmed_posted_manual"},created_at:completionAt},
  {id:11,entity_type:"creator_publishing_platform_job",entity_id:job.id,action:"operator_onlyfans_manual_completion",after_state:{job_state:"confirmed_posted_manual"},created_at:completionAt},
  {id:12,entity_type:"creator_publishing_plan",entity_id:"plan",action:"operator_onlyfans_manual_completion_plan_recomputed",after_state:{status:"completed"},created_at:completionAt},
  {id:13,entity_type:"creator_publishing_scheduler_event",entity_id:"scheduler",action:"operator_onlyfans_manual_completion_scheduler_superseded",after_state:{status:"superseded"},created_at:completionAt},
  {id:14,entity_type:"creator_publishing_queue_task",entity_id:task.id,action:"operator_onlyfans_package_prepared",after_state:{operator_progress_state:"package_prepared"},created_at:completionAt},
  {id:15,entity_type:"creator_publishing_platform_job",entity_id:job.id,action:"operator_onlyfans_manual_completion_proof_recorded",after_state:{platform_job_id:job.id,queue_task_id:task.id,evidence_intent_id:"evidence-proof",final_post_url:task.final_post_url,verified_sha256:"a".repeat(64),actual_size_bytes:321,normalized_mime_type:"image/png",completed_at:completionAt},created_at:completionAt},
]
const proofView=normalizeOnlyFansHistory({job,task,auditEvents:sameTimestampAudit,idempotencyRows:[{action_type:"manual_completion",queue_task_id:task.id,internal_request_snapshot:{evidence_intent_id:"evidence-proof"}}]},"operator")
assert.equal(proofView.ok,true)
if(proofView.ok){
  const confirmations=proofView.entries.filter(entry=>entry.action==="operator_onlyfans_manual_completion_proof_recorded" || entry.action==="operator_onlyfans_manual_completion" || entry.action==="manual_completion_reconstructed")
  assert.equal(confirmations.length,1)
  assert.equal(confirmations[0].action,"operator_onlyfans_manual_completion_proof_recorded")
  assert.equal(confirmations[0].finalPostUrl,task.final_post_url)
  assert.equal(confirmations[0].metadata?.evidenceIntentId,"evidence-proof")
  assert.equal(confirmations[0].provenance,"append_only_audit_evidence")
  assert.equal(proofView.entries.some(entry=>entry.action==="manual_completion_reconstructed"),false)
  assert.equal(proofView.entries.some(entry=>entry.action==="operator_onlyfans_manual_completion_plan_recomputed"),true)
  assert.equal(proofView.entries.some(entry=>entry.action==="operator_onlyfans_manual_completion_scheduler_superseded"),true)
  assert.equal(proofView.entries.some(entry=>entry.action==="operator_onlyfans_package_prepared"),true)
}

const withoutProof=normalizeOnlyFansHistory({job,task,auditEvents:sameTimestampAudit.filter(row=>row.id!==15),idempotencyRows:[{action_type:"manual_completion",queue_task_id:task.id,internal_request_snapshot:{evidence_intent_id:"evidence-fallback",final_post_url:task.final_post_url,verified_sha256:"b".repeat(64),actual_size_bytes:456,normalized_mime_type:"image/jpeg"}}]},"operator")
assert.equal(withoutProof.ok,true)
if(withoutProof.ok){
  const confirmations=withoutProof.entries.filter(entry=>entry.action==="operator_onlyfans_manual_completion" || entry.action==="manual_completion_reconstructed")
  assert.equal(confirmations.length,1)
  assert.equal(confirmations[0].action,"manual_completion_reconstructed")
  assert.equal(confirmations[0].finalPostUrl,task.final_post_url)
  assert.equal(confirmations[0].metadata?.evidenceIntentId,"evidence-fallback")
  assert.equal(withoutProof.entries.some(entry=>entry.action==="operator_onlyfans_package_prepared"),true)
}

const scopedAudit=scopeHistoryAuditEvents([
  {id:31,entity_type:"creator_publishing_platform_job",entity_id:"job-old",action:"operator_onlyfans_manual_completion",idempotency_key:"old-key"},
  {id:32,entity_type:"creator_publishing_plan",entity_id:"plan",action:"operator_onlyfans_manual_completion_plan_recomputed",idempotency_key:"old-key"},
  {id:33,entity_type:"creator_publishing_platform_job",entity_id:"job-middle",action:"operator_onlyfans_manual_completion",idempotency_key:"middle-key"},
  {id:34,entity_type:"creator_publishing_plan",entity_id:"plan",action:"operator_onlyfans_manual_completion_plan_recomputed",idempotency_key:"middle-key"},
],"job-old","task-old",[])
assert.deepEqual(scopedAudit.map(row=>row.id),[31,32])

const packageRow={id:"pkg",creator_id:"creator",target_platform:"onlyfans"}
const shared={creator_id:"creator",content_package_id:"pkg",platform_account_id:"acct",target_platform:"onlyfans",publishing_mode:"assisted",schedule_timezone:"UTC"}
const older={id:"job-old",job_state:"confirmed_posted_manual",created_at:"2026-07-18T08:00:00.000Z",...shared}
const middle={id:"job-middle",job_state:"confirmed_posted_manual",created_at:"2026-07-18T09:00:00.000Z",...shared}
const active={id:"job-active",job_state:"awaiting_operator",created_at:"2026-07-18T10:00:00.000Z",...shared}
const taskOld={id:"task-old",status:"confirmed_posted_manual",posted_at:"2026-07-18T08:30:00.000Z",final_post_url:"https://onlyfans.com/101/old"}
const taskMiddle={id:"task-middle",status:"confirmed_posted_manual",posted_at:"2026-07-18T09:30:00.000Z",final_post_url:"https://onlyfans.com/202/middle"}
const rowsByJob:Record<string,any>={
  "job-old":{job:older,task:taskOld,auditEvents:[{id:21,entity_type:"creator_publishing_platform_job",entity_id:"job-old",action:"operator_onlyfans_manual_completion_proof_recorded",after_state:{platform_job_id:"job-old",queue_task_id:"task-old",evidence_intent_id:"evidence-old",final_post_url:taskOld.final_post_url},created_at:taskOld.posted_at}],evidenceIntents:[{id:"evidence-old",created_at:"2026-07-18T08:20:00.000Z",verified_at:"2026-07-18T08:25:00.000Z",consumed_at:taskOld.posted_at}]},
  "job-middle":{job:middle,task:taskMiddle,auditEvents:[{id:22,entity_type:"creator_publishing_platform_job",entity_id:"job-middle",action:"operator_onlyfans_manual_completion_proof_recorded",after_state:{platform_job_id:"job-middle",queue_task_id:"task-middle",evidence_intent_id:"evidence-middle",final_post_url:taskMiddle.final_post_url},created_at:taskMiddle.posted_at}],evidenceIntents:[{id:"evidence-middle",created_at:"2026-07-18T09:20:00.000Z",verified_at:"2026-07-18T09:25:00.000Z",consumed_at:taskMiddle.posted_at}]},
  "job-active":{job:active,task:null,auditEvents:[],evidenceIntents:[]},
}
const collected:string[]=[]
const creatorView=await loadCreatorOnlyFansPackageHistoryCore("pkg","creator",{
  loadPackage:async (packageId,creatorId)=>packageId==="pkg"&&creatorId==="creator"?packageRow:null,
  loadJobs:async ()=>[older,active,middle],
  collectJobRows:async selected=>{collected.push(selected.id);return rowsByJob[selected.id]},
})
assert.equal(creatorView.ok,true)
if(creatorView.ok){
  assert.deepEqual(creatorView.attempts.map(attempt=>attempt.platformJobId),["job-active","job-middle","job-old"])
  assert.deepEqual(collected,["job-active","job-middle","job-old"])
  assert.equal(creatorView.attempts[0].taskLinkState,"limited")
  assert.equal(creatorView.attempts[1].history.entries.some(entry=>entry.finalPostUrl===taskMiddle.final_post_url),true)
  assert.equal(creatorView.attempts[1].history.entries.some(entry=>entry.finalPostUrl===taskOld.final_post_url || entry.id.includes("evidence-old")),false)
  assert.equal(creatorView.attempts[2].history.entries.some(entry=>entry.finalPostUrl===taskOld.final_post_url),true)
  assert.equal(creatorView.attempts[2].history.entries.some(entry=>entry.finalPostUrl===taskMiddle.final_post_url || entry.id.includes("evidence-middle")),false)
}

let unauthorizedCollections=0
const unauthorized=await loadCreatorOnlyFansPackageHistoryCore("pkg","another-creator",{
  loadPackage:async ()=>null,
  loadJobs:async ()=>{throw new Error("jobs must not be queried")},
  collectJobRows:async ()=>{unauthorizedCollections+=1;throw new Error("history must not be collected")},
})
assert.deepEqual(unauthorized,{ok:false,code:"not_found",message:"Publishing history is unavailable."})
assert.equal(unauthorizedCollections,0)

console.log("task20 history truthfulness tests passed")
