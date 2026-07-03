import assert from 'node:assert/strict'
import {
  FANVUE_ADMIN_WRITE_CREATOR_RECONNECT_INITIATOR,
  FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION,
  FANVUE_WRITE_CREATOR_RECONNECT_OPERATION,
  handleFanvueWriteCreatorReconnectRoute,
} from '../../../lib/autopost/fanvueWriteCreatorReconnectRoute'

const adminUserId = '123e4567-e89b-42d3-a456-426614174000'
const allowedFields = [
  'operation',
  'fanvue_connect_enabled',
  'oauth_config_valid',
  'requested_scopes_present',
  'requested_scopes_include_write_creator',
  'default_scopes_include_write_creator',
  'required_connection_scopes_include_write_creator',
  'fanvue_public_selectable',
  'fanvue_dispatch_enabled',
  'fanvue_scheduling_enabled',
  'confirmation_required',
  'operation_allowed_for_admin',
  'will_call_fanvue_before_redirect',
  'will_upload',
  'will_post',
  'will_dispatch',
  'will_schedule',
].sort()

function configStatus(scopes = ['read:self', 'read:media', 'write:media', 'write:creator']) {
  return {
    connect_enabled: true,
    configured: true,
    missing: [],
    config_error: null,
    scopes,
    api_base_url: null,
    api_version: null,
  }
}

function request(body: unknown) {
  return new Request('https://example.invalid/api/admin/autopost/fanvue/write-creator-reconnect/start', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

async function exercise(body: unknown, options: { scopes?: string[]; authOk?: boolean } = {}) {
  let createStateCalled = false
  let buildUrlCalled = false
  const response = await handleFanvueWriteCreatorReconnectRoute({
    request: request(body),
    expectedSecret: 'unused',
    adminUserIds: [adminUserId],
    getAuthenticatedUserId: async () => adminUserId,
    authorizeRequest: async () => options.authOk === false ? { ok: false, status: 403, error_code: 'FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_REQUIRED' } : { ok: true, status: 200, adminUserId },
    getConfigStatus: () => configStatus(options.scopes),
    defaultScopes: ['openid', 'offline_access', 'offline', 'read:self', 'read:creator', 'read:post', 'write:post', 'read:media', 'write:media'],
    requiredConnectionScopes: ['read:self', 'read:media', 'write:media'],
    createOAuthState: (userId, stateOptions) => {
      createStateCalled = true
      assert.equal(userId, adminUserId)
      assert.equal(stateOptions?.operation, FANVUE_WRITE_CREATOR_RECONNECT_OPERATION)
      assert.equal(stateOptions?.initiatedFrom, FANVUE_ADMIN_WRITE_CREATOR_RECONNECT_INITIATOR)
      assert.equal(stateOptions?.adminReconnectAuthorized, true)
      return { state: 'state-value', codeChallenge: 'challenge', cookieValue: 'cookie-value' }
    },
    buildAuthorizeUrl: (input) => {
      buildUrlCalled = true
      assert.deepEqual(input, { state: 'state-value', codeChallenge: 'challenge' })
      return new URL('https://fanvue.example.invalid/oauth/authorize')
    },
  })
  return { response, createStateCalled, buildUrlCalled }
}

async function run() {
  const preflight = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION })
  assert.equal(preflight.response.type, 'json')
  if (preflight.response.type !== 'json') throw new Error('expected json')
  assert.equal(preflight.response.status, 200)
  assert.deepEqual(Object.keys(preflight.response.body).sort(), allowedFields)
  assert.equal(preflight.response.body.operation, FANVUE_WRITE_CREATOR_RECONNECT_OPERATION)
  assert.equal(preflight.response.body.operation_allowed_for_admin, true)
  assert.equal(preflight.response.body.will_call_fanvue_before_redirect, false)
  assert.equal(preflight.response.body.will_upload, false)
  assert.equal(preflight.response.body.will_post, false)
  assert.equal(preflight.response.body.will_dispatch, false)
  assert.equal(preflight.response.body.will_schedule, false)
  assert.equal(preflight.createStateCalled, false)
  assert.equal(preflight.buildUrlCalled, false)

  const startFalse = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION, start: false })
  assert.equal(startFalse.response.type, 'json')
  assert.equal(startFalse.createStateCalled, false)
  assert.equal(startFalse.buildUrlCalled, false)

  const startTrue = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION, start: true })
  assert.equal(startTrue.response.type, 'redirect')
  assert.equal(startTrue.createStateCalled, true)
  assert.equal(startTrue.buildUrlCalled, true)

  const missingConfirm = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, start: true })
  assert.equal(missingConfirm.response.type, 'json')
  assert.equal(missingConfirm.response.status, 400)
  assert.equal(missingConfirm.createStateCalled, false)

  const invalidConfirm = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: 'NO', start: true })
  assert.equal(invalidConfirm.response.type, 'json')
  assert.equal(invalidConfirm.response.status, 400)

  const missingWriteCreator = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION, start: true }, { scopes: ['read:self', 'read:media', 'write:media'] })
  assert.equal(missingWriteCreator.response.type, 'json')
  assert.equal(missingWriteCreator.response.status, 400)
  if (missingWriteCreator.response.type !== 'json') throw new Error('expected json')
  assert.equal(missingWriteCreator.response.body.requested_scopes_include_write_creator, false)
  assert.equal(missingWriteCreator.createStateCalled, false)


  console.log('Fanvue write creator reconnect route mocked tests passed')
}

run()
