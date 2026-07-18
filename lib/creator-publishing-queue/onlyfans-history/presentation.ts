import type { OnlyFansHistoryAudience, OnlyFansHistoryCategory } from "./types"

type HistoryActionPresentation = {
  label: string
  creator: string
  operator: string
  category: OnlyFansHistoryCategory
}

type AudienceWording = { creator: string; operator: string }

export const PERSISTED_ONLYFANS_HISTORY_ACTIONS = [
  "operator_task_claimed",
  "operator_task_released",
  "operator_expired_claim_recovered",
  "operator_preparation_started",
  "operator_package_prepared",
  "operator_handoff_ready",
  "creator_publishing_schedule_created",
  "creator_publishing_schedule_rescheduled",
  "creator_publishing_schedule_cancelled",
  "creator_publishing_job_schedule_cancelled",
  "operator_task_claim_cleared_by_schedule",
  "operator_task_claim_cleared_by_reschedule",
  "operator_task_claim_cancelled_by_schedule_cancellation",
  "operator_task_archived_by_schedule_cancellation",
  "operator_task_claim_cleared_by_scheduler_gate",
  "creator_publishing_scheduler_event_claimed",
  "creator_publishing_scheduler_event_superseded",
  "creator_publishing_scheduler_gate_failed",
  "creator_publishing_scheduler_event_processed",
  "operator_onlyfans_manual_completion_scheduler_superseded",
  "operator_onlyfans_manual_completion",
  "operator_onlyfans_manual_completion_plan_recomputed",
  "operator_onlyfans_manual_completion_proof_recorded",
  "operator_onlyfans_manual_completion_rejected",
] as const

export const INTENTIONALLY_EXCLUDED_ONLYFANS_HISTORY_ACTIONS: Record<string, string> = {
  creator_publishing_plan_created: "The immutable plan row already supplies the plan-created entry; excluding the audit copy avoids duplicate creation events.",
  creator_publishing_platform_job_created: "The immutable platform-job row already supplies the job-created entry; excluding the audit copy avoids duplicate creation events.",
}

