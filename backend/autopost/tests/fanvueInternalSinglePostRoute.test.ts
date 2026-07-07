import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION,
  FANVUE_INTERNAL_SINGLE_POST_OPERATION,
  FANVUE_INTERNAL_SINGLE_POST_ROUTE,
} from '../../../lib/autopost/fanvueInternalAdapter'
import {
  FANVUE_INTERNAL_SINGLE_POST_SECRET_HEADER,
  handleFanvueInternalSinglePostRoute,
} from '../../../lib/autopost/fanvueInternalSinglePostRoute'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const nonAdminUserId = '123e4567-e89b-42d3-a456-426614174000'
const jobId = '623e4567-e89b-42d3-a456-426614174000'
const ruleId = '723e4567-e89b-42d3-a456-426614174000'
const postUuid = '523e4567-e89b-42d3-a456-426614174000'
const secret = 'internal-single-post-secret-never-returned'
const now = new Date('2026-07-06T00:00:00.000Z')
const freshExpiry = new Date(now.getTime() + 3_600_000).toISOString()

const body = (overrides: Record<string, unknown> = {}) => ({ operation: FANVUE_INTERNAL_SINGLE_POST_OPERATION, autopost_job_id: jobId, ...overrides })
function req(requestBody: unknown, headers: HeadersInit = {}, method = 'POST') {
  return new Request(`https://sirensforge.test${FANVUE_INTERNAL_SINGLE_POST_ROUTE}`, { method, headers: new Headers({ 'content-type': 'application/json', ...headers }), body: method === 'POST' ? JSON.stringify(requestBody) : undefined })
}

async function route(input: Record<string, any> = {}) {
  let adapterCalls = 0
  let persisted = 0
  const headers: Record<string, string> = {}
  if (input.requestSecret !== null) headers[FANVUE_INTERNAL_SINGLE_POST_SECRET_HEADER] = input.requestSecret ?? secret
  const response = await handleFanvueInternalSinglePostRoute({
    request: req(input.requestBody === undefined ? body() : input.requestBody, headers, input.method),
    expectedSecret: secret,
    adminUserIds: userId,
    getAuthenticatedUserId: async () => {
      if (input.authenticatedUserId === null) throw new Error('missing auth')
      return input.authenticatedUserId ?? userId
    },
    loadJob: input.loadJob ?? (async () => ({ id: jobId, user_id: userId, rule_id: ruleId, platform: 'fanvue', payload: {}, state: 'QUEUED', result: null, error: null })),
    loadRule: input.loadRule ?? (async () => ({ id: ruleId, user_id: userId, approval_state: 'APPROVED', enabled: true, selected_platforms: ['fanvue'], content_payload: { platform: 'fanvue', content_type: 'text', text: 'Approved Fanvue caption' }, paused_at: null, revoked_at: null })),
    loadAccount: input.loadAccount ?? (async () => ({ user_id: userId, platform: 'fanvue', connection_status: 'CONNECTED', encrypted_access_token: 'encrypted-token-never-returned', encrypted_refresh_token: 'encrypted-refresh-token-never-returned', token_expires_at: freshExpiry, scopes: ['read:media', 'write:media', 'write:creator'] })),
    persistProof: input.persistProof ?? (async (proof: any) => { persisted++; assert.equal(proof.providerPostUuid, postUuid); return { ok: true, job_proof_persisted: true, audit_log_persisted: true } }),
    adapter: input.adapter ?? (async (adapterInput: any) => { adapterCalls++; assert.equal(adapterInput.content.text, 'Approved Fanvue caption'); return { ok: true, safe_code: 'FANVUE_INTERNAL_SINGLE_POST_CREATED', platform: 'fanvue', live_attempted: true, content_type: 'text', text_present: true, media_asset_present: false, token_refresh_attempted: false, token_refresh_status_class: 'not_attempted', upload_attempted: false, upload_session_status_class: 'not_attempted', signed_url_status_class: 'not_attempted', byte_upload_status_class: 'not_attempted', finalize_status_class: 'not_attempted', readiness_checked: false, readiness_ready: false, create_attempted: true, create_status_class: '2xx', provider_post_uuid_present: true, provider_post_uuid: postUuid, upload_cleanup_supported: false, uploaded_media_may_remain_in_creator_media_library: false, price_used: false, publishAt_used: false, dispatch_attempted: false, schedule_attempted: false, platform_registry_changed: false, public_ui_added: false, supabase_mutated: false, safe_error_message: null } }),
    adapterDependencies: { apiBaseUrl: 'https://api.test.fanvue.example', apiVersion: '2025-01-01', fanvueFetch: async () => { throw new Error('mock adapter prevents provider calls') }, fetchIdentity: async () => { throw new Error('mock adapter prevents identity calls') }, signedPartUploader: async () => { throw new Error('mock adapter prevents uploads') } },
    now: () => now,
  })
  return { response, adapterCalls, persisted }
}

