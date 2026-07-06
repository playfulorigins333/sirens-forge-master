import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { getAutopostPlatformRegistry } from '../../../lib/autopost/platformRegistry'
import { FANVUE_SCOPE_POSTURE_DIAGNOSTIC_CONFIRMATION, FANVUE_SCOPE_POSTURE_DIAGNOSTIC_OPERATION, FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_HEADER, handleFanvueScopePostureDiagnosticRoute, type FanvueScopePostureAccount } from '../../../lib/autopost/fanvueScopePostureDiagnosticRoute'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const otherUserId = '123e4567-e89b-42d3-a456-426614174000'
const secret = 'scope-posture-secret-never-returned'
const safeScopes = ['read:post', 'write:post', 'read:media', 'write:media', 'write:creator']
const baseAccount: FanvueScopePostureAccount = { user_id: userId, platform: 'fanvue', connection_status: 'connected', scopes: safeScopes }

const validBody = (overrides: Record<string, unknown> = {}) => ({ operation: FANVUE_SCOPE_POSTURE_DIAGNOSTIC_OPERATION, confirm: FANVUE_SCOPE_POSTURE_DIAGNOSTIC_CONFIRMATION, preflight: true, user_id: userId, scope_check_profile: 'read_post_write_post_only', ...overrides })
function req(body: unknown, headers: HeadersInit = {}, method = 'POST') { return new Request('https://sirensforge.test/api/admin/autopost/fanvue/scope-posture-diagnostic', { method, headers: new Headers({ 'content-type': 'application/json', ...headers }), body: method === 'POST' ? JSON.stringify(body) : undefined }) }
async function route(input: { body?: unknown; requestSecret?: string | null; expectedSecret?: string | null; authenticatedUserId?: string | null; adminUserIds?: string[] | string | null; method?: string; rows?: FanvueScopePostureAccount[]; throwLookup?: boolean } = {}) {
  const headers: Record<string, string> = {}; if (input.requestSecret !== null) headers[FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_HEADER] = input.requestSecret ?? secret
  let lookupUserId = ''
  const result = await handleFanvueScopePostureDiagnosticRoute({ request: req(input.body === undefined ? validBody() : input.body, headers, input.method), expectedSecret: input.expectedSecret === undefined ? secret : input.expectedSecret, adminUserIds: input.adminUserIds === undefined ? userId : input.adminUserIds, getAuthenticatedUserId: async () => { if (input.authenticatedUserId === null) throw new Error('unauthenticated'); return input.authenticatedUserId ?? userId }, loadAccounts: async (id) => { lookupUserId = id; if (input.throwLookup) throw new Error('lookup'); return input.rows ?? [baseAccount] } })
  return { ...result, lookupUserId }
}
function assertNoSensitiveLeak(value: unknown) { assert.doesNotMatch(JSON.stringify(value), /scope-posture-secret-never-returned|read:post|write:post|read:media|write:media|write:creator|bearer|authorization|cookie|provider-account|provider_username|username|email|raw_provider|signed-url|upload-id|media-uuid|post-uuid|oauth|stack/i) }
async function expectBlock(body: unknown, code: string) { const result = await route({ body }); assert.equal(result.status, 400, code); assert.deepEqual((result.body as any).blockers, [code]); assertNoSensitiveLeak(result.body) }