export const ONLYFANS_HISTORY_ACTIONS: Record<string, HistoryActionPresentation> = {
  operator_task_claimed: { label: "Operator started work", creator: "An authorized operator started handling this publication attempt.", operator: "The queue task was claimed by an authorized operator.", category: "operator" },
  operator_task_released: { label: "Operator released task", creator: "Operator handling ended before completion.", operator: "The current queue-task claim was released.", category: "operator" },
  operator_expired_claim_recovered: { label: "Expired operator hold cleared", creator: "An expired operator hold was safely cleared.", operator: "Expired claim recovery restored the queue task to its job-derived state.", category: "operator" },
  operator_preparation_started: { label: "Preparation started", creator: "Manual handoff preparation started.", operator: "The operator advanced progress to preparing.", category: "operator" },
  operator_package_prepared: { label: "Package prepared", creator: "The manual publishing package was prepared.", operator: "The operator advanced progress to prepared.", category: "operator" },
  operator_handoff_ready: { label: "Ready for manual handoff", creator: "The publication was ready for manual OnlyFans posting.", operator: "The operator advanced progress to handoff ready.", category: "operator" },
  creator_publishing_schedule_created: { label: "Schedule created", creator: "A schedule request was recorded for this publication attempt.", operator: "The plan-level schedule request included this platform job.", category: "scheduling" },
  creator_publishing_schedule_rescheduled: { label: "Schedule changed", creator: "A reschedule request was recorded for this publication attempt.", operator: "The plan-level reschedule request included this platform job.", category: "scheduling" },
  creator_publishing_schedule_cancelled: { label: "Plan schedule cancelled", creator: "The publishing-plan schedule was cancelled.", operator: "The creator cancelled the publishing-plan schedule.", category: "scheduling" },
  creator_publishing_job_schedule_cancelled: { label: "Publication schedule cancelled", creator: "The schedule for this publication attempt was cancelled.", operator: "The creator cancelled this platform job's schedule.", category: "scheduling" },
  operator_task_claim_cleared_by_schedule: { label: "Operator hold cleared by scheduling", creator: "The operator hold was cleared because the attempt was scheduled before operator work was due.", operator: "Scheduling cleared the active claim and restored the task to scheduled internally.", category: "scheduling" },
  operator_task_claim_cleared_by_reschedule: { label: "Operator hold cleared by rescheduling", creator: "The operator hold was cleared because the publication time changed.", operator: "Rescheduling cleared the active claim and restored the task to scheduled internally.", category: "scheduling" },
  operator_task_claim_cancelled_by_schedule_cancellation: { label: "Operator hold ended by cancellation", creator: "The operator hold ended when the schedule was cancelled.", operator: "Schedule cancellation cleared the active claim and archived the task.", category: "scheduling" },
  operator_task_archived_by_schedule_cancellation: { label: "Task archived by cancellation", creator: "The pending manual-publishing task was archived when the schedule was cancelled.", operator: "Schedule cancellation archived the unclaimed queue task.", category: "scheduling" },
  operator_task_claim_cleared_by_scheduler_gate: { label: "Operator hold cleared by safety gate", creator: "The operator hold was cleared after a scheduling safety check blocked the attempt.", operator: "A scheduler safety gate cleared the active claim and moved the task to a safe state.", category: "scheduling" },
  creator_publishing_scheduler_event_claimed: { label: "Scheduled milestone processing started", creator: "Sirens Forge started processing a scheduled milestone.", operator: "The scheduler claimed the event for processing.", category: "scheduling" },
  creator_publishing_scheduler_event_superseded: { label: "Scheduled milestone superseded", creator: "A scheduled milestone was replaced or was no longer applicable.", operator: "The scheduler marked the event superseded.", category: "scheduling" },
  creator_publishing_scheduler_gate_failed: { label: "Scheduling safety check blocked", creator: "A safety check stopped this scheduled milestone from continuing.", operator: "The scheduler blocked the event with a finite safe gate result.", category: "scheduling" },
  creator_publishing_scheduler_event_processed: { label: "Scheduled milestone processed", creator: "A scheduled milestone moved this publication attempt forward.", operator: "The scheduler processed the event and recorded the resulting job state.", category: "scheduling" },
  operator_onlyfans_manual_completion_scheduler_superseded: { label: "Remaining schedule work closed", creator: "Unused scheduled milestones were closed after manual publication was confirmed.", operator: "Manual completion superseded remaining pending or processing scheduler events.", category: "scheduling" },
  operator_onlyfans_manual_completion: { label: "Manual publication confirmed", creator: "Manual OnlyFans posting was confirmed.", operator: "The queue task or platform job moved to confirmed manual completion.", category: "completion" },
  operator_onlyfans_manual_completion_plan_recomputed: { label: "Plan status updated", creator: "The publishing plan was updated after manual completion.", operator: "The plan status was recomputed after the confirmed manual completion.", category: "completion" },
  operator_onlyfans_manual_completion_proof_recorded: { label: "Completion proof recorded", creator: "Verified proof was recorded for the manual OnlyFans completion.", operator: "The append-only Task 20 completion-proof event was recorded.", category: "completion" },
  operator_onlyfans_manual_completion_rejected: { label: "Completion rejected", creator: "The trusted database rejected the completion attempt.", operator: "The audited wrapper recorded a finite database-controlled rejection.", category: "completion" },
}

