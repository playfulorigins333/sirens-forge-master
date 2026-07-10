import type { ComplianceRuleHit } from "../compliance"
import type { CreatorPublishingPolicyPlatform } from "../policies"

export const creatorPublishingReviewDecisions = ["approve_escalation", "reject", "block", "request_changes"] as const
export type CreatorPublishingReviewDecision = (typeof creatorPublishingReviewDecisions)[number]
export type CreatorPublishingComplianceStatus = "pending" | "passed" | "manual_review" | "blocked" | "escalated_approved"
export type CreatorPublishingReviewOutcome = "pass" | "block" | "manual_review" | "escalate"
export type CreatorPublishingReviewSource = "automated" | "human"

export type CreatorPublishingReviewErrorCode =
  | "REVIEW_UNAUTHORIZED" | "REVIEW_SELF_REVIEW_FORBIDDEN" | "REVIEW_PACKAGE_NOT_FOUND" | "REVIEW_INVALID_CURRENT_STATUS"
  | "REVIEW_STALE_POLICY_VERSION" | "REVIEW_REASON_REQUIRED" | "REVIEW_DUPLICATE" | "REVIEW_CONFLICT"
  | "REVIEW_FANVUE_NOT_SUPPORTED" | "REVIEW_BLOCKED_NOT_ESCALATABLE" | "REVIEW_INVALID_DECISION" | "REVIEW_POLICY_VERSION_UNASSIGNED"
  | "REVIEW_IDENTITY_MISMATCH" | "REVIEW_AUTOMATED_REVIEW_REQUIRED"

export class CreatorPublishingReviewError extends Error {
  constructor(public code: CreatorPublishingReviewErrorCode, message: string, public details?: unknown) { super(message) }
}

export type CreatorPublishingTrustedReviewInput = Readonly<{
  content_package_id: string
  reviewer_id: string
  decision: CreatorPublishingReviewDecision
  reason: string
  reviewer_notes?: string | null
  expected_current_status: CreatorPublishingComplianceStatus
  expected_policy_version: string
  reviewed_at?: string
  idempotency_key?: string
  reviewer_evidence?: Record<string, unknown>
  rule_hit_references?: readonly string[]
  confirmed_rule_hits?: readonly ComplianceRuleHit[]
}>

export type CreatorPublishingTrustedReviewResult = Readonly<{
  content_package_id: string
  creator_id: string
  reviewer_id: string
  decision: CreatorPublishingReviewDecision
  prior_compliance_status: CreatorPublishingComplianceStatus
  resulting_compliance_status: CreatorPublishingComplianceStatus
  policy_version: string
  review_record_id?: string | null
  audit_event_ids?: readonly (string | number)[]
  creator_approval_allowed: boolean
  queue_creation_allowed: false
  reviewed_at: string
}>

export type CreatorPublishingPackageForReview = Readonly<{
  id: string; creator_id: string; target_platform: CreatorPublishingPolicyPlatform; compliance_status: CreatorPublishingComplianceStatus
  compliance_policy_version: string; forced_disclosure_text: string | null; creator_approval_status: "pending" | "approved" | "rejected"
  creator_approved_at?: string | null; creator_approved_by?: string | null; updated_at?: string | null
}>

export type CreatorPublishingReviewerAuthorization = Readonly<{ reviewer_id: string; trusted: boolean; role?: "admin" | "operator" | "reviewer" | "service_reviewer"; active?: boolean }>
