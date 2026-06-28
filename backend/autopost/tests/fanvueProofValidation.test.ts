import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildFanvueProofCandidateFromReadback,
  buildFanvueReadPostPath,
  isFanvuePostVerifyEnabled,
  validateFanvueLivePostProof,
} from '../../../lib/autopost/fanvueProof'

const officialPostUuid = '123e4567-e89b-42d3-a456-426614174000'
const officialMediaUuid = '223e4567-e89b-42d3-a456-426614174000'
const expectedText = 'Text-only Fanvue post.'
const expectedAudience = 'subscribers'
const contentHash = 'readback-content-hash'

function proofInput(overrides = {}) {
  return {
    platform: 'fanvue',
    result_kind: 'POSTED_READY_FOR_PROOF',
    verification_needed: true,
    provider_post_uuid: officialPostUuid,
    provider_media_uuids: [officialMediaUuid],
    provider_publish_at: null,
    provider_published_at: '2026-06-27T01:00:00.000Z',
    provider_text: expectedText,
    expected_text: expectedText,
    provider_audience: expectedAudience,
    expected_audience: expectedAudience,
    content_hash: contentHash,
    api_version: '2025-06-26',
    job_id: 'job_1',
    rule_id: 'rule_1',
    user_id: 'user_1',
    scheduled_for: '2026-06-27T00:00:00.000Z',
    ...overrides,
  }
}

assert.equal(isFanvuePostVerifyEnabled(), false, 'Fanvue post verification must default off unless env is exactly true')
assert.equal(buildFanvueReadPostPath(officialPostUuid), `/posts/${officialPostUuid}`)

assert.equal(validateFanvueLivePostProof({}).posted, false, 'empty Fanvue proof must be rejected')
assert.equal(validateFanvueLivePostProof({ platform: 'fanvue', result_kind: 'ASSISTED_READY', verification_needed: true }).posted, false)
assert.equal(validateFanvueLivePostProof({ platform: 'fanvue', result_kind: 'POSTED_READY_FOR_PROOF', verification_needed: true }).posted, false)
assert.equal(validateFanvueLivePostProof({ platform: 'fanvue', result_kind: 'SCHEDULED_CREATED', verification_needed: true, provider_post_uuid: officialPostUuid }).posted, false)
assert.equal(validateFanvueLivePostProof(proofInput({ ok: true, provider_published_at: null })).posted, false, 'ok:true cannot replace publishedAt proof')
assert.equal(validateFanvueLivePostProof(proofInput({ workflow_task_id: 'task_1', provider_published_at: null })).posted, false, 'workflow task ids are not proof')
assert.equal(
  validateFanvueLivePostProof(proofInput({ provider_post_uuid: 'local-job-id' })).posted,
  false,
  'local/random ids must not be accepted as Fanvue post ids'
)
assert.equal(
  validateFanvueLivePostProof(proofInput({ provider_post_uuid: officialMediaUuid, provider_media_uuids: [officialMediaUuid] })).posted,
  false,
  'media UUIDs must not be accepted as post proof ids'
)
assert.equal(
  validateFanvueLivePostProof(proofInput({ provider_published_at: null })).posted,
  false,
  'Fanvue live proof requires provider_published_at'
)
assert.equal(
  validateFanvueLivePostProof(proofInput({ provider_publish_at: '2026-07-01T12:00:00.000Z', provider_published_at: null })).result_status,
  'SCHEDULED_CREATED',
  'publishAt without publishedAt is scheduled-created, not posted proof'
)
assert.equal(validateFanvueLivePostProof(proofInput({ provider_text: 'Different text' })).posted, false, 'read-back text must match expected text')
assert.equal(validateFanvueLivePostProof(proofInput({ provider_audience: 'other' })).posted, false, 'read-back audience must match expected audience')
assert.equal(validateFanvueLivePostProof(proofInput({ expected_content_hash: 'other-hash' })).posted, false, 'expected content hash mismatch must fail')

const valid = validateFanvueLivePostProof(proofInput({ provider_account_id: null, provider_creator_id: null, expected_content_hash: contentHash }))
assert.equal(valid.posted, true)
assert.equal(valid.proof?.platform_post_id, officialPostUuid)
assert.equal(valid.proof?.posted_at, '2026-06-27T01:00:00.000Z')
assert.equal(valid.proof?.provider_account_id, null, 'Fanvue proof must not invent provider_account_id')
assert.equal(valid.proof?.provider_creator_id, null, 'Fanvue proof must not invent provider_creator_id')
assert.equal(valid.proof?.job_id, 'job_1')
assert.equal(valid.proof?.rule_id, 'rule_1')
assert.equal(valid.proof?.user_id, 'user_1')
assert.equal(valid.proof?.scheduled_for, '2026-06-27T00:00:00.000Z')

const readbackCandidate = buildFanvueProofCandidateFromReadback({
  post: {
    uuid: officialPostUuid,
    createdAt: '2026-06-27T00:59:00.000Z',
    text: expectedText,
    audience: expectedAudience,
    publishAt: null,
    publishedAt: '2026-06-27T01:00:00.000Z',
    mediaUuids: [],
  },
  expected_text: expectedText,
  expected_audience: expectedAudience,
  api_version: '2025-06-26',
  job_id: 'job_1',
  rule_id: 'rule_1',
  user_id: 'user_1',
  scheduled_for: '2026-06-27T00:00:00.000Z',
})
assert.equal(validateFanvueLivePostProof(readbackCandidate).posted, true, 'official read-back helper should produce valid proof input')

const jobProofSource = readFileSync('lib/autopost/jobProof.ts', 'utf8')
assert.match(jobProofSource, /export type AutopostProofPlatform = "x";/, 'existing strict proof validator must not accept Fanvue before run-route wiring')

const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
const scheduleAdvance = readFileSync('lib/autopost/scheduleAdvance.ts', 'utf8')
const fanvueProof = readFileSync('lib/autopost/fanvueProof.ts', 'utf8')

assert.doesNotMatch(runRoute, /fanvue/, 'Fanvue must remain absent from public run route')
assert.doesNotMatch(scheduleAdvance, /fanvue/i, 'Fanvue schedule advancement must not exist in generic scheduleAdvance module')
assert.doesNotMatch(fanvueProof, /from\("autopost_jobs"\)|persistAutopostJobResult|fetch\(/, 'Fanvue proof helper must not persist jobs or perform live fetches')
assert.doesNotMatch(fanvueProof, /FANVUE_PROVIDER_IDENTITY_REQUIRED/, 'Fanvue proof must not require provider identity fields missing from official read-back')
assert.match(fanvueProof, /FANVUE_SCHEDULED_CREATED_NOT_POSTED/, 'scheduled-created must remain non-POSTED')
assert.match(fanvueProof, /FANVUE_POST_VERIFY_ENABLED === "true"/, 'Fanvue verification must remain explicitly gated')

console.log('Fanvue proof validation checks passed')
