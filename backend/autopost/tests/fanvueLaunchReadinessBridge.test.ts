import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateFanvueLaunchReadyContentPayload } from '../../../lib/autopost/fanvueLaunchReadiness'

const base = { rule_id: 'rule-1', user_id: 'user-1', scheduled_for: '2026-07-09T00:00:00.000Z', selected_platforms: ['fanvue'], env: { FANVUE_INTERNAL_LAUNCH_READINESS_ENABLED: 'true' } }

const text = validateFanvueLaunchReadyContentPayload({ ...base, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Launch ready text.' } })
assert.equal(text.valid, true)
assert.equal(text.valid && text.payload.dispatch_enabled, false)
assert.equal(text.valid && text.payload.price, null)

const image = validateFanvueLaunchReadyContentPayload({ ...base, content_payload: { platform: 'fanvue', content_type: 'image', text: 'Image caption', asset_id: 'asset-image-1', media_type: 'image', filename: 'safe.png', mime_type: 'image/png', size: 123 } })
assert.equal(image.valid, true)
assert.equal(image.valid && image.payload.media?.media_type, 'image')

const video = validateFanvueLaunchReadyContentPayload({ ...base, content_payload: { platform: 'fanvue', content_type: 'video', asset_id: 'asset-video-1', media_type: 'video', filename: 'safe.mp4', mime_type: 'video/mp4' } })
assert.equal(video.valid, true)
assert.equal(video.valid && video.payload.media?.media_type, 'video')

const disabled = validateFanvueLaunchReadyContentPayload({ ...base, env: {}, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Blocked' } })
assert.equal(disabled.valid, false)
assert.equal(!disabled.valid && disabled.error_code, 'FANVUE_INTERNAL_LAUNCH_READINESS_DISABLED')

for (const forbidden of ['price', 'paywall', 'publishAt', 'fanvue_media_uuid', 'signed_url', 'r2_key', 'access_token']) {
  const result = validateFanvueLaunchReadyContentPayload({ ...base, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Safe', [forbidden]: 'secret-or-provider-value' } })
  assert.equal(result.valid, false, forbidden)
  assert.equal(!result.valid && result.error_code, 'FANVUE_FORBIDDEN_PROVIDER_FIELD')
}

const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
assert.doesNotMatch(runRoute, /uploadFanvue|postFanvue|decrypt|fanvueApi|providerClient|FANVUE_RUN_DISPATCH_ENABLED/, 'normal runner must not reference Fanvue live/provider/upload/token dispatch')

const source = readFileSync('lib/autopost/fanvueLaunchReadiness.ts', 'utf8')
assert.doesNotMatch(source, /fetch\(|createFanvue|uploadFanvue|decryptAutopostToken|from\("autopost_jobs"\)|from\('autopost_jobs'\)/, 'bridge must stay dry-run/payload-only')

console.log('Fanvue launch-readiness bridge tests passed')
