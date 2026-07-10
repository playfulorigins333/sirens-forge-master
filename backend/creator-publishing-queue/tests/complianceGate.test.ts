import assert from 'node:assert/strict'
import { evaluateCreatorPublishingCompliance, evaluateAndPersistCreatorPublishingCompliance, type ComplianceInput } from '../../../lib/creator-publishing-queue/compliance'
import { findForbiddenNetworkCalls } from '../../../scripts/creatorPublishingQueueSafetyGuard'

const base: ComplianceInput = {
  content_package_id: 'pkg-1', creator_id: 'creator-1', target_platform: 'onlyfans', title: 'hello', caption_body: 'caption', ai_flag: 'none', ai_detail: {}, media_provenance: ['camera_upload'], creator_verification_status: 'verified', ai_twin_consent_status: 'not_applicable', second_person_present: false, co_performer_release_status: 'not_applicable', co_performer_verification_status: 'not_applicable', virtual_entity_registration_status: 'not_applicable', platform_account_verification_status: 'verified', evaluated_at: '2026-07-10T00:00:00.000Z'
}
const aiTwin = (patch: Partial<ComplianceInput>): ComplianceInput => ({ ...base, ai_flag: 'ai_generated', media_provenance: ['ai_pipeline'], ai_detail: { generated_creator_likeness: true }, ai_twin_consent_status: 'granted', ...patch })
const fansly = (patch: Partial<ComplianceInput> = {}): ComplianceInput => ({ ...base, target_platform: 'fansly', caption_body: 'caption', ai_twin_consent_status: 'not_applicable', ...patch })

