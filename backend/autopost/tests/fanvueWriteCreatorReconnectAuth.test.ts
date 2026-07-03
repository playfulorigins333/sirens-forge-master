import assert from 'node:assert/strict'
import {
  FANVUE_WRITE_CREATOR_RECONNECT_SECRET_HEADER,
  authorizeFanvueWriteCreatorReconnectRequest,
} from '../../../lib/autopost/fanvueWriteCreatorReconnectAuth'

const adminUserId = '123e4567-e89b-42d3-a456-426614174000'
const nonAdminUserId = '123e4567-e89b-42d3-a456-426614174001'
const expectedSecret = 'expected-secret'

function request(secret: string | null | undefined = expectedSecret) {
  const headers = new Headers()
  if (secret !== null) headers.set(FANVUE_WRITE_CREATOR_RECONNECT_SECRET_HEADER, secret ?? expectedSecret)
  return new Request('https://example.invalid/api/admin/autopost/fanvue/write-creator-reconnect/start', { method: 'POST', headers })
}

async function exercise(input: {
  configuredSecret?: string | null
  requestSecret?: string | null
  adminUserIds?: string[] | string | null
  authenticatedUserId?: string
  authThrows?: boolean
} = {}) {
  return authorizeFanvueWriteCreatorReconnectRequest({
    request: request(input.requestSecret === undefined ? expectedSecret : input.requestSecret),
    expectedSecret: input.configuredSecret === undefined ? expectedSecret : input.configuredSecret,
    adminUserIds: input.adminUserIds === undefined ? [adminUserId] : input.adminUserIds,
    getAuthenticatedUserId: async () => {
      if (input.authThrows) throw new Error('unauthenticated')
      return input.authenticatedUserId ?? adminUserId
    },
  })
}

async function run() {
  assert.deepEqual(await exercise({ configuredSecret: null }), { ok: false, status: 500, error_code: 'FANVUE_WRITE_CREATOR_RECONNECT_SECRET_NOT_CONFIGURED' })
  assert.deepEqual(await exercise({ requestSecret: null }), { ok: false, status: 401, error_code: 'FANVUE_WRITE_CREATOR_RECONNECT_SECRET_REQUIRED' })
  assert.deepEqual(await exercise({ requestSecret: 'wrong-secret' }), { ok: false, status: 403, error_code: 'FANVUE_WRITE_CREATOR_RECONNECT_SECRET_INVALID' })
  assert.deepEqual(await exercise({ authThrows: true }), { ok: false, status: 401, error_code: 'UNAUTHENTICATED' })
  assert.deepEqual(await exercise({ adminUserIds: null }), { ok: false, status: 500, error_code: 'FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_ALLOWLIST_NOT_CONFIGURED' })
  assert.deepEqual(await exercise({ authenticatedUserId: nonAdminUserId }), { ok: false, status: 403, error_code: 'FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_REQUIRED' })
  assert.deepEqual(await exercise({ adminUserIds: `${nonAdminUserId}, ${adminUserId}` }), { ok: true, status: 200, adminUserId })
  console.log('Fanvue write creator reconnect auth mocked tests passed')
}

run()
