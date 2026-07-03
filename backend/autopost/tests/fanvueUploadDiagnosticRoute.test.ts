import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleFanvueUploadDiagnosticRoute } from '../../../lib/autopost/fanvueUploadDiagnosticRoute'
import { FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION, FANVUE_UPLOAD_DIAGNOSTIC_OPERATION, type FanvueUploadDiagnosticResult } from '../../../lib/autopost/fanvueUploadDiagnostic'
import { FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER } from '../../../lib/autopost/fanvueUploadDiagnosticAuth'

const userId = '123e4567-e89b-42d3-a456-426614174000'
const secret = 'upload-route-secret-never-returned'

function req(body: unknown, method = 'POST') {
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.set(FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER, secret)
  return new Request('https://sirensforge.test/api/admin/autopost/fanvue/upload-diagnostic', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined })
}

async function route(input: { body?: unknown; method?: string; authOk?: boolean } = {}) {
  let providerCalls = 0
  let loadCalls = 0
  let runCalls = 0
  const response = await handleFanvueUploadDiagnosticRoute({
    request: req(input.body === undefined ? { operation: FANVUE_UPLOAD_DIAGNOSTIC_OPERATION, confirm: FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION, user_id: userId } : input.body, input.method),
    expectedSecret: secret,
    adminUserIds: userId,
    getAuthenticatedUserId: async () => userId,
    authorizeRequest: input.authOk === false ? async () => ({ ok: false, status: 403, error_code: 'FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED' }) : undefined,
    createLoadAccount: () => async () => { loadCalls++; return null },
    fetchIdentity: async () => { providerCalls++; throw new Error('provider should be mocked') },
    fanvueFetch: async () => { providerCalls++; throw new Error('provider should be mocked') },
    signedPartUploader: async () => { providerCalls++; return { ETag: 'etag-never-returned' } },
    apiBaseUrl: 'https://api.fanvue.test',
    apiVersion: '2025-06-26',
    runDiagnostic: async ({ userId: targetUserId }) => {
      runCalls++
      assert.equal(targetUserId, userId)
      return {
        ok: true,
        gate: 'FV-40DG',
        mode: 'fanvue_creator_scoped_upload_diagnostic_no_post',
        account_row_present: true,
        connection_status_connected: true,
        scopes_include_read_media: true,
        scopes_include_write_media: true,
        scopes_include_write_creator: true,
        identity_layer_reached: true,
        identity_provider_status_class: '2xx',
        identity_is_creator_true: true,
        candidate_creator_user_uuid_source: 'top_level_uuid_confirmed_for_diagnostic_use',
        candidate_creator_user_uuid_present: true,
        candidate_creator_user_uuid_format_valid: true,
        candidate_creator_user_uuid_used: true,
        upload_session_attempted: true,
        upload_session_provider_status_class: '2xx',
        signed_upload_url_attempted: true,
        signed_upload_url_provider_status_class: '2xx',
        byte_upload_attempted: true,
        byte_upload_status_class: '2xx',
        media_finalize_attempted: true,
        media_finalize_provider_status_class: '2xx',
        media_lookup_attempted: true,
        media_ready_class: 'ready',
        post_attempted: false,
        dispatch_attempted: false,
        scheduled: false,
        public_exposure_attempted: false,
        platform_registry_changed: false,
        safe_code: 'FANVUE_UPLOAD_DIAGNOSTIC_OK',
        blockers: [],
      } satisfies FanvueUploadDiagnosticResult
    },
  })
  return { response, providerCalls, loadCalls, runCalls }
}

function assertNoSensitiveLeak(value: unknown) {
  assert.doesNotMatch(JSON.stringify(value), /secret-never-returned|etag-never-returned|Authorization|Bearer|signed-upload-never-returned|upload-id-never-returned|media-uuid-never-returned|creator-user-uuid-never-returned|email|username|cookie|oauth/i)
}

async function run() {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const result = await route({ method })
    assert.equal(result.response.status, 405)
    assert.equal((result.response.body as any).error_code, 'METHOD_NOT_ALLOWED')
    assert.equal(result.runCalls, 0)
  }

  for (const [body, code] of [
    [null, 'INVALID_BODY'],
    [{ confirm: FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION, user_id: userId }, 'INVALID_OPERATION'],
    [{ operation: FANVUE_UPLOAD_DIAGNOSTIC_OPERATION, user_id: userId }, 'INVALID_CONFIRMATION'],
    [{ operation: FANVUE_UPLOAD_DIAGNOSTIC_OPERATION, confirm: FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION, user_id: 'not-a-uuid' }, 'INVALID_TARGET_USER_ID'],
    [{ operation: FANVUE_UPLOAD_DIAGNOSTIC_OPERATION, confirm: FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION, user_id: userId, creatorUserUuid: '223e4567-e89b-42d3-a456-426614174111' }, 'CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN'],
    [{ operation: FANVUE_UPLOAD_DIAGNOSTIC_OPERATION, confirm: FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION, user_id: userId, caption: 'hello' }, 'POST_RELATED_FIELD_FORBIDDEN'],
    [{ operation: FANVUE_UPLOAD_DIAGNOSTIC_OPERATION, confirm: FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION, user_id: userId, note: '/posts/abc' }, 'POST_RELATED_FIELD_FORBIDDEN'],
  ] as const) {
    const result = await route({ body })
    assert.equal(result.response.status, 400)
    assert.equal((result.response.body as any).error_code, code)
    assert.equal(result.runCalls, 0)
    assert.equal(result.providerCalls, 0)
    assertNoSensitiveLeak(result.response.body)
  }

  const authFailure = await route({ authOk: false })
  assert.equal(authFailure.response.status, 403)
  assert.equal((authFailure.response.body as any).error_code, 'FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED')
  assert.equal(authFailure.runCalls, 0)

  const success = await route()
  assert.equal(success.response.status, 200)
  assert.equal((success.response.body as any).safe_code, 'FANVUE_UPLOAD_DIAGNOSTIC_OK')
  assert.equal((success.response.body as any).post_attempted, false)
  assert.equal(success.runCalls, 1)
  assertNoSensitiveLeak(success.response.body)

  const helperSource = readFileSync('lib/autopost/fanvueUploadDiagnosticRoute.ts', 'utf8')
  assert.doesNotMatch(helperSource, /createFanvueTextPost|createFanvueMediaPost|readFanvuePost|autopost\/run|platformRegistry/)
}

run().then(() => console.log('Fanvue upload diagnostic route mocked tests passed'))
