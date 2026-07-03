import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  handleFanvueRefreshDiagnosticRoute,
  type FanvueRefreshDiagnosticRouteDependencies,
} from '../../../lib/autopost/fanvueRefreshDiagnosticRoute'
import { FANVUE_REFRESH_DIAGNOSTIC_SECRET_HEADER } from '../../../lib/autopost/fanvueRefreshDiagnosticAuth'
import type { FanvueRefreshDiagnosticAccount } from '../../../lib/autopost/fanvueRefreshDiagnostic'
import type { FanvueRefreshAccount, FanvueTokenRefreshResult } from '../../../lib/autopost/fanvueTokenRefresh'

const expectedSecret = 'diagnostic-secret-never-returned'
const adminUserId = '123e4567-e89b-42d3-a456-426614174000'
const nonAdminUserId = '999e4567-e89b-42d3-a456-426614174999'
const targetUserId = '123e4567-e89b-42d3-a456-426614174111'
const encryptedRefreshToken = 'encrypted-refresh-token-never-returned'

const baseAccount: FanvueRefreshDiagnosticAccount = {
  user_id: targetUserId,
  platform: 'fanvue',
  connection_status: 'CONNECTED',
  provider_account_id: 'fanvue-provider-account',
  metadata: { provider: 'fanvue', identity_fetched: true },
  encrypted_refresh_token: encryptedRefreshToken,
  token_expires_at: '2026-07-01T00:10:00.000Z',
  token_type: 'bearer',
  token_key_version: 1,
  last_refresh_at: null,
  scopes: ['read:media', 'write:media'],
}

type RequestInput = {
  body?: unknown
  configuredSecret?: string | null
  requestSecret?: string | null
  authenticatedUserId?: string
  authThrows?: boolean
  account?: FanvueRefreshDiagnosticAccount | null
  refreshResult?: FanvueTokenRefreshResult
}

function makeRequest(input: RequestInput, counters: { bodyParses: number }) {
  const headers = new Headers()
  if (input.requestSecret !== null) {
    headers.set(FANVUE_REFRESH_DIAGNOSTIC_SECRET_HEADER, input.requestSecret ?? expectedSecret)
  }
  headers.set('cookie', 'session=secret-cookie-never-returned')
  headers.set('authorization', 'Bearer bearer-token-never-returned')

  return {
    headers,
    json: async () => {
      counters.bodyParses++
      if (input.body === 'THROW_ON_PARSE') throw new Error('body parse should not run')
      return input.body ?? { user_id: targetUserId }
    },
  } as unknown as Request
}

async function exercise(input: RequestInput = {}) {
  const counters = {
    bodyParses: 0,
    authCalls: 0,
    accountLookups: 0,
    refreshCalls: 0,
    diagnosticCalls: 0,
  }
  const request = makeRequest(input, counters)
  const refreshCalls: FanvueRefreshAccount[] = []

  const response = await handleFanvueRefreshDiagnosticRoute({
    request,
    expectedSecret: input.configuredSecret === undefined ? expectedSecret : input.configuredSecret,
    adminUserIds: [adminUserId],
    getAuthenticatedUserId: async () => {
      counters.authCalls++
      if (input.authThrows) throw new Error('session cookie bearer-token-never-returned')
      return input.authenticatedUserId ?? adminUserId
    },
    createLoadAccount: () => async (userId) => {
      counters.accountLookups++
      assert.equal(userId, targetUserId)
      return input.account === undefined ? baseAccount : input.account
    },
    getRefreshAccessToken: () => async (account) => {
      counters.refreshCalls++
      refreshCalls.push(account)
      return input.refreshResult ?? {
        ok: true,
        token_expires_at: '2026-07-01T01:00:00.000Z',
        token_type: 'Bearer',
        scopes: ['read:media', 'write:media'],
        refreshed: true,
      }
    },
    runDiagnostic: async (diagnosticInput, dependencies) => {
      counters.diagnosticCalls++
      return (await (FanvueRefreshDiagnosticRouteDependenciesDefaults.runDiagnostic)(diagnosticInput, dependencies))
    },
  } satisfies FanvueRefreshDiagnosticRouteDependencies)

  return { response, counters, refreshCalls }
}

const FanvueRefreshDiagnosticRouteDependenciesDefaults = {
  runDiagnostic: async (...args: Parameters<NonNullable<FanvueRefreshDiagnosticRouteDependencies['runDiagnostic']>>) => {
    const { runFanvueRefreshOnlyDiagnostic } = await import('../../../lib/autopost/fanvueRefreshDiagnostic')
    return runFanvueRefreshOnlyDiagnostic(...args)
  },
}

