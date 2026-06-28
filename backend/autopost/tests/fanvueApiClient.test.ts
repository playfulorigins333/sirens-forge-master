import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createFanvueApiClient, type FanvueFetch } from '../../../lib/autopost/fanvueApiClientCore'
import { validateFanvueLivePostProof } from '../../../lib/autopost/fanvueProof'

const officialPostUuid = '123e4567-e89b-42d3-a456-426614174000'
const apiBaseUrl = 'https://api.fanvue.example'
const apiVersion = '2025-06-26'
const accessToken = 'test_access_token_value'
const expectedText = 'Text-only Fanvue post.'
const expectedAudience = 'subscribers'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

function textResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }
}

function clientWith(fetchFn: FanvueFetch) {
  return createFanvueApiClient({ apiBaseUrl, apiVersion, accessToken, fetchFn })
}

const originalFetch = globalThis.fetch
globalThis.fetch = (() => {
  throw new Error('global fetch must not be used by Fanvue API client tests')
}) as typeof fetch

try {
  const createCalls: Array<{ url: string; init: Parameters<FanvueFetch>[1] }> = []
  const createClient = clientWith(async (url, init) => {
    createCalls.push({ url, init })
    return jsonResponse(201, {
      uuid: officialPostUuid,
      createdAt: '2026-06-27T00:59:00.000Z',
      text: expectedText,
      audience: expectedAudience,
      publishedAt: '2026-06-27T01:00:00.000Z',
    })
  })

  const createResult = await createClient.createTextPost({ text: expectedText, audience: expectedAudience })
  assert.equal(createResult.ok, true)
  assert.equal(createResult.posted, false, 'create-post response alone must not be posted proof')
  assert.equal(createResult.proof_candidate, null, 'create-post response alone must not produce proof candidate')
  assert.equal(createCalls.length, 1)
  assert.equal(createCalls[0].url, `${apiBaseUrl}/posts`)
  assert.equal(createCalls[0].init.method, 'POST')
  assert.equal(createCalls[0].init.headers['X-Fanvue-API-Version'], apiVersion)
  assert.equal(createCalls[0].init.headers.authorization, `Bearer ${accessToken}`)
  assert.equal(JSON.parse(createCalls[0].init.body ?? '{}').audience, expectedAudience, 'create-post request must include audience')
  assert.equal(JSON.parse(createCalls[0].init.body ?? '{}').text, expectedText, 'create-post request must include text')
  assert.doesNotMatch(JSON.stringify(createResult), new RegExp(accessToken), 'client results must not echo bearer token')

  const uuidOnlyClient = clientWith(async () => jsonResponse(201, { uuid: officialPostUuid }))
  const uuidOnlyCreate = await uuidOnlyClient.createTextPost({ text: expectedText, audience: expectedAudience })
  assert.equal(uuidOnlyCreate.ok, true)
  assert.equal(uuidOnlyCreate.posted, false, 'create-post response with only uuid is not posted proof')
  assert.equal(uuidOnlyCreate.proof_candidate, null)

  const scheduledReadClient = clientWith(async () => jsonResponse(200, {
    uuid: officialPostUuid,
    text: expectedText,
    audience: expectedAudience,
    publishAt: '2026-07-01T12:00:00.000Z',
  }))
  const scheduledRead = await scheduledReadClient.readTextPost({ uuid: officialPostUuid, expectedText, expectedAudience })
  assert.equal(scheduledRead.ok, true)
  assert.equal(scheduledRead.posted, false, 'read-back response missing publishedAt is not posted proof')
  assert.equal(scheduledRead.kind, 'SCHEDULED_CREATED', 'publishAt without publishedAt remains scheduled-created')
  assert.equal(scheduledRead.proof_candidate, null)

  const textMismatchClient = clientWith(async () => jsonResponse(200, {
    uuid: officialPostUuid,
    text: 'Different text',
    audience: expectedAudience,
    publishedAt: '2026-06-27T01:00:00.000Z',
  }))
  const textMismatch = await textMismatchClient.readTextPost({ uuid: officialPostUuid, expectedText, expectedAudience })
  assert.equal(textMismatch.ok, false)
  assert.equal(textMismatch.error_code, 'FANVUE_READBACK_TEXT_MISMATCH')

  const audienceMismatchClient = clientWith(async () => jsonResponse(200, {
    uuid: officialPostUuid,
    text: expectedText,
    audience: 'other',
    publishedAt: '2026-06-27T01:00:00.000Z',
  }))
  const audienceMismatch = await audienceMismatchClient.readTextPost({ uuid: officialPostUuid, expectedText, expectedAudience })
  assert.equal(audienceMismatch.ok, false)
  assert.equal(audienceMismatch.error_code, 'FANVUE_READBACK_AUDIENCE_MISMATCH')

  const readCalls: Array<{ url: string; init: Parameters<FanvueFetch>[1] }> = []
  const readClient = clientWith(async (url, init) => {
    readCalls.push({ url, init })
    return jsonResponse(200, {
      uuid: officialPostUuid,
      createdAt: '2026-06-27T00:59:00.000Z',
      text: expectedText,
      audience: expectedAudience,
      publishAt: null,
      publishedAt: '2026-06-27T01:00:00.000Z',
      mediaUuids: [],
    })
  })
  const readResult = await readClient.readTextPost({
    uuid: officialPostUuid,
    expectedText,
    expectedAudience,
    jobId: 'job_1',
    ruleId: 'rule_1',
    userId: 'user_1',
    scheduledFor: '2026-06-27T00:00:00.000Z',
  })
  assert.equal(readResult.ok, true)
  assert.equal(readResult.posted, false, 'read-back client returns candidate, not persisted posted result')
  assert.equal(readCalls[0].url, `${apiBaseUrl}/posts/${officialPostUuid}`)
  assert.equal(readCalls[0].init.method, 'GET')
  assert.equal(readCalls[0].init.headers['X-Fanvue-API-Version'], apiVersion)
  assert.equal(readCalls[0].init.headers.authorization, `Bearer ${accessToken}`)
  assert.ok(readResult.proof_candidate, 'matching read-back can produce proof candidate for validator')
  assert.equal(validateFanvueLivePostProof(readResult.proof_candidate ?? {}).posted, true)

  for (const [status, code] of [
    [401, 'FANVUE_HTTP_UNAUTHORIZED'],
    [403, 'FANVUE_HTTP_FORBIDDEN'],
    [429, 'FANVUE_HTTP_RATE_LIMITED'],
    [500, 'FANVUE_HTTP_SERVER_ERROR'],
  ] as const) {
    const httpClient = clientWith(async () => textResponse(status, ''))
    const result = await httpClient.createTextPost({ text: expectedText, audience: expectedAudience })
    assert.equal(result.ok, false)
    assert.equal(result.error_code, code)
    assert.doesNotMatch(JSON.stringify(result), new RegExp(accessToken), `HTTP ${status} failure must not expose token`)
  }

  const malformedClient = clientWith(async () => textResponse(200, '{not json'))
  const malformed = await malformedClient.readTextPost({ uuid: officialPostUuid, expectedText, expectedAudience })
  assert.equal(malformed.ok, false)
  assert.equal(malformed.error_code, 'FANVUE_RESPONSE_JSON_INVALID')

  const wrapperSource = readFileSync('lib/autopost/fanvueApiClient.ts', 'utf8')
  const coreSource = readFileSync('lib/autopost/fanvueApiClientCore.ts', 'utf8')
  const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  const availability = readFileSync('lib/autopost/platformAvailability.ts', 'utf8')
  const oauth = readFileSync('lib/autopost/fanvueOAuth.ts', 'utf8')
  const proof = readFileSync('lib/autopost/fanvueProof.ts', 'utf8')

  assert.match(wrapperSource, /import "server-only"/, 'Fanvue API client boundary must be server-only')
  assert.match(coreSource, /fetchFn: FanvueFetch/, 'Fanvue API client must require injected fetch')
  assert.doesNotMatch(coreSource, /globalThis\.fetch|window\.fetch/, 'Fanvue API client must not use global/browser fetch')
  assert.doesNotMatch(coreSource, /media\/uploads|\/media\/\{uuid\}|write:creator/, 'Fanvue text-only client must not add media upload paths or write:creator')
  assert.doesNotMatch(coreSource, /persistAutopostJobResult|from\("autopost_jobs"\)|schedule_advanced|update\(/, 'Fanvue API client must not persist jobs or advance schedules')
  assert.doesNotMatch(proof, /persistAutopostJobResult|from\("autopost_jobs"\)|fetch\(/, 'Fanvue proof helpers must not persist jobs or perform live fetches')
  assert.doesNotMatch(runRoute, /fanvue/, 'Fanvue must remain absent from public run route')
  assert.match(availability, /public_selectable: false/, 'Fanvue must remain non-selectable')
  assert.match(availability, /can_schedule: false/, 'Fanvue must remain non-schedulable')
  assert.match(availability, /supports_real_posting: false/, 'Fanvue must not advertise real posting')
  assert.match(availability, /supports_text_posting: false/, 'Fanvue must not advertise text posting yet')
  assert.match(availability, /supports_media_posting: false/, 'Fanvue must not advertise media posting')
  assert.doesNotMatch(oauth, /write:creator/, 'Fanvue text-only readiness must not add write:creator scope')
} finally {
  globalThis.fetch = originalFetch
}

console.log('Fanvue API client safety checks passed')
