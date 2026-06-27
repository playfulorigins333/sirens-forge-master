import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateFanvueLivePostProof } from '../../../lib/autopost/fanvueProof'

const officialPostUuid = '123e4567-e89b-42d3-a456-426614174000'
const officialMediaUuid = '223e4567-e89b-42d3-a456-426614174000'

assert.equal(validateFanvueLivePostProof({}).posted, false, 'empty Fanvue proof must be rejected')
assert.equal(validateFanvueLivePostProof({ platform: 'fanvue', result_kind: 'ASSISTED_READY', verification_needed: true }).posted, false)
assert.equal(validateFanvueLivePostProof({ platform: 'fanvue', result_kind: 'POSTED_READY_FOR_PROOF', verification_needed: true }).posted, false)
assert.equal(validateFanvueLivePostProof({ platform: 'fanvue', result_kind: 'SCHEDULED_CREATED', verification_needed: true, provider_post_uuid: officialPostUuid }).posted, false)
assert.equal(
  validateFanvueLivePostProof({
    platform: 'fanvue',
    result_kind: 'POSTED_READY_FOR_PROOF',
    verification_needed: true,
    provider_post_uuid: 'local-job-id',
    provider_published_at: '2026-06-27T01:00:00.000Z',
    provider_account_id: 'creator_1',
    content_hash: 'hash',
    api_version: '2025-01-01',
  }).posted,
  false,
  'local/random ids must not be accepted as Fanvue post ids'
)
assert.equal(
  validateFanvueLivePostProof({
    platform: 'fanvue',
    result_kind: 'POSTED_READY_FOR_PROOF',
    verification_needed: true,
    provider_post_uuid: officialMediaUuid,
    provider_media_uuids: [officialMediaUuid],
    provider_published_at: '2026-06-27T01:00:00.000Z',
    provider_account_id: 'creator_1',
    content_hash: 'hash',
    api_version: '2025-01-01',
  }).posted,
  false,
  'media UUIDs must not be accepted as post proof ids'
)
assert.equal(
  validateFanvueLivePostProof({
    platform: 'fanvue',
    result_kind: 'POSTED_READY_FOR_PROOF',
    verification_needed: true,
    provider_post_uuid: officialPostUuid,
    provider_account_id: 'creator_1',
    content_hash: 'hash',
    api_version: '2025-01-01',
  }).posted,
  false,
  'Fanvue live proof requires provider_published_at'
)

const valid = validateFanvueLivePostProof({
  platform: 'fanvue',
  result_kind: 'POSTED_READY_FOR_PROOF',
  verification_needed: true,
  provider_post_uuid: officialPostUuid,
  provider_media_uuids: [officialMediaUuid],
  provider_publish_at: null,
  provider_published_at: '2026-06-27T01:00:00.000Z',
  provider_account_id: 'creator_1',
  content_hash: 'hash',
  api_version: '2025-01-01',
})
assert.equal(valid.posted, true)
assert.equal(valid.proof?.platform_post_id, officialPostUuid)
assert.equal(valid.proof?.posted_at, '2026-06-27T01:00:00.000Z')

const jobProofSource = readFileSync('lib/autopost/jobProof.ts', 'utf8')
assert.match(jobProofSource, /export type AutopostProofPlatform = "x";/, 'existing strict proof validator must not accept Fanvue before FV-7 wiring')

const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
const scheduleAdvance = readFileSync('lib/autopost/scheduleAdvance.ts', 'utf8')
const fanvueProof = readFileSync('lib/autopost/fanvueProof.ts', 'utf8')

assert.doesNotMatch(runRoute, /fanvue/, 'Fanvue must remain absent from public run route')
assert.doesNotMatch(scheduleAdvance, /fanvue/i, 'Fanvue schedule advancement must not exist in FV-7')
assert.doesNotMatch(fanvueProof, /from\("autopost_jobs"\)|persistAutopostJobResult/, 'Fanvue proof validator must not persist jobs')
assert.match(fanvueProof, /SCHEDULED_CREATED_NOT_POSTED/, 'scheduled-created must remain non-POSTED')

console.log('Fanvue proof validation checks passed')
