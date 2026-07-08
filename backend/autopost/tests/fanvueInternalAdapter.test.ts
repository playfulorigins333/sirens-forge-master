import assert from 'node:assert/strict'
import {
  FANVUE_INTERNAL_SINGLE_POST_AUDIENCE,
  postFanvueInternalSinglePost,
  redactFanvueInternalPostResult,
  type FanvueInternalAccount,
} from '../../../lib/autopost/fanvueInternalAdapter'
import type { FanvueFetch } from '../../../lib/autopost/fanvueApiClientCore'
import { FANVUE_MEDIA_READINESS_BACKOFF_BASE_MS, FANVUE_MEDIA_READINESS_MAX_ATTEMPTS, FANVUE_MEDIA_READINESS_MAX_DELAY_MS, FANVUE_VIDEO_MEDIA_READINESS_BACKOFF_BASE_MS, FANVUE_VIDEO_MEDIA_READINESS_MAX_ATTEMPTS, FANVUE_VIDEO_MEDIA_READINESS_MAX_DELAY_MS } from '../../../lib/autopost/fanvueMediaReadinessDiagnostic'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const mediaUuid = '223e4567-e89b-42d3-a456-426614174000'
const uploadId = '323e4567-e89b-42d3-a456-426614174000'
const creatorUuid = '423e4567-e89b-42d3-a456-426614174000'
const postUuid = '523e4567-e89b-42d3-a456-426614174000'
const now = new Date('2026-07-06T00:00:00.000Z')
const freshExpiry = new Date(now.getTime() + 3_600_000).toISOString()
const staleExpiry = new Date(now.getTime() - 3_600_000).toISOString()
const token = 'access-token-never-returned'
const refreshedToken = 'refreshed-access-token-never-returned'

function account(overrides: Partial<FanvueInternalAccount> = {}): FanvueInternalAccount {
  return { user_id: userId, platform: 'fanvue', connection_status: 'CONNECTED', encrypted_access_token: 'encrypted-token-never-returned', encrypted_refresh_token: 'encrypted-refresh-token-never-returned', token_expires_at: freshExpiry, scopes: ['read:media', 'write:media', 'write:creator'], ...overrides }
}

async function runAdapter(input: Partial<Parameters<typeof postFanvueInternalSinglePost>[0]> = {}) {
  const calls: Array<{ url: string; init: Parameters<FanvueFetch>[1] }> = []
  let uploads = 0
  const fanvueFetch: FanvueFetch = input.fanvueFetch ?? (async (url, init) => {
    calls.push({ url, init })
    if (init.method === 'POST' && /media\/uploads$/.test(url)) return { ok: true, status: 200, json: async () => ({ mediaUuid, uploadId, raw: token }) }
    if (init.method === 'GET' && /parts\/1\/url$/.test(url)) return { ok: true, status: 200, json: async () => 'https://signed-upload.example/one' }
    if (init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ status: 'processing' }) }
    if (init.method === 'POST' && /\/posts$/.test(url)) return { ok: true, status: 200, json: async () => ({ uuid: postUuid, raw: token }) }
    return { ok: false, status: 500, json: async () => ({ raw: token }) }
  })
  const result = await postFanvueInternalSinglePost({
    userId,
    account: account(),
    content: { platform: 'fanvue', content_type: 'text', text: 'Approved caption' },
    apiBaseUrl: 'https://api.test.fanvue.example',
    apiVersion: '2025-01-01',
    fanvueFetch,
    fetchIdentity: input.fetchIdentity ?? (async () => ({ ok: true, status: 200, json: async () => ({ uuid: creatorUuid, isCreator: true, email: 'creator@example.test' }) })),
    signedPartUploader: input.signedPartUploader ?? (async (uploadInput: any) => { uploads++; if (input.content && (input.content as any).media?.mediaType === 'video') assert.equal(uploadInput.contentType, 'video/mp4'); return { ETag: 'etag-one' } }),
    decryptAccessToken: input.decryptAccessToken ?? (() => token),
    refreshAccessToken: input.refreshAccessToken,
    reloadAccountAfterRefresh: input.reloadAccountAfterRefresh,
    waitForMediaReady: input.waitForMediaReady ?? (async (_config: any, args: any) => ({ ok: true, media: { uuid: args.uuid, status: 'ready' }, attempts: 1, proof: 'MEDIA_READY_READBACK' })),
    now: () => now,
    ...input,
  })
  return { result, calls, uploads }
}

