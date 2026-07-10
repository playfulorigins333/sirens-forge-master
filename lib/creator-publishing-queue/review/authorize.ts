import { CreatorPublishingReviewError, type CreatorPublishingPackageForReview, type CreatorPublishingReviewerAuthorization } from "./types"

const allowedRoles = new Set(["admin", "operator", "reviewer", "service_reviewer"])

export function assertTrustedCreatorPublishingReviewer(auth: CreatorPublishingReviewerAuthorization | null | undefined, pkg?: Pick<CreatorPublishingPackageForReview, "creator_id">) {
  if (!auth?.reviewer_id || !auth.trusted || auth.active === false || !allowedRoles.has(String(auth.role))) {
    throw new CreatorPublishingReviewError("REVIEW_UNAUTHORIZED", "A trusted reviewer role is required.")
  }
  if (pkg && auth.reviewer_id === pkg.creator_id) throw new CreatorPublishingReviewError("REVIEW_SELF_REVIEW_FORBIDDEN", "Creators cannot review their own content package.")
  return auth
}

export function reviewerAuthorizationFromServerAllowlist(reviewer_id: string | null | undefined, allowedReviewerIds: readonly string[] = [], role: CreatorPublishingReviewerAuthorization["role"] = "reviewer") {
  return { reviewer_id: reviewer_id ?? "", trusted: Boolean(reviewer_id && allowedReviewerIds.includes(reviewer_id)), role, active: true } as const
}
