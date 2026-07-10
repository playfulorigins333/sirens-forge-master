import type { PlatformId } from "../../autopost/types"
import { fanvuePolicy } from "./fanvue"
import { fanslyPolicy } from "./fansly"
import { onlyFansPolicy } from "./onlyfans"
import { validatePlatformPolicy, type CreatorPublishingPolicyPlatform, type PlatformPolicy } from "./schema"

export { fanvuePolicy, fanslyPolicy, onlyFansPolicy }
export * from "./schema"

const policies = [onlyFansPolicy, fanslyPolicy, fanvuePolicy].map(validatePlatformPolicy)

export const creatorPublishingPlatformPolicies = Object.freeze(
  Object.fromEntries(policies.map((policy) => [policy.platform, policy]))
) as Readonly<Record<CreatorPublishingPolicyPlatform, PlatformPolicy>>

export function getCreatorPublishingPlatformPolicy(platform: PlatformId | CreatorPublishingPolicyPlatform) {
  const policy = creatorPublishingPlatformPolicies[platform as CreatorPublishingPolicyPlatform]
  if (!policy) throw new Error(`Creator Publishing Queue policy is not configured for platform: ${platform}`)
  return policy
}

export function listCreatorPublishingPlatformPolicies() {
  return Object.freeze([...policies]) as readonly PlatformPolicy[]
}