const cases: Array<[string, ComplianceInput, string, string | null]> = [
  ['of ai twin consent passes with prepended disclosure', aiTwin({ caption_body: 'hello' }), 'passed', '#ai hello'],
  ['of existing #ai not duplicated', aiTwin({ caption_body: '#ai hello' }), 'passed', '#ai hello'],
  ['of existing #AIGenerated accepted', aiTwin({ caption_body: '#AIGenerated hello' }), 'passed', '#AIGenerated hello'],
  ['of late disclosure moved', aiTwin({ caption_body: 'hello #ai world' }), 'passed', '#ai hello world'],
  ['of non-ai no disclosure', { ...base, caption_body: 'hello' }, 'passed', 'hello'],
  ['of creator_attested creator blocked', { ...base, creator_verification_status: 'creator_attested' }, 'blocked', 'caption'],
  ['of platform account creator_attested blocked', { ...base, platform_account_verification_status: 'creator_attested' }, 'blocked', 'caption'],
  ['of platform account missing blocked', { ...base, platform_account_verification_status: undefined }, 'blocked', 'caption'],
  ['of platform account unverified blocked', { ...base, platform_account_verification_status: 'unverified' }, 'blocked', 'caption'],
  ['of both exactly verified eligible', { ...base }, 'passed', 'caption'],
  ['of missing creator verification blocked', aiTwin({ creator_verification_status: 'unverified' }), 'blocked', '#ai caption'],
  ['of generated ai twin missing consent blocked', aiTwin({ ai_twin_consent_status: 'missing' }), 'blocked', '#ai caption'],
  ['of generated ai twin consent eligible', aiTwin({ ai_twin_consent_status: 'granted' }), 'passed', '#ai caption'],
  ['of lora likeness missing consent blocked', aiTwin({ ai_detail: { lora_generated: true }, ai_twin_consent_status: 'missing' }), 'blocked', '#ai caption'],
  ['of background edit no consent review not consent-block', { ...base, ai_flag: 'ai_enhanced', media_provenance: ['edited'], ai_detail: { ai_background_edit: true }, ai_twin_consent_status: 'missing' }, 'manual_review', '#ai caption'],
  ['of lighting edit no consent no consent-block', { ...base, ai_flag: 'ai_enhanced', media_provenance: ['edited'], ai_detail: { ai_lighting_edit: true }, ai_twin_consent_status: 'missing' }, 'manual_review', '#ai caption'],
  ['of camera upscale no consent no consent-block', { ...base, media_provenance: ['camera_upload','edited'], ai_detail: { upscaled: true }, ai_twin_consent_status: 'missing' }, 'passed', '#ai caption'],
  ['of fictional persona blocked', aiTwin({ ai_detail: { synthetic_persona: true } }), 'blocked', '#ai caption'],
  ['of composite persona blocked', aiTwin({ ai_detail: { composite_persona: true } }), 'blocked', '#ai caption'],
  ['of third-party deepfake blocked', aiTwin({ ai_detail: { deepfake: true } }), 'blocked', '#ai caption'],
  ['of unauthorized face swap blocked', aiTwin({ ai_detail: { face_swap: true, unauthorized_face_swap: true } }), 'blocked', '#ai caption'],
  ['of second person no release blocked', { ...base, second_person_present: true, co_performer_release_status: 'missing', co_performer_verification_status: 'missing' }, 'blocked', 'caption'],
  ['of likeness drift manual review', aiTwin({ ai_detail: { creator_likeness_drift: true } }), 'manual_review', '#ai caption'],
  ['of outfit/body edit manual review', aiTwin({ ai_detail: { ai_outfit_edit: true, body_adjacent_edit: true } }), 'manual_review', '#ai caption'],
  ['of borderline consent manual review', { ...base, caption_body: 'consensual non-consent fantasy' }, 'manual_review', 'consensual non-consent fantasy'],
  ['of youth-coded blocked', { ...base, caption_body: 'barely legal vibe' }, 'blocked', 'barely legal vibe'],
  ['of non-consent blocked', { ...base, caption_body: 'without consent' }, 'blocked', 'without consent'],
  ['of incest blocked', { ...base, caption_body: 'step dad fantasy' }, 'blocked', 'step dad fantasy'],
  ['fansly photorealistic ai blocked', fansly({ ai_flag: 'ai_generated', media_provenance: ['ai_pipeline'], ai_detail: { photorealistic: true } }), 'blocked', 'caption'],
  ['fansly lora photorealistic blocked', fansly({ ai_flag: 'ai_generated', media_provenance: ['ai_pipeline'], ai_detail: { lora_generated: true, photorealistic: true } }), 'blocked', 'caption'],
  ['fansly disclosure cannot cure block', fansly({ caption_body: '#ai labeled', ai_flag: 'ai_generated', media_provenance: ['ai_pipeline'], ai_detail: { photorealistic: true } }), 'blocked', '#ai labeled'],
  ['fansly real camera passed', fansly(), 'passed', 'caption'],
  ['fansly minor retouch passed', fansly({ media_provenance: ['edited'] }), 'passed', 'caption'],
  ['fansly upscale real passed', fansly({ media_provenance: ['camera_upload','edited'], ai_detail: { upscaled: true } }), 'passed', 'caption'],
  ['fansly background edit review', fansly({ ai_flag: 'ai_enhanced', media_provenance: ['edited'], ai_detail: { ai_background_edit: true } }), 'manual_review', 'caption'],
  ['fansly outfit edit review', fansly({ ai_flag: 'ai_enhanced', media_provenance: ['edited'], ai_detail: { ai_outfit_edit: true } }), 'manual_review', 'caption'],
  ['fansly body edit review', fansly({ ai_flag: 'ai_enhanced', media_provenance: ['edited'], ai_detail: { body_adjacent_edit: true } }), 'manual_review', 'caption'],
  ['fansly non-photo registered passed', fansly({ ai_flag: 'ai_generated', media_provenance: ['ai_pipeline'], ai_detail: { non_photorealistic: true }, virtual_entity_registration_status: 'registered' }), 'passed', 'caption'],
  ['fansly non-photo unregistered safest blocked', fansly({ ai_flag: 'ai_generated', media_provenance: ['ai_pipeline'], ai_detail: { non_photorealistic: true }, virtual_entity_registration_status: 'not_registered' }), 'blocked', 'caption'],
  ['fansly missing co-performer blocked', fansly({ second_person_present: true, co_performer_release_status: 'confirmed', co_performer_verification_status: 'missing' }), 'blocked', 'caption'],
  ['fansly intoxication blocked', fansly({ caption_body: 'too drunk' }), 'blocked', 'too drunk'],
  ['fansly blood blocked', fansly({ caption_body: 'blood scene' }), 'blocked', 'blood scene'],
  ['fansly drugs blocked', fansly({ caption_body: 'cocaine party' }), 'blocked', 'cocaine party'],
]

for (const [name, input, outcome, caption] of cases) {
  const got = evaluateCreatorPublishingCompliance(input)
  assert.equal(got.outcome, outcome, name)
  assert.equal(got.normalized_caption, caption, name)
  assert.equal(got.hard_block, outcome === 'blocked', name)
  assert.equal(got.escalated_approval_allowed, outcome === 'manual_review', name)
  assert.equal(got.creator_approval_allowed, outcome === 'passed', name)
  assert.equal(got.rule_hits.some((h) => h.rule_id === 'onlyfans-ai-twin-consent-missing'), name.includes('missing consent') || name.includes('lora likeness missing consent'), name)
  assert.equal(got.policy_version, input.target_platform === 'fansly' ? 'fansly-manual-handoff-2026-07-10-v1' : 'onlyfans-manual-handoff-2026-07-10-v1')
  assert.deepEqual(got.rule_hits, [...got.rule_hits].sort((a, b) => a.rule_id.localeCompare(b.rule_id)), name)
  for (const hit of got.rule_hits) assert.ok(hit.rule_id && hit.severity && hit.category && hit.message && hit.source && hit.field && typeof hit.override_allowed === 'boolean', name)
}

