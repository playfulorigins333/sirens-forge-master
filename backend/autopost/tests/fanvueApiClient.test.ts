import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createFanvueMediaPost, createFanvueTextPost, deleteFanvuePost, isFanvueProviderAudience, readFanvuePost, type FanvueFetch } from '../../../lib/autopost/fanvueApiClientCore'
import { validateFanvueLivePostProof } from '../../../lib/autopost/fanvueProof'

const token = 'secret-token-never-returned'
const uuid = '123e4567-e89b-42d3-a456-426614174000'
const config = (fetch: FanvueFetch) => ({ accessToken: token, apiBaseUrl: 'https://api.test.fanvue.example', apiVersion: '2025-01-01', fetch })

function response(status: number, data: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

async function run() {
  const calls: Array<{ url: string; init: Parameters<FanvueFetch>[1] }> = []
  const create = await createFanvueTextPost(config(async (url, init) => {
    calls.push({ url, init })
    return response(200, { uuid })
  }), { text: 'hello creators', audience: 'subscribers' })
  assert.equal(create.ok, true)
  assert.equal(create.posted_proof, false, 'create response alone must not be proof')
  assert.equal(calls[0].url, 'https://api.test.fanvue.example/posts')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, `Bearer ${token}`)
  assert.equal(calls[0].init.headers.Authorization, undefined, 'Fanvue API requests should match identity lookup and use lowercase authorization header key')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].init.headers['X-Fanvue-API-Version'], '2025-01-01')
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { text: 'hello creators', audience: 'subscribers' })
  assert.doesNotMatch(JSON.stringify(create), new RegExp(token), 'token must not be echoed in create result')

  assert.equal(isFanvueProviderAudience('subscribers'), true)
  assert.equal(isFanvueProviderAudience('followers-and-subscribers'), true)
  for (const blocked of ['public', 'followers', 'other', 'internal_validation', '', 'random-string']) {
    const blockedCalls: Array<{ url: string; init: Parameters<FanvueFetch>[1] }> = []
    const blockedCreate = await createFanvueTextPost(config(async (url, init) => {
      blockedCalls.push({ url, init })
      return response(200, { uuid })
    }), { text: 'hello creators', audience: blocked })
    assert.equal(blockedCreate.ok, false)
    assert.equal(blockedCalls.length, 0, `${blocked} must fail before fetch`)
  }

  const mediaBlockedCalls: Array<{ url: string; init: Parameters<FanvueFetch>[1] }> = []
  const mediaBlocked = await createFanvueMediaPost(config(async (url, init) => {
    mediaBlockedCalls.push({ url, init })
    return response(200, { uuid })
  }), { audience: 'internal_validation', mediaUuids: [uuid] })
  assert.equal(mediaBlocked.ok, false)
  assert.equal(mediaBlockedCalls.length, 0, 'media post invalid audience must fail before fetch')

  const deleteCalls: Array<{ url: string; init: Parameters<FanvueFetch>[1] }> = []
  const deleted = await deleteFanvuePost(config(async (url, init) => {
    deleteCalls.push({ url, init })
    return response(204, { raw: token })
  }), { uuid })
  assert.equal(deleted.ok, true)
  assert.equal(deleteCalls[0].url, `https://api.test.fanvue.example/posts/${uuid}`)
  assert.equal(deleteCalls[0].init.method, 'DELETE')
  assert.doesNotMatch(JSON.stringify(deleted), new RegExp(uuid), 'delete result must not echo full UUID')
  assert.doesNotMatch(JSON.stringify(deleted), new RegExp(token), 'delete result must not echo raw body')

  const scheduled = await readFanvuePost(config(async () => response(200, { uuid, text: 'hello creators', audience: 'followers' })), {
    uuid,
    expectedText: 'hello creators',
    expectedAudience: 'followers',
  })
  assert.equal(scheduled.ok, true)
  assert.equal(scheduled.result_kind, 'SCHEDULED_CREATED')
  assert.equal(scheduled.proof_candidate, null, 'missing publishedAt is not proof')

  const publishOnly = await readFanvuePost(config(async () => response(200, { uuid, text: 'hello creators', audience: 'followers', publishAt: '2026-07-01T00:00:00Z' })), {
    uuid,
    expectedText: 'hello creators',
    expectedAudience: 'followers',
  })
  assert.equal(publishOnly.ok, true)
  assert.equal(publishOnly.result_kind, 'SCHEDULED_CREATED', 'publishAt without publishedAt remains scheduled-created')

  const textMismatch = await readFanvuePost(config(async () => response(200, { uuid, text: 'different', audience: 'followers', publishedAt: '2026-07-01T00:00:00Z' })), {
    uuid,
    expectedText: 'hello creators',
    expectedAudience: 'followers',
  })
  assert.equal(textMismatch.ok, false)
  assert.equal(textMismatch.error_code, 'FANVUE_TEXT_PROOF_MISMATCH')

  const audienceMismatch = await readFanvuePost(config(async () => response(200, { uuid, text: 'hello creators', audience: 'public', publishedAt: '2026-07-01T00:00:00Z' })), {
    uuid,
    expectedText: 'hello creators',
    expectedAudience: 'followers',
  })
  assert.equal(audienceMismatch.ok, false)
  assert.equal(audienceMismatch.error_code, 'FANVUE_AUDIENCE_PROOF_MISMATCH')

  const posted = await readFanvuePost(config(async () => response(200, { uuid, text: 'hello creators', audience: 'followers', publishedAt: '2026-07-01T00:00:00Z' })), {
    uuid,
    expectedText: 'hello creators',
    expectedAudience: 'followers',
  })
  assert.equal(posted.ok, true)
  assert.equal(posted.result_kind, 'POSTED_READY_FOR_PROOF')
  assert.ok(posted.proof_candidate)
  assert.equal(validateFanvueLivePostProof(posted.proof_candidate).posted, true)

  for (const [status, code] of [[401, 'FANVUE_UNAUTHORIZED'], [403, 'FANVUE_FORBIDDEN'], [429, 'FANVUE_RATE_LIMITED'], [500, 'FANVUE_SERVER_ERROR']] as const) {
    const failed = await createFanvueTextPost(config(async () => response(status, { message: token })), { text: 'hello creators', audience: 'subscribers' })
    assert.equal(failed.ok, false)
    assert.equal(failed.error_code, code)
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(token), `${status} result must not echo token`)
  }

  const malformed = await createFanvueTextPost(config(async () => ({ ok: true, status: 200, json: async () => { throw new Error(token) } })), { text: 'hello creators', audience: 'subscribers' })
  assert.equal(malformed.ok, false)
  assert.equal(malformed.error_code, 'FANVUE_MALFORMED_JSON')
  assert.doesNotMatch(JSON.stringify(malformed), new RegExp(token), 'malformed JSON result must not echo token')

  const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  assert.doesNotMatch(runRoute, /fanvue/i, 'run route must remain without Fanvue wiring')
  const availability = readFileSync('lib/autopost/platformAvailability.ts', 'utf8')
  assert.match(availability, /public_selectable: false/, 'Fanvue public-selectable flag must remain false')
  assert.match(availability, /can_schedule: false/, 'Fanvue schedulable flag must remain false')
  const oauth = readFileSync('lib/autopost/fanvueOAuth.ts', 'utf8')
  assert.match(oauth, /write:creator/, 'write:creator may be approved for explicit internal creator-scoped diagnostics')
  const client = readFileSync('lib/autopost/fanvueApiClientCore.ts', 'utf8')
  assert.doesNotMatch(client, /persistAutopostJobResult|advanceSchedule|from\("autopost_jobs"\)/i, 'client must not add persistence or schedule advancement')
  assert.doesNotMatch(client, /globalThis\.fetch|window\.fetch|node-fetch/, 'core client must use injected fetch only')
}

run().then(() => console.log('Fanvue API client tests passed'))
