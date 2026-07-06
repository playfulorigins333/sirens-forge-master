import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getAutopostPlatformRegistry } from '../../../lib/autopost/platformRegistry'
import {
  FANVUE_POST_RISK_DIAGNOSTIC_DISABLED_LIVE_CONFIRMATION,
  FANVUE_POST_RISK_DIAGNOSTIC_OPERATION,
  FANVUE_POST_RISK_DIAGNOSTIC_PREFLIGHT_CONFIRMATION,
  FANVUE_POST_RISK_DIAGNOSTIC_SECRET_HEADER,
  FANVUE_POST_RISK_DIAGNOSTIC_TEXT,
  handleFanvuePostRiskDiagnosticRoute,
} from '../../../lib/autopost/fanvuePostRiskDiagnosticRoute'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const nonAdminUserId = '123e4567-e89b-42d3-a456-426614174000'
const secret = 'post-risk-diagnostic-secret-never-returned'

const validBody = (overrides: Record<string, unknown> = {}) => ({
  operation: FANVUE_POST_RISK_DIAGNOSTIC_OPERATION,
  confirm: FANVUE_POST_RISK_DIAGNOSTIC_PREFLIGHT_CONFIRMATION,
  preflight: true,
  user_id: userId,
  content_profile: 'plain_text_diagnostic_only',
  post_mode: 'single_controlled_text_post_public_risk_accepted',
  acknowledge_post_may_be_public: true,
  acknowledge_cleanup_may_be_unavailable: true,
  acknowledge_no_draft_private_unpublished_mode_proven: true,
  acknowledge_publishAt_is_not_used_as_safety_control: true,
  acknowledge_no_media_upload_or_media_reuse: true,
  acknowledge_no_dispatch_no_schedule_no_public_ui: true,
  acknowledge_live_post_creation_is_not_launch_approval: true,
  ...overrides,
})
const liveBody = () => validBody({ confirm: FANVUE_POST_RISK_DIAGNOSTIC_DISABLED_LIVE_CONFIRMATION, preflight: false })

function req(body: unknown, headers: HeadersInit = {}, method = 'POST') {
  return new Request('https://sirensforge.test/api/admin/autopost/fanvue/post-risk-diagnostic', { method, headers: new Headers({ 'content-type': 'application/json', ...headers }), body: method === 'POST' ? JSON.stringify(body) : undefined })
}

async function route(input: { body?: unknown; requestSecret?: string | null; expectedSecret?: string | null; authenticatedUserId?: string | null; adminUserIds?: string[] | string | null; method?: string } = {}) {
  const headers: Record<string, string> = {}
  if (input.requestSecret !== null) headers[FANVUE_POST_RISK_DIAGNOSTIC_SECRET_HEADER] = input.requestSecret ?? secret
  return handleFanvuePostRiskDiagnosticRoute({
    request: req(input.body === undefined ? validBody() : input.body, headers, input.method),
    expectedSecret: input.expectedSecret === undefined ? secret : input.expectedSecret,
    adminUserIds: input.adminUserIds === undefined ? userId : input.adminUserIds,
    getAuthenticatedUserId: async () => {
      if (input.authenticatedUserId === null) throw new Error('unauthenticated')
      return input.authenticatedUserId ?? userId
    },
  })
}

function assertNoSensitiveLeak(value: unknown) {
  assert.doesNotMatch(JSON.stringify(value), /secret-never-returned|access[_-]?token|refresh[_-]?token|oauth|cookie|authorization|bearer|signed|media-uuid-never-returned|creator-user-uuid-never-returned|upload-id-never-returned|post-uuid-never-returned|etag|username|handle|email|raw provider|raw_provider|stack|FANVUE_POST_RISK_DIAGNOSTIC_SECRET/i)
}

async function expectError(body: unknown, code: string) {
  const result = await route({ body })
  assert.equal(result.status, 400, code)
  assert.equal((result.body as any).error_code, code)
  assertNoSensitiveLeak(result.body)
}