async function run() {
  assert.deepEqual(((await route({ method: 'GET' })).body as any).blockers, ['METHOD_NOT_ALLOWED'])
  for (const [key, input] of Object.entries({ FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_NOT_CONFIGURED: { expectedSecret: null }, FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_REQUIRED: { requestSecret: null }, FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_INVALID: { requestSecret: 'wrong' }, UNAUTHENTICATED: { authenticatedUserId: null }, FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED: { adminUserIds: null }, FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_ALLOWLIST_INVALID: { adminUserIds: 'not-a-uuid' }, FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_REQUIRED: { authenticatedUserId: otherUserId } })) {
    const result = await route(input as any); assert.deepEqual((result.body as any).blockers, [key]); assertNoSensitiveLeak(result.body)
  }
  assert.deepEqual(((await route({ requestSecret: '' })).body as any).blockers, ['FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_REQUIRED'])
  assert.deepEqual(((await route({ expectedSecret: '' })).body as any).blockers, ['FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_NOT_CONFIGURED'])

  await expectBlock(null, 'INVALID_BODY'); await expectBlock([], 'INVALID_BODY'); await expectBlock(validBody({ operation: 'wrong' }), 'INVALID_OPERATION'); await expectBlock(validBody({ confirm: 'wrong' }), 'INVALID_CONFIRMATION')
  for (const value of [false, 'true', null, 1]) await expectBlock(validBody({ preflight: value }), 'INVALID_PREFLIGHT')
  for (const value of [undefined, 1, null, 'not-a-uuid', otherUserId]) await expectBlock(validBody({ user_id: value }), 'INVALID_TARGET_USER_ID')
  await expectBlock(validBody({ scope_check_profile: 'wrong' }), 'INVALID_SCOPE_CHECK_PROFILE')
  await expectBlock(validBody({ scope_check_profile: null }), 'INVALID_SCOPE_CHECK_PROFILE')

  for (const field of ['token','accessToken','access_token','refreshToken','refresh_token','secret','authHeader','auth_header','authorization','headers','cookies','providerResponse','provider_response','rawProviderResponse','raw_provider_response','providerBody','provider_body','creatorUserUuid','creator_user_uuid','creatorUuid','creator_uuid','uploadId','upload_id','uploadUuid','upload_uuid','mediaUuid','media_uuid','mediaUuids','media_uuids','signedUrl','signed_url','byteUploadOutput','byte_upload_output','postUuid','post_uuid','providerPostId','provider_post_id','dispatch','schedule','publishAt','publish_at','scheduleAt','scheduledAt','platformRegistry','publicUI','public_ui','launchFacing','launch_facing','text','caption']) await expectBlock(validBody({ nested: { [field]: 'blocked' } }), 'DANGEROUS_FIELD_FORBIDDEN')
  await expectBlock(validBody({ nested: ['safe', { path: 'https://example.invalid/posts/1' }] }), 'POSTS_ROUTE_STRING_FORBIDDEN')
  await expectBlock(validBody({ nested: { path: '/creators/abc' } }), 'CREATORS_ROUTE_STRING_FORBIDDEN')

  for (const scopes of [safeScopes, safeScopes.join(' ')]) { const result = await route({ rows: [{ ...baseAccount, scopes }] }); const body: any = result.body; assert.equal(result.lookupUserId, userId); assert.equal(body.ok, true); assert.equal(body.scope_check_performed, true); assert.equal(body.stored_scopes_shape, 'array_or_space_delimited_string'); assert.equal(body.stored_scopes_include_read_post, true); assert.equal(body.stored_scopes_include_write_post, true); assert.equal(body.stored_scopes_include_read_media, true); assert.equal(body.stored_scopes_include_write_media, true); assert.equal(body.stored_scopes_include_write_creator, true); assert.deepEqual(body.blockers, []); for (const key of ['will_decrypt_tokens','will_retry_refresh','will_call_fanvue','will_use_posts_route','will_use_creators_route','will_upload','will_create_post','will_read_post','will_dispatch','will_schedule','will_mutate_supabase','will_expose_public_ui','will_touch_platformRegistry','will_expose_launch_facing_fanvue']) assert.equal(body[key], false); assertNoSensitiveLeak(body) }
  for (const scopes of [null, undefined, [], '']) assert.deepEqual(((await route({ rows: [{ ...baseAccount, scopes }] })).body as any).blockers, ['FANVUE_STORED_SCOPES_MISSING'])
  assert.deepEqual(((await route({ rows: [{ ...baseAccount, scopes: ['write:post'] }] })).body as any).blockers, ['FANVUE_READ_POST_SCOPE_MISSING'])
  assert.deepEqual(((await route({ rows: [{ ...baseAccount, scopes: ['read:post'] }] })).body as any).blockers, ['FANVUE_WRITE_POST_SCOPE_MISSING'])
  for (const scopes of [{}, 1, ['read:post', 1], [['read:post']]]) assert.deepEqual(((await route({ rows: [{ ...baseAccount, scopes }] })).body as any).blockers, ['FANVUE_STORED_SCOPES_UNEXPECTED_SHAPE'])
  assert.deepEqual(((await route({ rows: [] })).body as any).blockers, ['FANVUE_CONNECTED_ROW_NOT_FOUND'])
  for (const account of [
    { ...baseAccount, connection_status: 'connected' },
    { ...baseAccount, connection_status: 'CONNECTED' },
    { ...baseAccount, connection_status: undefined, status: 'connected' },
    { ...baseAccount, connection_status: undefined, status: 'CONNECTED' },
  ]) {
    const body: any = (await route({ rows: [account] })).body
    assert.equal(body.ok, true)
    assert.equal(body.connection_status_connected, true)
  }
  assert.deepEqual(((await route({ rows: [{ ...baseAccount, connection_status: 'expired' }] })).body as any).blockers, ['FANVUE_CONNECTION_STATUS_NOT_CONNECTED'])
  assert.deepEqual(((await route({ rows: [baseAccount, baseAccount] })).body as any).blockers, ['FANVUE_MULTIPLE_CONNECTION_ROWS_BLOCKED'])
  assert.deepEqual(((await route({ rows: [{ ...baseAccount, user_id: otherUserId }] })).body as any).blockers, ['FANVUE_TARGET_USER_MISMATCH'])
  assert.deepEqual(((await route({ throwLookup: true })).body as any).blockers, ['FANVUE_SCOPE_POSTURE_ACCOUNT_LOOKUP_FAILED'])

  const helper = readFileSync('lib/autopost/fanvueScopePostureDiagnosticRoute.ts', 'utf8')
  assert.doesNotMatch(helper, /decryptAutopostToken|refreshFanvueAccessToken|grant_type\s*[:=]|token endpoint|fanvueApiClient|fetch\(|createFanvueTextPost|createFanvueMediaPost|readFanvuePost|upload session|signed URL|byte upload|finalize|readiness polling|schedule advancement|autopost\/run|import .*platformRegistry/i)
  assert.doesNotMatch(helper, /\/posts|\/creators/)
  const routeSource = readFileSync('app/api/admin/autopost/fanvue/scope-posture-diagnostic/route.ts', 'utf8')
  assert.match(routeSource, /FANVUE_SCOPE_POSTURE_CONNECTION_STATUS_SELECT = \["user_id", "platform", "connection_status", "scopes"\]\.join\(", "\)/)
  assert.match(routeSource, /FANVUE_SCOPE_POSTURE_STATUS_SELECT = \["user_id", "platform", "status", "scopes"\]\.join\(", "\)/)
  assert.match(routeSource, /\.from\("autopost_accounts"\)[\s\S]*\.select\(selectColumns\)[\s\S]*\.eq\("user_id", userId\)[\s\S]*\.eq\("platform", "fanvue"\)[\s\S]*\.limit\(2\)/)
  assert.match(routeSource, /selectFanvueScopePostureAccounts\(userId, FANVUE_SCOPE_POSTURE_CONNECTION_STATUS_SELECT\)[\s\S]*isUnavailableStatusColumnError\(error\)[\s\S]*selectFanvueScopePostureAccounts\(userId, FANVUE_SCOPE_POSTURE_STATUS_SELECT\)/)
  assert.doesNotMatch(routeSource, /select\(\s*[`'"]\*|encrypted_access_token|encrypted_refresh_token|provider_account_id|provider_username|metadata|insert\(|upsert\(|update\(|delete\(|rpc\(|fetch\(|createFanvue|readFanvue|upload|dispatch|schedule|platformRegistry/i)
  assert.equal(existsSync('supabase/migrations/fv-40dz.sql'), false)
  const fanvue = getAutopostPlatformRegistry().find((platform) => platform.id === 'fanvue')
  assert.equal(fanvue?.public_selectable, false); assert.equal(fanvue?.supports_real_posting, false); assert.equal(fanvue?.supports_async_dispatch, false)
}
run().catch((error) => { console.error(error); process.exit(1) })
