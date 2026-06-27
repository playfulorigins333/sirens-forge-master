import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildFanvueDraftContentPayload } from '../../../lib/autopost/contentPayload'

const fixedNow = new Date('2026-06-27T00:00:00.000Z')
const result = buildFanvueDraftContentPayload(
  {
    selected_platforms: ['fanvue'],
    text: 'Draft caption for Fanvue manual preparation.',
    content_type: 'text_media',
    requested_publish_at: '2026-07-01T12:00:00.000Z',
    generation_ids: ['gen_1', 'gen_1'],
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
assert.equal(typeof payload.content_hash, 'string')
assert.ok(!('platform_post_id' in payload), 'draft payload must not store platform_post_id')
assert.ok(!('fanvue_media_uuid' in payload), 'draft payload must not fabricate Fanvue media UUIDs')
assert.ok(!('fanvue_post_uuid' in payload), 'draft payload must not fabricate Fanvue post UUIDs')

const empty = buildFanvueDraftContentPayload({ selected_platforms: ['fanvue'], content_type: 'text' }, fixedNow)
assert.deepEqual(empty, { error: 'EMPTY_FANVUE_TEXT' })

const tooLong = buildFanvueDraftContentPayload({ selected_platforms: ['fanvue'], text: 'x'.repeat(5001) }, fixedNow)
assert.deepEqual(tooLong, { error: 'FANVUE_TEXT_TOO_LONG' })

const rulesRoute = readFileSync('app/api/autopost/rules/route.ts', 'utf8')
const approveRoute = readFileSync('app/api/autopost/rules/[rule_id]/approve/route.ts', 'utf8')
const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
const contentHelper = readFileSync('lib/autopost/contentPayload.ts', 'utf8')

assert.match(rulesRoute, /buildFanvueDraftContentPayload/, 'rules route should persist Fanvue draft payloads only through draft helper')
assert.match(rulesRoute, /next_run_at: null/, 'Fanvue draft persistence must not create runnable schedule slots')
assert.match(approveRoute, /filterSelectableAutopostPlatformIds/, 'rule approval must still require selectable platforms')
assert.doesNotMatch(runRoute, /fanvue/, 'run route must not include Fanvue dispatch eligibility')
assert.doesNotMatch(contentHelper, /POST \/posts|media upload|platform_post_id|fanvue_media_uuid|fanvue_post_uuid/, 'Fanvue draft helper must not add API posting/media/proof identifiers')

console.log('Fanvue draft content payload checks passed')
