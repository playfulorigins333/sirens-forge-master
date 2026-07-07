import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FANVUE_ADMIN_CONTROLLED_DISPATCH_ENV,
  FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_ENV,
  FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_CONFIRMATION,
  FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_OPERATION,
  FANVUE_INTERNAL_CONTROLLED_DISPATCH_OPERATION,
  FANVUE_INTERNAL_CONTROLLED_DISPATCH_SECRET_HEADER,
  FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_CONFIRMATION,
  FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_OPERATION,
  handleFanvueInternalControlledDispatchRoute,
} from '../../../lib/autopost/fanvueInternalControlledDispatchRoute'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const nonAdminUserId = '123e4567-e89b-42d3-a456-426614174000'
const jobId = '623e4567-e89b-42d3-a456-426614174000'
const ruleId = '723e4567-e89b-42d3-a456-426614174000'
const assetId = '823e4567-e89b-42d3-a456-426614174000'
const secret = 'controlled-dispatch-secret-never-returned'
const postUuid = '523e4567-e89b-42d3-a456-426614174000'
const now = new Date('2026-07-07T00:00:00.000Z')
const routePath = '/api/admin/autopost/fanvue/internal-controlled-dispatch'

const requestBody = (overrides: Record<string, unknown> = {}) => ({ operation: FANVUE_INTERNAL_CONTROLLED_DISPATCH_OPERATION, autopost_job_id: jobId, ...overrides })
const videoBody = (overrides: Record<string, unknown> = {}) => ({ operation: FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_OPERATION, autopost_job_id: jobId, dry_run: true, confirm: FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_CONFIRMATION, ...overrides })
const liveBody = (overrides: Record<string, unknown> = {}) => ({ operation: FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_OPERATION, autopost_job_id: jobId, dry_run: false, confirm: FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_CONFIRMATION, ...overrides })
function req(body: unknown, headers: HeadersInit = {}, method = 'POST') {
  return new Request(`https://sirensforge.test${routePath}`, { method, headers: new Headers({ 'content-type': 'application/json', ...headers }), body: method === 'POST' ? JSON.stringify(body) : undefined })
}