const blockOverridesReview = evaluateCreatorPublishingCompliance(aiTwin({ ai_detail: { creator_likeness_drift: true, deepfake: true } }))
assert.equal(blockOverridesReview.outcome, 'blocked')
assert.equal(blockOverridesReview.escalated_approval_allowed, false)
assert.equal(blockOverridesReview.creator_approval_allowed, false)
const reviewOverridesAllow = evaluateCreatorPublishingCompliance(aiTwin({ ai_detail: { ai_outfit_edit: true } }))
assert.equal(reviewOverridesAllow.outcome, 'manual_review')
const passed = evaluateCreatorPublishingCompliance(base)
assert.equal(passed.rule_hits.filter((h) => h.severity === 'block' || h.severity === 'review').length, 0)
assert.equal(passed.creator_approval_allowed, true)
assert.throws(() => evaluateCreatorPublishingCompliance({ ...base, target_platform: 'fanvue' }), /Fanvue is not routed/)

function mockDb() {
  const calls: any[] = []
  const db = { from(table: string) { const q: any = { table, select(c?: string) { calls.push(['select', table, c]); return q }, eq(c: string, v: unknown) { calls.push(['eq', table, c, v]); return q }, single() { calls.push(['single', table]); return Promise.resolve({ data: { compliance_status: 'pending', compliance_policy_version: 'unassigned', forced_disclosure_text: null, creator_approval_status: 'pending' }, error: null }) }, insert(p: unknown) { calls.push(['insert', table, p]); return q }, update(p: unknown) { calls.push(['update', table, p]); return q } }; return q } }
  return { db, calls }
}
async function persistCase(input: ComplianceInput) {
  const { db, calls } = mockDb()
  const result = await evaluateAndPersistCreatorPublishingCompliance(input, { supabaseAdmin: db as any, now: () => '2026-07-10T01:00:00.000Z' })
  const reviewPayloads = calls.filter((c) => c[0] === 'insert' && c[1] === 'creator_publishing_compliance_reviews').map((c) => c[2])
  const auditPayloads = calls.filter((c) => c[0] === 'insert' && c[1] === 'creator_publishing_audit_events').map((c) => c[2])
  const packageUpdates = calls.filter((c) => c[0] === 'update' && c[1] === 'creator_publishing_content_packages').map((c) => c[2])
  return { result, calls, review: reviewPayloads[0], audits: auditPayloads, update: packageUpdates[0] }
}
const persistedPass = await persistCase(aiTwin({ caption_body: 'hello' }))
assert.equal(persistedPass.review.outcome, 'pass')
assert.equal(persistedPass.review.escalated_approval_reason, null)
assert.equal(persistedPass.update.compliance_status, 'passed')
assert.equal(persistedPass.update.compliance_policy_version, 'onlyfans-manual-handoff-2026-07-10-v1')
assert.equal(persistedPass.update.forced_disclosure_text, '#ai')
const persistedBlock = await persistCase(aiTwin({ ai_detail: { generated_creator_likeness: true }, ai_twin_consent_status: 'missing' }))
assert.equal(persistedBlock.review.outcome, 'block')
assert.equal(persistedBlock.review.escalated_approval_reason, null)
assert.equal(persistedBlock.update.compliance_status, 'blocked')
const persistedReview = await persistCase(aiTwin({ ai_detail: { ai_outfit_edit: true } }))
assert.equal(persistedReview.review.outcome, 'manual_review')
assert.equal(persistedReview.review.escalated_approval_reason, null)
for (const persisted of [persistedPass, persistedBlock, persistedReview]) {
  assert.equal(persisted.audits.length, 2)
  assert.equal(persisted.calls.some((c) => c[1] === 'creator_publishing_queue_tasks'), false)
  assert.equal(persisted.calls.some((c) => c[0] === 'update' && JSON.stringify(c[2]).includes('creator_approval_status')), false)
  assert.notEqual(persisted.review.outcome, 'escalate')
}
assert.equal(persistedBlock.review.outcome === 'escalate' && persistedBlock.review.escalated_approval_reason, false)

assert.deepEqual(findForbiddenNetworkCalls(['lib/creator-publishing-queue/compliance/evaluate.ts','lib/creator-publishing-queue/compliance/aiRules.ts','lib/creator-publishing-queue/compliance/textRules.ts','lib/creator-publishing-queue/compliance/persist.ts']), [])
console.log('Creator Publishing Queue compliance gate tests passed')
