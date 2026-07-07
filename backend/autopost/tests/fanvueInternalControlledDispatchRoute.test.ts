import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FANVUE_ADMIN_CONTROLLED_DISPATCH_ENV,
  FANVUE_INTERNAL_CONTROLLED_DISPATCH_OPERATION,
  FANVUE_INTERNAL_CONTROLLED_DISPATCH_SECRET_HEADER,
  handleFanvueInternalControlledDispatchRoute,
} from '../../../lib/autopost/fanvueInternalControlledDispatchRoute'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const nonAdminUserId = '123e4567-e89b-42d3-a456-426614174000'
const jobId = '623e4567-e89b-42d3-a456-426614174000'
const ruleId = '723e4567-e89b-42d3-a456-426614174000'
const assetId = '823e4567-e89b-42d3-a456-426614174000'
const secret = 'controlled-dispatch-secret-never-returned'
const routePath = '/api/admin/autopost/fanvue/internal-controlled-dispatch'

const requestBody = (overrides: Record<string, unknown> = {}) => ({ operation: FANVUE_INTERNAL_CONTROLLED_DISPATCH_OPERATION, autopost_job_id: jobId, ...overrides })
function req(body: unknown, headers: HeadersInit = {}, method = 'POST') {
  return new Request(`https://sirensforge.test${routePath}`, { method, headers: new Headers({ 'content-type': 'application/json', ...headers }), body: method === 'POST' ? JSON.stringify(body) : undefined })
}

async function exercise(input: Record<string, any> = {}) {
  let loadJobCalls = 0
  let loadRuleCalls = 0
  let loadAccountCalls = 0
  let loadApprovedMediaCalls = 0
  const headers: Record<string, string> = {}
  if (input.requestSecret !== null) headers[FANVUE_INTERNAL_CONTROLLED_DISPATCH_SECRET_HEADER] = input.requestSecret ?? secret
  const response = await handleFanvueInternalControlledDispatchRoute({
    request: req(input.requestBody === undefined ? requestBody() : input.requestBody, headers, input.method),
    expectedSecret: input.expectedSecret === undefined ? secret : input.expectedSecret,
    adminUserIds: input.adminUserIds === undefined ? userId : input.adminUserIds,
    env: { [FANVUE_ADMIN_CONTROLLED_DISPATCH_ENV]: input.envGate ?? 'true' },
    getAuthenticatedUserId: async () => {
      if (input.authenticatedUserId === null) throw new Error('missing auth')
      return input.authenticatedUserId ?? userId
    },
    loadJob: input.loadJob ?? (async () => { loadJobCalls++; return { id: jobId, user_id: userId, rule_id: ruleId, platform: 'fanvue', payload: input.jobPayload ?? {}, state: 'QUEUED', result: input.jobResult ?? null, error: null } }),
    loadRule: input.loadRule ?? (async () => { loadRuleCalls++; return { id: ruleId, user_id: userId, approval_state: 'APPROVED', enabled: true, selected_platforms: ['fanvue'], content_payload: input.ruleContent ?? { platform: 'fanvue', content_type: 'text', text: 'Approved caption' }, paused_at: null, revoked_at: null } }),
    loadAccount: input.loadAccount ?? (async () => { loadAccountCalls++; return { user_id: userId, platform: 'fanvue', connection_status: 'CONNECTED', scopes: input.scopes ?? ['read:media', 'write:media', 'write:creator'] } }),
    loadApprovedMedia: input.loadApprovedMedia ?? (async ({ userId: loaderUserId, sourceAssetIds }: any) => { loadApprovedMediaCalls++; assert.equal(loaderUserId, userId); assert.deepEqual(sourceAssetIds, [assetId]); return { ok: true, media: { filename: 'safe.png', mediaType: 'image', bytes: new Blob(['safe-test-bytes']) } } }),
  })
  return { response, loadJobCalls, loadRuleCalls, loadAccountCalls, loadApprovedMediaCalls }
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
  assert.doesNotMatch(JSON.stringify(body), /encrypted|refresh|access_token|providerPostUuid|safe-test-bytes|authorization|bearer|raw/i)
}

async function expectSafeCode(input: Record<string, any>, safeCode: string, status = 200) {
  const result = await exercise(input)
  assert.equal(result.response.status, status, safeCode)
  assert.equal((result.response.body as any).safe_code, safeCode, safeCode)
  assert.equal((result.response.body as any).would_dispatch, false, safeCode)
  assertDryRunOnly(result.response.body)
  return result
}

async function run() {
  const routeSource = readFileSync('app/api/admin/autopost/fanvue/internal-controlled-dispatch/route.ts', 'utf8')
  assert.doesNotMatch(routeSource, /insert\(|upsert\(|update\(|delete\(|createFanvue|uploadFanvue|completeFanvue|waitForFanvueMediaReady|refreshFanvueAccessToken|decryptAutopostToken|platformRegistry|autopost\/run/i)
  assert.match(routeSource, /FANVUE_UPLOAD_DIAGNOSTIC_SECRET/)
  assert.match(routeSource, /FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS/)
  assert.match(routeSource, /loadFanvueApprovedMedia/)

  const helperSource = readFileSync('lib/autopost/fanvueInternalControlledDispatchRoute.ts', 'utf8')
  assert.doesNotMatch(helperSource, /createFanvue|uploadFanvue|completeFanvue|waitForFanvueMediaReady|fetch\(|refreshFanvueAccessToken|decryptAutopostToken|insert\(|upsert\(|update\(|delete\(|scheduleAdvance|from [^\n]*platformRegistry|platformRegistry\.|autopost\/run/i)
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
  await expectSafeCode({ requestBody: requestBody({ dry_run: false }) }, 'FANVUE_CONTROLLED_DISPATCH_LIVE_NOT_ENABLED')
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

  await expectSafeCode({ loadJob: async () => null }, 'AUTOPOST_JOB_NOT_FOUND')
  await expectSafeCode({ loadJob: async () => ({ id: jobId, user_id: userId, rule_id: ruleId, platform: 'x', state: 'QUEUED', result: null }) }, 'FANVUE_JOB_PLATFORM_INVALID')
  await expectSafeCode({ loadJob: async () => ({ id: jobId, user_id: userId, rule_id: ruleId, platform: 'fanvue', state: 'PENDING', result: null }) }, 'FANVUE_JOB_STATE_NOT_QUEUED')
  await expectSafeCode({ loadJob: async () => ({ id: jobId, user_id: userId, rule_id: ruleId, platform: 'fanvue', state: 'SUCCEEDED', result: { result_status: 'POSTED' } }) }, 'FANVUE_JOB_STATE_NOT_QUEUED')
  await expectSafeCode({ jobResult: { result_status: 'POSTED' } }, 'FANVUE_JOB_ALREADY_POSTED')
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

  const runRouteAfter = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  assert.equal(runRouteAfter, runRouteBefore, '/api/autopost/run remains untouched')
  const registryAfter = readFileSync('lib/autopost/platformRegistry.ts', 'utf8')
  assert.equal(registryAfter, registryBefore, 'platformRegistry remains untouched')
  assert.doesNotMatch(readFileSync('app/api/autopost/platforms/route.ts', 'utf8'), /internal-controlled-dispatch|FANVUE_ADMIN_CONTROLLED_DISPATCH/)
}

run().then(() => console.log('Fanvue internal controlled dispatch dry-run route tests passed')).catch((error) => { console.error(error); process.exit(1) })
