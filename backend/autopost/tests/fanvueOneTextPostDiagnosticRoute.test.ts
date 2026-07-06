import assert from 'node:assert/strict'
import {
  FANVUE_ONE_TEXT_POST_DIAGNOSTIC_AUDIENCE,
  FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CONFIRMATION,
  FANVUE_ONE_TEXT_POST_DIAGNOSTIC_OPERATION,
  FANVUE_ONE_TEXT_POST_DIAGNOSTIC_ROUTE,
  FANVUE_ONE_TEXT_POST_DIAGNOSTIC_SECRET_HEADER,
  FANVUE_ONE_TEXT_POST_DIAGNOSTIC_TEXT,
  handleFanvueOneTextPostDiagnosticRoute,
} from '../../../lib/autopost/fanvueOneTextPostDiagnosticRoute'
import type { FanvueFetch } from '../../../lib/autopost/fanvueApiClientCore'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const nonAdminUserId = '123e4567-e89b-42d3-a456-426614174000'
const postUuid = '123e4567-e89b-42d3-a456-426614174000'
const secret = 'one-text-secret-never-returned'
const token = 'access-token-never-returned'
const refreshedToken = 'refreshed-access-token-never-returned'
const now = new Date('2026-07-06T00:00:00.000Z')
const freshExpiry = new Date(now.getTime() + 3_600_000).toISOString()
const staleExpiry = new Date(now.getTime() - 3_600_000).toISOString()

const body = (overrides: Record<string, unknown> = {}) => ({ operation: FANVUE_ONE_TEXT_POST_DIAGNOSTIC_OPERATION, user_id: userId, ...overrides })
function req(requestBody: unknown, headers: HeadersInit = {}, method = 'POST') {
  return new Request(`https://sirensforge.test${FANVUE_ONE_TEXT_POST_DIAGNOSTIC_ROUTE}`, { method, headers: new Headers({ 'content-type': 'application/json', ...headers }), body: method === 'POST' ? JSON.stringify(requestBody) : undefined })
}
async function route(input: { requestBody?: unknown; requestSecret?: string | null; authenticatedUserId?: string | null; fetch?: FanvueFetch; loadAccount?: any; decryptAccessToken?: any; refreshAccessToken?: any; method?: string } = {}) {
  const calls: Array<{ url: string; init: Parameters<FanvueFetch>[1] }> = []
  const fanvueFetch: FanvueFetch = input.fetch ?? (async (url, init) => {
    calls.push({ url, init })
    if (init.method === 'POST') return { ok: true, status: 200, json: async () => ({ uuid: postUuid, raw: token }) }
    if (init.method === 'DELETE') return { ok: true, status: 204, json: async () => ({ raw: token }) }
    return { ok: false, status: 500, json: async () => ({ raw: token }) }
  })
  const headers: Record<string, string> = {}
  if (input.requestSecret !== null) headers[FANVUE_ONE_TEXT_POST_DIAGNOSTIC_SECRET_HEADER] = input.requestSecret ?? secret
  const response = await handleFanvueOneTextPostDiagnosticRoute({
    request: req(input.requestBody === undefined ? body() : input.requestBody, headers, input.method),
    expectedSecret: secret,
    adminUserIds: userId,
    getAuthenticatedUserId: async () => {
      if (input.authenticatedUserId === null) throw new Error('missing auth')
      return input.authenticatedUserId ?? userId
    },
    createLoadAccount: () => input.loadAccount ?? (async () => ({ user_id: userId, platform: 'fanvue', connection_status: 'CONNECTED', encrypted_access_token: 'encrypted-token-never-returned', encrypted_refresh_token: 'encrypted-refresh-token-never-returned', token_expires_at: freshExpiry })),
    apiBaseUrl: 'https://api.test.fanvue.example',
    apiVersion: '2025-01-01',
    fanvueFetch,
    decryptAccessToken: input.decryptAccessToken ?? (() => token),
    refreshAccessToken: input.refreshAccessToken,
    now: () => now,
  })
  return { response, calls }
}
function noLeak(value: unknown) {
  const text = JSON.stringify(value)
  assert.doesNotMatch(text, new RegExp(postUuid), 'full post UUID must not be exposed')
  assert.doesNotMatch(text, /access-token-never-returned|refreshed-access-token-never-returned|encrypted-token-never-returned|encrypted-refresh-token-never-returned|raw|provider.*body/i)
}

