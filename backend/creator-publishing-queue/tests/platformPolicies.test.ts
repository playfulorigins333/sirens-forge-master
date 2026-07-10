import assert from 'node:assert/strict'
import { findForbiddenNetworkCalls } from '../../../scripts/creatorPublishingQueueSafetyGuard'
import { creatorPublishingPlatformPolicies, getCreatorPublishingPlatformPolicy, listCreatorPublishingPlatformPolicies, validatePlatformPolicy } from '../../../lib/creator-publishing-queue/policies'
import { onlyFansPolicy } from '../../../lib/creator-publishing-queue/policies/onlyfans'
import { fanslyPolicy } from '../../../lib/creator-publishing-queue/policies/fansly'
import { fanvuePolicy } from '../../../lib/creator-publishing-queue/policies/fanvue'
import type { PlatformPolicy } from '../../../lib/creator-publishing-queue/policies/schema'

assert.equal(onlyFansPolicy.mode, 'manual_handoff')
assert.equal(onlyFansPolicy.enabled_for_queue, true)
assert.equal(onlyFansPolicy.disclosure_policy.disclosure_required_for_ai, true)
assert.equal(onlyFansPolicy.disclosure_policy.disclosure_position, 'start')
assert.equal(onlyFansPolicy.disclosure_policy.default_disclosure, '#ai')
assert.equal(onlyFansPolicy.disclosure_policy.disclosure_removable, false)
assert.equal(onlyFansPolicy.disclosure_policy.copy_caption_must_include_disclosure, true)
assert.equal(onlyFansPolicy.capabilities.direct_posting, false)
assert.equal(onlyFansPolicy.capabilities.platform_credentials, false)
assert.equal(onlyFansPolicy.capabilities.platform_sessions, false)
assert.equal(onlyFansPolicy.capabilities.browser_automation, false)

assert.equal(fanslyPolicy.mode, 'manual_handoff')
assert.equal(fanslyPolicy.enabled_for_queue, false)
assert.ok(fanslyPolicy.ai_policy.hard_blocked.includes('photorealistic AI twin content'))
assert.ok(fanslyPolicy.ai_policy.hard_blocked.includes('LoRA-generated photorealistic content'))
assert.ok(fanslyPolicy.ai_policy.manual_review.includes('AI background edits'))
assert.ok(fanslyPolicy.ai_policy.manual_review.includes('AI outfit edits'))
assert.equal(fanslyPolicy.ai_policy.non_photorealistic_requires_virtual_entity_registration, true)
assert.equal(fanslyPolicy.disclosure_policy.disclosure_cures_prohibited_ai, false)
assert.equal(fanslyPolicy.capabilities.direct_posting, false)
assert.equal(fanslyPolicy.capabilities.unofficial_api, false)

assert.equal(fanvuePolicy.mode, 'direct_api')
assert.equal(fanvuePolicy.enabled_for_queue, false)
assert.equal(fanvuePolicy.reference_only, true)
assert.ok(fanvuePolicy.integration_notes?.some((note) => note.includes('Do not modify Fanvue posting behavior.')))

assert.equal(getCreatorPublishingPlatformPolicy('onlyfans'), onlyFansPolicy)
assert.equal(getCreatorPublishingPlatformPolicy('fansly'), fanslyPolicy)
assert.equal(getCreatorPublishingPlatformPolicy('fanvue'), fanvuePolicy)
assert.deepEqual(listCreatorPublishingPlatformPolicies().map((policy) => policy.platform), ['onlyfans', 'fansly', 'fanvue'])
assert.equal(creatorPublishingPlatformPolicies.onlyfans.policy_version, 'onlyfans-manual-handoff-2026-07-10-v1')

const invalidManualDirectPosting = {
  ...onlyFansPolicy,
  capabilities: { ...onlyFansPolicy.capabilities, direct_posting: true },
} as PlatformPolicy
assert.throws(() => validatePlatformPolicy(Object.freeze(invalidManualDirectPosting)), /manual_handoff cannot enable direct_posting/)

const invalidFanslyDisclosureOverride = {
  ...fanslyPolicy,
  disclosure_policy: { ...fanslyPolicy.disclosure_policy, disclosure_cures_prohibited_ai: true },
} as PlatformPolicy
assert.throws(() => validatePlatformPolicy(Object.freeze(invalidFanslyDisclosureOverride)), /Fansly disclosure cannot cure prohibited AI/)

const invalidFanvueQueue = { ...fanvuePolicy, enabled_for_queue: true } as PlatformPolicy
assert.throws(() => validatePlatformPolicy(Object.freeze(invalidFanvueQueue)), /Fanvue policy must not be routed through the manual queue/)

assert.equal(Object.isFrozen(onlyFansPolicy), true)
assert.equal(Object.isFrozen(onlyFansPolicy.disclosure_policy), true)
assert.equal(Object.isFrozen(onlyFansPolicy.disclosure_policy.allowed_signifiers), true)
assert.throws(() => { (onlyFansPolicy as unknown as { mode: string }).mode = 'direct_api' }, /read only|Cannot assign/)
assert.equal(onlyFansPolicy.mode, 'manual_handoff')

assert.deepEqual(findForbiddenNetworkCalls([
  'lib/creator-publishing-queue/policies/schema.ts',
  'lib/creator-publishing-queue/policies/onlyfans.ts',
  'lib/creator-publishing-queue/policies/fansly.ts',
  'lib/creator-publishing-queue/policies/fanvue.ts',
  'lib/creator-publishing-queue/policies/index.ts',
]), [])

console.log('Creator Publishing Queue platform policy tests passed')
