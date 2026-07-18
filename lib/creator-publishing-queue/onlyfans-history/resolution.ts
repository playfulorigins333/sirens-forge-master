export type HistoryTaskLinkSource =
  | "completion_proof_audit"
  | "manual_completion_idempotency"
  | "completion_evidence"

export type HistoryTaskResolution = {
  queueTaskId: string | null
  source: HistoryTaskLinkSource | null
  ambiguous: boolean
}

export type HistoryTaskLinkRows = {
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

function normalizedIds(values: unknown[]) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))]
}

function resolutionFor(source: HistoryTaskLinkSource, ids: string[]): HistoryTaskResolution | null {
  if (ids.length > 1) return { queueTaskId: null, source, ambiguous: true }
  if (ids.length === 1) return { queueTaskId: ids[0], source, ambiguous: false }
  return null
}

export function resolveQueueTaskIdFromJobLinks(rows: HistoryTaskLinkRows): HistoryTaskResolution {
  const proof = resolutionFor(
    "completion_proof_audit",
    normalizedIds(
      (rows.auditEvents ?? [])
        .filter(event => event?.action === "operator_onlyfans_manual_completion_proof_recorded")
        .map(event => event?.after_state?.queue_task_id),
    ),
  )
  if (proof) return proof

  const idempotency = resolutionFor(
    "manual_completion_idempotency",
    normalizedIds(
      (rows.idempotencyRows ?? [])
        .filter(row => row?.action_type === "manual_completion")
        .map(row => row?.queue_task_id),
    ),
  )
  if (idempotency) return idempotency

  const evidence = resolutionFor(
    "completion_evidence",
    normalizedIds((rows.evidenceIntents ?? []).map(row => row?.queue_task_id)),
  )
  if (evidence) return evidence

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

export function historyJobIsTerminal(jobState: unknown) {
  return typeof jobState === "string" && terminalJobStates.has(jobState)
}
