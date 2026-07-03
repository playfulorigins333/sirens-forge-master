import assert from 'node:assert/strict'
import {
  FANVUE_IDENTITY_DIAGNOSTIC_SECRET_HEADER,
  handleFanvueIdentityDiagnosticRoute,
  type FanvueIdentityDiagnosticRouteDependencies,
} from '../../../lib/autopost/fanvueIdentityDiagnosticRoute'
import type { FanvueIdentityDiagnosticAccount } from '../../../lib/autopost/fanvueIdentityDiagnostic'

const expectedSecret = 'identity-diagnostic-secret-never-returned'
const adminUserId = '123e4567-e89b-42d3-a456-426614174000'
const nonAdminUserId = '999e4567-e89b-42d3-a456-426614174999'
const targetUserId = '123e4567-e89b-42d3-a456-426614174111'

const baseAccount: FanvueIdentityDiagnosticAccount = {
  user_id: targetUserId,
  platform: 'fanvue',
  connection_status: 'CONNECTED',
  provider_account_id: 'provider-account-never-returned',
  provider_username: 'provider-username-never-returned',
  encrypted_access_token: 'encrypted-access-token-never-returned',
  token_expires_at: null,
  token_type: 'bearer',
  token_key_version: 1,
  scopes: ['read:media', 'write:media'],
  metadata: { provider: 'fanvue', identity_fetched: true },
}

type RequestInput = {
  body?: unknown
  configuredSecret?: string | null
  requestSecret?: string | null
  adminUserIds?: string[] | string | null
  authenticatedUserId?: string
  authThrows?: boolean
  account?: FanvueIdentityDiagnosticAccount | null
}

function makeRequest(input: RequestInput, counters: { bodyParses: number }) {
  const headers = new Headers()
  if (input.requestSecret !== null) headers.set(FANVUE_IDENTITY_DIAGNOSTIC_SECRET_HEADER, input.requestSecret ?? expectedSecret)
  headers.set('authorization', 'Bearer request-bearer-never-returned')
  headers.set('cookie', 'session=secret-cookie-never-returned')
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
  const counters = { bodyParses: 0, authCalls: 0, accountLookups: 0, diagnosticCalls: 0, fetchCalls: 0 }
  const response = await handleFanvueIdentityDiagnosticRoute({
    request: makeRequest(input, counters),
    expectedSecret: input.configuredSecret === undefined ? expectedSecret : input.configuredSecret,
    adminUserIds: input.adminUserIds === undefined ? [adminUserId] : input.adminUserIds,
    getAuthenticatedUserId: async () => {
      counters.authCalls++
      if (input.authThrows) throw new Error('session bearer raw provider body')
      return input.authenticatedUserId ?? adminUserId
    },
    createLoadAccount: () => async (userId) => {
      counters.accountLookups++
      assert.equal(userId, targetUserId)
      return input.account === undefined ? baseAccount : input.account
    },
    apiBaseUrl: 'https://api.fanvue.test',
    apiVersion: '2025-06-26',
    decryptAccessToken: () => 'plain-access-token-never-returned',
    fetchIdentity: async (url, init) => {
      counters.fetchCalls++
      assert.equal(url, 'https://api.fanvue.test/users/account')
      assert.equal(init.method, 'GET')
      return { ok: true, status: 200, json: async () => ({ creator: { userUuid: '223e4567-e89b-42d3-a456-426614174000' } }) }
    },
    runDiagnostic: async (diagnosticInput, dependencies) => {
      counters.diagnosticCalls++
      const { runFanvueIdentityOnlyDiagnostic } = await import('../../../lib/autopost/fanvueIdentityDiagnostic')
      return runFanvueIdentityOnlyDiagnostic(diagnosticInput, dependencies)
    },
  } satisfies FanvueIdentityDiagnosticRouteDependencies)
  return { response, counters }
}

function assertNoSensitiveLeak(value: unknown) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(
    serialized,
    /identity-diagnostic-secret-never-returned|wrong-secret-never-returned|request-bearer-never-returned|session=secret-cookie-never-returned|encrypted-access-token-never-returned|plain-access-token-never-returned|provider-account-never-returned|provider-username-never-returned|Authorization|Bearer|raw provider body/i,
  )
}

