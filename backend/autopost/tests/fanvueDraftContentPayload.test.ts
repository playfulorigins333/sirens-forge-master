import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildFanvueDraftContentPayload, validateFanvueTextOnlyContentPayload } from '../../../lib/autopost/contentPayload'

const fixedNow = new Date('2026-06-27T00:00:00.000Z')
const result = buildFanvueDraftContentPayload(
  {
    selected_platforms: ['fanvue'],
    text: 'Draft caption for Fanvue manual preparation.',
    content_type: 'text_media',
    requested_publish_at: '2026-07-01T12:00:00.000Z',
    generation_ids: ['gen_1', 'gen_1'],
    audience: 'subscribers',
    assets: [{ id: 'asset_1', url: 'https://example.com/source.png' }],
  },
  fixedNow
)

assert.ok(!('error' in result), 'valid Fanvue draft should build a payload')
const payload = result.payload
assert.equal(payload.platform, 'fanvue')
assert.equal(payload.content_type, 'text_media')
assert.equal(payload.native_posting_enabled, false)
assert.equal(payload.media_upload_enabled, false)
assert.equal(payload.dispatch_enabled, false)
assert.equal(payload.validation_status, 'DRAFT_VALID_NON_RUNNABLE')
assert.deepEqual(payload.source_generation_ids, ['gen_1'])
assert.deepEqual(payload.source_asset_ids, ['asset_1'])
assert.equal(payload.requested_publish_at, '2026-07-01T12:00:00.000Z')
assert.equal(payload.audience, 'subscribers')
assert.equal(typeof payload.content_hash, 'string')
assert.ok(!('platform_post_id' in payload), 'draft payload must not store platform_post_id')
assert.ok(!('fanvue_media_uuid' in payload), 'draft payload must not fabricate Fanvue media UUIDs')
assert.ok(!('fanvue_post_uuid' in payload), 'draft payload must not fabricate Fanvue post UUIDs')

const textOnly = buildFanvueDraftContentPayload({ selected_platforms: ['fanvue'], text: 'Text-only ready draft.', content_type: 'text', audience: 'subscribers' }, fixedNow)
assert.ok(!('error' in textOnly), 'valid Fanvue text-only draft should build')
const textOnlyValidation = validateFanvueTextOnlyContentPayload(textOnly.payload)
assert.equal(textOnlyValidation.valid, true, 'Fanvue text-only validation requires safe explicit text and audience')

const missingAudiencePayload = { ...textOnly.payload, audience: null }
assert.deepEqual(validateFanvueTextOnlyContentPayload(missingAudiencePayload), {
  valid: false,
  error_code: 'FANVUE_AUDIENCE_REQUIRED',
  safe_error_message: 'Fanvue text-only payload requires an explicit audience.',
})

assert.equal(validateFanvueTextOnlyContentPayload({ ...textOnly.payload, source_asset_ids: ['asset_1'] }).valid, false, 'text-only readiness must reject local media requirements')
assert.equal(validateFanvueTextOnlyContentPayload({ ...textOnly.payload, media_upload_enabled: true }).valid, false, 'media upload flags must remain disabled')
assert.equal(validateFanvueTextOnlyContentPayload({ ...textOnly.payload, dispatch_enabled: true }).valid, false, 'dispatch flags must remain disabled')
assert.equal(validateFanvueTextOnlyContentPayload({ ...textOnly.payload, platform: 'x' }).valid, false, 'Fanvue text-only validation requires platform fanvue')
assert.equal(validateFanvueTextOnlyContentPayload({ ...textOnly.payload, content_type: 'text_media' }).valid, false, 'Fanvue text-only validation requires content_type text')

const empty = buildFanvueDraftContentPayload({ selected_platforms: ['fanvue'], content_type: 'text' }, fixedNow)
assert.deepEqual(empty, { error: 'EMPTY_FANVUE_TEXT' })

const tooLong = buildFanvueDraftContentPayload({ selected_platforms: ['fanvue'], text: 'x'.repeat(5001) }, fixedNow)
assert.deepEqual(tooLong, { error: 'FANVUE_TEXT_TOO_LONG' })

