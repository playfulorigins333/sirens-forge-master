import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runFanvueUploadDiagnostic, runFanvueUploadDiagnosticPreflight, type FanvueUploadDiagnosticAccount } from '../../../lib/autopost/fanvueUploadDiagnostic'
import type { FanvueFetchResponse } from '../../../lib/autopost/fanvueApiClientCore'

const userId = '123e4567-e89b-42d3-a456-426614174000'
const creatorUuid = '223e4567-e89b-42d3-a456-426614174111'
const encryptedAccessToken = 'encrypted-access-token-never-returned'
const plainAccessToken = 'plain-access-token-never-returned'
const signedUrl = 'https://signed-upload-never-returned.example/upload?secret=never'
const uploadId = 'upload-id-never-returned'
const mediaUuid = '323e4567-e89b-42d3-a456-426614174222'

const baseAccount: FanvueUploadDiagnosticAccount = {
  user_id: userId,
  platform: 'fanvue',
  connection_status: 'CONNECTED',
  provider_account_id: creatorUuid,
  scopes: ['read:media', 'write:media', 'write:creator'],
  encrypted_access_token: encryptedAccessToken,
  token_expires_at: '2999-01-01T00:00:00.000Z',
  metadata: { provider: 'fanvue', identity_fetched: true },
}

type RunInput = { account?: FanvueUploadDiagnosticAccount | null; identityStatus?: number; identityBody?: unknown; identityJsonThrows?: boolean; fanvueFailures?: Record<string, number>; readyTimeout?: boolean; signedUploadThrows?: boolean }

function jsonResponse(status: number, body: unknown): FanvueFetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => typeof body === 'string' ? body : JSON.stringify(body), headers: { get: () => null } }
}

async function exercise(input: RunInput = {}) {
  const identityCalls: string[] = []
  const fanvueCalls: Array<{ url: string; method: string }> = []
  let signedUploadCalls = 0
  const result = await runFanvueUploadDiagnostic({ userId }, {
    apiBaseUrl: 'https://api.fanvue.test',
    apiVersion: '2025-06-26',
    now: () => new Date('2026-07-03T00:00:00.000Z'),
    loadAccount: async () => input.account === undefined ? baseAccount : input.account,
    decryptAccessToken: () => plainAccessToken,
    fetchIdentity: async (url) => {
      identityCalls.push(url)
      const status = input.identityStatus ?? 200
      return { ok: status >= 200 && status < 300, status, json: async () => { if (input.identityJsonThrows) throw new Error('raw provider body plain-access-token-never-returned'); return input.identityBody ?? { uuid: creatorUuid, isCreator: true, username: 'username-never-returned' } } }
    },
    fanvueFetch: async (url, init) => {
      if (/\/posts(?:\/|$)/i.test(new URL(url).pathname)) throw new Error('posts forbidden')
      fanvueCalls.push({ url, method: init.method })
      const path = new URL(url).pathname
      const failureStatus = Object.entries(input.fanvueFailures ?? {}).find(([pattern]) => path.includes(pattern))?.[1]
      if (failureStatus) return jsonResponse(failureStatus, { raw: 'raw provider body never returned' })
      if (init.method === 'POST' && path === `/creators/${creatorUuid}/media/uploads`) return jsonResponse(200, { mediaUuid, uploadId })
      if (init.method === 'GET' && path === `/creators/${creatorUuid}/media/uploads/${uploadId}/parts/1/url`) return { ...jsonResponse(200, signedUrl), text: async () => signedUrl }
      if (init.method === 'PATCH' && path === `/media/uploads/${uploadId}`) return jsonResponse(200, { status: 'processing' })
      if (init.method === 'GET' && path === `/media/${mediaUuid}`) return jsonResponse(200, { uuid: mediaUuid, status: 'ready', mediaType: 'image', name: 'fanvue-upload-diagnostic-1x1.png' })
      throw new Error(`unexpected provider call ${init.method} ${path}`)
    },
    signedPartUploader: async () => {
      signedUploadCalls++
      if (input.signedUploadThrows) throw new Error('ETag never-returned')
      return { ETag: 'etag-never-returned' }
    },
    waitForMediaReady: input.readyTimeout ? async () => ({ ok: false, kind: 'FAILED', status: null, error_code: 'FANVUE_MEDIA_READY_TIMEOUT', safe_error_message: 'timeout', attempts: 2, retryable: true }) : undefined,
  })
  return { result, identityCalls, fanvueCalls, signedUploadCalls }
}

