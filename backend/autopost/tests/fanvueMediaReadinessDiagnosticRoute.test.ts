import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleFanvueMediaReadinessDiagnosticRoute } from '../../../lib/autopost/fanvueMediaReadinessDiagnosticRoute'
import { FANVUE_MEDIA_READINESS_DIAGNOSTIC_CONFIRMATION, FANVUE_MEDIA_READINESS_DIAGNOSTIC_OPERATION, type FanvueMediaReadinessDiagnosticResult } from '../../../lib/autopost/fanvueMediaReadinessDiagnostic'
import type { FanvueUploadDiagnosticAccount } from '../../../lib/autopost/fanvueUploadDiagnostic'
import { FANVUE_MEDIA_READINESS_DIAGNOSTIC_SECRET_HEADER } from '../../../lib/autopost/fanvueMediaReadinessDiagnosticAuth'

const userId = '123e4567-e89b-42d3-a456-426614174000'
const secret = 'media-readiness-route-secret-never-returned'

const goodAccount: FanvueUploadDiagnosticAccount = {
  user_id: userId,
  platform: 'fanvue',
  connection_status: 'CONNECTED',
  provider_account_id: '223e4567-e89b-42d3-a456-426614174111',
  provider_username: 'creator-handle-never-returned',
  scopes: ['read:media', 'write:media', 'write:creator'],
  encrypted_access_token: 'encrypted-access-token-never-returned',
  encrypted_refresh_token: 'encrypted-refresh-token-never-returned',
  token_expires_at: '2999-01-01T00:00:00.000Z',
  metadata: { provider: 'fanvue', identity_fetched: true, isCreator: true, raw_provider_response: 'raw-provider-never-returned' },
}

function req(body: unknown, method = 'POST') {
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.set(FANVUE_MEDIA_READINESS_DIAGNOSTIC_SECRET_HEADER, secret)
  return new Request('https://sirensforge.test/api/admin/autopost/fanvue/media-readiness-diagnostic', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined })
}

const validBody = (overrides: Record<string, unknown> = {}) => ({
  operation: FANVUE_MEDIA_READINESS_DIAGNOSTIC_OPERATION,
  confirm: FANVUE_MEDIA_READINESS_DIAGNOSTIC_CONFIRMATION,
  user_id: userId,
  asset_profile: 'safe_static_image_v1',
  readiness_profile: 'bounded_extended_v1',
  ...overrides,
})

async function route(input: { body?: unknown; method?: string; authOk?: boolean; account?: FanvueUploadDiagnosticAccount | null } = {}) {
  let providerCalls = 0
  let loadCalls = 0
  let runCalls = 0
  const response = await handleFanvueMediaReadinessDiagnosticRoute({
    request: req(input.body === undefined ? validBody() : input.body, input.method),
    expectedSecret: secret,
    adminUserIds: userId,
    getAuthenticatedUserId: async () => userId,
    authorizeRequest: input.authOk === false ? async () => ({ ok: false, status: 403, error_code: 'FANVUE_MEDIA_READINESS_DIAGNOSTIC_ADMIN_REQUIRED' }) : undefined,
    createLoadAccount: () => async () => { loadCalls++; return input.account === undefined ? null : input.account },
    fetchIdentity: async () => { providerCalls++; throw new Error('identity provider should not be called by route unit tests') },
    fanvueFetch: async () => { providerCalls++; throw new Error('Fanvue API should not be called by route unit tests') },
    signedPartUploader: async () => { providerCalls++; return { ETag: 'etag-never-returned' } },
    apiBaseUrl: 'https://api.fanvue.test',
    apiVersion: '2025-06-26',
    now: () => new Date('2026-07-03T00:00:00.000Z'),
    runDiagnostic: async ({ userId: targetUserId }) => {
      runCalls++
      assert.equal(targetUserId, userId)
      return {
        ok: true,
        gate: 'FV-40DN',
        mode: 'fanvue_media_readiness_followup_diagnostic_no_post',
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
        media_finalize_status_class: 'processing',
        media_lookup_attempted: true,
        media_lookup_route_family: 'general_media_uuid',
        creator_scoped_read_route_supported_by_source: false,
        readiness_attempts: 1,
        readiness_elapsed_class: 'none',
        media_readiness_class: 'ready',
        post_attempted: false,
        dispatch_attempted: false,
        scheduled: false,
        public_exposure_attempted: false,
        platform_registry_changed: false,
        safe_code: 'FANVUE_MEDIA_READINESS_READY',
        blockers: [],
      } satisfies FanvueMediaReadinessDiagnosticResult
    },
  })
  return { response, providerCalls, loadCalls, runCalls }
}

function assertNoSensitiveLeak(value: unknown) {
  assert.doesNotMatch(JSON.stringify(value), /secret-never-returned|etag-never-returned|Authorization|Bearer|signed-upload-never-returned|upload-id-never-returned|media-uuid-never-returned|creator-user-uuid-never-returned|creator-handle-never-returned|raw-provider-never-returned|encrypted-access-token-never-returned|encrypted-refresh-token-never-returned|email|cookie|oauth/i)
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
    [{ confirm: FANVUE_MEDIA_READINESS_DIAGNOSTIC_CONFIRMATION, user_id: userId }, 'INVALID_OPERATION'],
    [{ operation: FANVUE_MEDIA_READINESS_DIAGNOSTIC_OPERATION, user_id: userId }, 'INVALID_CONFIRMATION'],
    [validBody({ user_id: 'not-a-uuid' }), 'INVALID_TARGET_USER_ID'],
    [validBody({ asset_profile: 'bad' }), 'INVALID_ASSET_PROFILE'],
    [validBody({ readiness_profile: 'bad' }), 'INVALID_READINESS_PROFILE'],
    [validBody({ creatorUserUuid: '223e4567-e89b-42d3-a456-426614174111' }), 'CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN'],
    [validBody({ uploadId: 'upload-id-never-returned' }), 'CALLER_SUPPLIED_UPLOAD_ID_FORBIDDEN'],
    [validBody({ mediaUuid: '323e4567-e89b-42d3-a456-426614174222' }), 'CALLER_SUPPLIED_MEDIA_UUID_FORBIDDEN'],
    [validBody({ signedUrl: 'https://signed-upload-never-returned.example' }), 'CALLER_SUPPLIED_SIGNED_URL_FORBIDDEN'],
    [validBody({ bytes: 'iVBORw0KGgo=' }), 'CALLER_SUPPLIED_MEDIA_CONTENT_FORBIDDEN'],
    [validBody({ caption: 'hello' }), 'POST_RELATED_FIELD_FORBIDDEN'],
    [validBody({ note: '/posts/abc' }), 'POST_RELATED_FIELD_FORBIDDEN'],
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
  assert.equal((authFailure.response.body as any).error_code, 'FANVUE_MEDIA_READINESS_DIAGNOSTIC_ADMIN_REQUIRED')
  assert.equal(authFailure.runCalls, 0)

  const success = await route()
  assert.equal(success.response.status, 200)
  assert.equal((success.response.body as any).safe_code, 'FANVUE_MEDIA_READINESS_READY')
  assert.equal((success.response.body as any).post_attempted, false)
  assert.equal(success.runCalls, 1)
  assertNoSensitiveLeak(success.response.body)

  const helperSource = readFileSync('lib/autopost/fanvueMediaReadinessDiagnosticRoute.ts', 'utf8')
  assert.doesNotMatch(helperSource, /createFanvueTextPost|createFanvueMediaPost|readFanvuePost|autopost\/run|platformRegistry/)
}

run().then(() => console.log('Fanvue media readiness diagnostic route mocked tests passed'))
