import assert from 'node:assert/strict'
import {
  inspectFanvueIdentityShape,
  runFanvueIdentityOnlyDiagnostic,
  type FanvueIdentityDiagnosticAccount,
  type FanvueIdentityFetchResponse,
} from '../../../lib/autopost/fanvueIdentityDiagnostic'

const userId = '123e4567-e89b-42d3-a456-426614174000'
const validUuid = '223e4567-e89b-42d3-a456-426614174111'
const encryptedAccessToken = 'encrypted-access-token-never-returned'
const plainAccessToken = 'plain-access-token-never-returned'

const baseAccount: FanvueIdentityDiagnosticAccount = {
  user_id: userId,
  platform: 'fanvue',
  connection_status: 'CONNECTED',
  provider_account_id: 'provider-account-never-returned',
  provider_username: 'provider-username-never-returned',
  scopes: ['read:media', 'write:media'],
  encrypted_access_token: encryptedAccessToken,
  token_expires_at: '2999-01-01T00:00:00.000Z',
  token_type: 'bearer',
  token_key_version: 1,
  metadata: { provider: 'fanvue', identity_fetched: true, raw: 'metadata-never-returned' },
}

type RunInput = {
  account?: FanvueIdentityDiagnosticAccount | null
  providerStatus?: number
  providerBody?: unknown
  providerJsonThrows?: boolean
  fetchThrows?: boolean
  decryptThrows?: boolean
}

function response(input: { status?: number; body?: unknown; jsonThrows?: boolean }): FanvueIdentityFetchResponse {
  const status = input.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (input.jsonThrows) throw new Error('raw provider body plain-access-token-never-returned')
      return input.body ?? { uuid: validUuid, isCreator: true, creator: { userUuid: validUuid } }
    },
  }
}

async function exercise(input: RunInput = {}) {
  const fetchCalls: Array<{ url: string; init: { method: 'GET'; headers: Record<string, string> } }> = []
  const result = await runFanvueIdentityOnlyDiagnostic(
    { userId },
    {
      apiBaseUrl: 'https://api.fanvue.test',
      apiVersion: '2025-06-26',
      now: () => new Date('2026-07-03T00:00:00.000Z'),
      loadAccount: async (targetUserId) => {
        assert.equal(targetUserId, userId)
        return input.account === undefined ? baseAccount : input.account
      },
      decryptAccessToken: () => {
        if (input.decryptThrows) throw new Error('encrypted access token should not leak')
        return plainAccessToken
      },
      fetchIdentity: async (url, init) => {
        fetchCalls.push({ url, init })
        if (input.fetchThrows) throw new Error('Authorization Bearer should not leak')
        return response({ status: input.providerStatus, body: input.providerBody, jsonThrows: input.providerJsonThrows })
      },
    },
  )
  return { result, fetchCalls }
}

function assertBoundaryFlags(value: any) {
  assert.equal(value.upload_attempted, false)
  assert.equal(value.signed_upload_url_attempted, false)
  assert.equal(value.byte_upload_attempted, false)
  assert.equal(value.media_finalize_attempted, false)
  assert.equal(value.media_lookup_attempted, false)
  assert.equal(value.post_attempted, false)
  assert.equal(value.dispatch_attempted, false)
  assert.equal(value.scheduled, false)
  assert.equal(value.platform_post_id, null)
  assert.equal(value.posted_proof, false)
}

function assertNoSensitiveLeak(value: unknown) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(
    serialized,
    /plain-access-token-never-returned|encrypted-access-token-never-returned|provider-account-never-returned|provider-username-never-returned|metadata-never-returned|Authorization|Bearer|client-secret|raw provider body|email@example\.test|signed-upload|uploadId|mediaUuid|post uuid/i,
  )
}

