import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getAutopostPlatformRegistry } from '../../../lib/autopost/platformRegistry'
import {
  FANVUE_POST_DIAGNOSTIC_CONFIRMATION,
  FANVUE_POST_DIAGNOSTIC_OPERATION,
  FANVUE_POST_DIAGNOSTIC_SECRET_HEADER,
  handleFanvuePostDiagnosticRoute,
} from '../../../lib/autopost/fanvuePostDiagnosticRoute'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const nonAdminUserId = '123e4567-e89b-42d3-a456-426614174000'
const secret = 'post-diagnostic-secret-never-returned'

const validBody = (overrides: Record<string, unknown> = {}) => ({
  operation: FANVUE_POST_DIAGNOSTIC_OPERATION,
  confirm: FANVUE_POST_DIAGNOSTIC_CONFIRMATION,
  preflight: true,
  user_id: userId,
  content_profile: 'plain_text_diagnostic_only',
  post_mode: 'preflight_only',
  ...overrides,
})

function req(body: unknown, headers: HeadersInit = {}, method = 'POST') {
  const requestHeaders = new Headers({ 'content-type': 'application/json', ...headers })
  return new Request('https://sirensforge.test/api/admin/autopost/fanvue/post-diagnostic', {
    method,
    headers: requestHeaders,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

async function route(input: { body?: unknown; requestSecret?: string | null; authenticatedUserId?: string | null; adminUserIds?: string[] | string | null; method?: string } = {}) {
  const headers: Record<string, string> = {}
  if (input.requestSecret !== null) headers[FANVUE_POST_DIAGNOSTIC_SECRET_HEADER] = input.requestSecret ?? secret
  return handleFanvuePostDiagnosticRoute({
    request: req(input.body === undefined ? validBody() : input.body, headers, input.method),
    expectedSecret: secret,
    adminUserIds: input.adminUserIds === undefined ? userId : input.adminUserIds,
    getAuthenticatedUserId: async () => {
      if (input.authenticatedUserId === null) throw new Error('unauthenticated')
      return input.authenticatedUserId ?? userId
    },
  })
}

function assertNoSensitiveLeak(value: unknown) {
  assert.doesNotMatch(JSON.stringify(value), /secret-never-returned|access[_-]?token|refresh[_-]?token|oauth|cookie|authorization|bearer|signed|encrypted|bytes|media contents|creator-user-uuid-never-returned|upload-id-never-returned|media-uuid-never-returned|post-uuid-never-returned|etag|username|handle|email|raw provider|raw_provider/i)
}

async function run() {
  assert.equal((await route({ requestSecret: null })).status, 401)
  assert.equal(((await route({ requestSecret: null })).body as any).error_code, 'FANVUE_POST_DIAGNOSTIC_SECRET_REQUIRED')
  assert.equal(((await route({ requestSecret: 'wrong' })).body as any).error_code, 'FANVUE_POST_DIAGNOSTIC_SECRET_INVALID')
  assert.equal(((await route({ authenticatedUserId: null })).body as any).error_code, 'UNAUTHENTICATED')
  assert.equal(((await route({ authenticatedUserId: nonAdminUserId })).body as any).error_code, 'FANVUE_POST_DIAGNOSTIC_ADMIN_REQUIRED')
  const accepted = await route()
  assert.equal(accepted.status, 200)
  assert.equal((accepted.body as any).ok, true)

  for (const [body, code] of [
    [{ ...validBody(), operation: undefined }, 'INVALID_OPERATION'],
    [validBody({ operation: 'wrong' }), 'INVALID_OPERATION'],
    [{ ...validBody(), confirm: undefined }, 'INVALID_CONFIRMATION'],
    [validBody({ confirm: 'wrong' }), 'INVALID_CONFIRMATION'],
    [validBody({ preflight: false }), 'INVALID_PREFLIGHT'],
    [validBody({ post_mode: 'draft' }), 'INVALID_POST_MODE'],
    [validBody({ post_mode: 'live' }), 'LIVE_MODE_FORBIDDEN'],
    [validBody({ content_profile: 'live_text' }), 'INVALID_CONTENT_PROFILE'],
  ] as const) {
    const result = await route({ body })
    assert.equal(result.status, 400, code)
    assert.equal((result.body as any).error_code, code)
  }

  for (const [field, value, code] of [
    ['creatorUserUuid', 'creator-user-uuid-never-returned', 'CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN'],
    ['creator_user_uuid', 'creator-user-uuid-never-returned', 'CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN'],
    ['mediaUuid', 'media-uuid-never-returned', 'CALLER_SUPPLIED_MEDIA_UUID_FORBIDDEN'],
    ['mediaUuids', ['media-uuid-never-returned'], 'CALLER_SUPPLIED_MEDIA_UUID_FORBIDDEN'],
    ['media_uuid', 'media-uuid-never-returned', 'CALLER_SUPPLIED_MEDIA_UUID_FORBIDDEN'],
    ['media_uuids', ['media-uuid-never-returned'], 'CALLER_SUPPLIED_MEDIA_UUID_FORBIDDEN'],
    ['uploadId', 'upload-id-never-returned', 'CALLER_SUPPLIED_UPLOAD_ID_FORBIDDEN'],
    ['upload_id', 'upload-id-never-returned', 'CALLER_SUPPLIED_UPLOAD_ID_FORBIDDEN'],
    ['signedUrl', 'https://signed.example.test/x', 'CALLER_SUPPLIED_SIGNED_URL_FORBIDDEN'],
    ['bytes', 'abc', 'CALLER_SUPPLIED_MEDIA_CONTENT_FORBIDDEN'],
    ['media', 'abc', 'CALLER_SUPPLIED_MEDIA_CONTENT_FORBIDDEN'],
    ['postUuid', 'post-uuid-never-returned', 'CALLER_SUPPLIED_POST_UUID_FORBIDDEN'],
    ['post_uuid', 'post-uuid-never-returned', 'CALLER_SUPPLIED_POST_UUID_FORBIDDEN'],
    ['providerPostId', 'provider-post-id-never-returned', 'CALLER_SUPPLIED_PROVIDER_POST_ID_FORBIDDEN'],
    ['schedule', true, 'SCHEDULE_FIELD_FORBIDDEN'],
    ['dispatch', true, 'DISPATCH_FIELD_FORBIDDEN'],
    ['platformRegistry', true, 'PLATFORM_EXPOSURE_FIELD_FORBIDDEN'],
    ['price', 5, 'PRICE_PAYWALL_FIELD_FORBIDDEN'],
    ['audience', 'subs', 'AUDIENCE_TARGETING_FIELD_FORBIDDEN'],
    ['links', ['https://example.test'], 'LINKS_HASHTAGS_FIELD_FORBIDDEN'],
    ['hashtags', ['#tag'], 'LINKS_HASHTAGS_FIELD_FORBIDDEN'],
    ['providerResponse', { ok: true }, 'PROVIDER_RESPONSE_FIELD_FORBIDDEN'],
  ] as const) {
    const result = await route({ body: validBody({ [field]: value }) })
    assert.equal(result.status, 400, field)
    assert.equal((result.body as any).error_code, code, field)
  }
  assert.equal(((await route({ body: validBody({ note: 'https://api.fanvue.test/posts' }) })).body as any).error_code, 'POSTS_ROUTE_STRING_FORBIDDEN')
  assert.equal(((await route({ body: validBody({ nested: { path: '/creators/abc' } }) })).body as any).error_code, 'CREATORS_ROUTE_STRING_FORBIDDEN')

  const body: any = accepted.body
  assertNoSensitiveLeak(body)
  for (const key of ['will_decrypt_tokens', 'will_retry_refresh', 'will_call_fanvue', 'will_use_posts_route', 'will_use_creators_route', 'will_upload', 'will_finalize_media', 'will_read_media', 'will_create_post', 'will_read_post', 'will_dispatch', 'will_schedule', 'will_touch_platform_registry', 'will_expose_public_ui', 'will_mutate_supabase']) {
    assert.equal(body[key], false, key)
  }
  assert.equal(body.live_post_blocked, true)
  assert.equal(body.visibility_safe_for_live_post, false)
  assert.equal(body.cleanup_supported_by_local_source, false)
  assert.equal(body.draft_private_unpublished_mode_proven, false)
  for (const blocker of ['FANVUE_POST_VISIBILITY_UNKNOWN', 'FANVUE_POST_CLEANUP_UNKNOWN', 'FANVUE_DRAFT_PRIVATE_UNPUBLISHED_MODE_NOT_PROVEN', 'FANVUE_LIVE_POST_CREATION_NOT_APPROVED', 'FANVUE_POST_SCOPE_CHECK_NOT_PERFORMED']) {
    assert.ok(body.blockers.includes(blocker), blocker)
  }

  const source = readFileSync('lib/autopost/fanvuePostDiagnosticRoute.ts', 'utf8')
  assert.doesNotMatch(source, /import .*fanvueApiClient|createFanvueTextPost|createFanvueMediaPost|readFanvuePost|decryptAutopostToken|fanvueFetch|fetch\(|uploadFanvue|completeFanvue|waitForFanvueMediaReady/i)

  const fanvue = getAutopostPlatformRegistry().find((platform) => platform.id === 'fanvue')
  assert.equal(fanvue?.public_selectable, false)
  assert.equal(fanvue?.supports_real_posting, false)
  assert.equal(fanvue?.supports_async_dispatch, false)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
