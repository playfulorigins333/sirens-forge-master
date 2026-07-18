import { actionCopy, evidenceLifecycleCopy, noUrlReasonLabel, rejectionWording } from "./presentation"
import { normalizeHistoryTimezone } from "./timezone"
import type { OnlyFansHistoryAudience, OnlyFansHistoryEntry, OnlyFansHistoryKind, OnlyFansHistoryRows, OnlyFansHistoryView } from "./types"

type InternalHistoryEntry = OnlyFansHistoryEntry & { completionGroup?:string; completionPriority?:number }

function iso(value:any){
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null
}

function metaValue(value:any){
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null ? value : JSON.stringify(value)
}

function auditKind(audit:any): OnlyFansHistoryKind {
  if (audit.action?.includes("rejected")) return "rejection"
  if (audit.action === "operator_onlyfans_manual_completion_proof_recorded" || audit.action === "operator_onlyfans_manual_completion") return "completion"
  if (audit.entity_type?.includes("scheduler") || audit.action?.includes("_scheduler_")) return "scheduler"
  return "lifecycle"
}

function completionPriority(audit:any) {
  if (audit.action === "operator_onlyfans_manual_completion_proof_recorded") return 50
  if (audit.action === "operator_onlyfans_manual_completion" && audit.entity_type === "creator_publishing_platform_job") return 30
  if (audit.action === "operator_onlyfans_manual_completion" && audit.entity_type === "creator_publishing_queue_task") return 20
  return null
}

function completionGroup(jobId:string|undefined, occurredAt:string) {
  return `publication-confirmation:${jobId ?? "unknown"}:${occurredAt}`
}

function collapsePublicationConfirmations(entries:InternalHistoryEntry[]) {
  const selected=new Map<string,InternalHistoryEntry>()
  const unrelated:InternalHistoryEntry[]=[]
  for (const entry of entries) {
    if (!entry.completionGroup || entry.completionPriority == null) {
      unrelated.push(entry)
      continue
    }
    const prior=selected.get(entry.completionGroup)
    if (!prior || (entry.completionPriority > (prior.completionPriority ?? -1)) || (entry.completionPriority === prior.completionPriority && (entry.sortAuditId ?? -1) > (prior.sortAuditId ?? -1))) {
      selected.set(entry.completionGroup,entry)
    }
  }
  return [...unrelated,...selected.values()]
}

function displayDeduplicationKey(entry:InternalHistoryEntry){
  if (entry.kind === "scheduler") return `scheduler:${entry.action}:${entry.metadata?.schedulerEventId ?? ""}`
  if (entry.action === "operator_onlyfans_expired_claim_recovered") return `claim-expired:${entry.occurredAt}`
  return entry.id
}

function evidenceMetadata(event:any, audience:OnlyFansHistoryAudience){
  if (audience !== "operator") return undefined
  return {
    evidenceIntentId:event.id,
    operation:event.operation,
    replacesIntentId:event.replaces_intent_id,
    replacedByIntentId:event.replaced_by_intent_id,
    mimeType:event.normalized_mime_type,
    actualSizeBytes:event.actual_size_bytes,
    digest:typeof event.verified_sha256 === "string" ? `${event.verified_sha256.slice(0,12)}…` : undefined,
    failureCode:event.failure_code,
  }
}

