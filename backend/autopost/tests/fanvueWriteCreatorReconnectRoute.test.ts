import assert from 'node:assert/strict'
import {
  FANVUE_ADMIN_WRITE_CREATOR_RECONNECT_INITIATOR,
  FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION,
  FANVUE_WRITE_CREATOR_RECONNECT_JSON_REDIRECT_MODE,
  FANVUE_WRITE_CREATOR_RECONNECT_NEXT_STEP,
  FANVUE_WRITE_CREATOR_RECONNECT_OPERATION,
  FANVUE_WRITE_CREATOR_RECONNECT_REDIRECT_TYPE,
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
  assert.equal('redirect_url' in preflight.response.body, false)
  assert.equal(preflight.createStateCalled, false)
  assert.equal(preflight.buildUrlCalled, false)

  const startFalse = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION, start: false })
  assert.equal(startFalse.response.type, 'json')
  if (startFalse.response.type !== 'json') throw new Error('expected json')
  assert.equal('redirect_url' in startFalse.response.body, false)
  assert.equal(startFalse.createStateCalled, false)
  assert.equal(startFalse.buildUrlCalled, false)

  const startTrue = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION, start: true })
  assert.equal(startTrue.response.type, 'redirect')
  assert.equal(startTrue.createStateCalled, true)
  assert.equal(startTrue.buildUrlCalled, true)


  const jsonRedirect = await exercise({
    operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION,
    confirm: FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION,
    start: true,
    response_mode: FANVUE_WRITE_CREATOR_RECONNECT_JSON_REDIRECT_MODE,
  })
  assert.equal(jsonRedirect.response.type, 'json_redirect')
  assert.equal(jsonRedirect.createStateCalled, true)
  assert.equal(jsonRedirect.buildUrlCalled, true)
  if (jsonRedirect.response.type !== 'json_redirect') throw new Error('expected json_redirect')
  assert.equal(jsonRedirect.response.status, 200)
  assert.equal(jsonRedirect.response.cookieValue, 'cookie-value')
  assert.equal(jsonRedirect.response.body.operation, FANVUE_WRITE_CREATOR_RECONNECT_OPERATION)
  assert.equal(jsonRedirect.response.body.type, FANVUE_WRITE_CREATOR_RECONNECT_REDIRECT_TYPE)
  assert.equal(jsonRedirect.response.body.redirect_url, 'https://fanvue.example.invalid/oauth/authorize')
  assert.equal(jsonRedirect.response.body.next_step, FANVUE_WRITE_CREATOR_RECONNECT_NEXT_STEP)
  assert.equal(jsonRedirect.response.body.will_call_fanvue_before_redirect, false)
  assert.equal(jsonRedirect.response.body.will_upload, false)
  assert.equal(jsonRedirect.response.body.will_post, false)
  assert.equal(jsonRedirect.response.body.will_dispatch, false)
  assert.equal(jsonRedirect.response.body.will_schedule, false)
  assert.equal(JSON.stringify(jsonRedirect.response.body).includes('secret'), false)
  assert.equal(JSON.stringify(jsonRedirect.response.body).includes('token'), false)
  assert.equal(JSON.stringify(jsonRedirect.response.body).includes('cookie-value'), false)
  assert.equal(JSON.stringify(jsonRedirect.response.body).includes('authorization'), false)
  assert.equal(JSON.stringify(jsonRedirect.response.body).includes('raw'), false)

  const missingConfirm = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, start: true })
  assert.equal(missingConfirm.response.type, 'json')
  assert.equal(missingConfirm.response.status, 400)
  if (missingConfirm.response.type !== 'json') throw new Error('expected json')
  assert.equal('redirect_url' in missingConfirm.response.body, false)
  assert.equal(missingConfirm.createStateCalled, false)

  const invalidConfirm = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: 'NO', start: true })
  assert.equal(invalidConfirm.response.type, 'json')
  assert.equal(invalidConfirm.response.status, 400)
  if (invalidConfirm.response.type !== 'json') throw new Error('expected json')
  assert.equal('redirect_url' in invalidConfirm.response.body, false)

  const missingWriteCreator = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION, start: true }, { scopes: ['read:self', 'read:media', 'write:media'] })
  assert.equal(missingWriteCreator.response.type, 'json')
  assert.equal(missingWriteCreator.response.status, 400)
  if (missingWriteCreator.response.type !== 'json') throw new Error('expected json')
  assert.equal(missingWriteCreator.response.body.requested_scopes_include_write_creator, false)
  assert.equal('redirect_url' in missingWriteCreator.response.body, false)
  assert.equal(missingWriteCreator.createStateCalled, false)

  const nonAdmin = await exercise({ operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION, confirm: FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION, start: true, response_mode: FANVUE_WRITE_CREATOR_RECONNECT_JSON_REDIRECT_MODE }, { authOk: false })
  assert.equal(nonAdmin.response.type, 'json')
  assert.equal(nonAdmin.response.status, 403)
  if (nonAdmin.response.type !== 'json') throw new Error('expected json')
  assert.equal('redirect_url' in nonAdmin.response.body, false)
  assert.equal(nonAdmin.createStateCalled, false)


  console.log('Fanvue write creator reconnect route mocked tests passed')
}

run()
