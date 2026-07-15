import type { CreatorPublishingApprovalErrorCode, CreatorPublishingApprovalStatus, CreatorPublishingQueueTaskStatus } from "../approval/types"
import type { CreatorPublishingComplianceStatus } from "../review"

export type SafeApprovalError = Readonly<{ code: string; title: string; message: string; severity: "error" | "warning" | "info"; reloadRequired?: boolean; controlsDisabled?: boolean }>

const safeErrors: Record<CreatorPublishingApprovalErrorCode, SafeApprovalError> = {
  APPROVAL_UNAUTHORIZED: { code: "APPROVAL_UNAUTHORIZED", title: "Not authorized", message: "You are not authorized to review this package.", severity: "error", controlsDisabled: true },
  APPROVAL_CREATOR_MISMATCH: { code: "APPROVAL_CREATOR_MISMATCH", title: "Not authorized", message: "You are not authorized to review this package.", severity: "error", controlsDisabled: true },
  APPROVAL_PACKAGE_NOT_FOUND: { code: "APPROVAL_PACKAGE_NOT_FOUND", title: "Package unavailable", message: "You are not authorized to review this package.", severity: "error", controlsDisabled: true },
  APPROVAL_INVALID_COMPLIANCE_STATUS: { code: "APPROVAL_INVALID_COMPLIANCE_STATUS", title: "Not eligible", message: "This package is no longer eligible for creator approval.", severity: "warning", controlsDisabled: true },
  APPROVAL_STALE_POLICY_VERSION: { code: "APPROVAL_STALE_POLICY_VERSION", title: "Reload required", message: "This package changed after it was loaded. Reload it before deciding.", severity: "warning", reloadRequired: true, controlsDisabled: true },
  APPROVAL_STALE_PACKAGE: { code: "APPROVAL_STALE_PACKAGE", title: "Reload required", message: "This package changed after it was loaded. Reload it before deciding.", severity: "warning", reloadRequired: true, controlsDisabled: true },
  APPROVAL_ALREADY_DECIDED: { code: "APPROVAL_ALREADY_DECIDED", title: "Already decided", message: "This package has already been approved or rejected.", severity: "info", reloadRequired: true, controlsDisabled: true },
  APPROVAL_DUPLICATE: { code: "APPROVAL_DUPLICATE", title: "Decision already saved", message: "This decision was already received. Reload the package to view the current status.", severity: "info", reloadRequired: true, controlsDisabled: true },
  APPROVAL_FANVUE_NOT_SUPPORTED: { code: "APPROVAL_FANVUE_NOT_SUPPORTED", title: "Not supported", message: "Fanvue packages are not routed through creator approval.", severity: "warning", controlsDisabled: true },
  APPROVAL_FANSLY_QUEUE_DISABLED: { code: "APPROVAL_FANSLY_QUEUE_DISABLED", title: "Queue disabled", message: "Approval was saved, but publishing queue handoff is not enabled for Fansly during MVP.", severity: "info", controlsDisabled: true },
  APPROVAL_DISCLOSURE_MISSING: { code: "APPROVAL_DISCLOSURE_MISSING", title: "Disclosure missing", message: "Required disclosure information is missing.", severity: "warning", controlsDisabled: true },
  APPROVAL_MEDIA_MISSING: { code: "APPROVAL_MEDIA_MISSING", title: "Media missing", message: "Required media is missing.", severity: "warning", controlsDisabled: true },
  APPROVAL_INVALID_DECISION: { code: "APPROVAL_INVALID_DECISION", title: "Invalid decision", message: "The decision could not be saved. No publishing action was taken. Try again or reload the package.", severity: "error", controlsDisabled: true },
  APPROVAL_REJECTION_REASON_REQUIRED: { code: "APPROVAL_REJECTION_REASON_REQUIRED", title: "Reason required", message: "Enter a rejection reason before rejecting this package.", severity: "warning" },
  APPROVAL_FINAL_CAPTION_MISSING: { code: "APPROVAL_FINAL_CAPTION_MISSING", title: "Caption missing", message: "A final caption is required before creator approval.", severity: "warning", controlsDisabled: true },
  APPROVAL_BLOCKING_REVIEW_EXISTS: { code: "APPROVAL_BLOCKING_REVIEW_EXISTS", title: "Compliance review required", message: "A compliance review must be completed before approval.", severity: "warning", controlsDisabled: true },
  APPROVAL_CURRENT_COMPLIANCE_EVIDENCE_REQUIRED: { code: "APPROVAL_CURRENT_COMPLIANCE_EVIDENCE_REQUIRED", title: "Compliance review required", message: "A compliance review must be completed before approval.", severity: "warning", controlsDisabled: true },
}
export function mapCreatorApprovalError(error: unknown): SafeApprovalError { const code = typeof error === "object" && error && "code" in error ? String((error as any).code) as CreatorPublishingApprovalErrorCode : "" as CreatorPublishingApprovalErrorCode; return safeErrors[code] ?? { code: "APPROVAL_UNKNOWN", title: "Decision not saved", message: "The decision could not be saved. No publishing action was taken. Try again or reload the package.", severity: "error" } }
export function approvalStatusLabel(status: CreatorPublishingApprovalStatus) { return status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Awaiting your approval" }
export function complianceStatusLabel(status: CreatorPublishingComplianceStatus) { return status.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ") }
export function queueStatusLabel(status: CreatorPublishingQueueTaskStatus | null | undefined) { const labels: Record<CreatorPublishingQueueTaskStatus,string> = { draft:"Draft", needs_compliance_review:"Needs compliance review", needs_creator_approval:"Needs creator approval", ready_for_handoff:"Ready for manual handoff", scheduled_internally:"Scheduled internally", awaiting_operator:"Awaiting operator", due_now:"Due now", claimed:"Claimed for manual handoff", confirmed_posted_manual:"Manual posting confirmed", skipped:"Skipped", failed_manual_upload:"Manual upload failed", needs_fix:"Needs fix", blocked:"Blocked", archived:"Archived" }; return status ? labels[status] ?? status : "No queue task" }
export function platformLabel(platform: string) { return platform === "onlyfans" ? "OnlyFans" : platform === "fansly" ? "Fansly" : platform === "fanvue" ? "Fanvue" : platform }

export function creatorApprovalSuccessMessage(result: { decision: string; target_platform: string; queue_task_status?: CreatorPublishingQueueTaskStatus | null }) {
  if (result.decision === "reject") return { title: "Rejected", message: "Rejected. No queue task was created and no publishing action occurred." }
  if (result.target_platform === "fansly") return { title: "Approved", message: "Approved. Publishing queue creation is disabled for Fansly during MVP; no queue task was created and no automatic publishing occurred." }
  return { title: "Approved", message: `Approved. ${queueStatusLabel(result.queue_task_status)}. Sirens Forge did not automatically publish this content; final posting remains a manual human action.` }
}
