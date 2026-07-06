import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FANVUE_MEDIA_READINESS_DIAGNOSTIC_SECRET_HEADER, authorizeFanvueMediaReadinessDiagnosticRequest } from '../../../lib/autopost/fanvueMediaReadinessDiagnosticAuth'

const expectedSecret = 'media-readiness-secret-never-returned'
const adminUserId = '123e4567-e89b-42d3-a456-426614174000'
const nonAdminUserId = '999e4567-e89b-42d3-a456-426614174999'

function requestWithSecret(secret: string | null = expectedSecret) {
  const headers = new Headers()
  if (secret !== null) headers.set(FANVUE_MEDIA_READINESS_DIAGNOSTIC_SECRET_HEADER, secret)
  headers.set('cookie', 'session=secret-cookie-never-returned')
  headers.set('authorization', 'Bearer bearer-token-never-returned')
  return new Request('https://sirensforge.test/api/admin/autopost/fanvue/media-readiness-diagnostic', { method: 'POST', headers })
}

async function authorize(input: { requestSecret?: string | null; configuredSecret?: string | null; adminUserIds?: string[] | string | null; authenticatedUserId?: string; authThrows?: boolean } = {}) {
  let authCalls = 0
  const result = await authorizeFanvueMediaReadinessDiagnosticRequest({
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
  assert.doesNotMatch(JSON.stringify(value), /media-readiness-secret-never-returned|session=secret-cookie-never-returned|bearer-token-never-returned|Bearer|access[_ -]?token|refresh[_ -]?token|encrypted|client[_ -]?secret|signed-upload|999e4567/i)
}

async function run() {
  const missingExpected = await authorize({ configuredSecret: '   ' })
  assert.equal(missingExpected.result.error_code, 'FANVUE_MEDIA_READINESS_DIAGNOSTIC_SECRET_NOT_CONFIGURED')
  assert.equal(missingExpected.authCalls, 0)

  const missingRequestSecret = await authorize({ requestSecret: null })
  assert.equal(missingRequestSecret.result.error_code, 'FANVUE_MEDIA_READINESS_DIAGNOSTIC_SECRET_REQUIRED')
  assert.equal(missingRequestSecret.authCalls, 0)

  const invalidSecret = await authorize({ requestSecret: 'wrong-media-readiness-secret-never-returned' })
  assert.equal(invalidSecret.result.error_code, 'FANVUE_MEDIA_READINESS_DIAGNOSTIC_SECRET_INVALID')
  assert.equal(invalidSecret.authCalls, 0)

  const unauthenticated = await authorize({ authThrows: true })
  assert.equal(unauthenticated.result.error_code, 'UNAUTHENTICATED')
  assert.equal(unauthenticated.authCalls, 1)

  const emptyAllowlist = await authorize({ adminUserIds: ' , ' })
  assert.equal(emptyAllowlist.result.error_code, 'FANVUE_MEDIA_READINESS_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED')

  const nonAdmin = await authorize({ authenticatedUserId: nonAdminUserId })
  assert.equal(nonAdmin.result.error_code, 'FANVUE_MEDIA_READINESS_DIAGNOSTIC_ADMIN_REQUIRED')

  const allowed = await authorize({ adminUserIds: `${nonAdminUserId}, ${adminUserId}` })
  assert.equal(allowed.result.ok, true)

  for (const item of [missingExpected, missingRequestSecret, invalidSecret, unauthenticated, emptyAllowlist, nonAdmin, allowed]) assertNoSensitiveLeak(item.result)

  const helperSource = readFileSync('lib/autopost/fanvueMediaReadinessDiagnosticAuth.ts', 'utf8')
  for (const forbidden of ['runFanvueMediaReadinessDiagnostic', 'fanvueApiClientCore', 'supabaseAdmin', 'supabaseServer', '/posts', '/media/uploads', 'platformRegistry']) {
    assert.doesNotMatch(helperSource, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${forbidden} must not appear in auth helper`)
  }
  assert.match(helperSource, /timingSafeEqual/)
}

run().then(() => console.log('Fanvue media readiness diagnostic auth mocked tests passed'))