async function exercise(input: Record<string, any> = {}) {
  let loadJobCalls = 0
  let loadRuleCalls = 0
  let loadAccountCalls = 0
  let loadApprovedMediaCalls = 0
  let adapterCalls = 0
  let persisted = 0
  const headers: Record<string, string> = {}
  if (input.requestSecret !== null) headers[FANVUE_INTERNAL_CONTROLLED_DISPATCH_SECRET_HEADER] = input.requestSecret ?? secret
  const response = await handleFanvueInternalControlledDispatchRoute({
    request: req(input.requestBody === undefined ? requestBody() : input.requestBody, headers, input.method),
    expectedSecret: input.expectedSecret === undefined ? secret : input.expectedSecret,
    adminUserIds: input.adminUserIds === undefined ? userId : input.adminUserIds,
    env: { [FANVUE_ADMIN_CONTROLLED_DISPATCH_ENV]: input.envGate ?? 'true', [FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_ENV]: input.liveEnvGate ?? 'true' },
    getAuthenticatedUserId: async () => {
      if (input.authenticatedUserId === null) throw new Error('missing auth')
      return input.authenticatedUserId ?? userId
    },
    loadJob: input.loadJob ?? (async () => { loadJobCalls++; return { id: jobId, user_id: userId, rule_id: ruleId, platform: 'fanvue', payload: input.jobPayload ?? {}, state: 'QUEUED', result: input.jobResult ?? null, error: null } }),
    loadRule: input.loadRule ?? (async () => { loadRuleCalls++; return { id: ruleId, user_id: userId, approval_state: 'APPROVED', enabled: true, selected_platforms: ['fanvue'], content_payload: input.ruleContent ?? { platform: 'fanvue', content_type: 'text', text: 'Approved caption' }, paused_at: null, revoked_at: null } }),
    loadAccount: input.loadAccount ?? (async () => { loadAccountCalls++; return { user_id: userId, platform: 'fanvue', connection_status: 'CONNECTED', encrypted_access_token: 'encrypted-token-never-returned', encrypted_refresh_token: 'encrypted-refresh-token-never-returned', token_expires_at: new Date(now.getTime() + 3600000).toISOString(), scopes: input.scopes ?? ['read:media', 'write:media', 'write:creator'] } }),
    loadApprovedMedia: input.loadApprovedMedia ?? (async ({ userId: loaderUserId, sourceAssetIds }: any) => { loadApprovedMediaCalls++; assert.equal(loaderUserId, userId); assert.deepEqual(sourceAssetIds, [assetId]); return { ok: true, media: { filename: 'safe.png', mediaType: 'image', bytes: new Blob(['safe-test-bytes']) } } }),
    persistProof: input.persistProof ?? (async (proof: any) => { persisted++; assert.equal(proof.providerPostUuid, postUuid); return { ok: true, job_proof_persisted: true, audit_log_persisted: true } }),
    adapter: input.adapter ?? (async (adapterInput: any) => { adapterCalls++; assert.equal(adapterInput.content.platform, 'fanvue'); return { ok: true, safe_code: 'FANVUE_INTERNAL_SINGLE_POST_CREATED', platform: 'fanvue', live_attempted: true, content_type: adapterInput.content.content_type, text_present: Boolean(adapterInput.content.text), media_asset_present: Boolean(adapterInput.content.media), token_refresh_attempted: false, token_refresh_status_class: 'not_attempted', upload_attempted: Boolean(adapterInput.content.media), upload_session_status_class: adapterInput.content.media ? '2xx' : 'not_attempted', signed_url_status_class: adapterInput.content.media ? '2xx' : 'not_attempted', byte_upload_status_class: adapterInput.content.media ? '2xx' : 'not_attempted', finalize_status_class: adapterInput.content.media ? '2xx' : 'not_attempted', readiness_checked: Boolean(adapterInput.content.media), readiness_ready: Boolean(adapterInput.content.media), create_attempted: true, create_status_class: '2xx', provider_post_uuid_present: true, provider_post_uuid: postUuid, upload_cleanup_supported: false, uploaded_media_may_remain_in_creator_media_library: Boolean(adapterInput.content.media), price_used: false, publishAt_used: false, dispatch_attempted: false, schedule_attempted: false, platform_registry_changed: false, public_ui_added: false, supabase_mutated: false, safe_error_message: null } }),
    adapterDependencies: { apiBaseUrl: 'https://api.test.fanvue.example', apiVersion: '2025-01-01', fanvueFetch: async () => { throw new Error('mock adapter prevents provider calls') }, fetchIdentity: async () => { throw new Error('mock adapter prevents identity calls') }, signedPartUploader: async () => { throw new Error('mock adapter prevents uploads') } },
    now: () => now,
  })
  return { response, loadJobCalls, loadRuleCalls, loadAccountCalls, loadApprovedMediaCalls, adapterCalls, persisted }
}

function assertDryRunOnly(body: any) {
  assert.equal(body.dry_run, true)
  assert.equal(body.fanvue_upload_attempted, false)
  assert.equal(body.fanvue_post_attempted, false)
  assert.equal(body.supabase_mutated, false)
  assert.equal(body.r2_mutated, false)
  assert.equal(body.schedule_advanced, false)
  assert.equal(body.dispatch_attempted, false)
  assert.equal(body.platform_registry_changed, false)
  assert.equal(body.public_ui_added, false)
  assert.equal(body.autopost_run_wired, false)
  assert.equal(body.provider_post_uuid_present, false)
  assert.doesNotMatch(JSON.stringify(body), /encrypted-token|encrypted-refresh|providerPostUuid|523e4567-e89b-42d3-a456-426614174000|safe-test-bytes|authorization|bearer|raw_provider/i)
}

async function expectSafeCode(input: Record<string, any>, safeCode: string, status = 200) {
  const result = await exercise(input)
  assert.equal(result.response.status, status, safeCode)
  assert.equal((result.response.body as any).safe_code, safeCode, safeCode)
  assert.equal((result.response.body as any).would_dispatch, false, safeCode)
  if ((result.response.body as any).dry_run !== false) assertDryRunOnly(result.response.body)
  assert.equal(result.adapterCalls, 0, safeCode)
  assert.equal(result.persisted, 0, safeCode)
  return result
}

