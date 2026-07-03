import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  runFanvueRefreshOnlyDiagnostic,
  type FanvueRefreshDiagnosticAccount,
} from '../../../lib/autopost/fanvueRefreshDiagnostic'
import type { FanvueRefreshAccount, FanvueTokenRefreshResult } from '../../../lib/autopost/fanvueTokenRefresh'

const userId = '123e4567-489b-42d3-a456-426614174000'

const baseAccount: FanvueRefreshDiagnosticAccount = {
  user_id: userId,
  platform: 'fanvue',
  connection_status: 'CONNECTED',
  provider_account_id: 'fanvue-account-1',
  metadata: { provider: 'fanvue', identity_fetched: true },
  encrypted_refresh_token: 'enc-refresh-token-placeholder',
  token_expires_at: '2026-07-01T00:10:00.000Z',
  token_type: 'bearer',
  token_key_version: 1,
  last_refresh_at: null,
  scopes: ['read:media', 'write:media'],
}

type RunInput = {
  account?: FanvueRefreshDiagnosticAccount | null
  refreshResult?: FanvueTokenRefreshResult
  loadThrows?: boolean
}

function assertUploadNegativeFlags(result: Awaited<ReturnType<typeof runFanvueRefreshOnlyDiagnostic>>) {
  assert.equal(result.gate, 'FV-40AR')
  assert.equal(result.mode, 'fanvue_refresh_only_diagnostic')
  assert.equal(result.posted_proof, false)
  assert.equal(result.platform_post_id, null)
  assert.equal(result.upload_attempted, false)
  assert.equal(result.media_upload_create_attempted, false)
  assert.equal(result.signed_upload_url_attempted, false)
  assert.equal(result.byte_upload_attempted, false)
  assert.equal(result.media_finalize_attempted, false)
  assert.equal(result.media_lookup_attempted, false)
  assert.equal(result.post_attempted, false)
  assert.equal(result.dispatch_attempted, false)
  assert.equal(result.scheduled, false)
}

function assertNoSecretLeak(value: unknown) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(
    serialized,
    /plain-access-token|plain-refresh-token|enc-refresh-token-placeholder|client-secret|raw provider body|error_description|signed-upload|Authorization|Bearer|access token|refresh token|encrypted token/i,
  )
}

async function runDiagnostic(input: RunInput = {}) {
  const refreshCalls: FanvueRefreshAccount[] = []
  const result = await runFanvueRefreshOnlyDiagnostic(
    { userId },
    {
      loadAccount: async (targetUserId) => {
        assert.equal(targetUserId, userId)
        if (input.loadThrows) throw new Error('raw provider body client-secret')
        return input.account === undefined ? baseAccount : input.account
      },
      refreshAccessToken: async (account) => {
        refreshCalls.push(account)
        return input.refreshResult ?? {
          ok: true,
          token_expires_at: '2026-07-01T01:00:00.000Z',
          token_type: 'Bearer',
          scopes: ['read:media', 'write:media'],
          refreshed: true,
        }
      },
    },
  )

  return { result, refreshCalls }
}

