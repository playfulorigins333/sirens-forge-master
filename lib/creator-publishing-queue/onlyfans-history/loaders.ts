import "server-only"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { supabaseServer } from "../../supabaseServer"
import { loadCreatorOnlyFansPackageHistoryCore } from "./creator-package"
import { normalizeOnlyFansHistory } from "./core"
import { jobStateLabel } from "./presentation"
import {
  chooseHistoryQueueTask,
  historyJobIsTerminal,
  resolveQueueTaskIdFromJobLinks,
  scopeHistoryAuditEvents,
  type HistoryTaskLinkRows,
} from "./resolution"
import {
  decodeTerminalHistoryCursor,
  nextTerminalHistoryCursor,
  ONLYFANS_TERMINAL_JOB_STATES,
  TERMINAL_HISTORY_PAGE_SIZE,
} from "./terminal-history"
import { normalizeHistoryTimezone } from "./timezone"
import type { OnlyFansCreatorPackageHistoryView, OnlyFansHistoryRows, OnlyFansHistoryView, OnlyFansTerminalHistoryView } from "./types"

const taskSelect = "id,content_package_id,creator_id,platform_account_id,target_platform,status,operator_progress_state,posted_by,posted_at,posted_confirmation,final_post_url,final_post_url_skip_reason,proof_screenshot_storage_key,created_at,updated_at"
const jobSelect = "id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,schedule_timezone,schedule_revision,created_at,updated_at,intended_publish_at,operator_due_at,scheduled_at,rescheduled_at,cancelled_at"
const auditSelect = "id,entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at"
const evidenceSelect = "id,actor_id,queue_task_id,platform_job_id,content_package_id,platform_account_id,status,operation,replaces_intent_id,replaced_by_intent_id,normalized_mime_type,actual_size_bytes,verified_sha256,failure_code,created_at,verified_at,consumed_at,invalidated_at,failed_at,expired_at"
const terminalTaskLinkActionTypes = ["claim", "release", "progress_update", "expired_claim_recovery", "manual_completion_rejection"]

async function actorId() {
  const server = await supabaseServer()
  const { data, error } = await server.auth.getUser()
  return error || !data.user?.id ? null : data.user.id
}

async function one(query: any) {
  const result = await query.maybeSingle()
  if (result.error) throw result.error
  return result.data ?? null
}

async function many(query: any) {
  const result = await query
  if (result.error) throw result.error
  return result.data ?? []
}

async function authorizedOperator(admin: any, creatorId: string, actor: string) {
  if (actor === creatorId) return true
  const row = await one(
    admin
      .from("creator_publishing_operator_authorizations")
      .select("id")
      .eq("creator_id", creatorId)
      .eq("operator_id", actor)
      .eq("platform", "onlyfans")
      .eq("status", "active")
      .is("revoked_at", null),
  )
  return Boolean(row)
}

async function resolveTaskForJob(admin: any, job: any, links: HistoryTaskLinkRows) {
  const resolution = resolveQueueTaskIdFromJobLinks(links)
  if (resolution.ambiguous) return null

  let candidates: any[] = []
  if (resolution.queueTaskId) {
    candidates = await many(
      admin
        .from("creator_publishing_queue_tasks")
        .select(taskSelect)
        .eq("id", resolution.queueTaskId),
    )
  } else if (!historyJobIsTerminal(job.job_state)) {
    candidates = await many(
      admin
        .from("creator_publishing_queue_tasks")
        .select(taskSelect)
        .eq("content_package_id", job.content_package_id)
        .eq("creator_id", job.creator_id)
        .eq("platform_account_id", job.platform_account_id)
        .eq("target_platform", job.target_platform),
    )
  }

  return chooseHistoryQueueTask(job, candidates, links)
}