async function run() {
  assert.equal((await route({ method: 'GET' })).status, 405)
  assert.equal(((await route({ expectedSecret: null })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_SECRET_NOT_CONFIGURED')
  assert.equal(((await route({ expectedSecret: '' })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_SECRET_NOT_CONFIGURED')
  assert.equal(((await route({ requestSecret: null })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_SECRET_REQUIRED')
  assert.equal(((await route({ requestSecret: '' })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_SECRET_REQUIRED')
  assert.equal(((await route({ requestSecret: 'wrong' })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_SECRET_INVALID')
  assert.equal(((await route({ requestSecret: `${secret}, ${secret}` })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_SECRET_INVALID')
  assert.equal(((await route({ authenticatedUserId: null })).body as any).error_code, 'UNAUTHENTICATED')
  assert.equal(((await route({ adminUserIds: null })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED')
  assert.equal(((await route({ adminUserIds: '' })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED')
  assert.equal(((await route({ adminUserIds: 'not-a-uuid' })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_ALLOWLIST_INVALID')
  assert.equal(((await route({ authenticatedUserId: nonAdminUserId })).body as any).error_code, 'FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_REQUIRED')

  await expectError(null, 'INVALID_BODY')
  await expectError([], 'INVALID_BODY')
  await expectError('body', 'INVALID_BODY')
  await expectError(validBody({ operation: 'wrong' }), 'INVALID_OPERATION')
  await expectError(validBody({ confirm: 'wrong' }), 'INVALID_CONFIRMATION')
  await expectError(validBody({ preflight: undefined }), 'INVALID_PREFLIGHT')
  await expectError(validBody({ confirm: FANVUE_POST_RISK_DIAGNOSTIC_DISABLED_LIVE_CONFIRMATION, preflight: true }), 'INVALID_CONFIRMATION')
  await expectError(validBody({ confirm: FANVUE_POST_RISK_DIAGNOSTIC_PREFLIGHT_CONFIRMATION, preflight: false }), 'INVALID_CONFIRMATION')
  await expectError(validBody({ content_profile: 'wrong' }), 'INVALID_CONTENT_PROFILE')
  await expectError(validBody({ post_mode: 'wrong' }), 'INVALID_POST_MODE')
  await expectError(validBody({ user_id: 1 }), 'INVALID_TARGET_USER_ID')
  const differentValidUuid = await route({ body: validBody({ user_id: '11111111-1111-4111-8111-111111111111' }) })
  assert.equal(differentValidUuid.status, 400)
  assert.equal((differentValidUuid.body as any).error_code, 'INVALID_TARGET_USER_ID')
  assertNoSensitiveLeak(differentValidUuid.body)
  for (const key of ['will_call_fanvue', 'will_use_posts_route', 'will_use_creators_route', 'will_upload', 'will_create_post', 'will_dispatch', 'will_schedule']) assert.notEqual((differentValidUuid.body as any)[key], true, key)
  await expectError(validBody({ preflight: 'true' }), 'INVALID_PREFLIGHT')

  for (const acknowledgement of ['acknowledge_post_may_be_public', 'acknowledge_cleanup_may_be_unavailable', 'acknowledge_no_draft_private_unpublished_mode_proven', 'acknowledge_publishAt_is_not_used_as_safety_control', 'acknowledge_no_media_upload_or_media_reuse', 'acknowledge_no_dispatch_no_schedule_no_public_ui', 'acknowledge_live_post_creation_is_not_launch_approval']) {
    await expectError(validBody({ [acknowledgement]: undefined }), 'INVALID_ACKNOWLEDGEMENT')
    await expectError(validBody({ [acknowledgement]: false }), 'INVALID_ACKNOWLEDGEMENT')
    await expectError(validBody({ [acknowledgement]: null }), 'INVALID_ACKNOWLEDGEMENT')
    await expectError(validBody({ [acknowledgement]: 'true' }), 'INVALID_ACKNOWLEDGEMENT')
    await expectError(validBody({ [acknowledgement]: 1 }), 'INVALID_ACKNOWLEDGEMENT')
  }

  for (const field of ['mediaUuid', 'mediaUuids', 'mediaPreviewUuid', 'uploadId', 'uploadUuid', 'creatorUserUuid', 'creatorUuid', 'creator_user_uuid', 'creator_uuid', 'postUuid', 'post_uuid', 'providerPostId', 'provider_post_id', 'signedUrl', 'signed_url', 'byteUploadOutput', 'byte_upload_output', 'etag', 'eTag', 'ETag', 'publishAt', 'publish_at', 'scheduleAt', 'scheduledAt', 'dispatch', 'schedule', 'platformRegistry', 'publicUI', 'public_ui', 'launchFacing', 'launch_facing', 'rawProviderResponse', 'providerResponse', 'raw_provider_response', 'provider_response', 'providerBody', 'provider_body', 'headers', 'cookies', 'authorization', 'authHeader', 'auth_header', 'accessToken', 'access_token', 'refreshToken', 'refresh_token', 'token', 'secret', 'handle', 'username', 'email', 'link', 'links', 'hashtag', 'hashtags', 'price', 'paywall', 'collectionUuids', 'expiresAt', 'text', 'caption']) {
    await expectError(validBody({ [field]: `${field}-never-returned` }), 'DANGEROUS_FIELD_FORBIDDEN')
  }
  await expectError(validBody({ nested: { mediaUuid: 'media-uuid-never-returned' } }), 'DANGEROUS_FIELD_FORBIDDEN')
  await expectError(validBody({ nested: { path: 'https://api.fanvue.test/posts' } }), 'POSTS_ROUTE_STRING_FORBIDDEN')
  await expectError(validBody({ nested: { path: '/creators/abc' } }), 'CREATORS_ROUTE_STRING_FORBIDDEN')

  const accepted = await route()
  assert.equal(accepted.status, 200)
  const body: any = accepted.body
  assert.equal(body.ok, true)
  assert.equal(body.route, '/api/admin/autopost/fanvue/post-risk-diagnostic')
  assert.equal(body.safe_code, 'FANVUE_POST_RISK_PREFLIGHT_LIVE_PATH_DISABLED')
  assert.equal(body.diagnostic_text, FANVUE_POST_RISK_DIAGNOSTIC_TEXT)
  assert.equal(body.audience_strategy, 'blocked_pending_supported_value')
  assert.equal(body.publishAt_used, false)
  assert.equal(body.manual_risk_acknowledgements_present, true)
  for (const key of ['will_decrypt_tokens', 'will_retry_refresh', 'will_call_fanvue', 'will_use_posts_route', 'will_use_creators_route', 'will_upload', 'will_create_post', 'will_read_post', 'will_dispatch', 'will_schedule', 'will_mutate_supabase', 'will_touch_platformRegistry', 'will_expose_public_ui', 'will_expose_launch_facing_fanvue', 'live_path_enabled', 'cleanup_proven', 'safe_visibility_proven', 'draft_private_unpublished_proven', 'readback_can_prove_safe_visibility']) assert.equal(body[key], false, key)
  for (const key of ['live_post_blocked', 'plain_text_only', 'media_blocked', 'caller_supplied_media_blocked', 'caller_supplied_creator_ids_blocked', 'caller_supplied_upload_ids_blocked', 'caller_supplied_post_ids_blocked']) assert.equal(body[key], true, key)
  for (const blocker of ['live_path_disabled_pending_later_gate', 'post_visibility_not_proven_safe', 'cleanup_not_proven', 'draft_private_unpublished_not_proven', 'publishAt_not_safety_control', 'readback_cannot_prove_safe_visibility', 'audience_value_not_selected_for_live_execution']) assert.ok(body.blockers.includes(blocker), blocker)
  assertNoSensitiveLeak(body)

  const blocked = await route({ body: liveBody() })
  assert.equal(blocked.status, 200)
  const blockedBody: any = blocked.body
  assert.equal(blockedBody.ok, false)
  assert.equal(blockedBody.preflight, false)
  assert.equal(blockedBody.safe_code, 'FANVUE_POST_RISK_LIVE_PATH_DISABLED_PENDING_LATER_GATE')
  assert.equal(blockedBody.blocked_reason, 'live_risk_path_disabled_pending_later_gate')
  assert.equal(blockedBody.live_post_blocked, true)
  assert.equal(blockedBody.live_path_enabled, false)
  for (const key of ['will_decrypt_tokens', 'will_retry_refresh', 'will_call_fanvue', 'will_use_posts_route', 'will_use_creators_route', 'will_upload', 'will_create_post', 'will_read_post', 'will_dispatch', 'will_schedule', 'will_mutate_supabase', 'will_touch_platformRegistry', 'will_expose_public_ui', 'will_expose_launch_facing_fanvue']) assert.equal(blockedBody[key], false, key)
  assertNoSensitiveLeak(blockedBody)

  const source = readFileSync('lib/autopost/fanvuePostRiskDiagnosticRoute.ts', 'utf8')
  assert.doesNotMatch(source, /import .*fanvueApiClient|import .*createFanvueTextPost|import .*createFanvueMediaPost|import .*readFanvuePost|import .*decryptAutopostToken|import .*fanvueFetch|fetch\(|uploadFanvue|completeFanvue|waitForFanvueMediaReady|import .*dispatch|import .*scheduler|import .*platformRegistry/i)
  assert.match(source, /FANVUE_POST_RISK_DIAGNOSTIC_DISABLED_LIVE_CONFIRMATION/)
  assert.match(source, /DANGEROUS_FIELDS/)
  assert.match(source, /buildDisabledLiveResult/)

  const routeSource = readFileSync('app/api/admin/autopost/fanvue/post-risk-diagnostic/route.ts', 'utf8')
  assert.doesNotMatch(routeSource, /createFanvueTextPost|createFanvueMediaPost|readFanvuePost|fanvueFetch|fetch\(|import .*upload|import .*dispatch|import .*schedule|platformRegistry/i)

  const fanvue = getAutopostPlatformRegistry().find((platform) => platform.id === 'fanvue')
  assert.equal(fanvue?.public_selectable, false)
  assert.equal(fanvue?.supports_real_posting, false)
  assert.equal(fanvue?.supports_async_dispatch, false)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