function assertNoSensitiveLeak(value: unknown) {
  assert.doesNotMatch(JSON.stringify(value), /plain-access-token-never-returned|encrypted-access-token-never-returned|signed-upload-never-returned|upload-id-never-returned|323e4567|223e4567|etag-never-returned|username-never-returned|Authorization|Bearer|raw provider body|cookie|oauth|iVBOR/i)
}

function assertBoundaries(value: any) {
  assert.equal(value.post_attempted, false)
  assert.equal(value.dispatch_attempted, false)
  assert.equal(value.scheduled, false)
  assert.equal(value.public_exposure_attempted, false)
  assert.equal(value.platform_registry_changed, false)
}

async function run() {

  const preflightMissing = await runFanvueUploadDiagnosticPreflight({ userId }, { loadAccount: async () => null, now: () => new Date('2026-07-03T00:00:00.000Z') })
  assert.equal(preflightMissing.safe_code, 'FANVUE_UPLOAD_PREFLIGHT_ACCOUNT_NOT_FOUND')
  assert.equal(preflightMissing.will_call_fanvue, false)
  assert.equal(preflightMissing.will_decrypt_access_token, false)
  assert.equal(preflightMissing.will_create_upload_session, false)
  assert.equal(preflightMissing.will_request_signed_upload_url, false)
  assert.equal(preflightMissing.will_upload_bytes, false)
  assert.equal(preflightMissing.will_finalize_media, false)
  assert.equal(preflightMissing.will_poll_media_readiness, false)
  assert.equal(preflightMissing.will_post, false)
  assert.equal(preflightMissing.will_dispatch, false)
  assert.equal(preflightMissing.will_schedule, false)

  const preflightMissingScope = await runFanvueUploadDiagnosticPreflight({ userId }, { loadAccount: async () => ({ ...baseAccount, scopes: ['read:media', 'write:media'] }), now: () => new Date('2026-07-03T00:00:00.000Z') })
  assert.equal(preflightMissingScope.ready_for_live_upload_diagnostic_gate, false)
  assert.match(preflightMissingScope.blockers.join('|'), /write:creator scope missing/)

  const preflightExpired = await runFanvueUploadDiagnosticPreflight({ userId }, { loadAccount: async () => ({ ...baseAccount, token_expires_at: '2020-01-01T00:00:00.000Z' }), now: () => new Date('2026-07-03T00:00:00.000Z') })
  assert.equal(preflightExpired.token_freshness, 'stale_or_expired')
  assert.match(preflightExpired.blockers.join('|'), /access token freshness invalid/)

  const preflightReady = await runFanvueUploadDiagnosticPreflight({ userId }, { loadAccount: async () => ({ ...baseAccount, provider_username: 'provider-username-never-returned', encrypted_refresh_token: 'encrypted-refresh-never-returned', metadata: { provider: 'fanvue', identity_fetched: true, isCreator: true, raw: 'raw-never-returned' } }), now: () => new Date('2026-07-03T00:00:00.000Z') })
  assert.equal(preflightReady.ok, true)
  assert.equal(preflightReady.gate, 'FV-40DJ')
  assert.equal(preflightReady.ready_for_live_upload_diagnostic_gate, true)
  assert.equal(preflightReady.provider_account_id_present, true)
  assert.equal(preflightReady.provider_username_present, true)
  assert.equal(preflightReady.encrypted_access_token_present, true)
  assert.equal(preflightReady.encrypted_refresh_token_present, true)
  assert.equal(preflightReady.token_freshness, 'fresh')
  assertNoSensitiveLeak(preflightReady)

  const missing = await exercise({ account: null })
  assert.equal(missing.result.safe_code, 'FANVUE_UPLOAD_ACCOUNT_NOT_FOUND')
  assert.equal(missing.identityCalls.length, 0)

  const missingScope = await exercise({ account: { ...baseAccount, scopes: ['read:media', 'write:media'] } })
  assert.equal(missingScope.result.safe_code, 'FANVUE_UPLOAD_ACCOUNT_POSTURE_BLOCKED')
  assert.deepEqual(missingScope.result.blockers, ['write:creator scope missing'])
  assert.equal(missingScope.identityCalls.length, 0)

  const nonCreator = await exercise({ identityBody: { uuid: creatorUuid, isCreator: false } })
  assert.equal(nonCreator.result.safe_code, 'FANVUE_UPLOAD_IDENTITY_NOT_CREATOR')
  assert.equal(nonCreator.fanvueCalls.length, 0)

  const malformed = await exercise({ identityBody: 'not-record' })
  assert.equal(malformed.result.safe_code, 'FANVUE_UPLOAD_IDENTITY_NOT_CREATOR')

  const identityUnauthorized = await exercise({ identityStatus: 401 })
  assert.equal(identityUnauthorized.result.safe_code, 'FANVUE_UPLOAD_IDENTITY_PROVIDER_UNAUTHORIZED')
  assert.equal(identityUnauthorized.result.identity_provider_status_class, '4xx')

  const identityServer = await exercise({ identityStatus: 502 })
  assert.equal(identityServer.result.safe_code, 'FANVUE_UPLOAD_IDENTITY_PROVIDER_SERVER_ERROR')
  assert.equal(identityServer.result.identity_provider_status_class, '5xx')

  const mismatch = await exercise({ account: { ...baseAccount, provider_account_id: '423e4567-e89b-42d3-a456-426614174444' } })
  assert.equal(mismatch.result.safe_code, 'FANVUE_UPLOAD_CREATOR_UUID_MISMATCH')

  const createFailure = await exercise({ fanvueFailures: { '/media/uploads': 403 } })
  assert.equal(createFailure.result.safe_code, 'FANVUE_FORBIDDEN')
  assert.equal(createFailure.result.upload_session_attempted, true)
  assert.equal(createFailure.result.signed_upload_url_attempted, false)

  const signedFailure = await exercise({ fanvueFailures: { '/parts/1/url': 429 } })
  assert.equal(signedFailure.result.safe_code, 'FANVUE_RATE_LIMITED')
  assert.equal(signedFailure.result.signed_upload_url_provider_status_class, '4xx')

  const byteFailure = await exercise({ signedUploadThrows: true })
  assert.equal(byteFailure.result.safe_code, 'FANVUE_SIGNED_PART_UPLOAD_FAILED')
  assert.equal(byteFailure.result.byte_upload_attempted, true)

  const readyTimeout = await exercise({ readyTimeout: true })
  assert.equal(readyTimeout.result.safe_code, 'FANVUE_MEDIA_READY_TIMEOUT')
  assert.equal(readyTimeout.result.media_ready_class, 'timeout')

  const success = await exercise()
  assert.equal(success.result.ok, true)
  assert.equal(success.result.safe_code, 'FANVUE_UPLOAD_DIAGNOSTIC_OK')
  assert.equal(success.result.candidate_creator_user_uuid_source, 'top_level_uuid_confirmed_for_diagnostic_use')
  assert.equal(success.result.upload_session_attempted, true)
  assert.equal(success.result.signed_upload_url_attempted, true)
  assert.equal(success.result.byte_upload_attempted, true)
  assert.equal(success.result.media_finalize_attempted, true)
  assert.equal(success.result.media_lookup_attempted, true)
  assert.equal(success.signedUploadCalls, 1)
  assert(success.fanvueCalls.some((call) => call.method === 'POST' && new URL(call.url).pathname === `/creators/${creatorUuid}/media/uploads`))
  assert(success.fanvueCalls.some((call) => call.method === 'GET' && new URL(call.url).pathname === `/creators/${creatorUuid}/media/uploads/${uploadId}/parts/1/url`))

  for (const item of [missing, missingScope, nonCreator, malformed, identityUnauthorized, identityServer, mismatch, createFailure, signedFailure, byteFailure, readyTimeout, success]) {
    assertBoundaries(item.result)
    assertNoSensitiveLeak(item.result)
  }

  const source = readFileSync('lib/autopost/fanvueUploadDiagnostic.ts', 'utf8')
  assert.doesNotMatch(source, /createFanvueTextPost|createFanvueMediaPost|readFanvuePost|autopost\/run|platformRegistry/)
}

run().then(() => console.log('Fanvue upload diagnostic mocked tests passed'))
