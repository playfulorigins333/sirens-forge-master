import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildFanvueMockedRunnerPersistenceBridge } from '../../../lib/autopost/fanvueRunnerPersistenceBridge'

const enabledEnv = {
  FANVUE_INTERNAL_LAUNCH_READINESS_ENABLED: 'true',
  FANVUE_INTERNAL_RUNNER_PERSISTENCE_BRIDGE_ENABLED: 'true',
}

const base = {
  rule_id: 'rule-1',
  user_id: 'user-1',
  scheduled_for: '2026-07-09T00:00:00.000Z',
  selected_platforms: ['fanvue'],
  env: enabledEnv,
}

function assertSafeEnvelope(result: ReturnType<typeof buildFanvueMockedRunnerPersistenceBridge>) {
  assert.equal(result.dry_run, true)
  assert.equal(result.platform, 'fanvue')
  assert.equal(result.bridge_mode, 'internal_mocked_runner_persistence')
  assert.equal(result.dispatch_enabled, false)
  assert.equal(result.live_attempted, false)
  assert.equal(result.fanvue_upload_attempted, false)
  assert.equal(result.fanvue_post_attempted, false)
  assert.equal(result.provider_post_uuid_present, false)
  assert.equal(result.supabase_mutation_intent, 'mocked_only')
  assert.equal(result.schedule_advance_intent, 'mocked_only')

  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /provider-uuid|raw_provider_response|signed-url|r2-key|media-bytes|token-value|cookie-value|header-value|secret-value/i)
  assert.doesNotMatch(serialized, /fanvue_media_uuid|provider_post_id|signed_url|r2_key|bytes|access_token|refresh_token|cookie|header|secret/i)
}

const text = buildFanvueMockedRunnerPersistenceBridge({
  ...base,
  content_payload: { platform: 'fanvue', content_type: 'text', text: 'Launch ready text.' },
})
assertSafeEnvelope(text)
assert.equal(text.content_type, 'text')
assert.equal(text.job_persistence_intent, 'mocked_success')
assert.equal(text.schedule_state_intent, 'advance_after_mocked_success')
assert.equal(text.safe_code, 'FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS')

const image = buildFanvueMockedRunnerPersistenceBridge({
  ...base,
  content_payload: { platform: 'fanvue', content_type: 'image', text: 'Image caption', asset_id: 'asset-image-1', media_type: 'image', filename: 'safe.png', mime_type: 'image/png', size: 123 },
})
assertSafeEnvelope(image)
assert.equal(image.content_type, 'image')
assert.equal(image.job_persistence_intent, 'mocked_success')
assert.equal(image.schedule_state_intent, 'advance_after_mocked_success')

const video = buildFanvueMockedRunnerPersistenceBridge({
  ...base,
  content_payload: { platform: 'fanvue', content_type: 'video', asset_id: 'asset-video-1', media_type: 'video', filename: 'safe.mp4', mime_type: 'video/mp4' },
})
assertSafeEnvelope(video)
assert.equal(video.content_type, 'video')
assert.equal(video.job_persistence_intent, 'mocked_success')
assert.equal(video.schedule_state_intent, 'advance_after_mocked_success')

const mockedFailure = buildFanvueMockedRunnerPersistenceBridge({
  ...base,
  outcome: 'failure',
  content_payload: { platform: 'fanvue', content_type: 'text', text: 'Safe failure path.' },
})
assertSafeEnvelope(mockedFailure)
assert.equal(mockedFailure.content_type, 'text')
assert.equal(mockedFailure.job_persistence_intent, 'mocked_failure')
assert.equal(mockedFailure.schedule_state_intent, 'do_not_advance_after_mocked_failure')
assert.equal(mockedFailure.safe_code, 'FANVUE_MOCKED_RUNNER_PERSISTENCE_VALIDATION_FAILED')

const forbidden = buildFanvueMockedRunnerPersistenceBridge({
  ...base,
  content_payload: { platform: 'fanvue', content_type: 'text', text: 'Safe', provider_post_id: 'provider-uuid-secret-value' },
})
assertSafeEnvelope(forbidden)
assert.equal(forbidden.job_persistence_intent, 'mocked_failure')
assert.equal(forbidden.schedule_state_intent, 'do_not_advance_after_mocked_failure')
assert.equal(forbidden.safe_code, 'FANVUE_FORBIDDEN_PROVIDER_FIELD')
assert.equal(forbidden.payload, null)

const disabled = buildFanvueMockedRunnerPersistenceBridge({
  ...base,
  env: { FANVUE_INTERNAL_LAUNCH_READINESS_ENABLED: 'true' },
  content_payload: { platform: 'fanvue', content_type: 'text', text: 'Blocked' },
})
assertSafeEnvelope(disabled)
assert.equal(disabled.safe_code, 'FANVUE_MOCKED_RUNNER_PERSISTENCE_GATE_DISABLED')
assert.equal(disabled.payload, null)

const bridgeSource = readFileSync('lib/autopost/fanvueRunnerPersistenceBridge.ts', 'utf8')
assert.doesNotMatch(bridgeSource, /fetch\(|createFanvue|uploadFanvue|postFanvue|decrypt|createClient|from\(|fanvueApi|providerClient/, 'mocked runner bridge must not reference live/provider/upload/token/decrypt/database clients')

const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
assert.doesNotMatch(runRoute, /fanvue/i, '/api/autopost/run must remain Fanvue-free')

for (const file of [
  'lib/autopost/platformRegistry.ts',
  'app/api/autopost/run/route.ts',
]) {
  const source = readFileSync(file, 'utf8')
  assert.doesNotMatch(source, /price|paywall|publishAt|publish_at|fanvue.*scheduler|scheduler.*fanvue|cron.*fanvue|bulk.*fanvue|retry.*fanvue/i, `${file} must not add Fanvue scheduling/price/paywall/runtime dispatch`)
}

console.log('Fanvue mocked runner persistence bridge tests passed')