function assertBlockedBeforeBody(result: Awaited<ReturnType<typeof exercise>>, status: number, errorCode: string) {
  assert.equal(result.response.status, status)
  assert.deepEqual(result.response.body, { ok: false, error_code: errorCode })
  assert.equal(result.counters.bodyParses, 0)
  assert.equal(result.counters.accountLookups, 0)
  assert.equal(result.counters.diagnosticCalls, 0)
  assert.equal(result.counters.refreshCalls, 0)
  assertNoSensitiveLeak(result.response.body)
}

function assertInvalidBodyBlocked(result: Awaited<ReturnType<typeof exercise>>) {
  assert.equal(result.response.status, 400)
  assert.deepEqual(result.response.body, { ok: false, error_code: 'INVALID_TARGET_USER_ID' })
  assert.equal(result.counters.bodyParses, 1)
  assert.equal(result.counters.accountLookups, 0)
  assert.equal(result.counters.diagnosticCalls, 0)
  assert.equal(result.counters.refreshCalls, 0)
  assertNoSensitiveLeak(result.response.body)
}

function assertUploadNegativeFlags(value: any) {
  assert.equal(value.posted_proof, false)
  assert.equal(value.platform_post_id, null)
  assert.equal(value.upload_attempted, false)
  assert.equal(value.media_upload_create_attempted, false)
  assert.equal(value.signed_upload_url_attempted, false)
  assert.equal(value.byte_upload_attempted, false)
  assert.equal(value.media_finalize_attempted, false)
  assert.equal(value.media_lookup_attempted, false)
  assert.equal(value.post_attempted, false)
  assert.equal(value.dispatch_attempted, false)
  assert.equal(value.scheduled, false)
}

function assertNoSensitiveLeak(value: unknown) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(
    serialized,
    /diagnostic-secret-never-returned|request-secret-never-returned|wrong-secret-never-returned|session=secret-cookie-never-returned|bearer-token-never-returned|Bearer bearer|encrypted-refresh-token-never-returned|encrypted_access_token|plain-refresh-token|client-secret|raw provider body|Authorization|signed-upload/i,
  )
}