async function run() {
  const missing = await exercise({ account: null })
  assert.equal(missing.result.ok, false)
  assert.equal(missing.result.safe_code, 'FANVUE_IDENTITY_ACCOUNT_NOT_FOUND')
  assert.equal(missing.fetchCalls.length, 0)
  assertBoundaryFlags(missing.result)
  assertNoSensitiveLeak(missing.result)

  const nonFanvue = await exercise({ account: { ...baseAccount, platform: 'x' } })
  assert.equal(nonFanvue.result.safe_code, 'FANVUE_IDENTITY_ACCOUNT_PLATFORM_INVALID')
  assert.equal(nonFanvue.fetchCalls.length, 0)
  assertBoundaryFlags(nonFanvue.result)

  const disconnected = await exercise({ account: { ...baseAccount, connection_status: 'DISCONNECTED' } })
  assert.equal(disconnected.result.safe_code, 'FANVUE_IDENTITY_ACCOUNT_NOT_CONNECTED')
  assert.equal(disconnected.fetchCalls.length, 0)

  const missingToken = await exercise({ account: { ...baseAccount, encrypted_access_token: null } })
  assert.equal(missingToken.result.safe_code, 'FANVUE_IDENTITY_ACCESS_TOKEN_MISSING')
  assert.equal(missingToken.result.provider_calls_attempted, false)
  assert.equal(missingToken.result.identity_layer_reached, false)
  assert.equal(missingToken.result.requires_oauth_reconnect, false)
  assert.equal(missingToken.fetchCalls.length, 0)

  const expired = await exercise({ account: { ...baseAccount, token_expires_at: '2026-07-02T00:00:00.000Z' } })
  assert.equal(expired.result.safe_code, 'FANVUE_IDENTITY_ACCESS_TOKEN_EXPIRED_REFRESH_NOT_ATTEMPTED')
  assert.equal(expired.result.provider_calls_attempted, false)
  assert.equal(expired.result.identity_layer_reached, false)
  assert.equal(expired.result.requires_oauth_reconnect, false)
  assert.equal(expired.fetchCalls.length, 0)

  const decryptFailed = await exercise({ decryptThrows: true })
  assert.equal(decryptFailed.result.safe_code, 'FANVUE_IDENTITY_ACCESS_TOKEN_DECRYPT_FAILED')
  assert.equal(decryptFailed.fetchCalls.length, 0)
  assertNoSensitiveLeak(decryptFailed.result)

  const success = await exercise({
    providerBody: {
      uuid: '323e4567-e89b-42d3-a456-426614174222',
      id: 'not-selected',
      userUuid: '423e4567-e89b-42d3-a456-426614174333',
      email: 'email@example.test',
      username: 'private-user-never-returned',
      isCreator: true,
      account: { present: true },
      creator: { uuid: '523e4567-e89b-42d3-a456-426614174444', id: '623e4567-e89b-42d3-a456-426614174555', userUuid: validUuid },
    },
  })
  assert.equal(success.result.ok, true)
  assert.equal(success.result.gate, 'FV-40CO')
  assert.equal(success.result.mode, 'fanvue_identity_only_diagnostic')
  assert.equal(success.result.safe_code, 'FANVUE_IDENTITY_SHAPE_INSPECTED')
  assert.equal(success.result.identity_layer_reached, true)
  assert.equal(success.result.provider_calls_attempted, true)
  assert.equal(success.result.identity_response_present, true)
  assert.equal(success.result.provider_status_class, '2xx')
  assert.equal(success.result.has_top_level_uuid, true)
  assert.equal(success.result.has_top_level_id, true)
  assert.equal(success.result.has_top_level_userUuid, true)
  assert.equal(success.result.has_creator_object, true)
  assert.equal(success.result.has_creator_uuid, true)
  assert.equal(success.result.has_creator_id, true)
  assert.equal(success.result.has_creator_userUuid, true)
  assert.equal(success.result.has_isCreator, true)
  assert.equal(success.result.has_account, true)
  assert.equal(success.result.has_creator, true)
  assert.equal(success.result.candidate_creator_user_uuid_source, 'creator_userUuid')
  assert.equal(success.result.candidate_creator_user_uuid_present, true)
  assert.equal(success.result.candidate_creator_user_uuid_format_valid, true)
  assert.equal(success.fetchCalls.length, 1)
  assert.equal(success.fetchCalls[0].url, 'https://api.fanvue.test/users/account')
  assert.equal(success.fetchCalls[0].init.method, 'GET')
  assert.equal(success.fetchCalls[0].init.headers['X-Fanvue-API-Version'], '2025-06-26')
  assert.match(success.fetchCalls[0].init.headers.authorization, /^Bearer /)
  assertBoundaryFlags(success.result)
  assertNoSensitiveLeak(success.result)
  assert.doesNotMatch(JSON.stringify(success.result), new RegExp(validUuid))

  assert.equal(inspectFanvueIdentityShape({ uuid: validUuid })?.candidate_creator_user_uuid_source, 'top_level_uuid')
  assert.equal(inspectFanvueIdentityShape({ id: validUuid })?.candidate_creator_user_uuid_source, 'top_level_id')
  assert.equal(inspectFanvueIdentityShape({ userUuid: validUuid })?.candidate_creator_user_uuid_source, 'top_level_userUuid')
  assert.equal(inspectFanvueIdentityShape({ creator: { uuid: validUuid } })?.candidate_creator_user_uuid_source, 'creator_uuid')
  assert.equal(inspectFanvueIdentityShape({ creator: { id: validUuid } })?.candidate_creator_user_uuid_source, 'creator_id')
  assert.equal(inspectFanvueIdentityShape({ creator: { userUuid: validUuid } })?.candidate_creator_user_uuid_source, 'creator_userUuid')
  assert.equal(inspectFanvueIdentityShape({ creator: { userUuid: 'not-a-uuid' } })?.candidate_creator_user_uuid_format_valid, false)
  const noCandidate = inspectFanvueIdentityShape({ isCreator: false })
  assert.equal(noCandidate?.candidate_creator_user_uuid_present, false)
  assert.equal(noCandidate?.candidate_creator_user_uuid_source, null)

  for (const [status, code] of [
    [401, 'FANVUE_IDENTITY_PROVIDER_UNAUTHORIZED'],
    [403, 'FANVUE_IDENTITY_PROVIDER_FORBIDDEN'],
    [429, 'FANVUE_IDENTITY_PROVIDER_RATE_LIMITED'],
    [502, 'FANVUE_IDENTITY_PROVIDER_SERVER_ERROR'],
  ] as const) {
    const failed = await exercise({ providerStatus: status })
    assert.equal(failed.result.ok, false)
    assert.equal(failed.result.safe_code, code)
    assert.equal(failed.result.provider_calls_attempted, true)
    assert.equal(failed.result.identity_layer_reached, true)
    assert.equal(failed.fetchCalls.length, 1)
    assertBoundaryFlags(failed.result)
    assertNoSensitiveLeak(failed.result)
  }

  const malformed = await exercise({ providerBody: 'not-record' })
  assert.equal(malformed.result.safe_code, 'FANVUE_IDENTITY_RESPONSE_MALFORMED')
  assert.equal(malformed.result.identity_response_present, true)
  assertNoSensitiveLeak(malformed.result)

  const jsonThrows = await exercise({ providerJsonThrows: true })
  assert.equal(jsonThrows.result.safe_code, 'FANVUE_IDENTITY_RESPONSE_MALFORMED')
  assert.equal(jsonThrows.result.identity_response_present, false)
  assertNoSensitiveLeak(jsonThrows.result)

  const fetchThrows = await exercise({ fetchThrows: true })
  assert.equal(fetchThrows.result.safe_code, 'FANVUE_IDENTITY_PROVIDER_REQUEST_FAILED')
  assertNoSensitiveLeak(fetchThrows.result)
}

run().then(() => console.log('Fanvue identity diagnostic mocked tests passed'))