async function run() {
  const success = await runDiagnostic()
  assert.equal(success.result.ok, true)
  assert.equal(success.result.refresh_layer_reached, true)
  assert.equal(success.result.refresh_ok, true)
  assert.equal(success.result.safe_code, 'FANVUE_REFRESH_OK')
  assert.equal(success.result.requires_oauth_reconnect, false)
  assert.equal(success.result.stop_reason, 'STOPPED_AFTER_REFRESH_SUCCESS_UPLOAD_NOT_ATTEMPTED')
  assert.equal(success.refreshCalls.length, 1)
  assert.equal(success.refreshCalls[0].encrypted_refresh_token, baseAccount.encrypted_refresh_token)
  assertUploadNegativeFlags(success.result)
  assertNoSecretLeak(success.result)

  const invalidGrant = await runDiagnostic({
    refreshResult: {
      ok: false,
      blocked: true,
      error_code: 'FANVUE_REFRESH_INVALID_GRANT_REAUTH_REQUIRED',
      safe_error_message: 'Fanvue refresh authorization is no longer valid; OAuth reconnect is required.',
      provider_calls_attempted: true,
      posted_proof: false,
      platform_post_id: null,
      provider_response_present: true,
      provider_status: 400,
      provider_status_class: '4xx',
      provider_error_code: 'invalid_grant',
      requires_oauth_reconnect: true,
    },
  })
  assert.equal(invalidGrant.result.ok, false)
  assert.equal(invalidGrant.result.refresh_layer_reached, true)
  assert.equal(invalidGrant.result.refresh_ok, false)
  assert.equal(invalidGrant.result.safe_code, 'FANVUE_REFRESH_INVALID_GRANT_REAUTH_REQUIRED')
  assert.equal(invalidGrant.result.requires_oauth_reconnect, true)
  assert.equal(invalidGrant.result.provider_calls_attempted, true)
  assert.equal(invalidGrant.result.provider_error_code, 'invalid_grant')
  assert.equal(invalidGrant.result.stop_reason, 'STOPPED_AFTER_REFRESH_INVALID_GRANT_UPLOAD_NOT_ATTEMPTED')
  assert.equal(invalidGrant.refreshCalls.length, 1)
  assertUploadNegativeFlags(invalidGrant.result)
  assertNoSecretLeak(invalidGrant.result)

  const providerFailure = await runDiagnostic({
    refreshResult: {
      ok: false,
      blocked: true,
      error_code: 'FANVUE_REFRESH_FAILED',
      safe_error_message: 'raw provider body with plain-access-token plain-refresh-token client-secret error_description https://signed-upload.invalid Authorization Bearer abc',
      provider_calls_attempted: true,
      posted_proof: false,
      platform_post_id: null,
      provider_response_present: true,
      provider_status: 502,
      provider_status_class: '5xx',
      provider_error_code: 'temporarily_unavailable',
    },
  })
  assert.equal(providerFailure.result.ok, false)
  assert.equal(providerFailure.result.safe_code, 'FANVUE_REFRESH_FAILED')
  assert.equal(providerFailure.result.safe_error_message, 'Fanvue refresh diagnostic failed safely.')
  assert.equal(providerFailure.result.refresh_layer_reached, true)
  assert.equal(providerFailure.result.stop_reason, 'STOPPED_AFTER_REFRESH_FAILURE_UPLOAD_NOT_ATTEMPTED')
  assertUploadNegativeFlags(providerFailure.result)
  assertNoSecretLeak(providerFailure.result)

  const missingConnection = await runDiagnostic({ account: null })
  assert.equal(missingConnection.result.ok, false)
  assert.equal(missingConnection.result.safe_code, 'FANVUE_CONNECTION_NOT_FOUND')
  assert.equal(missingConnection.result.refresh_layer_reached, false)
  assert.equal(missingConnection.result.provider_calls_attempted, false)
  assert.equal(missingConnection.result.stop_reason, 'STOPPED_BEFORE_REFRESH_NO_CONNECTION')
  assert.equal(missingConnection.refreshCalls.length, 0)
  assertUploadNegativeFlags(missingConnection.result)
  assertNoSecretLeak(missingConnection.result)

  const missingRefresh = await runDiagnostic({ account: { ...baseAccount, encrypted_refresh_token: null } })
  assert.equal(missingRefresh.result.ok, false)
  assert.equal(missingRefresh.result.safe_code, 'FANVUE_REFRESH_TOKEN_MISSING')
  assert.equal(missingRefresh.result.refresh_layer_reached, false)
  assert.equal(missingRefresh.result.provider_calls_attempted, false)
  assert.equal(missingRefresh.result.stop_reason, 'STOPPED_BEFORE_REFRESH_TOKEN_MISSING')
  assert.equal(missingRefresh.refreshCalls.length, 0)
  assertUploadNegativeFlags(missingRefresh.result)
  assertNoSecretLeak(missingRefresh.result)

  const lookupFailure = await runDiagnostic({ loadThrows: true })
  assert.equal(lookupFailure.result.ok, false)
  assert.equal(lookupFailure.result.safe_code, 'FANVUE_CONNECTION_LOOKUP_FAILED')
  assert.equal(lookupFailure.result.refresh_layer_reached, false)
  assert.equal(lookupFailure.refreshCalls.length, 0)
  assertUploadNegativeFlags(lookupFailure.result)
  assertNoSecretLeak(lookupFailure.result)

  const source = readFileSync('lib/autopost/fanvueRefreshDiagnostic.ts', 'utf8')
  for (const forbidden of [
    'refreshFanvueAccessToken',
    'fanvueApiClientCore',
    'createFanvueUploadSession',
    'getFanvueUploadPartUrl',
    'uploadFanvueSignedPart',
    'completeFanvueUploadSession',
    'readFanvueMedia',
    'waitForFanvueMediaReady',
    'createFanvueMediaPost',
    'createFanvueTextPost',
    '/posts',
    '/media/uploads',
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${forbidden} must not appear in the refresh diagnostic module`)
  }
}

run().then(() => console.log('Fanvue refresh diagnostic mocked tests passed'))
