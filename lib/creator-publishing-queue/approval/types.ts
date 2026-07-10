import type { CreatorPublishingPolicyPlatform } from "../policies"
import type { CreatorPublishingComplianceStatus } from "../review"

export const creatorPublishingApprovalDecisions = ["approve", "reject"] as const
export type CreatorPublishingApprovalDecision = (typeof creatorPublishingApprovalDecisions)[number]
export type CreatorPublishingApprovalStatus = "pending" | "approved" | "rejected"
export type CreatorPublishingQueueTaskStatus = "draft" | "needs_compliance_review" | "needs_creator_approval" | "ready_for_handoff" | "scheduled_internally" | "due_now" | "claimed" | "confirmed_posted_manual" | "skipped" | "failed_manual_upload" | "needs_fix" | "blocked" | "archived"

export type CreatorPublishingApprovalErrorCode =
  | "APPROVAL_UNAUTHORIZED" | "APPROVAL_CREATOR_MISMATCH" | "APPROVAL_PACKAGE_NOT_FOUND" | "APPROVAL_INVALID_COMPLIANCE_STATUS"
  | "APPROVAL_STALE_POLICY_VERSION" | "APPROVAL_STALE_PACKAGE" | "APPROVAL_ALREADY_DECIDED" | "APPROVAL_DUPLICATE"
  | "APPROVAL_FANVUE_NOT_SUPPORTED" | "APPROVAL_FANSLY_QUEUE_DISABLED" | "APPROVAL_DISCLOSURE_MISSING" | "APPROVAL_MEDIA_MISSING"
  | "APPROVAL_INVALID_DECISION" | "APPROVAL_REJECTION_REASON_REQUIRED" | "APPROVAL_FINAL_CAPTION_MISSING" | "APPROVAL_BLOCKING_REVIEW_EXISTS"
  | "APPROVAL_CURRENT_COMPLIANCE_EVIDENCE_REQUIRED"

export class CreatorPublishingApprovalError extends Error {
  constructor(public code: CreatorPublishingApprovalErrorCode, message: string, public details?: unknown) { super(message) }
}

export type CreatorPublishingCreatorAuthorization = Readonly<{ user_id?: string | null; role?: string | null; service_role?: boolean | null }>
export type CreatorPublishingApprovalInput = Readonly<{
  content_package_id: string
  creator_id: string
  decision: CreatorPublishingApprovalDecision
  expected_compliance_status: CreatorPublishingComplianceStatus
  expected_policy_version: string
  expected_package_updated_at: string
  idempotency_key: string
  rejection_reason?: string | null
  creator_notes?: string | null
  approval_snapshot_hash?: string | null
  media_manifest_hash?: string | null
  actor_role?: string | null
}>
export type CreatorPublishingPackageForApproval = Readonly<{
  id: string; creator_id: string; platform_account_id: string; target_platform: CreatorPublishingPolicyPlatform; title: string; caption_body: string | null; forced_disclosure_text: string | null
  ai_flag: "none" | "ai_enhanced" | "ai_generated"; ai_detail: Record<string, unknown>; second_person_present: boolean
  compliance_status: CreatorPublishingComplianceStatus; compliance_policy_version: string; creator_approval_status: CreatorPublishingApprovalStatus
  creator_approved_at?: string | null; creator_approved_by?: string | null; scheduled_for?: string | null; created_at: string; updated_at: string
}>
export type CreatorPublishingMediaAssetForApproval = Readonly<{ id: string; content_package_id: string; storage_key: string; mime_type: string; sha256: string; source: string; ai_generation_metadata?: Record<string, unknown> | null; created_at?: string | null }>
export type CreatorPublishingApprovalSnapshot = Readonly<{
  content_package_id: string; creator_id: string; target_platform: CreatorPublishingPolicyPlatform; platform_account_id: string; policy_version: string; compliance_status: CreatorPublishingComplianceStatus
  title: string; final_caption: string; forced_disclosure: string | null; media_assets: readonly Pick<CreatorPublishingMediaAssetForApproval, "id" | "storage_key" | "mime_type" | "sha256" | "source" | "ai_generation_metadata">[]
  ai_flag: string; ai_detail: Record<string, unknown>; second_person_present: boolean; compliance_summary: Record<string, unknown>; review_summary: Record<string, unknown> | null
  platform_handoff_checklist: readonly string[]; platform_disclaimers: readonly string[]; created_at: string; updated_at: string
}>
export type CreatorPublishingApprovalResult = Readonly<{
  content_package_id: string; creator_id: string; target_platform: CreatorPublishingPolicyPlatform; decision: CreatorPublishingApprovalDecision
  prior_creator_approval_status: CreatorPublishingApprovalStatus; resulting_creator_approval_status: CreatorPublishingApprovalStatus
  compliance_status: CreatorPublishingComplianceStatus; policy_version: string; snapshot_hash: string; queue_task_created: boolean; queue_task_id: string | null
  queue_task_status: CreatorPublishingQueueTaskStatus | null; queue_creation_allowed: boolean; approved_at?: string | null; rejected_at?: string | null; audit_event_ids: readonly (string | number)[]
}>
