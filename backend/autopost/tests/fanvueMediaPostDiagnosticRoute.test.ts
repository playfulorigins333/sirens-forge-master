import assert from 'node:assert/strict'
import {
  FANVUE_MEDIA_POST_DIAGNOSTIC_AUDIENCE,
  FANVUE_MEDIA_POST_DIAGNOSTIC_CONFIRMATION,
  FANVUE_MEDIA_POST_DIAGNOSTIC_OPERATION,
  FANVUE_MEDIA_POST_DIAGNOSTIC_ROUTE,
  FANVUE_MEDIA_POST_DIAGNOSTIC_SECRET_HEADER,
  FANVUE_MEDIA_POST_DIAGNOSTIC_TEXT,
  handleFanvueMediaPostDiagnosticRoute,
} from '../../../lib/autopost/fanvueMediaPostDiagnosticRoute'
import { FANVUE_UPLOAD_DIAGNOSTIC_FILENAME, FANVUE_UPLOAD_DIAGNOSTIC_PNG } from '../../../lib/autopost/fanvueUploadDiagnostic'
import type { FanvueFetch } from '../../../lib/autopost/fanvueApiClientCore'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const nonAdminUserId = '123e4567-e89b-42d3-a456-426614174000'
const mediaUuid = '223e4567-e89b-42d3-a456-426614174000'
const uploadId = '323e4567-e89b-42d3-a456-426614174000'
const creatorUuid = '423e4567-e89b-42d3-a456-426614174000'
const postUuid = '523e4567-e89b-42d3-a456-426614174000'
const secret = 'media-post-secret-never-returned'
const token = 'access-token-never-returned'
const now = new Date('2026-07-06T00:00:00.000Z')
const freshExpiry = new Date(now.getTime() + 3_600_000).toISOString()

const body = (overrides: Record<string, unknown> = {}) => ({ operation: FANVUE_MEDIA_POST_DIAGNOSTIC_OPERATION, user_id: userId, ...overrides })
function req(requestBody: unknown, headers: HeadersInit = {}, method = 'POST') {
  return new Request(`https://sirensforge.test${FANVUE_MEDIA_POST_DIAGNOSTIC_ROUTE}`, { method, headers: new Headers({ 'content-type': 'application/json', ...headers }), body: method === 'POST' ? JSON.stringify(requestBody) : undefined })
}
async function route(input: { requestBody?: unknown; requestSecret?: string | null; authenticatedUserId?: string | null; fetch?: FanvueFetch; loadAccount?: any; decryptAccessToken?: any; refreshAccessToken?: any; method?: string; waitForMediaReady?: any; signedPartUploader?: any; fetchIdentity?: any } = {}) {
  const calls: Array<{ url: string; init: Parameters<FanvueFetch>[1] }> = []
  let uploads = 0
  const fanvueFetch: FanvueFetch = input.fetch ?? (async (url, init) => {
    calls.push({ url, init })
    if (init.method === 'POST' && /media\/uploads$/.test(url)) return { ok: true, status: 200, json: async () => ({ uploadId, mediaUuid, raw: token }) }
    if (init.method === 'GET' && /parts\/1\/url$/.test(url)) return { ok: true, status: 200, json: async () => 'https://signed-upload.example/one' }
    if (init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ status: 'processing', raw: token }) }
    if (init.method === 'POST' && /\/posts$/.test(url)) return { ok: true, status: 200, json: async () => ({ uuid: postUuid, raw: token }) }
    if (init.method === 'DELETE') return { ok: true, status: 204, json: async () => ({ raw: token }) }
    return { ok: false, status: 500, json: async () => ({ raw: token }) }
  })
  const headers: Record<string, string> = {}
  if (input.requestSecret !== null) headers[FANVUE_MEDIA_POST_DIAGNOSTIC_SECRET_HEADER] = input.requestSecret ?? secret
  const response = await handleFanvueMediaPostDiagnosticRoute({
    request: req(input.requestBody === undefined ? body() : input.requestBody, headers, input.method),
    expectedSecret: secret,
    adminUserIds: userId,
    getAuthenticatedUserId: async () => {
      if (input.authenticatedUserId === null) throw new Error('missing auth')
      return input.authenticatedUserId ?? userId
    },
    createLoadAccount: () => input.loadAccount ?? (async () => ({ user_id: userId, platform: 'fanvue', connection_status: 'CONNECTED', encrypted_access_token: 'encrypted-token-never-returned', encrypted_refresh_token: 'encrypted-refresh-token-never-returned', token_expires_at: freshExpiry, scopes: ['read:media', 'write:media', 'write:creator'] })),
    fetchIdentity: input.fetchIdentity ?? (async () => ({ ok: true, status: 200, json: async () => ({ uuid: creatorUuid, isCreator: true, provider_identity_marker: 'sensitive-marker-must-not-leak' }) })),
    apiBaseUrl: 'https://api.test.fanvue.example',
    apiVersion: '2025-01-01',
    fanvueFetch,
    signedPartUploader: input.signedPartUploader ?? (async ({ body }) => { uploads += 1; assert.deepEqual(body, FANVUE_UPLOAD_DIAGNOSTIC_PNG); return { ETag: 'etag-one' } }),
    decryptAccessToken: input.decryptAccessToken ?? (() => token),
    refreshAccessToken: input.refreshAccessToken,
    now: () => now,
    waitForMediaReady: input.waitForMediaReady ?? (async (_config: any, args: any) => ({ ok: true, media: { uuid: args.uuid, status: 'ready' }, attempts: 1, proof: 'MEDIA_READY_READBACK' })),
  })
  return { response, calls, uploads }
}
function noLeak(value: unknown) {
  const text = JSON.stringify(value)
  for (const forbidden of [postUuid, mediaUuid, uploadId, creatorUuid, token, 'encrypted-token-never-returned', 'encrypted-refresh-token-never-returned', 'sensitive-marker-must-not-leak']) assert.doesNotMatch(text, new RegExp(forbidden), forbidden)
  assert.doesNotMatch(text, /raw|provider.*body|authorization|bearer/i)
}

