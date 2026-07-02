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
  fetchThrows?: boolean
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
      if (input.fetchThrows) throw new Error('raw provider body with plain-new-access mock-client-secret https://signed-upload.invalid')
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
  assert.equal(success.fetchCalls[0].init.headers.authorization, undefined)
  assert.equal(success.fetchCalls[0].init.body.get('grant_type'), 'refresh_token')
  assert.equal(success.fetchCalls[0].init.body.get('client_id'), clientId)
  assert.equal(success.fetchCalls[0].init.body.get('client_secret'), clientSecret)
  assert.equal(success.fetchCalls[0].init.body.get('refresh_token'), 'plain-existing-refresh')
  assert.equal(success.fetchCalls[0].init.body.has('scope'), false)
  assert.equal(success.fetchCalls[0].init.body.has('redirect_uri'), false)
  assert.equal(success.fetchCalls[0].init.body.has('code_verifier'), false)
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
  assert.notEqual(rotated.persistCalls[0].updatePayload.encrypted_refresh_token, baseAccount.encrypted_refresh_token)

  const missingRotated = await runRefresh({ body: { access_token: 'plain-new-access', expires_in: 60, raw: 'raw provider body with plain-new-access mock-client-secret' } })
  assert.equal(missingRotated.result.ok, false)
  assert.equal(missingRotated.result.error_code, 'FANVUE_REFRESH_MISSING_ROTATED_TOKEN')
  assert.equal(missingRotated.result.provider_calls_attempted, true)
  assert.equal(missingRotated.result.provider_response_present, true)
  assert.equal(missingRotated.result.provider_status, 200)
  assert.equal(missingRotated.result.provider_status_class, '2xx')
  assert.equal(missingRotated.persistCalls.length, 0)
  assert.deepEqual(missingRotated.encrypted, [])
  assertSafe(missingRotated.result)

  const returnedScopes = await runRefresh({ body: { access_token: 'plain-new-access', refresh_token: 'plain-new-refresh', expires_in: 60, scope: 'write:media read:media write:media' } })
  assert.deepEqual(returnedScopes.persistCalls[0].updatePayload.scopes, ['write:media', 'read:media'])
  assert.ok(!(returnedScopes.persistCalls[0].updatePayload.scopes as string[]).includes('write:creator'), 'write:creator must not be added unless returned by provider')
  assert.deepEqual(baseAccount.scopes, ['read:media', 'write:media'], 'known posture: read:media is present, write:media is present, write:creator is absent')

  const providerWriteCreator = await runRefresh({ body: { access_token: 'plain-new-access', refresh_token: 'plain-new-refresh', expires_in: 60, scope: 'read:media write:media write:creator' } })
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

  const threwBeforeResponse = await runRefresh({ fetchThrows: true })
  assert.equal(threwBeforeResponse.result.ok, false)
  assert.equal(threwBeforeResponse.result.error_code, 'FANVUE_REFRESH_FAILED')
  assert.equal(threwBeforeResponse.result.safe_error_message, 'Fanvue token refresh request failed.')
  assert.equal(threwBeforeResponse.result.provider_calls_attempted, true)
  assert.equal(threwBeforeResponse.result.provider_response_present, false)
  assert.equal(threwBeforeResponse.result.provider_status, null)
  assert.equal(threwBeforeResponse.result.provider_status_class, null)
  assert.equal(threwBeforeResponse.result.provider_error_code, null)
  assert.equal(threwBeforeResponse.persistCalls.length, 0)
  assertSafe(threwBeforeResponse.result)

  const nonOkSafeError = await runRefresh({ status: 502, body: { error: 'temporarily_unavailable', error_description: 'raw provider body with plain-new-access' } })
  assert.equal(nonOkSafeError.result.ok, false)
  assert.equal(nonOkSafeError.result.error_code, 'FANVUE_REFRESH_FAILED')
  assert.equal(nonOkSafeError.result.provider_response_present, true)
  assert.equal(nonOkSafeError.result.provider_status, 502)
  assert.equal(nonOkSafeError.result.provider_status_class, '5xx')
  assert.equal(nonOkSafeError.result.provider_error_code, 'temporarily_unavailable')
  assert.equal(nonOkSafeError.persistCalls.length, 0)
  assertSafe(nonOkSafeError.result)

  const nonOkUnsafeError = await runRefresh({ status: 429, body: { error_code: 'unsafe raw provider body with https://signed-upload.invalid/plain-new-access and mock-client-secret' } })
  assert.equal(nonOkUnsafeError.result.ok, false)
  assert.equal(nonOkUnsafeError.result.error_code, 'FANVUE_REFRESH_FAILED')
  assert.equal(nonOkUnsafeError.result.provider_response_present, true)
  assert.equal(nonOkUnsafeError.result.provider_status, 429)
  assert.equal(nonOkUnsafeError.result.provider_status_class, '4xx')
  assert.equal(nonOkUnsafeError.result.provider_error_code, null)
  assert.equal(nonOkUnsafeError.persistCalls.length, 0)
  assertSafe(nonOkUnsafeError.result)

  for (const status of [400, 401, 403, 500] as const) {
    const failed = await runRefresh({ status, body: { error_code: 'invalid_grant', error_description: 'raw provider body', access_token: 'plain-new-access' } })
    assert.equal(failed.result.ok, false)
    assert.equal(failed.result.error_code, 'FANVUE_REFRESH_INVALID_GRANT_REAUTH_REQUIRED')
    assert.equal(failed.result.provider_calls_attempted, true)
    assert.equal(failed.result.provider_response_present, true)
    assert.equal(failed.result.provider_status, status)
    assert.equal(failed.result.provider_status_class, `${Math.floor(status / 100)}xx`)
    assert.equal(failed.result.provider_error_code, 'invalid_grant')
    assert.equal(failed.result.requires_oauth_reconnect, true)
    assert.equal(failed.fetchCalls.length, 1)
    assert.equal(failed.persistCalls.length, 0)
    assertSafe(failed.result)
  }

  for (const body of [
    { refresh_token: 'plain-new-refresh', expires_in: 60 },
    { access_token: '', expires_in: 60 },
    { access_token: 'plain-new-access', refresh_token: 'plain-new-refresh', expires_in: 0 },
    { access_token: 'plain-new-access', refresh_token: 'plain-new-refresh', expires_in: -1 },
    { access_token: 'plain-new-access', refresh_token: 'plain-new-refresh', expires_in: '3600' },
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
  assert.match(adminUpload, /refreshFanvueAccessToken/, 'FV-40O wires refresh helper into upload-only admin path')
  assert.match(adminUpload, /fanvueTokenRefresh/, 'FV-40O imports the Fanvue refresh helper in the upload-only admin path')
  assert.doesNotMatch(adminUpload, /grant_type:\s*["']refresh_token/, 'upload-only admin path must delegate token payload construction to the helper')

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
