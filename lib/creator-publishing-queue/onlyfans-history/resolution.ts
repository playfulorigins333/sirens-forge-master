export type HistoryTaskLinkSource =
  | "completion_proof_audit"
  | "manual_completion_idempotency"
  | "completion_evidence"
  | "operator_action_idempotency"
  | "queue_task_audit"

export type HistoryTaskResolution = {
  queueTaskId: string | null
  source: HistoryTaskLinkSource | null
  ambiguous: boolean
}

export type HistoryTaskLinkRows = {
  platformJobId?: string
  auditEvents?: any[]
  idempotencyRows?: any[]
  evidenceIntents?: any[]
}

const terminalJobStates = new Set([
  "confirmed_posted_manual",
  "published_direct",
  "exported",
  "failed_manual_upload",
  "direct_publish_failed",
  "skipped",
  "blocked",
  "platform_rejected",
  "archived",
])

const terminalQueueStates = new Set([
  "archived",
  "skipped",
  "failed_manual_upload",
  "confirmed_posted_manual",
])

const task17OperatorActionTypes = new Set([
  "claim",
  "release",
  "progress_update",
  "expired_claim_recovery",
  "manual_completion_rejection",
])

function normalizedIds(values: unknown[]) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))]
}

function resolutionFor(source: HistoryTaskLinkSource, ids: string[]): HistoryTaskResolution | null {
  if (ids.length > 1) return { queueTaskId: null, source, ambiguous: true }
  if (ids.length === 1) return { queueTaskId: ids[0], source, ambiguous: false }
  return null
}

function matchesPlatformJob(value: unknown, platformJobId?: string) {
  return !platformJobId || value === platformJobId
}

function queueTaskAuditIds(events: any[], platformJobId?: string) {
  return normalizedIds(
    events
      .filter(event =>
        event?.entity_type === "creator_publishing_queue_task" &&
        typeof event?.entity_id === "string" &&
        typeof event?.after_state?.platform_job_id === "string" &&
        matchesPlatformJob(event.after_state.platform_job_id, platformJobId),
      )
      .map(event => event.entity_id),
  )
}

export function resolveQueueTaskIdFromJobLinks(rows: HistoryTaskLinkRows): HistoryTaskResolution {
  const proof = resolutionFor(
    "completion_proof_audit",
    normalizedIds(
      (rows.auditEvents ?? [])
        .filter(event => event?.action === "operator_onlyfans_manual_completion_proof_recorded" && matchesPlatformJob(event?.after_state?.platform_job_id, rows.platformJobId))
        .map(event => event?.after_state?.queue_task_id),
    ),
  )
  if (proof) return proof

  const idempotency = resolutionFor(
    "manual_completion_idempotency",
    normalizedIds(
      (rows.idempotencyRows ?? [])
        .filter(row => row?.action_type === "manual_completion" && matchesPlatformJob(row?.platform_job_id, rows.platformJobId))
        .map(row => row?.queue_task_id),
    ),
  )
  if (idempotency) return idempotency

  const evidence = resolutionFor(
    "completion_evidence",
    normalizedIds((rows.evidenceIntents ?? []).filter(row => matchesPlatformJob(row?.platform_job_id, rows.platformJobId)).map(row => row?.queue_task_id)),
  )
  if (evidence) return evidence

  const operatorActions = resolutionFor(
    "operator_action_idempotency",
    normalizedIds(
      (rows.idempotencyRows ?? [])
        .filter(row => task17OperatorActionTypes.has(row?.action_type) && matchesPlatformJob(row?.platform_job_id, rows.platformJobId))
        .map(row => row?.queue_task_id),
    ),
  )
  if (operatorActions) return operatorActions

  const queueAudit = resolutionFor("queue_task_audit", queueTaskAuditIds(rows.auditEvents ?? [], rows.platformJobId))
  if (queueAudit) return queueAudit

  return { queueTaskId: null, source: null, ambiguous: false }
}

export function taskMatchesHistoryJob(task: any, job: any) {
  return Boolean(
    task &&
      job &&
      task.content_package_id === job.content_package_id &&
      task.creator_id === job.creator_id &&
      task.platform_account_id === job.platform_account_id &&
      task.target_platform === job.target_platform,
  )
}

export function chooseHistoryQueueTask(job: any, candidates: any[], rows: HistoryTaskLinkRows) {
  const resolution = resolveQueueTaskIdFromJobLinks(rows)
  if (resolution.ambiguous) return null

  const matching = (candidates ?? []).filter(task => taskMatchesHistoryJob(task, job))

  if (resolution.queueTaskId) {
    const exact = matching.filter(task => task.id === resolution.queueTaskId)
    return exact.length === 1 ? exact[0] : null
  }

  if (terminalJobStates.has(job?.job_state)) return null

  const active = matching.filter(task => !terminalQueueStates.has(task.status))
  return active.length === 1 ? active[0] : null
}

function stateReferencesPlatformJob(state:any, platformJobId:string) {
  if (!state || typeof state !== "object") return false
  if (state.platform_job_id === platformJobId || state.platformJobId === platformJobId || state.job_id === platformJobId) return true
  if (Array.isArray(state.jobs) && state.jobs.some((job:any)=>job?.job_id===platformJobId || job?.platform_job_id===platformJobId || job?.platformJobId===platformJobId || job?.id===platformJobId)) return true
  return false
}

export function scopeHistoryAuditEvents(events:any[], platformJobId:string, queueTaskId:string|null|undefined, schedulerEventIds:string[]) {
  const schedulerIds=new Set(schedulerEventIds)
  const directlyScoped=(event:any)=>(
    event?.entity_type==="creator_publishing_platform_job" && event?.entity_id===platformJobId
  ) || (
    Boolean(queueTaskId) && event?.entity_type==="creator_publishing_queue_task" && event?.entity_id===queueTaskId
  ) || (
    event?.entity_type==="creator_publishing_scheduler_event" && schedulerIds.has(event?.entity_id)
  )
  const scopedKeys=new Set((events??[]).filter(directlyScoped).map(event=>event?.idempotency_key).filter((key):key is string=>typeof key==="string"&&key.length>0))
  return (events??[]).filter(event=>
    directlyScoped(event) ||
    event?.action==="creator_publishing_plan_created" ||
    stateReferencesPlatformJob(event?.before_state,platformJobId) ||
    stateReferencesPlatformJob(event?.after_state,platformJobId) ||
    (typeof event?.idempotency_key==="string" && scopedKeys.has(event.idempotency_key)),
  )
}

export function historyJobIsTerminal(jobState: unknown) {
  return typeof jobState === "string" && terminalJobStates.has(jobState)
}
