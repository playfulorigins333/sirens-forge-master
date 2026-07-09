import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildFanvueScheduleCreationBridgeRow } from '../../../lib/autopost/fanvueScheduleCreationBridge'
import { runFanvueRouteDryRunVerification, isFanvueRouteDryRunConfirmed } from '../../../lib/autopost/fanvueRunRouteDryRunVerifier'
import { FANVUE_RUN_DRY_RUN_CONFIRMATION } from '../../../lib/autopost/fanvueRunDryRunBranch'
import { getAutopostPlatformRegistry } from '../../../lib/autopost/platformRegistry'

const scheduled_for = '2026-07-09T00:00:00.000Z'
const creationEnv = { FANVUE_INTERNAL_SCHEDULE_RULE_CREATION_BRIDGE_ENABLED: 'true' }
const runEnv = {
  FANVUE_RUN_DRY_RUN_BRANCH_ENABLED: 'true',
  FANVUE_INTERNAL_LAUNCH_READINESS_ENABLED: 'true',
  FANVUE_INTERNAL_RUNNER_PERSISTENCE_BRIDGE_ENABLED: 'true',
}

const examples = [
  ['text', { platform: 'fanvue', content_type: 'text', text: 'Fanvue scheduled text.' }],
  ['image', { platform: 'fanvue', content_type: 'image', text: 'Image caption', asset_id: 'asset-image-1', media_type: 'image', filename: 'safe.png', mime_type: 'image/png', size: 123 }],
  ['video', { platform: 'fanvue', content_type: 'video', asset_id: 'asset-video-1', media_type: 'video', filename: 'safe.mp4', mime_type: 'video/mp4' }],
] as const

function createRow(content_payload: unknown) {
  const result = buildFanvueScheduleCreationBridgeRow({
    id: 'fanvue-created-rule-1',
    user_id: 'user-1',
    scheduled_for,
    selected_platforms: ['fanvue'],
    content_payload,
    env: creationEnv,
  })
  assert.equal(result.ok, true)
  return result.row
}

for (const [contentType, payload] of examples) {
  const row = createRow(payload)
  assert.equal(row.user_id, 'user-1')
  assert.equal(row.approval_state, 'APPROVED')
  assert.equal(row.enabled, true)
  assert.equal(row.paused_at, null)
  assert.equal(row.revoked_at, null)
  assert.deepEqual(row.selected_platforms, ['fanvue'])
  assert.equal(row.next_run_at, scheduled_for)
  assert.equal(row.timezone, 'UTC')
  assert.equal(row.posts_per_day, 1)
  assert.deepEqual(row.time_slots, [])
  assert.equal(row.content_payload.platform, 'fanvue')
  assert.equal(row.content_payload.content_type, contentType)

  const summary = { fanvue_dry_runs: 0, fanvue_dry_run_blocked: 0 }
  const results = runFanvueRouteDryRunVerification({ rules: [row], now: new Date(scheduled_for), env: runEnv, request_confirmation: FANVUE_RUN_DRY_RUN_CONFIRMATION, summary })
  assert.equal(results[0].safe_code, 'FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS')
  assert.equal(summary.fanvue_dry_runs, 1)

  const missingRunGate = runFanvueRouteDryRunVerification({ rules: [row], now: new Date(scheduled_for), env: {}, request_confirmation: FANVUE_RUN_DRY_RUN_CONFIRMATION, summary: { fanvue_dry_runs: 0, fanvue_dry_run_blocked: 0 } })
  assert.equal(missingRunGate[0].safe_code, 'FANVUE_RUN_DRY_RUN_BRANCH_GATE_DISABLED')

  const wrongConfirm = runFanvueRouteDryRunVerification({ rules: [row], now: new Date(scheduled_for), env: runEnv, request_confirmation: 'wrong', summary: { fanvue_dry_runs: 0, fanvue_dry_run_blocked: 0 } })
  assert.equal(wrongConfirm[0].safe_code, 'FANVUE_RUN_DRY_RUN_BRANCH_CONFIRMATION_REQUIRED')
  assert.equal(isFanvueRouteDryRunConfirmed('wrong'), false)
}

for (const env of [{}, { FANVUE_INTERNAL_SCHEDULE_RULE_CREATION_BRIDGE_ENABLED: 'false' }]) {
  const result = buildFanvueScheduleCreationBridgeRow({ user_id: 'user-1', scheduled_for, selected_platforms: ['fanvue'], content_payload: examples[0][1], env })
  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'FANVUE_SCHEDULE_CREATION_BRIDGE_DISABLED')
}

for (const field of ['provider_post_id', 'fanvue_media_uuid', 'raw_provider_response', 'signed_url', 'r2_key', 'bytes', 'access_token', 'refresh_token', 'token', 'cookie', 'header', 'secret', 'price', 'paywall', 'publishAt', 'publish_at']) {
  const result = buildFanvueScheduleCreationBridgeRow({ user_id: 'user-1', scheduled_for, selected_platforms: ['fanvue'], content_payload: { ...examples[0][1], [field]: `${field}-value-never-returned` }, env: creationEnv })
  assert.equal(result.ok, false, `${field} must be rejected`)
  assert.equal(result.error_code, 'FANVUE_SCHEDULE_FORBIDDEN_FIELD')
}

const row = createRow(examples[1][1])
const body = { row, dryRun: runFanvueRouteDryRunVerification({ rules: [row], now: new Date(scheduled_for), env: runEnv, request_confirmation: FANVUE_RUN_DRY_RUN_CONFIRMATION, summary: { fanvue_dry_runs: 0, fanvue_dry_run_blocked: 0 } }) }
const serialized = JSON.stringify(body)
assert.doesNotMatch(serialized, new RegExp(FANVUE_RUN_DRY_RUN_CONFIRMATION))
assert.doesNotMatch(serialized, /provider-uuid|raw_provider_response|signed-url|r2-key|media-bytes|token-value|cookie-value|header-value|secret-value/i)
assert.doesNotMatch(serialized, /fanvue_media_uuid|provider_post_id|signed_url|r2_key|bytes|access_token|refresh_token|cookie|header|secret/i)

const helperSource = readFileSync('lib/autopost/fanvueScheduleCreationBridge.ts', 'utf8')
assert.doesNotMatch(helperSource, /fetch\(|createClient|from\(|uploadFanvue|postFanvue|decrypt|fanvueApi|providerClient|refreshFanvueAccessToken|signedUrl/i)
const registrySource = readFileSync('lib/autopost/platformRegistry.ts', 'utf8')
assert.doesNotMatch(registrySource, /id: "fanvue"[\s\S]*public_selectable:\s*true/)
const fanvue = getAutopostPlatformRegistry().find((platform) => platform.id === 'fanvue')
assert.equal(fanvue?.public_selectable, false)
assert.equal(fanvue?.supports_real_posting, false)
assert.equal(fanvue?.supports_async_dispatch, false)

console.log('Fanvue schedule creation bridge tests passed')