function assertBlockedBeforeBody(result: Awaited<ReturnType<typeof exercise>>, status: number, errorCode: string) {
  assert.equal(result.response.status, status)
  assert.deepEqual(result.response.body, { ok: false, error_code: errorCode })
  assert.equal(result.counters.bodyParses, 0)
  assert.equal(result.counters.accountLookups, 0)
  assert.equal(result.counters.diagnosticCalls, 0)
  assert.equal(result.counters.fetchCalls, 0)
  assertNoSensitiveLeak(result.response.body)
}

async function run() {
  assertBlockedBeforeBody(await exercise({ configuredSecret: null, body: 'THROW_ON_PARSE' }), 500, 'FANVUE_IDENTITY_DIAGNOSTIC_SECRET_NOT_CONFIGURED')
  assertBlockedBeforeBody(await exercise({ requestSecret: null, body: 'THROW_ON_PARSE' }), 401, 'FANVUE_IDENTITY_DIAGNOSTIC_SECRET_REQUIRED')
  assertBlockedBeforeBody(await exercise({ requestSecret: 'wrong-secret-never-returned', body: 'THROW_ON_PARSE' }), 403, 'FANVUE_IDENTITY_DIAGNOSTIC_SECRET_INVALID')
  assertBlockedBeforeBody(await exercise({ authThrows: true, body: 'THROW_ON_PARSE' }), 401, 'UNAUTHENTICATED')
  assertBlockedBeforeBody(await exercise({ adminUserIds: null, body: 'THROW_ON_PARSE' }), 500, 'FANVUE_IDENTITY_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED')
  assertBlockedBeforeBody(await exercise({ authenticatedUserId: nonAdminUserId, body: 'THROW_ON_PARSE' }), 403, 'FANVUE_IDENTITY_DIAGNOSTIC_ADMIN_REQUIRED')

  for (const body of [{}, { user_id: 123 }, { user_id: 'not-a-uuid' }]) {
    const invalid = await exercise({ body })
    assert.equal(invalid.response.status, 400)
    assert.deepEqual(invalid.response.body, { ok: false, error_code: 'INVALID_TARGET_USER_ID' })
    assert.equal(invalid.counters.accountLookups, 0)
    assert.equal(invalid.counters.diagnosticCalls, 0)
    assert.equal(invalid.counters.fetchCalls, 0)
    assertNoSensitiveLeak(invalid.response.body)
  }

  const missingAccount = await exercise({ account: null })
  assert.equal(missingAccount.response.status, 200)
  assert.equal(missingAccount.response.body.ok, false)
  assert.equal(missingAccount.response.body.safe_code, 'FANVUE_IDENTITY_ACCOUNT_NOT_FOUND')
  assert.equal(missingAccount.counters.accountLookups, 1)
  assert.equal(missingAccount.counters.diagnosticCalls, 1)
  assert.equal(missingAccount.counters.fetchCalls, 0)
  assertNoSensitiveLeak(missingAccount.response.body)

  const success = await exercise()
  assert.equal(success.response.status, 200)
  assert.equal(success.response.body.ok, true)
  assert.equal(success.response.body.gate, 'FV-40CO')
  assert.equal(success.response.body.mode, 'fanvue_identity_only_diagnostic')
  assert.equal(success.response.body.safe_code, 'FANVUE_IDENTITY_SHAPE_INSPECTED')
  assert.equal(success.response.body.candidate_creator_user_uuid_source, 'creator_userUuid')
  assert.equal(success.counters.accountLookups, 1)
  assert.equal(success.counters.diagnosticCalls, 1)
  assert.equal(success.counters.fetchCalls, 1)
  assertNoSensitiveLeak(success.response.body)
  assert.equal('encrypted_access_token' in success.response.body, false)
  assert.equal('metadata' in success.response.body, false)
  assert.equal('provider_username' in success.response.body, false)
}

run().then(() => console.log('Fanvue identity diagnostic route mocked tests passed'))