function noLeak(value: unknown) {
  const text = JSON.stringify(value)
  assert.doesNotMatch(text, new RegExp(postUuid), 'full post UUID must not be exposed')
  assert.doesNotMatch(text, /encrypted-token-never-returned|encrypted-refresh-token-never-returned|authorization|bearer|raw|provider.*body|username|handle|email/i)
}

async function run() {

  const appRouteSource = readFileSync('app/api/admin/autopost/fanvue/internal-single-post/route.ts', 'utf8')
  assert.match(appRouteSource, /\.select\("id,user_id,rule_id,platform,payload,state,result,error"\)/, 'loadJob must select only production autopost_jobs columns')
  assert.doesNotMatch(appRouteSource, /select\([^)]*result_status/, 'loadJob query must not request result_status')
  const updateMatch = appRouteSource.match(/\.update\(\{([\s\S]*?)\}\)\n    \.eq\("id"/)
  assert.ok(updateMatch, 'persistProof update shape must be present')
  const updateShape = updateMatch[1]
  for (const existingColumn of ['state:', 'result:', 'error:', 'updated_at:']) assert.match(updateShape, new RegExp(existingColumn), `persistProof must update ${existingColumn}`)
  for (const missingColumn of ['platform_post_id:', 'error_code:', 'error_message:', 'locked_at:', 'lock_id:']) {
    assert.doesNotMatch(updateShape, new RegExp(`^\\s*${missingColumn}`, 'm'), `persistProof must not update missing production column ${missingColumn}`)
  }
  assert.match(updateShape, /result_status: "POSTED"/, 'persistProof stores result_status inside result JSON')
  assert.match(updateShape, /provider_post_uuid_present: true/, 'persistProof stores UUID presence only')
  assert.doesNotMatch(updateShape, /providerPostUuid/, 'persistProof update must not store full provider UUID')
  const logMetaMatch = appRouteSource.match(/meta: \{([\s\S]*?)\},\n  \}\)/)
  assert.ok(logMetaMatch, 'audit log meta must be present')
  assert.doesNotMatch(logMetaMatch![1], /providerPostUuid|platform_post_id|provider_post_uuid\s*:/, 'audit log meta must not leak full provider UUID')
  assert.match(appRouteSource, /level: \"INFO\"/, 'audit log insert must use schema-compatible uppercase INFO')
  assert.match(appRouteSource, /error: logError/, 'audit log insert error must be captured')
  assert.match(appRouteSource, /audit_log_persisted: false/, 'audit log insert failure must be reported safely')

  const platformRegistrySource = readFileSync('lib/autopost/platformRegistry.ts', 'utf8')
  assert.doesNotMatch(platformRegistrySource, /id:\s*["']fanvue["'][\s\S]{0,500}public_selectable:\s*true/, 'Fanvue must not be publicly selectable')
  const runRouteSource = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  assert.doesNotMatch(runRouteSource, /fanvueInternalSinglePost|postFanvueInternalSinglePost|fanvue\/internal-single-post/, 'run route must not wire Fanvue internal single-post dispatch')
  const preflight = await route()
  assert.equal(preflight.response.status, 200)
  assert.equal((preflight.response.body as any).dry_run, true)
  assert.equal((preflight.response.body as any).live_attempted, false)
  assert.equal(preflight.adapterCalls, 0)
  assert.equal(preflight.persisted, 0)
  noLeak(preflight.response.body)

  assert.equal((await route({ requestSecret: null })).response.status, 401)
  assert.equal(((await route({ authenticatedUserId: null })).response.body as any).error_code, 'UNAUTHENTICATED')
  assert.equal(((await route({ authenticatedUserId: nonAdminUserId })).response.body as any).error_code, 'FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED')
  assert.equal(((await route({ requestBody: body({ dry_run: false, confirm: 'bad' }) })).response.body as any).error_code, 'INVALID_CONFIRMATION')

  for (const key of ['text', 'audience', 'mediaUuid', 'mediaUuids', 'uploadId', 'postUuid', 'providerPostUuid', 'creatorUserUuid', 'providerAccountId', 'username', 'email', 'price', 'publishAt', 'expiresAt', 'collectionUuids', 'schedule', 'dispatch', 'platformRegistry', 'public_ui', 'fileBytes', 'fileUrl']) {
    const result = await route({ requestBody: body({ [key]: 'caller-supplied' }) })
    assert.equal(result.response.status, 400, key)
    assert.equal((result.response.body as any).error_code, 'CALLER_SUPPLIED_FORBIDDEN_FIELD', key)
    assert.equal(result.adapterCalls, 0, key)
  }

  const live = await route({ requestBody: body({ dry_run: false, confirm: FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION }) })
  assert.equal((live.response.body as any).ok, true)
  assert.equal(live.adapterCalls, 1)
  assert.equal(live.persisted, 1)
  assert.equal((live.response.body as any).proof_persisted, true)
  assert.equal((live.response.body as any).audit_log_persisted, true)
  assert.equal((live.response.body as any).supabase_mutated, true)
  assert.equal((live.response.body as any).provider_post_uuid_present, true)
  assert.equal((live.response.body as any).price_used, false)
  assert.equal((live.response.body as any).publishAt_used, false)
  assert.equal((live.response.body as any).dispatch_attempted, false)
  assert.equal((live.response.body as any).schedule_attempted, false)
  assert.equal((live.response.body as any).platform_registry_changed, false)
  assert.equal((live.response.body as any).public_ui_added, false)
  noLeak(live.response.body)


  const auditLogFailed = await route({
    requestBody: body({ dry_run: false, confirm: FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION }),
    persistProof: async (proof: any) => {
      assert.equal(proof.providerPostUuid, postUuid)
      return { ok: false, job_proof_persisted: true, audit_log_persisted: false }
    },
  })
  assert.equal((auditLogFailed.response.body as any).ok, false, 'audit log failure prevents reporting full success')
  assert.equal((auditLogFailed.response.body as any).proof_persisted, true)
  assert.equal((auditLogFailed.response.body as any).audit_log_persisted, false)
  assert.equal((auditLogFailed.response.body as any).supabase_mutated, true)
  noLeak(auditLogFailed.response.body)

  const createFailed = await route({ requestBody: body({ dry_run: false, confirm: FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION }), adapter: async () => ({ ok: false, safe_code: 'FANVUE_REQUEST_FAILED', platform: 'fanvue', live_attempted: true, content_type: 'text', text_present: true, media_asset_present: false, token_refresh_attempted: false, token_refresh_status_class: 'not_attempted', upload_attempted: false, upload_session_status_class: 'not_attempted', signed_url_status_class: 'not_attempted', byte_upload_status_class: 'not_attempted', finalize_status_class: 'not_attempted', readiness_checked: false, readiness_ready: false, create_attempted: true, create_status_class: '5xx', provider_post_uuid_present: false, provider_post_uuid: null, upload_cleanup_supported: false, uploaded_media_may_remain_in_creator_media_library: false, price_used: false, publishAt_used: false, dispatch_attempted: false, schedule_attempted: false, platform_registry_changed: false, public_ui_added: false, supabase_mutated: false, safe_error_message: 'safe' }) })
  assert.equal((createFailed.response.body as any).ok, false)
  assert.equal((createFailed.response.body as any).proof_persisted, false)
  assert.equal(createFailed.persisted, 0, 'proof persists only after successful create')
  noLeak(createFailed.response.body)

  const mediaBlocked = await route({ requestBody: body({ dry_run: false, confirm: FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION }), loadRule: async () => ({ id: ruleId, user_id: userId, approval_state: 'APPROVED', enabled: true, content_payload: { platform: 'fanvue', content_type: 'media', source_asset_ids: ['asset_1'] }, paused_at: null, revoked_at: null }) })
  assert.equal((mediaBlocked.response.body as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_BYTES_REQUIRED')
  assert.equal(mediaBlocked.adapterCalls, 0)
}

run().then(() => console.log('Fanvue internal single-post route tests passed')).catch((error) => { console.error(error); process.exit(1) })
