import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runFanvueMediaReadinessDiagnostic, FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG, type FanvueMediaReadinessDiagnosticResult } from '../../../lib/autopost/fanvueMediaReadinessDiagnostic'
import type { FanvueUploadDiagnosticAccount } from '../../../lib/autopost/fanvueUploadDiagnostic'
import type { FanvueFetchResponse } from '../../../lib/autopost/fanvueApiClientCore'

const userId = '123e4567-e89b-42d3-a456-426614174000'
const creatorUuid = '223e4567-e89b-42d3-a456-426614174111'
const encryptedAccessToken = 'encrypted-access-token-never-returned'
const plainAccessToken = 'plain-access-token-never-returned'
const signedUrl = 'https://signed-upload-never-returned.example/upload?secret=never'
const uploadId = 'upload-id-never-returned'
const mediaUuid = '323e4567-e89b-42d3-a456-426614174222'
const otherMediaUuid = '423e4567-e89b-42d3-a456-426614174333'

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

type Readback = { status: number; data?: unknown; throws?: boolean }
type RunInput = { account?: FanvueUploadDiagnosticAccount | null; identityStatus?: number; identityBody?: unknown; fanvueFailures?: Record<string, number>; readbacks?: Readback[]; signedUploadThrows?: boolean }

function jsonResponse(status: number, body: unknown): FanvueFetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => typeof body === 'string' ? body : JSON.stringify(body), headers: { get: () => null } }
}

async function exercise(input: RunInput = {}) {
  const identityCalls: string[] = []
  const fanvueCalls: Array<{ url: string; method: string }> = []
  const sleeps: number[] = []
  let signedUploadCalls = 0
  const readbacks = [...(input.readbacks ?? [{ status: 200, data: { uuid: mediaUuid, status: 'ready', mediaType: 'image', name: 'safe image' } }])]
  const result = await runFanvueMediaReadinessDiagnostic({ userId }, {
    apiBaseUrl: 'https://api.fanvue.test',
    apiVersion: '2025-06-26',
    now: () => new Date('2026-07-03T00:00:00.000Z'),
    sleep: async (ms) => { sleeps.push(ms) },
    loadAccount: async () => input.account === undefined ? baseAccount : input.account,
    decryptAccessToken: () => plainAccessToken,
    fetchIdentity: async (url) => {
      identityCalls.push(url)
      const status = input.identityStatus ?? 200
      return { ok: status >= 200 && status < 300, status, json: async () => input.identityBody ?? { uuid: creatorUuid, isCreator: true, username: 'username-never-returned' } }
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
      if (init.method === 'GET' && path === `/media/${mediaUuid}`) {
        const next = readbacks.shift() ?? readbacks[readbacks.length - 1] ?? { status: 200, data: { uuid: mediaUuid, status: 'processing' } }
        if (next.throws) throw new Error('network raw provider body never returned')
        return jsonResponse(next.status, next.data ?? { raw: 'raw provider body never returned', signed_url: signedUrl })
      }
      throw new Error(`unexpected provider call ${init.method} ${path}`)
    },
    signedPartUploader: async ({ body }) => {
      signedUploadCalls++
      assert(body instanceof Buffer)
      if (input.signedUploadThrows) throw new Error('ETag never-returned')
      return { ETag: 'etag-never-returned' }
    },
  })
  return { result, identityCalls, fanvueCalls, signedUploadCalls, sleeps }
}

function assertNoSensitiveLeak(value: unknown) {
  assert.doesNotMatch(JSON.stringify(value), /plain-access-token-never-returned|encrypted-access-token-never-returned|signed-upload-never-returned|upload-id-never-returned|323e4567|223e4567|423e4567|etag-never-returned|username-never-returned|Authorization|Bearer|raw provider body|cookie|oauth|iVBOR/i)
}

function assertBoundaries(value: FanvueMediaReadinessDiagnosticResult) {
  assert.equal(value.post_attempted, false)
  assert.equal(value.dispatch_attempted, false)
  assert.equal(value.scheduled, false)
  assert.equal(value.public_exposure_attempted, false)
  assert.equal(value.platform_registry_changed, false)
}