export async function collectOnlyFansHistoryRows(admin: any, job: any): Promise<OnlyFansHistoryRows> {
  const schedulerEvents = await many(
    admin
      .from("creator_publishing_scheduler_events")
      .select("id,platform_job_id,event_type,status,due_at,schedule_revision,safe_error_code,created_at,updated_at,processed_at,blocked_at,superseded_at,cancelled_at")
      .eq("platform_job_id", job.id),
  )

  const jobAuditEvents = await many(
    admin
      .from("creator_publishing_audit_events")
      .select(auditSelect)
      .eq("entity_type", "creator_publishing_platform_job")
      .eq("entity_id", job.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  )

  const queueTaskLinkAuditEvents = await many(
    admin
      .from("creator_publishing_audit_events")
      .select(auditSelect)
      .eq("entity_type", "creator_publishing_queue_task")
      .contains("after_state", { platform_job_id: job.id })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  )

  const evidenceIntents = await many(
    admin
      .from("creator_publishing_operator_completion_evidence_intents")
      .select(evidenceSelect)
      .eq("platform_job_id", job.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  )

  const completionIdempotencyRows = await many(
    admin
      .from("creator_publishing_operator_action_idempotency")
      .select("queue_task_id,platform_job_id,action_type,internal_request_snapshot,created_at")
      .eq("platform_job_id", job.id)
      .eq("action_type", "manual_completion")
      .order("created_at", { ascending: false }),
  )

  const terminalTaskLinkRows = await many(
    admin
      .from("creator_publishing_operator_action_idempotency")
      .select("queue_task_id,platform_job_id,action_type,created_at")
      .eq("platform_job_id", job.id)
      .in("action_type", terminalTaskLinkActionTypes)
      .order("created_at", { ascending: false }),
  )

  const idempotencyRows = [...completionIdempotencyRows, ...terminalTaskLinkRows]
  const links = {
    platformJobId: job.id,
    auditEvents: [...jobAuditEvents, ...queueTaskLinkAuditEvents],
    evidenceIntents,
    idempotencyRows,
  }
  const task = await resolveTaskForJob(admin, job, links)
  const schedulerIds = schedulerEvents.map((event: any) => event.id)
  const orParts = [
    `and(entity_type.eq.creator_publishing_platform_job,entity_id.eq.${job.id})`,
    `and(entity_type.eq.creator_publishing_content_package,entity_id.eq.${job.content_package_id})`,
    `and(entity_type.eq.creator_publishing_plan,entity_id.eq.${job.publishing_plan_id})`,
  ]
  if (task?.id) orParts.push(`and(entity_type.eq.creator_publishing_queue_task,entity_id.eq.${task.id})`)
  for (const id of schedulerIds) orParts.push(`and(entity_type.eq.creator_publishing_scheduler_event,entity_id.eq.${id})`)

  const auditEvents = await many(
    admin
      .from("creator_publishing_audit_events")
      .select(auditSelect)
      .or(orParts.join(","))
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  )

  const plan = await one(
    admin
      .from("creator_publishing_plans")
      .select("id,creator_id,status,created_at,updated_at")
      .eq("id", job.publishing_plan_id)
      .eq("creator_id", job.creator_id),
  )

  const scopedAuditEvents=scopeHistoryAuditEvents(auditEvents,job.id,task?.id,schedulerIds)
  return { plan, job, task, schedulerEvents, auditEvents:scopedAuditEvents, evidenceIntents, idempotencyRows }
}

export async function loadCreatorOnlyFansHistory(contentPackageId: string): Promise<OnlyFansCreatorPackageHistoryView> {
  const actor = await actorId()
  if (!actor) return { ok: false, code: "sign_in_required", message: "Sign in to view publishing history." }
  const admin = getSupabaseAdmin()

  try {
    return await loadCreatorOnlyFansPackageHistoryCore(contentPackageId,actor,{
      loadPackage:async (packageId,creatorId)=>one(
        admin
          .from("creator_publishing_content_packages")
          .select("id,creator_id,target_platform")
          .eq("id", packageId)
          .eq("creator_id", creatorId)
          .eq("target_platform", "onlyfans"),
      ),
      loadJobs:async (packageId,creatorId)=>many(
        admin
          .from("creator_publishing_platform_jobs")
          .select(jobSelect)
          .eq("content_package_id", packageId)
          .eq("creator_id", creatorId)
          .eq("target_platform", "onlyfans")
          .eq("publishing_mode", "assisted")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
      ),
      collectJobRows:(job)=>collectOnlyFansHistoryRows(admin,job),
    })
  } catch {
    return { ok: false, code: "service_unavailable", message: "Publishing history could not be loaded." }
  }
}

export async function loadOperatorOnlyFansJobHistory(platformJobId: string): Promise<OnlyFansHistoryView> {
  const actor = await actorId()
  if (!actor) return { ok: false, code: "sign_in_required", message: "Sign in to view operator history." }
  const admin = getSupabaseAdmin()

  try {
    const job = await one(
      admin
        .from("creator_publishing_platform_jobs")
        .select(jobSelect)
        .eq("id", platformJobId)
        .eq("target_platform", "onlyfans")
        .eq("publishing_mode", "assisted"),
    )
    if (!job || !(await authorizedOperator(admin, job.creator_id, actor))) {
      return { ok: false, code: "not_found", message: "This history is unavailable." }
    }

    return normalizeOnlyFansHistory(await collectOnlyFansHistoryRows(admin, job), "operator")
  } catch {
    return { ok: false, code: "service_unavailable", message: "This history could not be loaded." }
  }
}

export async function loadOperatorOnlyFansTerminalHistory(cursorValue?: string | null): Promise<OnlyFansTerminalHistoryView> {
  const actor = await actorId()
  if (!actor) return { ok: false as const, code: "sign_in_required" as const, message: "Sign in to view completed history." }
  const admin = getSupabaseAdmin()

  try {
    const auths = await many(
      admin
        .from("creator_publishing_operator_authorizations")
        .select("creator_id")
        .eq("operator_id", actor)
        .eq("platform", "onlyfans")
        .eq("status", "active")
        .is("revoked_at", null),
    )
    const creators = [...new Set([actor, ...auths.map((authorization: any) => authorization.creator_id)])]
    const cursor = decodeTerminalHistoryCursor(cursorValue)
    let query = admin
      .from("creator_publishing_platform_jobs")
      .select("id,creator_id,content_package_id,job_state,schedule_timezone,updated_at")
      .in("creator_id", creators)
      .eq("target_platform", "onlyfans")
      .eq("publishing_mode", "assisted")
      .in("job_state", [...ONLYFANS_TERMINAL_JOB_STATES])
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(TERMINAL_HISTORY_PAGE_SIZE + 1)
    if (cursor) {
      query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.platformJobId})`)
    }
    const jobs = await many(query)
    const nextCursor = nextTerminalHistoryCursor(jobs)
    return {
      ok: true as const,
      jobs: jobs.slice(0, TERMINAL_HISTORY_PAGE_SIZE).map((job: any) => ({
        platformJobId: job.id,
        creatorId: job.creator_id,
        contentPackageId: job.content_package_id,
        status: job.job_state,
        statusLabel: jobStateLabel(job.job_state, "operator"),
        updatedAt: job.updated_at,
        timezone: normalizeHistoryTimezone(job.schedule_timezone),
      })),
      nextCursor,
      hasPreviousPage: Boolean(cursor),
    }
  } catch {
    return { ok: false as const, code: "service_unavailable" as const, message: "Completed history could not be loaded." }
  }
}