export function normalizeOnlyFansHistory(rows: OnlyFansHistoryRows, audience: OnlyFansHistoryAudience): OnlyFansHistoryView {
  const timezone=normalizeHistoryTimezone(rows.job?.schedule_timezone)
  const entries:InternalHistoryEntry[]=[]
  const add=(entry:InternalHistoryEntry)=>{ if(iso(entry.occurredAt)) entries.push(entry) }

  if (rows.plan?.created_at) add({id:`plan:${rows.plan.id}:created`,kind:"lifecycle",action:"plan_created",label:"Publishing plan created",explanation:"The publishing plan was created.",occurredAt:rows.plan.created_at,provenance:"derived_lifecycle_event",metadata:{planId:rows.plan.id}})
  if (rows.job?.created_at) add({id:`job:${rows.job.id}:created`,kind:"lifecycle",action:"platform_job_created",label:"OnlyFans job created",explanation:"An assisted/manual OnlyFans publishing job was created.",occurredAt:rows.job.created_at,provenance:"derived_lifecycle_event",metadata:{platformJobId:rows.job.id}})

  for (const audit of rows.auditEvents ?? []) {
    const after=audit.after_state ?? {}
    const copy=actionCopy(audit.action,audience)
    const code=after.rejection_code
    const priority=completionPriority(audit)
    add({
      id:`audit:${audit.id}`,
      kind:auditKind(audit),
      action:audit.action,
      label:copy.label,
      explanation:code ? (rejectionWording[code]?.[audience] ?? "Completion was rejected.") : copy[audience],
      occurredAt:audit.created_at,
      sortAuditId:Number(audit.id),
      provenance:"append_only_audit_evidence",
      evidenceState:after.evidence_intent_id?"proof present":null,
      finalPostUrl:after.final_post_url??null,
      noUrlReason:after.final_post_url_skip_reason??null,
      metadata:audience==="operator" ? Object.fromEntries(Object.entries({
        entityType:audit.entity_type,
        entityId:audit.entity_id,
        actorId:audit.actor_id,
        queueTaskId:after.queue_task_id,
        platformJobId:after.platform_job_id,
        evidenceIntentId:after.evidence_intent_id,
        rejectionCode:code,
        mimeType:after.normalized_mime_type,
        actualSizeBytes:after.actual_size_bytes,
        digest:typeof after.verified_sha256 === "string" ? `${after.verified_sha256.slice(0,12)}…` : undefined,
      }).map(([key,value])=>[key,metaValue(value)])) : undefined,
      completionGroup:priority == null ? undefined : completionGroup(rows.job?.id, audit.created_at),
      completionPriority:priority ?? undefined,
    })
  }

  const evidenceEvents = [
    {timestamp:"created_at",action:"evidence_reserved",state:"reserved"},
    {timestamp:"verified_at",action:"evidence_verified",state:"verified"},
    {timestamp:"invalidated_at",action:"evidence_superseded",state:"superseded"},
    {timestamp:"failed_at",action:"evidence_failed",state:"failed"},
    {timestamp:"expired_at",action:"evidence_expired",state:"expired"},
    {timestamp:"consumed_at",action:"evidence_consumed",state:"consumed"},
  ] as const

  for (const evidence of rows.evidenceIntents ?? []) {
    for (const lifecycle of evidenceEvents) {
      const occurredAt=evidence[lifecycle.timestamp]
      if (!occurredAt) continue
      const copy=evidenceLifecycleCopy(lifecycle.action,audience)
      add({
        id:`evidence:${evidence.id}:${lifecycle.action}`,
        kind:"evidence",
        action:lifecycle.action,
        label:copy.label,
        explanation:copy[audience],
        occurredAt,
        provenance:"immutable_evidence_row_data",
        evidenceState:lifecycle.state,
        metadata:evidenceMetadata(evidence,audience),
      })
    }
  }

  for (const scheduler of rows.schedulerEvents ?? []) {
    if (!scheduler.status || !scheduler.updated_at) continue
    add({
      id:`scheduler:${scheduler.id}:${scheduler.status}`,
      kind:"scheduler",
      action:`scheduler_${scheduler.status}`,
      label:`Scheduler ${scheduler.status}`,
      explanation:"Scheduler state was recorded for this OnlyFans job.",
      occurredAt:scheduler.processed_at ?? scheduler.blocked_at ?? scheduler.superseded_at ?? scheduler.updated_at,
      provenance:"derived_lifecycle_event",
      metadata:{schedulerEventId:scheduler.id,status:scheduler.status},
    })
  }

  let correlated=collapsePublicationConfirmations(entries)
  const proofSurvives=correlated.some(entry=>entry.action==="operator_onlyfans_manual_completion_proof_recorded")
  const completionIdempotency=(rows.idempotencyRows ?? []).find(row=>row?.action_type==="manual_completion" && (!rows.task?.id || row?.queue_task_id===rows.task.id))
  if (!proofSurvives && rows.task?.status === "confirmed_posted_manual" && rows.task.posted_at) {
    const snapshot=completionIdempotency?.internal_request_snapshot ?? {}
    correlated.push({
      id:`reconstructed:${rows.task.id}`,
      kind:"completion",
      action:"manual_completion_reconstructed",
      label:"Manual publication confirmed",
      explanation:"Completion proof was reconstructed from existing trusted completion state.",
      occurredAt:rows.task.posted_at,
      provenance:"reconstructed_completion_state",
      evidenceState:snapshot.evidence_intent_id?"proof present":"proof metadata limited",
      finalPostUrl:rows.task.final_post_url??snapshot.final_post_url??null,
      noUrlReason:rows.task.final_post_url_skip_reason??snapshot.final_post_url_skip_reason??null,
      metadata:audience==="operator" ? {
        queueTaskId:rows.task.id,
        platformJobId:rows.job?.id,
        evidenceIntentId:snapshot.evidence_intent_id,
        mimeType:snapshot.normalized_mime_type,
        actualSizeBytes:snapshot.actual_size_bytes,
        digest:typeof snapshot.verified_sha256 === "string" ? `${snapshot.verified_sha256.slice(0,12)}…` : undefined,
      } : undefined,
      completionGroup:completionGroup(rows.job?.id,rows.task.posted_at),
      completionPriority:40,
    })
    correlated=collapsePublicationConfirmations(correlated)
  }

  const byKey=new Map<string,InternalHistoryEntry>()
  for (const entry of correlated) {
    const key=displayDeduplicationKey(entry)
    const prior=byKey.get(key)
    if(!prior || (prior.provenance!=="append_only_audit_evidence" && entry.provenance==="append_only_audit_evidence")) byKey.set(key,entry)
  }

  const sorted=[...byKey.values()].sort((left,right)=>left.occurredAt.localeCompare(right.occurredAt) || (left.sortAuditId??Number.MAX_SAFE_INTEGER)-(right.sortAuditId??Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id))
  const publicEntries=sorted.map(entry=>{
    const {completionGroup:_,completionPriority:__,...publicEntry}=entry
    if(publicEntry.noUrlReason) publicEntry.explanation += ` ${noUrlReasonLabel(publicEntry.noUrlReason)}`
    return publicEntry
  })
  return {ok:true,timezone,timezoneLabel:timezone,entries:publicEntries}
}
