import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runFanvueRouteDryRunVerification, isFanvueRouteDryRunConfirmed } from '../../../lib/autopost/fanvueRunRouteDryRunVerifier'
import { FANVUE_RUN_DRY_RUN_CONFIRMATION } from '../../../lib/autopost/fanvueRunDryRunBranch'

const now = new Date('2026-07-09T00:00:00.000Z')
const enabledEnv = {
  FANVUE_RUN_DRY_RUN_BRANCH_ENABLED: 'true',
  FANVUE_INTERNAL_LAUNCH_READINESS_ENABLED: 'true',
  FANVUE_INTERNAL_RUNNER_PERSISTENCE_BRIDGE_ENABLED: 'true',
}
const baseRule = {
  id: 'fanvue-route-rule-1',
  user_id: 'fanvue-route-user-1',
  approval_state: 'APPROVED',
  enabled: true,
  paused_at: null,
  revoked_at: null,
  next_run_at: '2026-07-08T00:00:00.000Z',
  timezone: 'UTC',
  start_date: null,
  end_date: null,
  posts_per_day: 1,
  time_slots: [],
  selected_platforms: ['fanvue'],
}

function runWithRule(content_payload: unknown, env: Record<string, string | undefined> = enabledEnv, request_confirmation: unknown = FANVUE_RUN_DRY_RUN_CONFIRMATION) {
  const summary = { fanvue_dry_runs: 0, fanvue_dry_run_blocked: 0 }
  const fanvue_dry_run_results = runFanvueRouteDryRunVerification({
    rules: [{ ...baseRule, content_payload }],
    now,
    env,
    request_confirmation,
    summary,
  })
  return {
    ok: true,
    dispatch_enabled: false,
    schedule_advancement_enabled: false,
    schedulable_platforms: [],
    claim_jobs: false,
    fanvue_dry_run_confirmed: isFanvueRouteDryRunConfirmed(request_confirmation),
    summary,
    fanvue_dry_run_results,
  }
}

function assertSafeEnvelope(body: any, safeCode = 'FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS') {
  assert.equal(body.ok, true)
  assert.equal(body.dispatch_enabled, false)
  assert.equal(body.schedule_advancement_enabled, false)
  assert.deepEqual(body.schedulable_platforms, [])
  assert.equal(body.claim_jobs, false)
  assert.equal(body.summary.fanvue_dry_runs, safeCode === 'FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS' ? 1 : 0)
  assert.equal(body.summary.fanvue_dry_run_blocked, safeCode === 'FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS' ? 0 : 1)
  assert.equal(body.fanvue_dry_run_results.length, 1)
  const result = body.fanvue_dry_run_results[0]
  assert.equal(result.dry_run, true)
  assert.equal(result.platform, 'fanvue')
  assert.equal(result.bridge_mode, 'internal_mocked_runner_persistence')
  assert.equal(result.dispatch_enabled, false)
  assert.equal(result.live_attempted, false)
  assert.equal(result.fanvue_upload_attempted, false)
  assert.equal(result.fanvue_post_attempted, false)
  assert.equal(result.provider_post_uuid_present, false)
  assert.equal(result.schedule_advance_intent, 'mocked_only')
  assert.equal(result.safe_code, safeCode)
  const serialized = JSON.stringify(body)
  assert.doesNotMatch(serialized, new RegExp(FANVUE_RUN_DRY_RUN_CONFIRMATION))
  assert.doesNotMatch(serialized, /provider-uuid|raw_provider_response|signed-url|r2-key|media-bytes|token-value|cookie-value|header-value|secret-value/i)
  assert.doesNotMatch(serialized, /fanvue_media_uuid|provider_post_id|signed_url|r2_key|bytes|access_token|refresh_token|cookie|header|secret/i)
}

for (const content_payload of [
  { platform: 'fanvue', content_type: 'text', text: 'Fanvue dry-run route text.' },
  { platform: 'fanvue', content_type: 'image', text: 'Image caption', asset_id: 'asset-image-1', media_type: 'image', filename: 'safe.png', mime_type: 'image/png', size: 123 },
  { platform: 'fanvue', content_type: 'video', asset_id: 'asset-video-1', media_type: 'video', filename: 'safe.mp4', mime_type: 'video/mp4' },
]) {
  assertSafeEnvelope(runWithRule(content_payload))
}

for (const env of [{}, { FANVUE_RUN_DRY_RUN_BRANCH_ENABLED: 'false' }]) {
  const body = runWithRule({ platform: 'fanvue', content_type: 'text', text: 'Blocked without env.' }, env)
  assert.equal(body.fanvue_dry_run_confirmed, true)
  assertSafeEnvelope(body, 'FANVUE_RUN_DRY_RUN_BRANCH_GATE_DISABLED')
}

for (const confirm of ['', 'wrong-confirmation']) {
  const body = runWithRule({ platform: 'fanvue', content_type: 'text', text: 'Blocked without confirmation.' }, enabledEnv, confirm)
  assert.equal(body.fanvue_dry_run_confirmed, false)
  assertSafeEnvelope(body, 'FANVUE_RUN_DRY_RUN_BRANCH_CONFIRMATION_REQUIRED')
}

const routeSource = readFileSync('app/api/autopost/run/route.ts', 'utf8')
assert.match(routeSource, /runFanvueRouteDryRunVerification/, '/api/autopost/run must use the route-level Fanvue dry-run verifier')
assert.match(routeSource, /from\("autopost_rules"\)[\s\S]*selected_platforms[\s\S]*content_payload/, '/api/autopost/run must load app-shaped rule rows with selected_platforms and content_payload')
assert.doesNotMatch(routeSource, /uploadFanvue|postFanvue|decrypt|fanvueApi|providerClient|refreshFanvueAccessToken|FANVUE_RUN_DISPATCH_ENABLED/, '/api/autopost/run must not reference Fanvue live/provider/upload/token dispatch')
assert.doesNotMatch(routeSource, /fanvue.*price|price.*fanvue|paywall|publishAt|native scheduling|platformRegistry/i, '/api/autopost/run must not add Fanvue pricing, native scheduling, or public registry behavior')

const helperSource = readFileSync('lib/autopost/fanvueRunRouteDryRunVerifier.ts', 'utf8')
assert.doesNotMatch(helperSource, /fetch\(|createClient|from\(|uploadFanvue|postFanvue|decrypt|fanvueApi|providerClient|refreshFanvueAccessToken|FANVUE_RUN_DISPATCH_ENABLED/, 'route dry-run verifier must not reference live/provider/upload/token/database clients')

console.log('Fanvue route dry-run app-data tests passed')