async function run() {
  assert.equal(FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG.subarray(1, 4).toString('ascii'), 'PNG')
  assert(FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG.length > 1_000)
  assert(FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG.length < 20_000)

  const missing = await exercise({ account: null })
  assert.equal(missing.result.safe_code, 'FANVUE_MEDIA_READINESS_ACCOUNT_NOT_FOUND')
  assert.equal(missing.identityCalls.length, 0)

  const missingScope = await exercise({ account: { ...baseAccount, scopes: ['read:media', 'write:media'] } })
  assert.equal(missingScope.result.safe_code, 'FANVUE_MEDIA_READINESS_ACCOUNT_POSTURE_BLOCKED')
  assert.deepEqual(missingScope.result.blockers, ['write:creator scope missing'])

  const nonCreator = await exercise({ identityBody: { uuid: creatorUuid, isCreator: false } })
  assert.equal(nonCreator.result.safe_code, 'FANVUE_MEDIA_READINESS_IDENTITY_NOT_CREATOR')
  assert.equal(nonCreator.fanvueCalls.length, 0)

  const mismatch = await exercise({ account: { ...baseAccount, provider_account_id: otherMediaUuid } })
  assert.equal(mismatch.result.safe_code, 'FANVUE_MEDIA_READINESS_CREATOR_UUID_MISMATCH')

  const createFailure = await exercise({ fanvueFailures: { '/media/uploads': 403 } })
  assert.equal(createFailure.result.safe_code, 'FANVUE_FORBIDDEN')
  assert.equal(createFailure.result.upload_session_attempted, true)
  assert.equal(createFailure.result.signed_upload_url_attempted, false)

  const success = await exercise()
  assert.equal(success.result.ok, true)
  assert.equal(success.result.safe_code, 'FANVUE_MEDIA_READINESS_READY')
  assert.equal(success.result.media_readiness_class, 'ready')
  assert.equal(success.result.media_lookup_route_family, 'general_media_uuid')
  assert.equal(success.result.creator_scoped_read_route_supported_by_source, false)
  assert.equal(success.result.readiness_attempts, 1)
  assert.equal(success.signedUploadCalls, 1)

  const timeout = await exercise({ readbacks: Array.from({ length: 6 }, () => ({ status: 200, data: { uuid: mediaUuid, status: 'processing' } })) })
  assert.equal(timeout.result.safe_code, 'FANVUE_MEDIA_READINESS_PROCESSING_TIMEOUT')
  assert.equal(timeout.result.media_readiness_class, 'processing_timeout')
  assert.equal(timeout.result.readiness_attempts, 6)
  assert.deepEqual(timeout.sleeps, [5000, 5000, 5000, 5000, 5000])

  const terminal = await exercise({ readbacks: [{ status: 200, data: { uuid: mediaUuid, status: 'error' } }] })
  assert.equal(terminal.result.safe_code, 'FANVUE_MEDIA_READINESS_TERMINAL_PROVIDER_ERROR')
  assert.equal(terminal.result.media_readiness_class, 'terminal_provider_error')

  const forbidden = await exercise({ readbacks: [{ status: 403 }] })
  assert.equal(forbidden.result.safe_code, 'FANVUE_MEDIA_READINESS_READ_FORBIDDEN')
  assert.equal(forbidden.result.media_readiness_class, 'read_route_forbidden')

  const notFound = await exercise({ readbacks: Array.from({ length: 6 }, () => ({ status: 404 })) })
  assert.equal(notFound.result.safe_code, 'FANVUE_MEDIA_READINESS_ROUTE_OR_ID_MISMATCH_SUSPECTED')
  assert.equal(notFound.result.media_readiness_class, 'route_or_id_mismatch_suspected')

  const mismatchRead = await exercise({ readbacks: [{ status: 200, data: { uuid: otherMediaUuid, status: 'ready' } }] })
  assert.equal(mismatchRead.result.safe_code, 'FANVUE_MEDIA_READINESS_ROUTE_OR_ID_MISMATCH_SUSPECTED')

  for (const data of [{ uuid: mediaUuid }, { uuid: mediaUuid, state: 'ready' }, { id: mediaUuid, status: 'ready' }, { uuid: mediaUuid, status: 'available' }]) {
    const malformed = await exercise({ readbacks: [{ status: 200, data }] })
    assert.equal(malformed.result.safe_code, 'FANVUE_MEDIA_READINESS_READBACK_MALFORMED')
    assert.equal(malformed.result.media_readiness_class, 'malformed_readback')
  }

  const rateLimitedReady = await exercise({ readbacks: [{ status: 429 }, { status: 200, data: { uuid: mediaUuid, status: 'ready' } }] })
  assert.equal(rateLimitedReady.result.safe_code, 'FANVUE_MEDIA_READINESS_READY')
  assert.equal(rateLimitedReady.result.media_readiness_class, 'ready')

  const rateLimited = await exercise({ readbacks: Array.from({ length: 6 }, () => ({ status: 429 })) })
  assert.equal(rateLimited.result.safe_code, 'FANVUE_MEDIA_READINESS_RATE_LIMITED')
  assert.equal(rateLimited.result.media_readiness_class, 'rate_limited')

  const network = await exercise({ readbacks: [{ status: 500, throws: true }] })
  assert.equal(network.result.safe_code, 'FANVUE_MEDIA_READINESS_TRANSIENT_PROVIDER_FAILURE')
  assert.equal(network.result.media_readiness_class, 'transient_provider_failure')

  const server = await exercise({ readbacks: [{ status: 502 }] })
  assert.equal(server.result.safe_code, 'FANVUE_MEDIA_READINESS_TRANSIENT_PROVIDER_FAILURE')

  const unknown = await exercise({ readbacks: [{ status: 418 }] })
  assert.equal(unknown.result.safe_code, 'FANVUE_MEDIA_READINESS_UNKNOWN_PROVIDER_FAILURE')
  assert.equal(unknown.result.media_readiness_class, 'unknown_provider_failure')

  for (const item of [missing, missingScope, nonCreator, mismatch, createFailure, success, timeout, terminal, forbidden, notFound, mismatchRead, rateLimitedReady, rateLimited, network, server, unknown]) {
    assertBoundaries(item.result)
    assertNoSensitiveLeak(item.result)
  }

  const source = readFileSync('lib/autopost/fanvueMediaReadinessDiagnostic.ts', 'utf8')
  assert.doesNotMatch(source, /createFanvueTextPost|createFanvueMediaPost|readFanvuePost|autopost\/run|platformRegistry/)
}

run().then(() => console.log('Fanvue media readiness diagnostic mocked tests passed'))
