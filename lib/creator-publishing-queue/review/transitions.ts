import type { CreatorPublishingComplianceStatus, CreatorPublishingReviewDecision, CreatorPublishingReviewOutcome } from "./types"
import { CreatorPublishingReviewError } from "./types"

type Transition = Readonly<{ from: "manual_review"; to: CreatorPublishingComplianceStatus; review_outcome: CreatorPublishingReviewOutcome; action: string; creator_approval_allowed: boolean; reset_for_reevaluation: boolean }>

export const creatorPublishingReviewTransitions: Readonly<Record<CreatorPublishingReviewDecision, Transition>> = Object.freeze({
  approve_escalation: { from: "manual_review", to: "escalated_approved", review_outcome: "escalate", action: "manual_review_approved_for_escalation", creator_approval_allowed: true, reset_for_reevaluation: false },
  reject: { from: "manual_review", to: "manual_review", review_outcome: "manual_review", action: "manual_review_rejected", creator_approval_allowed: false, reset_for_reevaluation: false },
  block: { from: "manual_review", to: "blocked", review_outcome: "block", action: "manual_review_blocked", creator_approval_allowed: false, reset_for_reevaluation: false },
  request_changes: { from: "manual_review", to: "pending", review_outcome: "manual_review", action: "manual_review_changes_requested", creator_approval_allowed: false, reset_for_reevaluation: true },
})

export function resolveCreatorPublishingReviewTransition(decision: string) {
  const transition = creatorPublishingReviewTransitions[decision as CreatorPublishingReviewDecision]
  if (!transition) throw new CreatorPublishingReviewError("REVIEW_INVALID_DECISION", "Unsupported manual-review decision.")
  return transition
}