async function run() {
  const preflight = await route()
  assert.equal(preflight.response.status, 200)
  assert.equal((preflight.response.body as any).live_attempted, false)
  assert.equal(preflight.calls.length, 0, 'preflight must not call Fanvue')


  let preflightDecrypts = 0
  let preflightRefreshes = 0
  const preflightNoToken = await route({
    decryptAccessToken: () => { preflightDecrypts += 1; return token },
    refreshAccessToken: async () => { preflightRefreshes += 1; return { ok: true, token_expires_at: freshExpiry, token_type: 'bearer', scopes: [], refreshed: true } },
  })
  assert.equal(preflightNoToken.response.status, 200)
  assert.equal(preflightDecrypts, 0, 'preflight must not decrypt')
  assert.equal(preflightRefreshes, 0, 'preflight must not refresh')
  assert.equal(preflightNoToken.calls.length, 0, 'preflight must not call Fanvue')

  assert.equal((await route({ requestSecret: null })).response.status, 401)
  assert.equal(((await route({ authenticatedUserId: null })).response.body as any).error_code, 'UNAUTHENTICATED')
  assert.equal(((await route({ authenticatedUserId: nonAdminUserId })).response.body as any).error_code, 'FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED')
  assert.equal(((await route({ requestBody: body({ preflight: false, confirm: 'bad' }) })).response.body as any).error_code, 'INVALID_CONFIRMATION')

  for (const key of ['text', 'audience', 'mediaUuids', 'mediaPreviewUuid', 'price', 'publishAt', 'expiresAt', 'collectionUuids', 'postUuid', 'uuid', 'uploadId', 'media', 'schedule', 'dispatch']) {
    const result = await route({ requestBody: body({ [key]: 'caller-supplied' }) })
    assert.equal(result.response.status, 400, key)
    assert.equal((result.response.body as any).error_code, 'CALLER_SUPPLIED_FORBIDDEN_FIELD', key)
  }

  const live = await route({ requestBody: body({ preflight: false, confirm: FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CONFIRMATION }) })
  assert.equal(live.response.status, 200)
  assert.equal((live.response.body as any).ok, true)
  assert.equal(live.calls.length, 2)
  assert.equal(live.calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(live.calls[0].init.body ?? '{}'), { text: FANVUE_ONE_TEXT_POST_DIAGNOSTIC_TEXT, audience: FANVUE_ONE_TEXT_POST_DIAGNOSTIC_AUDIENCE })
  assert.equal(live.calls[1].init.method, 'DELETE')
  assert.equal(live.calls[1].url, `https://api.test.fanvue.example/posts/${postUuid}`)
  const liveBody: any = live.response.body
  assert.equal(liveBody.cleanup_attempted, true)
  assert.equal(liveBody.cleanup_ok, true)
  assert.equal(liveBody.upload_attempted, false)
  assert.equal(liveBody.media_attempted, false)
  assert.equal(liveBody.price_used, false)
  assert.equal(liveBody.publishAt_used, false)
  assert.equal(liveBody.dispatch_attempted, false)
  assert.equal(liveBody.schedule_attempted, false)
  noLeak(liveBody)



  let refreshCalls = 0
  let loadCalls = 0
  const refreshedLive = await route({
    requestBody: body({ preflight: false, confirm: FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CONFIRMATION }),
    loadAccount: async () => {
      loadCalls += 1
      return {
        user_id: userId,
        platform: 'fanvue',
        connection_status: 'CONNECTED',
        encrypted_access_token: loadCalls === 1 ? 'stale-encrypted-token-never-returned' : 'refreshed-encrypted-token-never-returned',
        encrypted_refresh_token: 'encrypted-refresh-token-never-returned',
        token_expires_at: loadCalls === 1 ? staleExpiry : freshExpiry,
      }
    },
    refreshAccessToken: async () => { refreshCalls += 1; return { ok: true, token_expires_at: freshExpiry, token_type: 'bearer', scopes: ['write:post'], refreshed: true } },
    decryptAccessToken: (encrypted: string) => encrypted === 'refreshed-encrypted-token-never-returned' ? refreshedToken : token,
  })
  assert.equal(refreshCalls, 1, 'live stale path must refresh before create')
  assert.equal(refreshedLive.calls.length, 2)
  assert.equal(refreshedLive.calls[0].init.headers.authorization, `Bearer ${refreshedToken}`)
  assert.equal((refreshedLive.response.body as any).supabase_mutated, true)
  noLeak(refreshedLive.response.body)

  let blockedRefreshCreateCalls = 0
  const refreshBlocked = await route({
    requestBody: body({ preflight: false, confirm: FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CONFIRMATION }),
    loadAccount: async () => ({ user_id: userId, platform: 'fanvue', connection_status: 'CONNECTED', encrypted_access_token: 'stale-encrypted-token-never-returned', encrypted_refresh_token: 'encrypted-refresh-token-never-returned', token_expires_at: staleExpiry }),
    refreshAccessToken: async () => ({ ok: false, blocked: true, error_code: 'FANVUE_REFRESH_UNAUTHORIZED', safe_error_message: 'safe', provider_calls_attempted: true, posted_proof: false, platform_post_id: null }),
    fetch: async (url, init) => { blockedRefreshCreateCalls += 1; return { ok: true, status: 200, json: async () => ({ uuid: postUuid }) } },
  })
  assert.equal((refreshBlocked.response.body as any).safe_code, 'FANVUE_REFRESH_UNAUTHORIZED')
  assert.equal((refreshBlocked.response.body as any).create_attempted, false)
  assert.equal(blockedRefreshCreateCalls, 0, 'refresh failure must block provider create')
  noLeak(refreshBlocked.response.body)

  const deleteFailed = await route({
    requestBody: body({ preflight: false, confirm: FANVUE_ONE_TEXT_POST_DIAGNOSTIC_CONFIRMATION }),
    fetch: async (url, init) => {
      if (init.method === 'POST') return { ok: true, status: 200, json: async () => ({ uuid: postUuid }) }
      return { ok: false, status: 500, json: async () => ({ raw: postUuid }) }
    },
  })
  assert.equal((deleteFailed.response.body as any).cleanup_attempted, true)
  assert.equal((deleteFailed.response.body as any).cleanup_status_class, '5xx')
  noLeak(deleteFailed.response.body)
}

run().then(() => console.log('Fanvue one-text post diagnostic route tests passed')).catch((error) => {
  console.error(error)
  process.exit(1)
})
