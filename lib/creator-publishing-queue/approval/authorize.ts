import { CreatorPublishingApprovalError, type CreatorPublishingApprovalInput, type CreatorPublishingCreatorAuthorization, type CreatorPublishingPackageForApproval } from "./types"

export function assertCreatorPublishingApprovalAuthorized(input: CreatorPublishingApprovalInput, authorization?: CreatorPublishingCreatorAuthorization | null, pkg?: Pick<CreatorPublishingPackageForApproval, "creator_id"> | null) {
  if (!authorization?.user_id || authorization.service_role) throw new CreatorPublishingApprovalError("APPROVAL_UNAUTHORIZED", "Authenticated creator identity is required.")
  if (input.creator_id !== authorization.user_id) throw new CreatorPublishingApprovalError("APPROVAL_CREATOR_MISMATCH", "Caller supplied creator identity does not match the session.")
  if (pkg && pkg.creator_id !== authorization.user_id) throw new CreatorPublishingApprovalError("APPROVAL_CREATOR_MISMATCH", "Only the package creator can approve this package.")
  return { creator_id: authorization.user_id }
}