export const rejectionWording: Record<string, AudienceWording> = {
  current_claim_required: { creator: "Completion could not be confirmed because the operator hold was no longer current.", operator: "current_claim_required" },
  work_not_completable: { creator: "Completion could not be confirmed because the work was no longer eligible.", operator: "work_not_completable" },
  account_not_verified: { creator: "Completion could not be confirmed because the OnlyFans account was not verified.", operator: "account_not_verified" },
  package_not_approved: { creator: "Completion could not be confirmed because package approval was incomplete.", operator: "package_not_approved" },
  capability_unavailable: { creator: "Completion could not be confirmed because assisted OnlyFans publishing was unavailable.", operator: "capability_unavailable" },
  source_changed: { creator: "Completion could not be confirmed because source package data changed.", operator: "source_changed" },
  evidence_mismatch: { creator: "Completion could not be confirmed because proof evidence did not match the verified upload.", operator: "evidence_mismatch" },
  url_or_reason_required: { creator: "Completion could not be confirmed because a final URL or approved no-URL reason was required.", operator: "url_or_reason_required" },
  idempotency_conflict: { creator: "Completion could not be confirmed because the retry key was reused for different completion details.", operator: "idempotency_conflict" },
}

const evidenceLifecycleWording: Record<string, HistoryActionPresentation> = {
  evidence_reserved: { label: "Evidence upload reserved", creator: "A proof upload was reserved for this publication.", operator: "A completion-evidence upload intent was reserved.", category: "evidence" },
  evidence_verified: { label: "Evidence verified", creator: "Uploaded completion proof was verified.", operator: "The evidence intent passed trusted MIME, size, and digest verification.", category: "evidence" },
  evidence_superseded: { label: "Evidence superseded", creator: "Earlier completion proof was superseded by replacement evidence.", operator: "The evidence intent was invalidated because replacement evidence superseded it.", category: "evidence" },
  evidence_failed: { label: "Evidence failed", creator: "A proof upload could not be verified and was closed.", operator: "The evidence intent entered a terminal failed state.", category: "evidence" },
  evidence_expired: { label: "Evidence expired", creator: "A proof reservation expired before it was used.", operator: "The evidence intent expired before completion.", category: "evidence" },
  evidence_consumed: { label: "Evidence consumed", creator: "Verified proof was used to confirm the manual publication.", operator: "The verified evidence intent was consumed by manual completion.", category: "evidence" },
}

