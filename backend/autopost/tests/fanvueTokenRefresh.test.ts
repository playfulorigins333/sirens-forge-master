import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { refreshFanvueAccessToken, type FanvueRefreshAccount } from '../../../lib/autopost/fanvueTokenRefresh'

const tokenUrl = 'https://oauth.mock.fanvue.example/token'
const clientId = 'mock-client-id'
const clientSecret = 'mock-client-secret'
const now = new Date('2026-07-01T00:00:00.000Z')

const baseAccount: FanvueRefreshAccount = {
  user_id: '123e4567-489b-42d3-a456-426614174000',
  platform: 'fanvue',
  encrypted_refresh_token: 'enc-existing-refresh',
  token_expires_at: '2026-07-01T00:10:00.000Z',
  token_type: 'bearer',
  token_key_version: 1,
  scopes: ['read:media', 'write:media'],
}

type FetchCall = { url: string; init: { method: string; headers: Record<string, string>; body: URLSearchParams } }
type PersistCall = { userId: string; updatePayload: Record<string, unknown> }

function assertSafe(result: unknown) {
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /plain-existing-refresh|plain-new-access|plain-new-refresh|enc-existing-refresh|enc:plain|mock-client-secret|Authorization:|Authorization=|Basic [A-Za-z0-9+/=]+|raw provider body|signed-upload|X-Amz-Signature/i)
}

