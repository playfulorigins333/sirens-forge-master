import { selectCurrentCreatorApprovalComplianceEvidence } from "../approval/service"
import type { CreatorPublishingApprovalReviewEvidence } from "../approval/service"
import type { CreatorPublishingPackageForApproval } from "../approval/types"

export const CREATOR_APPROVAL_QUEUE_TASK_SELECT = "id,content_package_id,target_platform,status,due_at,updated_at"

export type CreatorApprovalListEligibilityPackage = Pick<CreatorPublishingPackageForApproval, "id" | "creator_id" | "target_platform" | "title" | "compliance_status" | "compliance_policy_version" | "creator_approval_status" | "scheduled_for" | "updated_at">

export function baseCreatorApprovalEligible(pkg: Pick<CreatorPublishingPackageForApproval,"target_platform"|"creator_approval_status"|"compliance_status"|"compliance_policy_version">) {
  return pkg.target_platform !== "fanvue" && pkg.creator_approval_status === "pending" && ["passed","escalated_approved"].includes(pkg.compliance_status) && Boolean(pkg.compliance_policy_version && pkg.compliance_policy_version !== "unassigned")
}

export function creatorApprovalListEligibility(pkg: CreatorApprovalListEligibilityPackage, reviews: readonly CreatorPublishingApprovalReviewEvidence[]) {
  const { evidence, laterBlockingReview } = selectCurrentCreatorApprovalComplianceEvidence(pkg as CreatorPublishingPackageForApproval, reviews)
  return { approvable: baseCreatorApprovalEligible(pkg) && Boolean(evidence) && !laterBlockingReview, evidence, laterBlockingReview }
}