const rulesRoute = readFileSync('app/api/autopost/rules/route.ts', 'utf8')
const approveRoute = readFileSync('app/api/autopost/rules/[rule_id]/approve/route.ts', 'utf8')
const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
const contentHelper = readFileSync('lib/autopost/contentPayload.ts', 'utf8')
const autopostPageClient = readFileSync('app/autopost/AutopostPageClient.tsx', 'utf8')
const platformsMeRoute = readFileSync('app/api/autopost/platforms/me/route.ts', 'utf8')
const platformAvailability = readFileSync('lib/autopost/platformAvailability.ts', 'utf8')

const textOnlyRuleResult = buildFanvueDraftContentPayload({
  selected_platforms: ['fanvue'],
  content_payload: {
    platform: 'fanvue',
    content_type: 'text',
    text: 'Internal validation text only.',
    audience: 'internal_validation',
    media_upload_enabled: false,
    native_posting_enabled: false,
    dispatch_enabled: false,
  },
  assets: [],
}, fixedNow)
assert.ok(!('error' in textOnlyRuleResult), 'Fanvue UI text-only rule creation payload should build')
assert.equal(textOnlyRuleResult.payload.content_type, 'text')
assert.equal(textOnlyRuleResult.payload.dispatch_enabled, false)
assert.equal(textOnlyRuleResult.payload.native_posting_enabled, false)
assert.equal(textOnlyRuleResult.payload.media_upload_enabled, false)
assert.deepEqual(textOnlyRuleResult.payload.source_asset_ids, [])
assert.equal(validateFanvueTextOnlyContentPayload(textOnlyRuleResult.payload).valid, true)

assert.match(rulesRoute, /buildFanvueDraftContentPayload/, 'rules route should persist Fanvue draft payloads only through draft helper')
assert.match(rulesRoute, /next_run_at: null/, 'Fanvue draft persistence must not create runnable schedule slots')
assert.match(approveRoute, /filterSelectableAutopostPlatformIds/, 'rule approval must still require selectable platforms')
assert.doesNotMatch(runRoute, /fanvue/, 'run route must not include Fanvue dispatch eligibility')
assert.match(platformsMeRoute, /buildUserPlatformStatus/, '/platforms/me must derive Fanvue safety flags from platform availability')
assert.match(platformAvailability, /public_selectable:\s*false/, 'Fanvue /platforms/me status must keep public_selectable false')
assert.match(platformAvailability, /can_schedule:\s*false/, 'Fanvue /platforms/me status must keep can_schedule false')
assert.match(platformAvailability, /supports_real_posting:\s*false/, 'Fanvue /platforms/me status must keep supports_real_posting false')
assert.match(platformAvailability, /supports_text_posting:\s*false/, 'Fanvue /platforms/me status must keep supports_text_posting false')
assert.match(platformAvailability, /supports_media_posting:\s*false/, 'Fanvue /platforms/me status must keep supports_media_posting false')
assert.match(platformAvailability, /native_posting_available:\s*false/, 'Fanvue /platforms/me status must keep native_posting_available false')
assert.match(platformAvailability, /FANVUE_NATIVE_POSTING_NOT_ENABLED/, 'Fanvue /platforms/me status must keep native posting blocker')
assert.match(autopostPageClient, /saveFanvueInternalValidationDraftRule/, 'Build Rule UI should expose a Fanvue internal-validation save path')
assert.match(autopostPageClient, /selected_platforms: \["fanvue"\]/, 'Fanvue UI save path must submit only Fanvue')
assert.match(autopostPageClient, /content_type: "text"/, 'Fanvue UI save path must submit text-only metadata')
assert.match(autopostPageClient, /Save Fanvue Validation Draft/, 'Fanvue UI should use safe validation draft button copy')
assert.match(autopostPageClient, /Fanvue validation draft saved\. Native posting, scheduling, dispatch, and media upload remain disabled\./, 'Fanvue UI should show safe success copy')
assert.doesNotMatch(autopostPageClient, /FANVUE_RUN_DISPATCH_ENABLED|FANVUE_POST_VERIFY_ENABLED|write:creator|persistAutopostJobResult/, 'Fanvue UI must not enable dispatch, verification, write scope, or result persistence')
assert.doesNotMatch(contentHelper, /POST \/posts|platform_post_id|fanvue_media_uuid|fanvue_post_uuid/, 'Fanvue draft helper must not add API posting/media/proof identifiers')

console.log('Fanvue draft content payload checks passed')