export const SAFE_SCHEDULE_GATE_WORDING: Record<string, AudienceWording> = {
  PLATFORM_UNAVAILABLE: { creator: "Assisted publishing was unavailable for this destination.", operator: "Platform capability was unavailable (PLATFORM_UNAVAILABLE)." },
  FANVUE_NOT_AVAILABLE: { creator: "That destination was not available for scheduling.", operator: "Fanvue scheduling remained unavailable (FANVUE_NOT_AVAILABLE)." },
  JOB_TERMINAL: { creator: "This attempt was already in a final state.", operator: "The platform job was already terminal (JOB_TERMINAL)." },
  SCHEDULER_JOB_NOT_DRAFT: { creator: "This attempt was no longer eligible for a first schedule.", operator: "The job was not an unscheduled draft (SCHEDULER_JOB_NOT_DRAFT)." },
  SCHEDULER_RESCHEDULE_STATE_BLOCKED: { creator: "This attempt could not be rescheduled from its current state.", operator: "The current job state blocked rescheduling (SCHEDULER_RESCHEDULE_STATE_BLOCKED)." },
  SCHEDULER_OPERATOR_DUE_PASSED: { creator: "The requested time did not leave enough time for manual preparation.", operator: "The calculated operator-due time had already passed (SCHEDULER_OPERATOR_DUE_PASSED)." },
  ACTIVE_QUEUE_TASK_CONFLICT: { creator: "Another active publishing task prevented this schedule change.", operator: "The active queue-task relationship was missing or conflicted (ACTIVE_QUEUE_TASK_CONFLICT)." },
  CREATOR_VERIFICATION_MISSING: { creator: "Creator verification was not current.", operator: "Creator verification was missing (CREATOR_VERIFICATION_MISSING)." },
  DESTINATION_ACCOUNT_NOT_FOUND: { creator: "The selected destination account could not be verified.", operator: "The destination account relationship was not found (DESTINATION_ACCOUNT_NOT_FOUND)." },
  DESTINATION_ACCOUNT_REVOKED: { creator: "The selected OnlyFans account authorization was revoked.", operator: "The destination account was revoked (DESTINATION_ACCOUNT_REVOKED)." },
  DESTINATION_ACCOUNT_NOT_VERIFIED: { creator: "The selected OnlyFans account was not verified.", operator: "The destination account was not verified (DESTINATION_ACCOUNT_NOT_VERIFIED)." },
  AI_TWIN_CONSENT_MISSING: { creator: "Required AI-twin consent was not current.", operator: "Current AI-twin consent evidence was missing (AI_TWIN_CONSENT_MISSING)." },
  CONTENT_PACKAGE_MISMATCH: { creator: "The publishing package no longer matched this attempt.", operator: "The content-package relationship did not match (CONTENT_PACKAGE_MISMATCH)." },
  CREATOR_APPROVAL_MISSING: { creator: "Creator approval or compliance approval was incomplete.", operator: "Creator/package approval was missing (CREATOR_APPROVAL_MISSING)." },
  COMPLIANCE_EVIDENCE_INVALID: { creator: "Current compliance evidence did not support publishing.", operator: "Current compliance evidence was invalid (COMPLIANCE_EVIDENCE_INVALID)." },
  CO_PERFORMER_RELEASE_MISSING: { creator: "A required co-performer release was incomplete.", operator: "A required co-performer release was missing (CO_PERFORMER_RELEASE_MISSING)." },
  SOURCE_FINGERPRINT_STALE: { creator: "The source package changed after this attempt was prepared.", operator: "The source fingerprint was stale (SOURCE_FINGERPRINT_STALE)." },
  ACTIVE_PUBLICATION_JOB_CONFLICT: { creator: "Another active publication attempt prevented this action.", operator: "Another active publication job conflicted (ACTIVE_PUBLICATION_JOB_CONFLICT)." },
  SCHEDULER_STALE_REVISION: { creator: "The schedule changed before this request finished.", operator: "The schedule revision was stale (SCHEDULER_STALE_REVISION)." },
  SCHEDULER_STATE_TRANSITION_INVALID: { creator: "The scheduled milestone no longer matched the attempt's current state.", operator: "The scheduler transition was invalid (SCHEDULER_STATE_TRANSITION_INVALID)." },
  OBSOLETE_OPERATOR_DUE_SUPERSEDED: { creator: "An older operator-due milestone was no longer needed.", operator: "The operator-due event was obsolete (OBSOLETE_OPERATOR_DUE_SUPERSEDED)." },
  OPERATOR_TASK_JOB_MISMATCH: { creator: "The manual-publishing task no longer matched this attempt.", operator: "The task/job relationship did not match (OPERATOR_TASK_JOB_MISMATCH)." },
  OPERATOR_TASK_INELIGIBLE: { creator: "The manual-publishing task was not eligible for this action.", operator: "The queue task was ineligible (OPERATOR_TASK_INELIGIBLE)." },
  OPERATOR_QUEUE_TASK_AMBIGUOUS: { creator: "The publishing task relationship was not unambiguous.", operator: "Multiple or missing active tasks made the relationship ambiguous (OPERATOR_QUEUE_TASK_AMBIGUOUS)." },
  OPERATOR_TARGET_NOT_SUPPORTED: { creator: "This publishing mode was not supported for the requested action.", operator: "The target or mode was unsupported (OPERATOR_TARGET_NOT_SUPPORTED)." },
  PLATFORM_MODE_UNSUPPORTED: { creator: "The destination's publishing mode was unavailable.", operator: "The platform mode was unsupported (PLATFORM_MODE_UNSUPPORTED)." },
  OPERATOR_NOT_AUTHORIZED: { creator: "The operator was not authorized for this publication.", operator: "The actor was not authorized (OPERATOR_NOT_AUTHORIZED)." },
}

