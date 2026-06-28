import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateFanvueScheduleAdvanceProof } from '../../../lib/autopost/fanvueScheduleAdvance'
import type { FanvueLivePostProof } from '../../../lib/autopost/fanvueProof'

const proof: FanvueLivePostProof & { job_id: string; rule_id: string; user_id: string; scheduled_for: string } = {
  posted: true,
  platform: 'fanvue',
  platform_post_id: '123e4567-e89b-42d3-a456-426614174000',
  posted_at: '2026-06-27T01:00:00.000Z',
  provider_post_uuid: '123e4567-e89b-42d3-a456-426614174000',
  provider_publish_at: null,
  provider_published_at: '2026-06-27T01:00:00.000Z',
  provider_created_at: '2026-06-27T00:59:00.000Z',
  provider_text: 'Text-only Fanvue post.',
  provider_audience: 'subscribers',
  provider_account_id: null,
  provider_creator_id: null,
  content_hash: 'hash',
  api_version: '2025-06-26',
  verification_needed: true,
  job_id: 'job_1',
  rule_id: 'rule_1',
  user_id: 'user_1',
  scheduled_for: '2026-06-27T00:00:00.000Z',
}

function baseInput(overrides = {}) {
  return {
    platform: 'fanvue',
    result_status: 'POSTED',
    platform_post_id: proof.platform_post_id,
    posted_at: proof.posted_at,
    job_id: proof.job_id,
    rule_id: proof.rule_id,
    user_id: proof.user_id,
    scheduled_for: proof.scheduled_for,
    validated_proof: proof,
    ...overrides,
  }
}

assert.equal(validateFanvueScheduleAdvanceProof({ platform: 'fanvue', result_status: 'DRAFT' }).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof({ platform: 'fanvue', result_status: 'ASSISTED_READY' }).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof({ platform: 'fanvue', workflow_task_id: 'task_1' }).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof({ platform: 'fanvue', external_job_id: 'external_1' }).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof({ platform: 'fanvue', ok: true }).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof({ platform: 'fanvue', adapter_result_kind: 'DISPATCHED' }).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof({ platform: 'fanvue', adapter_result_kind: 'SCHEDULED_CREATED' }).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof({ platform: 'fanvue', adapter_result_kind: 'POSTED_READY_FOR_PROOF' }).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof(baseInput({ platform_post_id: null })).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof(baseInput({ platform_post_id: 'fake-id' })).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof(baseInput({ posted_at: null })).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof(baseInput({ job_id: 'other_job' })).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof(baseInput({ rule_id: 'other_rule' })).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof(baseInput({ user_id: 'other_user' })).can_advance, false)
assert.equal(validateFanvueScheduleAdvanceProof(baseInput({ scheduled_for: '2026-06-28T00:00:00.000Z' })).can_advance, false)

const allowed = validateFanvueScheduleAdvanceProof(baseInput())
assert.equal(allowed.can_advance, true, 'strict validated live proof can advance only in pure helper')
assert.equal(allowed.blocker, null)

const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
const scheduleAdvance = readFileSync('lib/autopost/scheduleAdvance.ts', 'utf8')
const fanvueScheduleAdvance = readFileSync('lib/autopost/fanvueScheduleAdvance.ts', 'utf8')
assert.doesNotMatch(runRoute, /fanvue|validateFanvueScheduleAdvanceProof/, 'Fanvue helper must not be called from public run route')
assert.doesNotMatch(scheduleAdvance, /fanvue|validateFanvueScheduleAdvanceProof/i, 'Fanvue helper must not alter current scheduleAdvance module')
assert.doesNotMatch(fanvueScheduleAdvance, /from\("autopost_jobs"\)|update\(|insert\(|persistAutopostJobResult/, 'Fanvue schedule helper must not persist or advance real jobs')

console.log('Fanvue schedule advancement safety checks passed')
