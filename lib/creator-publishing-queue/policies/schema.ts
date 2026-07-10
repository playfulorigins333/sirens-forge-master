import type { PlatformId } from "../../autopost/types"

export const creatorPublishingPolicyPlatforms = ["onlyfans", "fansly", "fanvue"] as const
export type CreatorPublishingPolicyPlatform = Extract<PlatformId, (typeof creatorPublishingPolicyPlatforms)[number]>

export const creatorPublishingPolicyModes = ["manual_handoff", "direct_api"] as const
export type CreatorPublishingPolicyMode = (typeof creatorPublishingPolicyModes)[number]

export type SourceReference = Readonly<{
  label: string
  url?: string
  internal_path?: string
  retrieved_or_verified_date?: string
  notes?: string
}>

export type DisclosurePolicy = Readonly<{
  disclosure_required_for_ai: boolean
  allowed_signifiers: readonly string[]
  default_disclosure: string | null
  disclosure_position: "start" | "inline" | "end" | "not_applicable"
  disclosure_removable: boolean
  copy_caption_must_include_disclosure: boolean
  disclosure_cures_prohibited_ai: boolean
  notes: readonly string[]
}>

export type AiPolicy = Readonly<{
  allowed: readonly string[]
  requires: readonly string[]
  hard_blocked: readonly string[]
  manual_review: readonly string[]
  non_photorealistic_requires_virtual_entity_registration?: boolean
}>

export type VerificationPolicy = Readonly<{
  required: boolean
  requirements: readonly string[]
}>

export type PlatformPolicyCapabilities = Readonly<{
  direct_posting: boolean
  manual_handoff: boolean
  native_scheduling: boolean
  internal_scheduling: boolean
  text_posts: boolean
  image_posts: boolean
  video_posts: boolean
  ppv_or_locked_posts: boolean
  visibility_controls: boolean
  provider_post_id: boolean
  platform_credentials: boolean
  platform_sessions: boolean
  browser_automation: boolean
  unofficial_api: boolean
  dm_automation: boolean
  fan_interaction_automation: boolean
  remote_post_verification: boolean
  final_url_human_entry: boolean
  proof_screenshot_optional: boolean
}>

export type PlatformPolicy = Readonly<{
  platform: CreatorPublishingPolicyPlatform
  display_name: string
  mode: CreatorPublishingPolicyMode
  enabled_for_queue: boolean
  policy_version: string
  policy_effective_date: string
  source_references: readonly SourceReference[]
  core_rule: string
  disclosure_policy: DisclosurePolicy
  ai_policy: AiPolicy
  creator_verification_policy: VerificationPolicy
  co_performer_policy: VerificationPolicy
  blocked_categories: readonly string[]
  manual_review_categories: readonly string[]
  allowed_categories: readonly string[]
  handoff_checklist: readonly string[]
  operator_attestation: string
  posted_confirmation: string
  disclaimers: readonly string[]
  capabilities: PlatformPolicyCapabilities
  forbidden_capabilities: readonly string[]
  reference_only?: boolean
  integration_notes?: readonly string[]
}>

export function deepFreezePolicy<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezePolicy(child)
  }
  return value as Readonly<T>
}

function assertNonEmptyArray(value: readonly unknown[], field: string) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be non-empty`)
}

export function validatePlatformPolicy(policy: PlatformPolicy): PlatformPolicy {
  if (!creatorPublishingPolicyPlatforms.includes(policy.platform)) throw new Error(`Invalid platform: ${policy.platform}`)
  if (!creatorPublishingPolicyModes.includes(policy.mode)) throw new Error(`Invalid mode for ${policy.platform}: ${policy.mode}`)
  if (!policy.policy_version.trim()) throw new Error(`${policy.platform} policy_version must be non-empty`)
  assertNonEmptyArray(policy.source_references, `${policy.platform} source_references`)

  if (policy.mode === "manual_handoff") {
    const forbiddenTrue = ["direct_posting", "platform_credentials", "platform_sessions", "browser_automation", "unofficial_api"] as const
    for (const capability of forbiddenTrue) {
      if (policy.capabilities[capability]) throw new Error(`${policy.platform} manual_handoff cannot enable ${capability}`)
    }
  }

  if (policy.platform === "onlyfans") {
    if (!policy.disclosure_policy.disclosure_required_for_ai) throw new Error("OnlyFans AI policy must require disclosure")
    if (!policy.disclosure_policy.copy_caption_must_include_disclosure) throw new Error("OnlyFans copied captions must include disclosure")
  }

  if (policy.platform === "fansly") {
    const blocked = policy.ai_policy.hard_blocked.map((item) => item.toLowerCase())
    if (!blocked.some((item) => item.includes("photorealistic ai twin"))) throw new Error("Fansly photorealistic AI twin content must be hard-blocked")
    if (policy.disclosure_policy.disclosure_cures_prohibited_ai) throw new Error("Fansly disclosure cannot cure prohibited AI")
  }

  if (policy.platform === "fanvue") {
    if (policy.mode !== "direct_api") throw new Error("Fanvue policy must remain direct_api")
    if (policy.enabled_for_queue) throw new Error("Fanvue policy must not be routed through the manual queue")
  }

  if (!Object.isFrozen(policy)) throw new Error(`${policy.platform} policy object must be frozen`)
  return policy
}