export const ONLYFANS_JOB_STATE_LABELS: Record<string, { creator: string; operator: string }> = {
  draft: { creator: "Draft publication attempt", operator: "Draft" },
  scheduled_internally: { creator: "Scheduled for manual publishing", operator: "Scheduled internally" },
  awaiting_operator: { creator: "Awaiting operator preparation", operator: "Awaiting operator" },
  due_now: { creator: "Due for manual publishing", operator: "Due now" },
  ready_to_publish: { creator: "Ready to publish", operator: "Ready to publish" },
  direct_publish_queued: { creator: "Queued for publishing", operator: "Direct publish queued" },
  package_ready: { creator: "Publishing package ready", operator: "Package ready" },
  ready_for_export: { creator: "Ready for export", operator: "Ready for export" },
  needs_fix: { creator: "Needs attention", operator: "Needs fix" },
  confirmed_posted_manual: { creator: "Manual publication confirmed", operator: "Confirmed posted manually" },
  published_direct: { creator: "Publication confirmed", operator: "Published direct" },
  exported: { creator: "Publishing package exported", operator: "Exported" },
  failed_manual_upload: { creator: "Manual publishing failed", operator: "Failed manual upload" },
  direct_publish_failed: { creator: "Publishing failed", operator: "Direct publish failed" },
  skipped: { creator: "Publication skipped", operator: "Skipped" },
  blocked: { creator: "Blocked by safety checks", operator: "Blocked" },
  platform_rejected: { creator: "Platform rejected publication", operator: "Platform rejected" },
  archived: { creator: "Publication attempt archived", operator: "Archived" },
}

export function actionCopy(action: string, _audience: OnlyFansHistoryAudience) {
  return ONLYFANS_HISTORY_ACTIONS[action] ?? {
    label: "Publishing event recorded",
    creator: "A trusted publishing lifecycle event was recorded.",
    operator: "An unrecognized sanitized publishing audit action was recorded.",
    category: "operator" as const,
  }
}

export function isIntentionallyExcludedHistoryAction(action: string) {
  return Object.prototype.hasOwnProperty.call(INTENTIONALLY_EXCLUDED_ONLYFANS_HISTORY_ACTIONS, action)
}

export function evidenceLifecycleCopy(action: string, _audience: OnlyFansHistoryAudience) {
  return evidenceLifecycleWording[action] ?? { label: "Evidence state recorded", creator: "A completion-proof state was recorded.", operator: "A sanitized evidence lifecycle state was recorded.", category: "evidence" as const }
}

export function scheduleGateWording(code: unknown, audience: OnlyFansHistoryAudience) {
  if (typeof code !== "string" || !/^[A-Z0-9_]{1,80}$/.test(code)) return null
  const wording = SAFE_SCHEDULE_GATE_WORDING[code]
  if (wording) return wording[audience]
  return audience === "creator" ? "A scheduling safety check prevented this action." : `An unmapped finite scheduling gate was recorded (${code}).`
}

export function jobStateLabel(state: string, audience: OnlyFansHistoryAudience) {
  return ONLYFANS_JOB_STATE_LABELS[state]?.[audience] ?? (audience === "creator" ? "Publication attempt" : "Unmapped job state")
}

export function evidenceStatusLabel(status: string) {
  return ({ reserved: "Evidence upload reserved", pending: "Evidence upload reserved", verified: "Evidence verified", superseded: "Evidence superseded", invalidated: "Evidence superseded", consumed: "Evidence consumed", failed: "Evidence failed", expired: "Evidence expired" } as Record<string, string>)[status] ?? "Evidence state recorded"
}

export function noUrlReasonLabel(reason: string) {
  return ({ platform_did_not_expose_stable_url: "OnlyFans did not expose a stable post URL.", post_completed_without_shareable_url: "The post was completed without a shareable URL.", account_owner_declined_url_capture: "The account owner declined URL capture." } as Record<string, string>)[reason] ?? "Approved no-URL reason recorded."
}