async function run() {
  const routeSource = readFileSync('app/api/admin/autopost/fanvue/internal-controlled-dispatch/route.ts', 'utf8')
  assert.doesNotMatch(routeSource, /upsert\(|delete\(|encrypted-token-never-returned|autopost\/run/i)
  assert.match(routeSource, /FANVUE_UPLOAD_DIAGNOSTIC_SECRET/)
  assert.match(routeSource, /FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS/)
  assert.match(routeSource, /loadFanvueApprovedMedia/)

  const helperSource = readFileSync('lib/autopost/fanvueInternalControlledDispatchRoute.ts', 'utf8')
  assert.doesNotMatch(helperSource, /fetch\(|insert\(|upsert\(|update\(|delete\(|scheduleAdvance|from [^\n]*platformRegistry|platformRegistry\.|autopost\/run/i)
  assert.match(helperSource, new RegExp(FANVUE_INTERNAL_CONTROLLED_DISPATCH_OPERATION))

  const runRouteBefore = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  assert.doesNotMatch(runRouteBefore, /internal-controlled-dispatch|FanvueInternalControlled|FANVUE_ADMIN_CONTROLLED_DISPATCH|fanvueInternalControlled/i)
  const registryBefore = readFileSync('lib/autopost/platformRegistry.ts', 'utf8')
  assert.doesNotMatch(registryBefore, /public_selectable:\s*true/)

  await expectSafeCode({ envGate: 'false' }, 'FANVUE_ADMIN_CONTROLLED_DISPATCH_GATE_DISABLED')
  await expectSafeCode({ requestSecret: null }, 'FANVUE_UPLOAD_DIAGNOSTIC_SECRET_REQUIRED', 401)
  await expectSafeCode({ requestSecret: 'wrong' }, 'FANVUE_UPLOAD_DIAGNOSTIC_SECRET_INVALID', 403)
  await expectSafeCode({ authenticatedUserId: null }, 'UNAUTHENTICATED', 401)
  await expectSafeCode({ authenticatedUserId: nonAdminUserId }, 'FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED', 403)
  await expectSafeCode({ requestBody: { autopost_job_id: jobId } }, 'INVALID_OPERATION', 400)
  await expectSafeCode({ requestBody: requestBody({ operation: 'wrong' }) }, 'INVALID_OPERATION', 400)
  await expectSafeCode({ requestBody: videoBody({ confirm: 'bad' }) }, 'INVALID_CONFIRMATION', 400)
  await expectSafeCode({ requestBody: videoBody({ dry_run: false }) }, 'INVALID_DRY_RUN', 400)
  await expectSafeCode({ requestBody: liveBody(), liveEnvGate: 'false' }, 'FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_GATE_DISABLED')
  await expectSafeCode({ requestBody: requestBody({ dry_run: false, confirm: FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_CONFIRMATION }) }, 'INVALID_OPERATION', 400)
  for (const confirm of [undefined, 'bad', FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_CONFIRMATION.toLowerCase(), ` ${FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_CONFIRMATION}`]) {
    await expectSafeCode({ requestBody: liveBody({ confirm }) }, 'INVALID_CONFIRMATION', 400)
  }
  await expectSafeCode({ requestBody: requestBody({ dry_run: 'true' }) }, 'INVALID_DRY_RUN', 400)
  await expectSafeCode({ requestBody: { operation: FANVUE_INTERNAL_CONTROLLED_DISPATCH_OPERATION } }, 'AUTOPOST_JOB_ID_REQUIRED', 400)
  await expectSafeCode({ requestBody: requestBody({ autopost_job_id: 'not-a-uuid' }) }, 'AUTOPOST_JOB_ID_INVALID', 400)

  const omittedDryRun = await exercise({ requestBody: { operation: FANVUE_INTERNAL_CONTROLLED_DISPATCH_OPERATION, autopost_job_id: jobId } })
  assert.equal(omittedDryRun.response.status, 200)
  assert.equal((omittedDryRun.response.body as any).ok, true)
  assert.equal((omittedDryRun.response.body as any).would_dispatch, true)
  assertDryRunOnly(omittedDryRun.response.body)

  for (const key of ['text', 'caption', 'media', 'file', 'bytes', 'fileBytes', 'file_url', 'fileUrl', 'url', 'source_asset_urls', 'providerPostUuid', 'provider_post_uuid', 'mediaUuid', 'mediaUuids', 'uploadId', 'postUuid', 'audience', 'price', 'paywall', 'publishAt', 'schedule', 'dispatch', 'platformRegistry', 'publicUi', 'dryRun', 'providerPayload']) {
    await expectSafeCode({ requestBody: requestBody({ [key]: 'caller-supplied' }) }, 'CALLER_SUPPLIED_FORBIDDEN_FIELD', 400)
  }


  for (const key of ['scan', 'list', 'bulk', 'limit', 'cursor', 'job_ids', 'autopost_job_ids', 'platform', 'payload', 'content_payload', 'random_unknown_key']) {
    for (const makeBody of [requestBody, liveBody, videoBody]) {
      const result = await exercise({ requestBody: makeBody({ [key]: 'caller-supplied' }) })
      assert.equal(result.response.status, 400, key)
      assert.equal((result.response.body as any).safe_code, 'CALLER_SUPPLIED_UNKNOWN_FIELD', key)
      assert.equal(result.loadJobCalls, 0, key)
      assert.equal(result.loadRuleCalls, 0, key)
      assert.equal(result.loadAccountCalls, 0, key)
      assert.equal(result.loadApprovedMediaCalls, 0, key)
      assert.equal(result.adapterCalls, 0, key)
      assert.equal(result.persisted, 0, key)
    }
  }

  await expectSafeCode({ loadJob: async () => null }, 'AUTOPOST_JOB_NOT_FOUND')
  await expectSafeCode({ loadJob: async () => ({ id: jobId, user_id: userId, rule_id: ruleId, platform: 'x', state: 'QUEUED', result: null }) }, 'FANVUE_JOB_PLATFORM_INVALID')
  await expectSafeCode({ loadJob: async () => ({ id: jobId, user_id: userId, rule_id: ruleId, platform: 'fanvue', state: 'PENDING', result: null }) }, 'FANVUE_JOB_STATE_NOT_QUEUED')
  await expectSafeCode({ loadJob: async () => ({ id: jobId, user_id: userId, rule_id: ruleId, platform: 'fanvue', state: 'SUCCEEDED', result: { result_status: 'POSTED' } }) }, 'FANVUE_JOB_STATE_NOT_QUEUED')
  await expectSafeCode({ jobResult: { result_status: 'POSTED' } }, 'FANVUE_JOB_ALREADY_POSTED')
  await expectSafeCode({ jobResult: { provider_post_uuid_present: true } }, 'FANVUE_JOB_ALREADY_POSTED')
  await expectSafeCode({ jobResult: { posted: true } }, 'FANVUE_JOB_ALREADY_POSTED')
  await expectSafeCode({ jobResult: { state: 'SUCCEEDED' } }, 'FANVUE_JOB_ALREADY_POSTED')
  await expectSafeCode({ loadRule: async () => null }, 'APPROVED_RULE_NOT_FOUND')
  await expectSafeCode({ loadRule: async () => ({ id: ruleId, user_id: userId, approval_state: 'APPROVED', enabled: false, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Approved caption' }, paused_at: null, revoked_at: null }) }, 'FANVUE_RULE_DISABLED')
  await expectSafeCode({ loadRule: async () => ({ id: ruleId, user_id: userId, approval_state: 'DRAFT', enabled: true, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Approved caption' }, paused_at: null, revoked_at: null }) }, 'FANVUE_RULE_NOT_APPROVED')
  await expectSafeCode({ loadRule: async () => ({ id: ruleId, user_id: userId, approval_state: 'APPROVED', enabled: true, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Approved caption' }, paused_at: '2026-07-07T00:00:00Z', revoked_at: null }) }, 'FANVUE_RULE_PAUSED')
  await expectSafeCode({ loadRule: async () => ({ id: ruleId, user_id: userId, approval_state: 'APPROVED', enabled: true, content_payload: { platform: 'fanvue', content_type: 'text', text: 'Approved caption' }, paused_at: null, revoked_at: '2026-07-07T00:00:00Z' }) }, 'FANVUE_RULE_REVOKED')
  await expectSafeCode({ ruleContent: { platform: 'x', content_type: 'text', text: 'bad' } }, 'CONTENT_PLATFORM_MISMATCH')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'text', text: '' } }, 'FANVUE_INTERNAL_TEXT_REQUIRED')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'text', text: 'x'.repeat(5001) } }, 'FANVUE_INTERNAL_TEXT_TOO_LONG')

  const validText = await exercise()
  const validTextBody = validText.response.body as any
  assert.equal(validTextBody.ok, true)
  assert.equal(validTextBody.safe_code, 'FANVUE_CONTROLLED_DISPATCH_DRY_RUN_ELIGIBLE')
  assert.equal(validTextBody.content_type, 'text')
  assert.equal(validTextBody.text_present, true)
  assert.equal(validTextBody.account_connected, true)
  assert.equal(validTextBody.required_scopes_present, true)
  assert.equal(validText.loadApprovedMediaCalls, 0)
  assertDryRunOnly(validTextBody)

  await expectSafeCode({ loadAccount: async () => null }, 'FANVUE_ACCOUNT_NOT_CONNECTED')
  await expectSafeCode({ loadAccount: async () => ({ user_id: userId, platform: 'fanvue', connection_status: 'DISCONNECTED', scopes: [] }) }, 'FANVUE_ACCOUNT_NOT_CONNECTED')

  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'media', source_asset_ids: [] } }, 'FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'media', source_asset_ids: [assetId, '923e4567-e89b-42d3-a456-426614174000'] } }, 'FANVUE_SERVER_OWNED_MEDIA_SINGLE_ASSET_ONLY')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'media', source_asset_urls: ['https://example.test/unsafe.png'] } }, 'FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'text_media', text: 'caption', source_asset_ids: [assetId], source_asset_urls: ['https://example.test/unsafe.png'] } }, 'FANVUE_SOURCE_ASSET_URLS_NOT_EXECUTABLE')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'media', source_asset_ids: [assetId] }, loadApprovedMedia: async () => ({ ok: false, safe_code: 'FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_COMPLETED' }) }, 'FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_COMPLETED')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'media', source_asset_ids: [assetId] }, loadApprovedMedia: async () => ({ ok: false, safe_code: 'FANVUE_SERVER_OWNED_MEDIA_R2_OBJECT_REQUIRED' }) }, 'FANVUE_SERVER_OWNED_MEDIA_R2_OBJECT_REQUIRED')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'media', source_asset_ids: [assetId] }, loadApprovedMedia: async () => ({ ok: false, safe_code: 'FANVUE_SERVER_OWNED_MEDIA_UNSUPPORTED_TYPE' }) }, 'FANVUE_SERVER_OWNED_MEDIA_UNSUPPORTED_TYPE')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'media', source_asset_ids: [assetId] }, loadApprovedMedia: async () => ({ ok: true, media: { filename: 'video.mp4', mediaType: 'video', bytes: new Blob(['video']) } }) }, 'FANVUE_SERVER_OWNED_MEDIA_UNSUPPORTED_TYPE')
  await expectSafeCode({ ruleContent: { platform: 'fanvue', content_type: 'media', source_asset_ids: [assetId] }, scopes: [] }, 'FANVUE_REQUIRED_SCOPES_MISSING')

  await expectSafeCode({ requestBody: videoBody(), ruleContent: { platform: 'fanvue', content_type: 'media_video', source_asset_urls: ['https://example.test/unsafe.mp4'] } }, 'FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED')
  await expectSafeCode({ requestBody: videoBody(), ruleContent: { platform: 'fanvue', content_type: 'media_video', source_asset_ids: [] } }, 'FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED')
  await expectSafeCode({ requestBody: videoBody(), ruleContent: { platform: 'fanvue', content_type: 'media_video', source_asset_ids: [assetId, '923e4567-e89b-42d3-a456-426614174000'] } }, 'FANVUE_SERVER_OWNED_MEDIA_SINGLE_ASSET_ONLY')
  await expectSafeCode({ requestBody: videoBody(), ruleContent: { platform: 'fanvue', content_type: 'media_video', source_asset_ids: [assetId] }, loadApprovedMedia: async () => ({ ok: false, safe_code: 'FANVUE_SERVER_OWNED_MEDIA_LOAD_FAILED' }) }, 'FANVUE_SERVER_OWNED_MEDIA_LOAD_FAILED')

  const validVideo = await exercise({ requestBody: videoBody(), ruleContent: { platform: 'fanvue', content_type: 'media_video', text: 'Approved video', source_asset_ids: [assetId] }, loadApprovedMedia: async () => ({ ok: true, media: { filename: 'video.mp4', mediaType: 'video', bytes: new Blob(['video']) } }) })
  const validVideoBody = validVideo.response.body as any
  assert.equal(validVideoBody.ok, true)
  assert.equal(validVideoBody.safe_code, 'FANVUE_CONTROLLED_VIDEO_DISPATCH_DRY_RUN_ELIGIBLE')
  assert.equal(validVideoBody.would_dispatch, true)
  assert.equal(validVideoBody.media_type, 'video')
  assert.equal(validVideoBody.media_asset_present, true)
  assert.equal(validVideoBody.server_owned_media_validated, true)
  assert.equal(validVideo.adapterCalls, 0)
  assert.equal(validVideo.persisted, 0)
  assertDryRunOnly(validVideoBody)

  const validMedia = await exercise({ ruleContent: { platform: 'fanvue', content_type: 'media', text: 'Approved media', source_asset_ids: [assetId] } })
  const validMediaBody = validMedia.response.body as any
  assert.equal(validMediaBody.ok, true)
  assert.equal(validMediaBody.would_dispatch, true)
  assert.equal(validMediaBody.content_type, 'media')
  assert.equal(validMediaBody.media_asset_present, true)
  assert.equal(validMediaBody.media_source_asset_count, 1)
  assert.equal(validMediaBody.server_owned_media_validated, true)
  assert.equal(validMedia.loadApprovedMediaCalls, 1)
  assertDryRunOnly(validMediaBody)



  const liveText = await exercise({ requestBody: liveBody() })
  const liveTextBody = liveText.response.body as any
  assert.equal(liveTextBody.ok, true)
  assert.equal(liveTextBody.dry_run, false)
  assert.equal(liveTextBody.safe_code, 'FANVUE_INTERNAL_SINGLE_POST_CREATED')
  assert.equal(liveText.adapterCalls, 1)
  assert.equal(liveText.persisted, 1)
  assert.equal(liveTextBody.proof_persisted, true)
  assert.equal(liveTextBody.audit_log_persisted, true)
  assert.equal(liveTextBody.provider_post_uuid_present, true)
  assert.equal(liveTextBody.price_used, false)
  assert.equal(liveTextBody.publishAt_used, false)
  assert.equal(liveTextBody.dispatch_attempted, false)
  assert.equal(liveTextBody.schedule_attempted, false)
  assert.equal(liveTextBody.platform_registry_changed, false)
  assert.equal(liveTextBody.public_ui_added, false)
  assert.doesNotMatch(JSON.stringify(liveTextBody), new RegExp(postUuid))

  const liveMedia = await exercise({ requestBody: liveBody(), ruleContent: { platform: 'fanvue', content_type: 'media', text: 'Approved media', source_asset_ids: [assetId] } })
  const liveMediaBody = liveMedia.response.body as any
  assert.equal(liveMediaBody.ok, true)
  assert.equal(liveMediaBody.upload_attempted, true)
  assert.equal(liveMediaBody.create_attempted, true)
  assert.equal(liveMedia.loadApprovedMediaCalls, 1)
  assert.equal(liveMedia.adapterCalls, 1)
  assert.equal(liveMedia.persisted, 1)
  assert.doesNotMatch(JSON.stringify(liveMediaBody), /safe-test-bytes|https:\/\/signed|encrypted-token|encrypted-refresh|Bearer/i)

  const providerFailed = await exercise({ requestBody: liveBody(), adapter: async () => ({ ok: false, safe_code: 'FANVUE_REQUEST_FAILED', platform: 'fanvue', live_attempted: true, content_type: 'text', text_present: true, media_asset_present: false, token_refresh_attempted: false, token_refresh_status_class: 'not_attempted', upload_attempted: false, upload_session_status_class: 'not_attempted', signed_url_status_class: 'not_attempted', byte_upload_status_class: 'not_attempted', finalize_status_class: 'not_attempted', readiness_checked: false, readiness_ready: false, create_attempted: true, create_status_class: '5xx', provider_post_uuid_present: false, provider_post_uuid: null, upload_cleanup_supported: false, uploaded_media_may_remain_in_creator_media_library: false, price_used: false, publishAt_used: false, dispatch_attempted: false, schedule_attempted: false, platform_registry_changed: false, public_ui_added: false, supabase_mutated: false, safe_error_message: 'raw provider failure' }) })
  assert.equal((providerFailed.response.body as any).ok, false)
  assert.equal((providerFailed.response.body as any).safe_code, 'FANVUE_REQUEST_FAILED')
  assert.equal(providerFailed.persisted, 0)
  assert.doesNotMatch(JSON.stringify(providerFailed.response.body), /raw provider failure|provider_post_uuid\":|encrypted-token|encrypted-refresh|Bearer|https:\/\/signed/i)

  const runRouteAfter = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  assert.equal(runRouteAfter, runRouteBefore, '/api/autopost/run remains untouched')
  const registryAfter = readFileSync('lib/autopost/platformRegistry.ts', 'utf8')
  assert.equal(registryAfter, registryBefore, 'platformRegistry remains untouched')
  assert.doesNotMatch(readFileSync('app/api/autopost/platforms/route.ts', 'utf8'), /internal-controlled-dispatch|FANVUE_ADMIN_CONTROLLED_DISPATCH/)
}

run().then(() => console.log('Fanvue internal controlled dispatch dry-run route tests passed')).catch((error) => { console.error(error); process.exit(1) })