function assertNoForbiddenRouteSource() {
  const routeSource = readFileSync('app/api/admin/autopost/fanvue/refresh-diagnostic/route.ts', 'utf8')
  const supportSource = readFileSync('lib/autopost/fanvueRefreshDiagnosticRoute.ts', 'utf8')

  assert.doesNotMatch(routeSource, /encrypted_access_token/, 'diagnostic route must not select encrypted_access_token')

  for (const [label, source] of [
    ['route', routeSource],
    ['support', supportSource],
  ] as const) {
    for (const forbidden of [
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
      'app/api/autopost/run',
      'scheduler',
      'platformRegistry',
    ]) {
      assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${forbidden} must not appear in ${label} source`)
    }
  }

  for (const path of [
    'app/api/autopost/platforms/me/route.ts',
    'app/api/autopost/connect/fanvue/start/route.ts',
    'app/api/autopost/connect/fanvue/callback/route.ts',
    'app/api/autopost/run/route.ts',
    'app/api/autopost/rules/route.ts',
    'lib/autopost/platformRegistry.ts',
  ]) {
    if (!existsSync(path)) continue
    const source = readFileSync(path, 'utf8')
    assert.doesNotMatch(source, /refresh-diagnostic/, `${path} must not reference refresh-diagnostic`)
    assert.doesNotMatch(source, /runFanvueRefreshOnlyDiagnostic/, `${path} must not reference runFanvueRefreshOnlyDiagnostic`)
    assert.doesNotMatch(source, /refreshFanvueAccessToken/, `${path} must not reference refreshFanvueAccessToken`)
  }

  const registry = readFileSync('lib/autopost/platformRegistry.ts', 'utf8')
  assert.match(registry, /public_selectable: false/)
  assert.match(registry, /supports_real_posting: false/)
  assert.match(registry, /supports_async_dispatch: false/)
}

async function run() {
  assertBlockedBeforeBody(
    await exercise({ configuredSecret: null, body: 'THROW_ON_PARSE' }),
    500,
    'FANVUE_REFRESH_DIAGNOSTIC_SECRET_NOT_CONFIGURED',
  )

  assertBlockedBeforeBody(
    await exercise({ requestSecret: null, body: 'THROW_ON_PARSE' }),
    401,
    'FANVUE_REFRESH_DIAGNOSTIC_SECRET_REQUIRED',
  )

  assertBlockedBeforeBody(
    await exercise({ requestSecret: 'wrong-secret-never-returned', body: 'THROW_ON_PARSE' }),
    403,
    'FANVUE_REFRESH_DIAGNOSTIC_SECRET_INVALID',
  )

  const missingSession = await exercise({ authThrows: true, body: 'THROW_ON_PARSE' })
  assert.equal(missingSession.counters.authCalls, 1)
  assertBlockedBeforeBody(missingSession, 401, 'UNAUTHENTICATED')

  const nonAdmin = await exercise({ authenticatedUserId: nonAdminUserId, body: 'THROW_ON_PARSE' })
  assert.equal(nonAdmin.counters.authCalls, 1)
  assertBlockedBeforeBody(nonAdmin, 403, 'FANVUE_REFRESH_DIAGNOSTIC_ADMIN_REQUIRED')

  for (const body of [{}, { user_id: 123 }, { user_id: '   ' }, { user_id: 'not-a-uuid' }]) {
    assertInvalidBodyBlocked(await exercise({ body }))
  }

  const missingAccount = await exercise({ account: null })
  assert.equal(missingAccount.response.status, 200)
  assert.equal(missingAccount.response.body.ok, false)
  assert.equal(missingAccount.response.body.safe_code, 'FANVUE_CONNECTION_NOT_FOUND')
  assert.equal(missingAccount.response.body.refresh_layer_reached, false)
  assert.equal(missingAccount.response.body.provider_calls_attempted, false)
  assert.equal(missingAccount.counters.accountLookups, 1)
  assert.equal(missingAccount.counters.diagnosticCalls, 1)
  assert.equal(missingAccount.counters.refreshCalls, 0)
  assertUploadNegativeFlags(missingAccount.response.body)
  assertNoSensitiveLeak(missingAccount.response.body)

  const success = await exercise()
  assert.equal(success.response.status, 200)
  assert.equal(success.response.body.ok, true)
  assert.equal(success.response.body.gate, 'FV-40AR')
  assert.equal(success.response.body.mode, 'fanvue_refresh_only_diagnostic')
  assert.equal(success.response.body.safe_code, 'FANVUE_REFRESH_OK')
  assert.equal(success.response.body.stop_reason, 'STOPPED_AFTER_REFRESH_SUCCESS_UPLOAD_NOT_ATTEMPTED')
  assert.equal(success.refreshCalls.length, 1)
  assert.equal(success.refreshCalls[0].encrypted_refresh_token, encryptedRefreshToken)
  assertUploadNegativeFlags(success.response.body)
  assertNoSensitiveLeak(success.response.body)

  const invalidGrant = await exercise({
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
  assert.equal(invalidGrant.response.status, 200)
  assert.equal(invalidGrant.response.body.ok, false)
  assert.equal(invalidGrant.response.body.gate, 'FV-40AR')
  assert.equal(invalidGrant.response.body.mode, 'fanvue_refresh_only_diagnostic')
  assert.equal(invalidGrant.response.body.safe_code, 'FANVUE_REFRESH_INVALID_GRANT_REAUTH_REQUIRED')
  assert.equal(invalidGrant.response.body.requires_oauth_reconnect, true)
  assert.equal(invalidGrant.response.body.stop_reason, 'STOPPED_AFTER_REFRESH_INVALID_GRANT_UPLOAD_NOT_ATTEMPTED')
  assertUploadNegativeFlags(invalidGrant.response.body)
  assertNoSensitiveLeak(invalidGrant.response.body)

  const providerFailure = await exercise({
    refreshResult: {
      ok: false,
      blocked: true,
      error_code: 'FANVUE_REFRESH_FAILED',
      safe_error_message: 'raw provider body client-secret plain-refresh-token Authorization signed-upload',
      provider_calls_attempted: true,
      posted_proof: false,
      platform_post_id: null,
      provider_response_present: true,
      provider_status: 502,
      provider_status_class: '5xx',
      provider_error_code: 'temporarily_unavailable',
    },
  })
  assertNoSensitiveLeak(providerFailure.response.body)

  assertNoForbiddenRouteSource()
}

run().then(() => console.log('Fanvue refresh diagnostic route mocked tests passed'))