async function runRefresh(input: {
  account?: FanvueRefreshAccount
  status?: number
  body?: unknown
  jsonThrows?: boolean
  persistError?: unknown
}) {
  const fetchCalls: FetchCall[] = []
  const persistCalls: PersistCall[] = []
  const decrypted: string[] = []
  const encrypted: string[] = []
  const result = await refreshFanvueAccessToken(input.account ?? baseAccount, {
    tokenUrl,
    clientId,
    clientSecret,
    now: () => now,
    getTokenKeyVersion: () => 7,
    decryptToken: (encryptedToken) => {
      decrypted.push(encryptedToken)
      if (encryptedToken === 'decrypt-fails') throw new Error('mock decrypt failure')
      return 'plain-existing-refresh'
    },
    encryptToken: (token) => {
      encrypted.push(token)
      return `enc:${token}`
    },
    fetch: async (url, init) => {
      assert.doesNotMatch(url, /api\.fanvue\.com/, 'refresh tests must not call live Fanvue API')
      assert.doesNotMatch(url, /\/media\/uploads|\/posts|\/users\/account|\/me|\/self/i, 'refresh helper tests must not call upload, posts, or identity routes')
      fetchCalls.push({ url, init })
      if (input.jsonThrows) return { ok: true, status: 200, json: async () => { throw new Error('invalid json') } }
      const status = input.status ?? 200
      return { ok: status >= 200 && status < 300, status, json: async () => input.body ?? { access_token: 'plain-new-access', refresh_token: 'plain-new-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'read:media write:media' } }
    },
    persistRefresh: async (call) => {
      persistCalls.push(call)
      return input.persistError ? { error: input.persistError } : undefined
    },
  })
  return { result, fetchCalls, persistCalls, decrypted, encrypted }
}

async function run() {
  const success = await runRefresh({})
  assert.equal(success.result.ok, true)
  assert.equal(success.fetchCalls.length, 1)
  assert.equal(success.fetchCalls[0].url, tokenUrl)
  assert.notEqual(new URL(success.fetchCalls[0].url).hostname, 'api.fanvue.com')
  assert.equal(success.fetchCalls[0].init.method, 'POST')
  assert.equal(success.fetchCalls[0].init.headers['content-type'], 'application/x-www-form-urlencoded')
  assert.match(success.fetchCalls[0].init.headers.authorization, /^Basic /)
  assert.equal(success.fetchCalls[0].init.body.get('grant_type'), 'refresh_token')
  assert.equal(success.fetchCalls[0].init.body.get('refresh_token'), 'plain-existing-refresh')
  assert.deepEqual(success.decrypted, ['enc-existing-refresh'])
  assert.deepEqual(success.encrypted, ['plain-new-access', 'plain-new-refresh'])
  assert.equal(success.persistCalls.length, 1)
  assert.equal(success.persistCalls[0].userId, baseAccount.user_id)
  assert.deepEqual(success.persistCalls[0].updatePayload, {
    encrypted_access_token: 'enc:plain-new-access',
    encrypted_refresh_token: 'enc:plain-new-refresh',
    token_expires_at: '2026-07-01T01:00:00.000Z',
    token_type: 'Bearer',
    token_key_version: 7,
    scopes: ['read:media', 'write:media'],
    last_refresh_at: now.toISOString(),
    last_error: null,
    connection_status: 'CONNECTED',
  })
  assertSafe(success.result)

  const rotated = await runRefresh({ body: { access_token: 'plain-new-access', refresh_token: 'plain-new-refresh-2', expires_in: 60 } })
  assert.equal(rotated.persistCalls[0].updatePayload.encrypted_refresh_token, 'enc:plain-new-refresh-2')

  const preserved = await runRefresh({ body: { access_token: 'plain-new-access', expires_in: 60 } })
  assert.equal(preserved.persistCalls[0].updatePayload.encrypted_refresh_token, 'enc-existing-refresh')
  assert.deepEqual(preserved.persistCalls[0].updatePayload.scopes, ['read:media', 'write:media'])

  const returnedScopes = await runRefresh({ body: { access_token: 'plain-new-access', expires_in: 60, scope: 'write:media read:media write:media' } })
  assert.deepEqual(returnedScopes.persistCalls[0].updatePayload.scopes, ['write:media', 'read:media'])
  assert.ok(!(returnedScopes.persistCalls[0].updatePayload.scopes as string[]).includes('write:creator'), 'write:creator must not be added unless returned by provider')
  assert.deepEqual(baseAccount.scopes, ['read:media', 'write:media'], 'known posture: read:media is present, write:media is present, write:creator is absent')

  const providerWriteCreator = await runRefresh({ body: { access_token: 'plain-new-access', expires_in: 60, scope: 'read:media write:media write:creator' } })
  assert.deepEqual(providerWriteCreator.persistCalls[0].updatePayload.scopes, ['read:media', 'write:media', 'write:creator'], 'provider-returned write:creator can be stored but is not invented')

  for (const account of [{ ...baseAccount, encrypted_refresh_token: null }, { ...baseAccount, encrypted_refresh_token: '' }]) {
    const missing = await runRefresh({ account })
    assert.equal(missing.result.ok, false)
    assert.equal(missing.result.error_code, 'FANVUE_REFRESH_TOKEN_MISSING')
    assert.equal(missing.result.provider_calls_attempted, false)
    assert.equal(missing.fetchCalls.length, 0)
    assert.equal(missing.persistCalls.length, 0)
    assertSafe(missing.result)
  }

  const invalidPlatform = await runRefresh({ account: { ...baseAccount, platform: 'x' } })
  assert.equal(invalidPlatform.result.ok, false)
  assert.equal(invalidPlatform.result.error_code, 'FANVUE_ACCOUNT_PLATFORM_INVALID')
  assert.equal(invalidPlatform.fetchCalls.length, 0)

  const decryptFailed = await runRefresh({ account: { ...baseAccount, encrypted_refresh_token: 'decrypt-fails' } })
  assert.equal(decryptFailed.result.ok, false)
  assert.equal(decryptFailed.result.error_code, 'FANVUE_REFRESH_TOKEN_DECRYPT_FAILED')
  assert.equal(decryptFailed.fetchCalls.length, 0)
  assertSafe(decryptFailed.result)

  for (const status of [400, 401, 403, 500] as const) {
    const failed = await runRefresh({ status, body: { error: 'raw provider body', access_token: 'plain-new-access' } })
    assert.equal(failed.result.ok, false)
    assert.equal(failed.result.error_code, status === 500 ? 'FANVUE_REFRESH_FAILED' : 'FANVUE_REFRESH_UNAUTHORIZED')
    assert.equal(failed.result.provider_calls_attempted, true)
    assert.equal(failed.persistCalls.length, 0)
    assertSafe(failed.result)
  }

  for (const body of [
    { refresh_token: 'plain-new-refresh', expires_in: 60 },
    { access_token: '', expires_in: 60 },
    { access_token: 'plain-new-access', expires_in: 0 },
    { access_token: 'plain-new-access', expires_in: -1 },
    { access_token: 'plain-new-access', expires_in: '3600' },
  ]) {
    const invalid = await runRefresh({ body })
    assert.equal(invalid.result.ok, false)
    assert.equal(invalid.result.error_code, 'FANVUE_REFRESH_RESPONSE_INVALID')
    assert.equal(invalid.persistCalls.length, 0)
    assertSafe(invalid.result)
  }

  const invalidJson = await runRefresh({ jsonThrows: true })
  assert.equal(invalidJson.result.ok, false)
  assert.equal(invalidJson.result.error_code, 'FANVUE_REFRESH_RESPONSE_INVALID')
  assert.equal(invalidJson.persistCalls.length, 0)

  const persistFailure = await runRefresh({ persistError: { message: 'raw provider body with plain-new-access and mock-client-secret' } })
  assert.equal(persistFailure.result.ok, false)
  assert.equal(persistFailure.result.error_code, 'FANVUE_REFRESH_PERSIST_FAILED')
  assert.equal(persistFailure.persistCalls.length, 1)
  assertSafe(persistFailure.result)

  const adminUpload = readFileSync('backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts', 'utf8')
  assert.doesNotMatch(adminUpload, /refreshFanvueAccessToken|fanvueTokenRefresh|FANVUE_OAUTH_TOKEN_URL|grant_type:\s*["']refresh_token/, 'FV-40N must not wire refresh into upload-only admin path')
  assert.doesNotMatch(adminUpload, /from ["'].*fanvueTokenRefresh["']/, 'upload-only admin path must not import Fanvue refresh helper yet')

  for (const unchanged of [
    'app/api/autopost/run/route.ts',
    'app/autopost/AutopostPageClient.tsx',
    'lib/autopost/platformAvailability.ts',
    'lib/autopost/platformRegistry.ts',
  ]) {
    const source = readFileSync(unchanged, 'utf8')
    assert.ok(source.length > 0)
    assert.doesNotMatch(source, /refreshFanvueAccessToken|fanvueTokenRefresh/, `${unchanged} must not wire Fanvue refresh, dispatch, public selectability, or scheduling`)
  }
}

run().then(() => console.log('Fanvue token refresh mocked tests passed'))
