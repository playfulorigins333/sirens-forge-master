import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FANVUE_RUN_DRY_RUN_CONFIRMATION, runFanvueDryRunBranch } from '../../../lib/autopost/fanvueRunDryRunBranch'

const now = new Date('2026-07-09T00:00:00.000Z')
const enabledEnv = {
  FANVUE_RUN_DRY_RUN_BRANCH_ENABLED: 'true',
  FANVUE_INTERNAL_LAUNCH_READINESS_ENABLED: 'true',
  FANVUE_INTERNAL_RUNNER_PERSISTENCE_BRIDGE_ENABLED: 'true',
}
const baseRule = {
  id: 'rule-1',
  user_id: 'user-1',
  approval_state: 'APPROVED',
  enabled: true,
  paused_at: null,
  revoked_at: null,
  next_run_at: '2026-07-08T00:00:00.000Z',
  selected_platforms: ['fanvue'],
}

function assertSafe(result: ReturnType<typeof runFanvueDryRunBranch>) {
  assert.equal(result.dry_run, true)
  assert.equal(result.platform, 'fanvue')
  assert.equal(result.bridge_mode, 'internal_mocked_runner_persistence')
  assert.equal(result.dispatch_enabled, false)
  assert.equal(result.live_attempted, false)
  assert.equal(result.fanvue_upload_attempted, false)
  assert.equal(result.fanvue_post_attempted, false)
  assert.equal(result.provider_post_uuid_present, false)
  assert.equal(result.schedule_advance_intent, 'mocked_only')
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /provider-uuid|raw_provider_response|signed-url|r2-key|media-bytes|token-value|cookie-value|header-value|secret-value/i)
  assert.doesNotMatch(serialized, /fanvue_media_uuid|provider_post_id|signed_url|r2_key|bytes|access_token|refresh_token|cookie|header|secret/i)
}

for (const env of [{}, { FANVUE_RUN_DRY_RUN_BRANCH_ENABLED: 'false' }]) {
  const result = runFanvueDryRunBranch({
    rule: { ...baseRule, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Blocked' } },
    now,
    env,
    request_confirmation: FANVUE_RUN_DRY_RUN_CONFIRMATION,
  })
  assertSafe(result)
  assert.equal(result.safe_code, 'FANVUE_RUN_DRY_RUN_BRANCH_GATE_DISABLED')
  assert.equal(result.payload, null)
}


for (const request_confirmation of [undefined, '', 'wrong-confirmation']) {
  const result = runFanvueDryRunBranch({
    rule: { ...baseRule, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Env alone is not enough.' } },
    now,
    env: enabledEnv,
    request_confirmation,
  })
  assertSafe(result)
  assert.equal(result.safe_code, 'FANVUE_RUN_DRY_RUN_BRANCH_CONFIRMATION_REQUIRED')
  assert.equal(result.payload, null)
}

for (const content_payload of [
  { platform: 'fanvue', content_type: 'text', text: 'Launch ready text.' },
  { platform: 'fanvue', content_type: 'image', text: 'Image caption', asset_id: 'asset-image-1', media_type: 'image', filename: 'safe.png', mime_type: 'image/png', size: 123 },
  { platform: 'fanvue', content_type: 'video', asset_id: 'asset-video-1', media_type: 'video', filename: 'safe.mp4', mime_type: 'video/mp4' },
]) {
  const result = runFanvueDryRunBranch({ rule: { ...baseRule, content_payload }, now, env: enabledEnv, request_confirmation: FANVUE_RUN_DRY_RUN_CONFIRMATION })
  assertSafe(result)
  assert.equal(result.safe_code, 'FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS')
}

const forbidden = runFanvueDryRunBranch({
  rule: { ...baseRule, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Safe', provider_post_id: 'provider-uuid-secret-value' } },
  now,
  env: enabledEnv,
  request_confirmation: FANVUE_RUN_DRY_RUN_CONFIRMATION,
})
assertSafe(forbidden)
assert.equal(forbidden.safe_code, 'FANVUE_FORBIDDEN_PROVIDER_FIELD')
assert.equal(forbidden.payload, null)

const branchSource = readFileSync('lib/autopost/fanvueRunDryRunBranch.ts', 'utf8')
assert.doesNotMatch(branchSource, /fetch\(|createFanvue|uploadFanvue|postFanvue|decrypt|createClient|from\(|fanvueApi|providerClient/, 'Fanvue run dry-run branch must not reference live/provider/upload/token/decrypt/database clients')

const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
assert.match(runRoute, /runFanvueDryRunBranch/, '/api/autopost/run should call the Fanvue dry-run helper')
assert.doesNotMatch(runRoute, /uploadFanvue|postFanvue|decrypt|fanvueApi|providerClient|FANVUE_RUN_DISPATCH_ENABLED/, '/api/autopost/run must not reference Fanvue live/provider/upload/token dispatch')

console.log('Fanvue run dry-run branch tests passed')
