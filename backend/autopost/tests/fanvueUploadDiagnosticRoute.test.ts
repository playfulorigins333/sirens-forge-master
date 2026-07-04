import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleFanvueUploadDiagnosticRoute } from '../../../lib/autopost/fanvueUploadDiagnosticRoute'
import {
  FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION,
  FANVUE_UPLOAD_DIAGNOSTIC_OPERATION,
  FANVUE_UPLOAD_DIAGNOSTIC_PREFLIGHT_CONFIRMATION,
  type FanvueUploadDiagnosticAccount,
  type FanvueUploadDiagnosticResult,
} from '../../../lib/autopost/fanvueUploadDiagnostic'
import { FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER } from '../../../lib/autopost/fanvueUploadDiagnosticAuth'

const userId = '123e4567-e89b-42d3-a456-426614174000'
const secret = 'upload-route-secret-never-returned'

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
  headers.set(FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER, secret)
  return new Request('https://sirensforge.test/api/admin/autopost/fanvue/upload-diagnostic', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined })
}

const preflightBody = (overrides: Record<string, unknown> = {}) => ({
  operation: FANVUE_UPLOAD_DIAGNOSTIC_OPERATION,
  confirm: FANVUE_UPLOAD_DIAGNOSTIC_PREFLIGHT_CONFIRMATION,
  preflight: true,
  user_id: userId,
  ...overrides,
})

async function route(input: { body?: unknown; method?: string; authOk?: boolean; account?: FanvueUploadDiagnosticAccount | null } = {}) {
  let providerCalls = 0
  let loadCalls = 0
  let runCalls = 0
  const response = await handleFanvueUploadDiagnosticRoute({
    request: req(input.body === undefined ? { operation: FANVUE_UPLOAD_DIAGNOSTIC_OPERATION, confirm: FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION, user_id: userId } : input.body, input.method),
    expectedSecret: secret,
    adminUserIds: userId,
    getAuthenticatedUserId: async () => userId,
    authorizeRequest: input.authOk === false ? async () => ({ ok: false, status: 403, error_code: 'FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED' }) : undefined,
    createLoadAccount: () => async () => { loadCalls++; return input.account === undefined ? null : input.account },
    fetchIdentity: async () => { providerCalls++; throw new Error('identity provider should not be called by preflight tests') },
    fanvueFetch: async () => { providerCalls++; throw new Error('Fanvue API should not be called by preflight tests') },
    signedPartUploader: async () => { providerCalls++; return { ETag: 'etag-never-returned' } },
    apiBaseUrl: 'https://api.fanvue.test',
    apiVersion: '2025-06-26',
    now: () => new Date('2026-07-03T00:00:00.000Z'),
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
  assert.doesNotMatch(JSON.stringify(value), /secret-never-returned|etag-never-returned|Authorization|Bearer|signed-upload-never-returned|upload-id-never-returned|media-uuid-never-returned|creator-user-uuid-never-returned|creator-handle-never-returned|raw-provider-never-returned|encrypted-access-token-never-returned|encrypted-refresh-token-never-returned|email|cookie|oauth/i)
}

function assertPreflightNoActionFlags(body: any) {
  assert.equal(body.will_call_fanvue, false)
  assert.equal(body.will_decrypt_access_token, false)
  assert.equal(body.will_create_upload_session, false)
  assert.equal(body.will_request_signed_upload_url, false)
  assert.equal(body.will_upload_bytes, false)
  assert.equal(body.will_finalize_media, false)
  assert.equal(body.will_poll_media_readiness, false)
  assert.equal(body.will_post, false)
  assert.equal(body.will_dispatch, false)
  assert.equal(body.will_schedule, false)
  assert.equal(body.public_exposure_attempted, false)
  assert.equal(body.platform_registry_changed, false)
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

  const preflight = await route({ body: preflightBody(), account: goodAccount })
  assert.equal(preflight.response.status, 200)
  assert.equal((preflight.response.body as any).gate, 'FV-40DJ')
  assert.equal((preflight.response.body as any).mode, 'fanvue_upload_diagnostic_preflight_only')
  assert.equal((preflight.response.body as any).ready_for_live_upload_diagnostic_gate, true)
  assert.equal((preflight.response.body as any).token_freshness, 'fresh')
  assert.equal(preflight.loadCalls, 1)
  assert.equal(preflight.runCalls, 0)
  assert.equal(preflight.providerCalls, 0)
  assertPreflightNoActionFlags(preflight.response.body)
  assertNoSensitiveLeak(preflight.response.body)

  for (const body of [
    preflightBody({ confirm: undefined }),
    preflightBody({ confirm: 'invalid' }),
    preflightBody({ confirm: FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION }),
    preflightBody({ creatorUserUuid: '223e4567-e89b-42d3-a456-426614174111' }),
    preflightBody({ dispatch: true }),
    preflightBody({ schedule: true }),
    preflightBody({ platform_registry: true }),
    preflightBody({ note: '/posts/abc' }),
  ]) {
    const blocked = await route({ body, account: goodAccount })
    assert.equal(blocked.response.status, 400)
    assert.equal(blocked.loadCalls, 0)
    assert.equal(blocked.runCalls, 0)
    assert.equal(blocked.providerCalls, 0)
    assertNoSensitiveLeak(blocked.response.body)
  }

  const missingAccount = await route({ body: preflightBody(), account: null })
  assert.equal((missingAccount.response.body as any).safe_code, 'FANVUE_UPLOAD_PREFLIGHT_ACCOUNT_NOT_FOUND')
  assert.equal((missingAccount.response.body as any).account_row_present, false)
  assert.match((missingAccount.response.body as any).blockers.join('|'), /account row missing/)
  assertPreflightNoActionFlags(missingAccount.response.body)

  const missingWriteCreator = await route({ body: preflightBody(), account: { ...goodAccount, scopes: ['read:media', 'write:media'] } })
  assert.equal((missingWriteCreator.response.body as any).ready_for_live_upload_diagnostic_gate, false)
  assert.match((missingWriteCreator.response.body as any).blockers.join('|'), /write:creator scope missing/)

  const expired = await route({ body: preflightBody(), account: { ...goodAccount, token_expires_at: '2020-01-01T00:00:00.000Z' } })
  assert.equal((expired.response.body as any).token_freshness, 'stale_or_expired')
  assert.match((expired.response.body as any).blockers.join('|'), /access token freshness invalid/)

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