async function run() {
  let decrypts = 0, refreshes = 0, identityCalls = 0, signedUploads = 0
  const preflight = await route({ decryptAccessToken: () => { decrypts++; return token }, refreshAccessToken: async () => { refreshes++; return { ok: true } }, fetchIdentity: async () => { identityCalls++; throw new Error('no identity') }, signedPartUploader: async () => { signedUploads++; return { ETag: 'x' } } })
  assert.equal(preflight.response.status, 200)
  assert.equal((preflight.response.body as any).live_attempted, false)
  assert.equal(decrypts, 0)
  assert.equal(refreshes, 0)
  assert.equal(identityCalls, 0)
  assert.equal(signedUploads, 0)
  assert.equal(preflight.calls.length, 0)
  noLeak(preflight.response.body)

  assert.equal((await route({ requestSecret: null })).response.status, 401)
  assert.equal(((await route({ authenticatedUserId: null })).response.body as any).error_code, 'UNAUTHENTICATED')
  assert.equal(((await route({ authenticatedUserId: nonAdminUserId })).response.body as any).error_code, 'FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED')
  assert.equal(((await route({ requestBody: body({ preflight: false, confirm: 'bad' }) })).response.body as any).error_code, 'INVALID_CONFIRMATION')

  for (const key of ['text', 'audience', 'mediaUuids', 'mediaPreviewUuid', 'price', 'publishAt', 'expiresAt', 'collectionUuids', 'postUuid', 'mediaUuid', 'uploadId', 'fileBytes', 'fileUrl', 'schedule', 'dispatch', 'platform']) {
    const result = await route({ requestBody: body({ [key]: 'caller-supplied' }) })
    assert.equal(result.response.status, 400, key)
    assert.equal((result.response.body as any).error_code, 'CALLER_SUPPLIED_FORBIDDEN_FIELD', key)
  }

  const live = await route({ requestBody: body({ preflight: false, confirm: FANVUE_MEDIA_POST_DIAGNOSTIC_CONFIRMATION }) })
  assert.equal((live.response.body as any).ok, true)
  assert.equal(live.uploads, 1)
  assert.equal(live.calls.length, 5)
  assert.equal(live.calls[0].init.method, 'POST')
  assert.match(live.calls[0].url, new RegExp(`/creators/${creatorUuid}/media/uploads$`))
  assert.deepEqual(JSON.parse(live.calls[0].init.body ?? '{}'), { name: FANVUE_UPLOAD_DIAGNOSTIC_FILENAME, filename: FANVUE_UPLOAD_DIAGNOSTIC_FILENAME, mediaType: 'image' })
  assert.equal(live.calls[3].init.method, 'POST')
  assert.deepEqual(JSON.parse(live.calls[3].init.body ?? '{}'), { audience: FANVUE_MEDIA_POST_DIAGNOSTIC_AUDIENCE, mediaUuids: [mediaUuid], text: FANVUE_MEDIA_POST_DIAGNOSTIC_TEXT })
  assert.equal(live.calls[4].init.method, 'DELETE')
  const liveBody: any = live.response.body
  assert.equal(liveBody.readiness_checked, true)
  assert.equal(liveBody.readiness_ready, true)
  assert.equal(liveBody.cleanup_attempted, true)
  assert.equal(liveBody.cleanup_ok, true)
  assert.equal(liveBody.price_used, false)
  assert.equal(liveBody.publishAt_used, false)
  assert.equal(liveBody.dispatch_attempted, false)
  assert.equal(liveBody.schedule_attempted, false)
  assert.equal(liveBody.uploaded_media_cleanup_supported, false)
  assert.equal(liveBody.uploaded_media_may_remain_in_creator_media_library, true)
  noLeak(liveBody)

  let readinessCalls = 0
  const readinessBlocked = await route({ requestBody: body({ preflight: false, confirm: FANVUE_MEDIA_POST_DIAGNOSTIC_CONFIRMATION }), waitForMediaReady: async () => { readinessCalls++; return { ok: false, status: 200, error_code: 'FANVUE_MEDIA_READY_TIMEOUT', safe_error_message: 'safe' } } })
  assert.equal(readinessCalls, 1)
  assert.equal((readinessBlocked.response.body as any).create_attempted, false)
  assert.equal(readinessBlocked.calls.filter((call) => call.init.method === 'POST' && /\/posts$/.test(call.url)).length, 0)
  noLeak(readinessBlocked.response.body)

  const createFailed = await route({ requestBody: body({ preflight: false, confirm: FANVUE_MEDIA_POST_DIAGNOSTIC_CONFIRMATION }), fetch: async (url, init) => {
    if (init.method === 'POST' && /media\/uploads$/.test(url)) return { ok: true, status: 200, json: async () => ({ uploadId, mediaUuid }) }
    if (init.method === 'GET') return { ok: true, status: 200, json: async () => 'https://signed.example' }
    if (init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ status: 'ready' }) }
    if (init.method === 'POST' && /\/posts$/.test(url)) return { ok: false, status: 500, json: async () => ({ uuid: postUuid }) }
    if (init.method === 'DELETE') throw new Error('delete should not happen')
    return { ok: false, status: 500, json: async () => ({}) }
  } })
  assert.equal((createFailed.response.body as any).create_attempted, true)
  assert.equal((createFailed.response.body as any).cleanup_attempted, false)
  assert.equal(createFailed.calls.filter((call) => call.init.method === 'DELETE').length, 0)
  noLeak(createFailed.response.body)

  const deleteFailed = await route({ requestBody: body({ preflight: false, confirm: FANVUE_MEDIA_POST_DIAGNOSTIC_CONFIRMATION }), fetch: async (url, init) => {
    if (init.method === 'POST' && /media\/uploads$/.test(url)) return { ok: true, status: 200, json: async () => ({ uploadId, mediaUuid }) }
    if (init.method === 'GET') return { ok: true, status: 200, json: async () => 'https://signed.example' }
    if (init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ status: 'ready' }) }
    if (init.method === 'POST' && /\/posts$/.test(url)) return { ok: true, status: 200, json: async () => ({ uuid: postUuid }) }
    if (init.method === 'DELETE') return { ok: false, status: 500, json: async () => ({ uuid: postUuid }) }
    return { ok: false, status: 500, json: async () => ({}) }
  } })
  assert.equal((deleteFailed.response.body as any).cleanup_attempted, true)
  assert.equal((deleteFailed.response.body as any).cleanup_ok, false)
  assert.equal((deleteFailed.response.body as any).cleanup_status_class, '5xx')
  noLeak(deleteFailed.response.body)
}

run().then(() => console.log('Fanvue media post diagnostic route tests passed')).catch((error) => {
  console.error(error)
  process.exit(1)
})
