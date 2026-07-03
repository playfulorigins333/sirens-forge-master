import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FANVUE_REFRESH_DIAGNOSTIC_SECRET_HEADER,
  authorizeFanvueRefreshDiagnosticRequest,
} from '../../../lib/autopost/fanvueRefreshDiagnosticAuth'

const expectedSecret = 'diagnostic-secret-never-returned'
const adminUserId = '123e4567-e89b-42d3-a456-426614174000'
const nonAdminUserId = '999e4567-e89b-42d3-a456-426614174999'

function requestWithSecret(secret: string | null = expectedSecret) {
  const headers = new Headers()
  if (secret !== null) headers.set(FANVUE_REFRESH_DIAGNOSTIC_SECRET_HEADER, secret)
  headers.set('cookie', 'session=secret-cookie-never-returned')
  headers.set('authorization', 'Bearer bearer-token-never-returned')
  return new Request('https://sirensforge.test/api/admin/autopost/fanvue/refresh-diagnostic', { method: 'POST', headers })
}

async function authorize(input: {
  requestSecret?: string | null
  configuredSecret?: string | null
  adminUserIds?: string[] | string | null
  authenticatedUserId?: string
  authThrows?: boolean
} = {}) {
  let authCalls = 0
  const result = await authorizeFanvueRefreshDiagnosticRequest({
    request: requestWithSecret(input.requestSecret === undefined ? expectedSecret : input.requestSecret),
    expectedSecret: input.configuredSecret === undefined ? expectedSecret : input.configuredSecret,
    adminUserIds: input.adminUserIds === undefined ? [adminUserId] : input.adminUserIds,
    getAuthenticatedUserId: async () => {
      authCalls++
      if (input.authThrows) throw new Error('session cookie bearer-token-never-returned')
      return input.authenticatedUserId === undefined ? adminUserId : input.authenticatedUserId
    },
  })
  return { result, authCalls }
}

function assertNoSensitiveLeak(value: unknown) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(
    serialized,
    /diagnostic-secret-never-returned|session=secret-cookie-never-returned|bearer-token-never-returned|Bearer|access[_ -]?token|refresh[_ -]?token|encrypted|client[_ -]?secret|raw provider|signed-upload|999e4567-e89b-42d3-a456-426614174999/i,
  )
}

async function run() {
  const missingExpected = await authorize({ configuredSecret: '   ' })
  assert.equal(missingExpected.result.ok, false)
  assert.equal(missingExpected.result.status, 500)
  assert.equal(missingExpected.result.error_code, 'FANVUE_REFRESH_DIAGNOSTIC_SECRET_NOT_CONFIGURED')
  assert.equal(missingExpected.authCalls, 0)
  assertNoSensitiveLeak(missingExpected.result)

  const missingRequestSecret = await authorize({ requestSecret: null })
  assert.equal(missingRequestSecret.result.ok, false)
  assert.equal(missingRequestSecret.result.status, 401)
  assert.equal(missingRequestSecret.result.error_code, 'FANVUE_REFRESH_DIAGNOSTIC_SECRET_REQUIRED')
  assert.equal(missingRequestSecret.authCalls, 0)
  assertNoSensitiveLeak(missingRequestSecret.result)

  const invalidRequestSecret = await authorize({ requestSecret: 'wrong-diagnostic-secret-never-returned' })
  assert.equal(invalidRequestSecret.result.ok, false)
  assert.equal(invalidRequestSecret.result.status, 403)
  assert.equal(invalidRequestSecret.result.error_code, 'FANVUE_REFRESH_DIAGNOSTIC_SECRET_INVALID')
  assert.equal(invalidRequestSecret.authCalls, 0)
  assertNoSensitiveLeak(invalidRequestSecret.result)

  const missingSessionThrow = await authorize({ authThrows: true })
  assert.equal(missingSessionThrow.result.ok, false)
  assert.equal(missingSessionThrow.result.status, 401)
  assert.equal(missingSessionThrow.result.error_code, 'UNAUTHENTICATED')
  assert.equal(missingSessionThrow.authCalls, 1)
  assertNoSensitiveLeak(missingSessionThrow.result)

  const missingSessionBlank = await authorize({ authenticatedUserId: '   ' })
  assert.equal(missingSessionBlank.result.ok, false)
  assert.equal(missingSessionBlank.result.status, 401)
  assert.equal(missingSessionBlank.result.error_code, 'UNAUTHENTICATED')
  assert.equal(missingSessionBlank.authCalls, 1)
  assertNoSensitiveLeak(missingSessionBlank.result)

  const missingAllowlist = await authorize({ adminUserIds: ' ,  , ' })
  assert.equal(missingAllowlist.result.ok, false)
  assert.equal(missingAllowlist.result.status, 500)
  assert.equal(missingAllowlist.result.error_code, 'FANVUE_REFRESH_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED')
  assert.equal(missingAllowlist.authCalls, 1)
  assertNoSensitiveLeak(missingAllowlist.result)

  const nonAdmin = await authorize({ authenticatedUserId: nonAdminUserId })
  assert.equal(nonAdmin.result.ok, false)
  assert.equal(nonAdmin.result.status, 403)
  assert.equal(nonAdmin.result.error_code, 'FANVUE_REFRESH_DIAGNOSTIC_ADMIN_REQUIRED')
  assert.equal(nonAdmin.authCalls, 1)
  assertNoSensitiveLeak(nonAdmin.result)

  const allowedArray = await authorize()
  assert.equal(allowedArray.result.ok, true)
  assert.equal(allowedArray.result.status, 200)
  if (allowedArray.result.ok) assert.equal(allowedArray.result.adminUserId, adminUserId)
  assert.equal(allowedArray.authCalls, 1)
  assertNoSensitiveLeak(allowedArray.result)

  const allowedCommaSeparated = await authorize({ adminUserIds: ` , ${nonAdminUserId} , , ${adminUserId} , ` })
  assert.equal(allowedCommaSeparated.result.ok, true)
  assert.equal(allowedCommaSeparated.authCalls, 1)
  if (allowedCommaSeparated.result.ok) assert.equal(allowedCommaSeparated.result.adminUserId, adminUserId)
  assertNoSensitiveLeak(allowedCommaSeparated.result)

  const helperSource = readFileSync('lib/autopost/fanvueRefreshDiagnosticAuth.ts', 'utf8')
  for (const forbidden of [
    'runFanvueRefreshOnlyDiagnostic',
    'refreshFanvueAccessToken',
    'fanvueTokenRefresh',
    'fanvueRefreshDiagnostic',
    'fanvueApiClientCore',
    'createFanvueUploadSession',
    'getFanvueUploadPartUrl',
    'uploadFanvueSignedPart',
    'completeFanvueUploadSession',
    'readFanvueMedia',
    'waitForFanvueMediaReady',
    'createFanvueMediaPost',
    'createFanvueTextPost',
    'autopost/run',
    'schedule',
    'scheduler',
    'platformRegistry',
    'supabaseAdmin',
    'supabaseServer',
    '/posts',
    '/media/uploads',
  ]) {
    assert.doesNotMatch(helperSource, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${forbidden} must not appear in the auth helper module`)
  }

  assert.match(helperSource, /timingSafeEqual/, 'auth helper must use constant-time comparison')
}

run().then(() => console.log('Fanvue refresh diagnostic auth helper tests passed'))