function noLeak(value: unknown) {
  const text = JSON.stringify(value)
  for (const forbidden of [postUuid, mediaUuid, uploadId, creatorUuid, token, refreshedToken, 'encrypted-token-never-returned', 'encrypted-refresh-token-never-returned', 'creator@example.test', 'raw']) assert.doesNotMatch(text, new RegExp(forbidden), forbidden)
  assert.doesNotMatch(text, /authorization|bearer|provider.*body/i)
}

async function run() {
  const text = await runAdapter()
  assert.equal(text.result.ok, true)
  assert.equal(text.result.provider_post_uuid, postUuid)
  assert.equal(text.calls.length, 1)
  assert.deepEqual(JSON.parse(text.calls[0].init.body ?? '{}'), { text: 'Approved caption', audience: FANVUE_INTERNAL_SINGLE_POST_AUDIENCE })
  assert.equal(JSON.stringify(text.calls[0].init.body).includes('publishAt'), false)
  assert.equal(JSON.stringify(text.calls[0].init.body).includes('price'), false)
  assert.equal(text.result.price_used, false)
  assert.equal(text.result.publishAt_used, false)
  assert.equal(text.result.dispatch_attempted, false)
  assert.equal(text.result.schedule_attempted, false)
  noLeak(redactFanvueInternalPostResult(text.result))

  let refreshes = 0
  const stale = await runAdapter({
    account: account({ encrypted_access_token: 'stale-encrypted-token-never-returned', token_expires_at: staleExpiry }),
    refreshAccessToken: async () => { refreshes++; return { ok: true, token_expires_at: freshExpiry, token_type: 'bearer', scopes: ['read:media', 'write:media', 'write:creator'], refreshed: true } },
    reloadAccountAfterRefresh: async () => account({ encrypted_access_token: 'refreshed-encrypted-token-never-returned', token_expires_at: freshExpiry }),
    decryptAccessToken: (encrypted: string) => encrypted === 'refreshed-encrypted-token-never-returned' ? refreshedToken : token,
  })
  assert.equal(refreshes, 1)
  assert.equal(stale.calls[0].init.headers.authorization, `Bearer ${refreshedToken}`)
  assert.equal(stale.result.supabase_mutated, true)
  noLeak(redactFanvueInternalPostResult(stale.result))

  const blockedRefresh = await runAdapter({
    account: account({ token_expires_at: staleExpiry }),
    refreshAccessToken: async () => ({ ok: false, blocked: true, error_code: 'FANVUE_REFRESH_UNAUTHORIZED', safe_error_message: 'safe', provider_calls_attempted: true, posted_proof: false, platform_post_id: null }),
  })
  assert.equal(blockedRefresh.result.safe_code, 'FANVUE_REFRESH_UNAUTHORIZED')
  assert.equal(blockedRefresh.result.create_attempted, false)
  assert.equal(blockedRefresh.calls.length, 0)

  let readinessArgs: any = null
  const media = await runAdapter({
    content: { platform: 'fanvue', content_type: 'media', text: 'Approved media caption', media: { filename: 'approved.png', mediaType: 'image', bytes: new Blob(['safe-bytes']) } },
    waitForMediaReady: async (_config: any, args: any) => { readinessArgs = args; return { ok: true, media: { uuid: args.uuid, status: 'ready' }, attempts: 1, proof: 'MEDIA_READY_READBACK' } },
  })
  assert.equal(media.result.ok, true)
  assert.deepEqual(readinessArgs, { uuid: mediaUuid, maxAttempts: FANVUE_MEDIA_READINESS_MAX_ATTEMPTS, maxDelayMs: FANVUE_MEDIA_READINESS_MAX_DELAY_MS, backoffBaseMs: FANVUE_MEDIA_READINESS_BACKOFF_BASE_MS })
  assert.equal(media.uploads, 1)
  assert.equal(media.calls.length, 4)
  assert.match(media.calls[0].url, new RegExp(`/creators/${creatorUuid}/media/uploads$`))
  assert.match(media.calls[2].url, new RegExp(`/creators/${creatorUuid}/media/uploads/${uploadId}$`))
  assert.deepEqual(JSON.parse(media.calls[2].init.body ?? '{}'), { parts: [{ ETag: 'etag-one', PartNumber: 1 }] })
  assert.deepEqual(JSON.parse(media.calls[3].init.body ?? '{}'), { audience: FANVUE_INTERNAL_SINGLE_POST_AUDIENCE, mediaUuids: [mediaUuid], text: 'Approved media caption' })
  assert.equal(media.calls.some((call) => call.init.method === 'DELETE'), false)
  assert.equal(media.result.upload_cleanup_supported, false)
  assert.equal(media.result.uploaded_media_may_remain_in_creator_media_library, true)
  noLeak(redactFanvueInternalPostResult(media.result))

  let videoReadinessArgs: any = null
  const video = await runAdapter({
    content: { platform: 'fanvue', content_type: 'media', text: 'Approved video caption', media: { filename: 'approved.mp4', mediaType: 'video', bytes: new Blob(['safe-video-bytes'], { type: 'video/mp4' }) } },
    waitForMediaReady: async (_config: any, args: any) => { videoReadinessArgs = args; return { ok: true, media: { uuid: args.uuid, status: 'ready' }, attempts: 3, proof: 'MEDIA_READY_READBACK' } },
  })
  assert.equal(video.result.ok, true)
  assert.equal(video.uploads, 1)
  assert.deepEqual(videoReadinessArgs, { uuid: mediaUuid, maxAttempts: FANVUE_VIDEO_MEDIA_READINESS_MAX_ATTEMPTS, maxDelayMs: FANVUE_VIDEO_MEDIA_READINESS_MAX_DELAY_MS, backoffBaseMs: FANVUE_VIDEO_MEDIA_READINESS_BACKOFF_BASE_MS })
  assert(FANVUE_VIDEO_MEDIA_READINESS_MAX_ATTEMPTS * FANVUE_VIDEO_MEDIA_READINESS_MAX_DELAY_MS > FANVUE_MEDIA_READINESS_MAX_ATTEMPTS * FANVUE_MEDIA_READINESS_MAX_DELAY_MS)
  assert.equal(video.result.readiness_attempts_used, 3)
  assert.equal(video.result.readiness_status_class, '2xx')
  assert.equal(video.result.readiness_final_state, 'ready')
  assert.deepEqual(JSON.parse(video.calls[2].init.body ?? '{}'), { parts: [{ ETag: 'etag-one', PartNumber: 1 }], filename: 'approved.mp4', contentType: 'video/mp4', size: 16 })
  assert.deepEqual(JSON.parse(video.calls[3].init.body ?? '{}'), { audience: FANVUE_INTERNAL_SINGLE_POST_AUDIENCE, mediaUuids: [mediaUuid], text: 'Approved video caption' })
  noLeak(redactFanvueInternalPostResult(video.result))

  const notReady = await runAdapter({
    content: { platform: 'fanvue', content_type: 'media', media: { filename: 'approved.png', mediaType: 'image', bytes: new Blob(['safe-bytes']) } },
    waitForMediaReady: async () => ({ ok: false, status: null, error_code: 'FANVUE_MEDIA_PROCESSING_ERROR', safe_error_message: 'safe' }),
  })
  assert.equal(notReady.result.safe_code, 'FANVUE_MEDIA_PROCESSING_ERROR')
  assert.equal(notReady.result.create_attempted, false)
  assert.equal(notReady.result.readiness_checked, true)
  assert.equal(notReady.result.readiness_status_class, 'not_ready')
  assert.equal(notReady.result.readiness_final_state, 'error')
  assert.equal(notReady.calls.filter((call) => call.init.method === 'POST' && /\/posts$/.test(call.url)).length, 0)

  const missingScopes = await runAdapter({ account: account({ scopes: [] }), content: { platform: 'fanvue', content_type: 'media', media: { filename: 'approved.png', mediaType: 'image', bytes: new Blob(['safe-bytes']) } } })
  assert.equal(missingScopes.result.safe_code, 'FANVUE_INTERNAL_REQUIRED_SCOPES_MISSING')
  assert.equal(missingScopes.calls.length, 0)
}

run().then(() => console.log('Fanvue internal adapter tests passed')).catch((error) => { console.error(error); process.exit(1) })
