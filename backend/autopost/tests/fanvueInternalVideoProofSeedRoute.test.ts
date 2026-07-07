import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_CONFIRMATION,
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_OPERATION,
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_ROUTE,
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_SECRET_HEADER,
  handleFanvueInternalVideoProofSeedRoute,
  type FanvueInternalVideoProofSeedResult,
} from '../../../lib/autopost/fanvueInternalVideoProofSeedAsset'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const nonAdminUserId = '123e4567-e89b-42d3-a456-426614174000'
const secret = 'video-seed-secret-never-returned'
const generationId = '623e4567-e89b-42d3-a456-426614174001'
const ruleId = '723e4567-e89b-42d3-a456-426614174001'
const jobId = '823e4567-e89b-42d3-a456-426614174001'

function body(overrides: Record<string, unknown> = {}) { return { operation: FANVUE_INTERNAL_VIDEO_PROOF_SEED_OPERATION, confirm: FANVUE_INTERNAL_VIDEO_PROOF_SEED_CONFIRMATION, ...overrides } }
function req(requestBody: unknown, headers: HeadersInit = {}, method = 'POST') { return new Request(`https://sirensforge.test${FANVUE_INTERNAL_VIDEO_PROOF_SEED_ROUTE}`, { method, headers: new Headers({ 'content-type': 'application/json', ...headers }), body: method === 'POST' ? JSON.stringify(requestBody) : undefined }) }
function safeResult(overrides: Partial<FanvueInternalVideoProofSeedResult> = {}): FanvueInternalVideoProofSeedResult { return { ok: true, safe_code: 'OK', generation_id_present: true, generation_id: generationId, rule_id_present: true, rule_id: ruleId, autopost_job_id_present: true, autopost_job_id: jobId, r2_object_present: true, r2_uploaded: true, generation_inserted: true, generation_reused: false, rule_inserted: true, rule_reused: false, job_inserted: true, job_reused: false, fanvue_upload_attempted: false, fanvue_post_attempted: false, dispatch_attempted: false, schedule_attempted: false, platform_registry_changed: false, public_ui_added: false, autopost_run_wired: false, ...overrides } }
async function route(input: Record<string, any> = {}) {
  let createCalls = 0
  const headers: Record<string, string> = {}
  if (input.requestSecret !== null) headers[FANVUE_INTERNAL_VIDEO_PROOF_SEED_SECRET_HEADER] = input.requestSecret ?? secret
  const response = await handleFanvueInternalVideoProofSeedRoute({
    request: req(input.requestBody === undefined ? body() : input.requestBody, headers, input.method),
    expectedSecret: secret,
    adminUserIds: userId,
    getAuthenticatedUserId: async () => { if (input.authenticatedUserId === null) throw new Error('missing auth'); return input.authenticatedUserId ?? userId },
    createSeedAsset: async ({ userId: routeUserId }) => { createCalls++; assert.equal(routeUserId, userId); return input.seedResult ?? safeResult() },
  })
  return { response, createCalls }
}
function noLeak(value: unknown) { assert.doesNotMatch(JSON.stringify(value), /server-owned-r2-bucket|fanvue\/internal-video-proof-seeds|object-bytes|signed-url|provider-id|fanvue-media-uuid|upload-id|ftyp|mdat/i) }

async function run() {
  const missingSecret = await route({ requestSecret: null })
  assert.equal(missingSecret.response.status, 401)
  assert.equal((missingSecret.response.body as any).safe_code, 'FANVUE_UPLOAD_DIAGNOSTIC_SECRET_REQUIRED')
  assert.equal(missingSecret.createCalls, 0)

  const invalidSecret = await route({ requestSecret: 'bad-secret' })
  assert.equal(invalidSecret.response.status, 403)
  assert.equal((invalidSecret.response.body as any).safe_code, 'FANVUE_UPLOAD_DIAGNOSTIC_SECRET_INVALID')
  assert.equal(invalidSecret.createCalls, 0)

  const unauthenticated = await route({ authenticatedUserId: null })
  assert.equal(unauthenticated.response.status, 401)
  assert.equal((unauthenticated.response.body as any).safe_code, 'UNAUTHENTICATED')

  const nonAdmin = await route({ authenticatedUserId: nonAdminUserId })
  assert.equal(nonAdmin.response.status, 403)
  assert.equal((nonAdmin.response.body as any).safe_code, 'FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED')

  const invalidOperation = await route({ requestBody: body({ operation: 'bad' }) })
  assert.equal(invalidOperation.response.status, 400)
  assert.equal((invalidOperation.response.body as any).safe_code, 'INVALID_OPERATION')

  const invalidConfirm = await route({ requestBody: body({ confirm: 'bad' }) })
  assert.equal(invalidConfirm.response.status, 400)
  assert.equal((invalidConfirm.response.body as any).safe_code, 'INVALID_CONFIRMATION')

  for (const key of ['file', 'bytes', 'fileBytes', 'url', 'source_asset_urls', 'externalUrl', 'browserPath', 'providerUuid', 'providerId', 'uploadId', 'mediaUuid', 'fanvueMediaUuid', 'price', 'paywall', 'publishAt', 'schedule', 'dispatch', 'platformRegistry', 'public_ui', 'providerPayload']) {
    const result = await route({ requestBody: body({ [key]: 'caller-supplied' }) })
    assert.equal(result.response.status, 400, key)
    assert.equal((result.response.body as any).safe_code, 'CALLER_SUPPLIED_FORBIDDEN_FIELD', key)
    assert.equal(result.createCalls, 0, key)
  }

  const success = await route()
  assert.equal(success.response.status, 200)
  assert.equal((success.response.body as any).ok, true)
  assert.equal((success.response.body as any).generation_id_present, true)
  assert.equal((success.response.body as any).rule_id_present, true)
  assert.equal((success.response.body as any).autopost_job_id_present, true)
  assert.equal((success.response.body as any).fanvue_upload_attempted, false)
  assert.equal((success.response.body as any).fanvue_post_attempted, false)
  assert.equal((success.response.body as any).dispatch_attempted, false)
  assert.equal((success.response.body as any).schedule_attempted, false)
  assert.equal((success.response.body as any).platform_registry_changed, false)
  assert.equal((success.response.body as any).public_ui_added, false)
  assert.equal((success.response.body as any).autopost_run_wired, false)
  noLeak(success.response.body)

  const routeSource = readFileSync('app/api/admin/autopost/fanvue/internal-video-proof-seed/route.ts', 'utf8')
  const helperSource = readFileSync('lib/autopost/fanvueInternalVideoProofSeedAsset.ts', 'utf8')
  const combined = `${routeSource}\n${helperSource}`
  assert.doesNotMatch(combined, /postFanvueInternalSinglePost|createFanvueCreatorUploadSession|createFanvueMediaPost|createFanvueTextPost|completeFanvueUploadSession|getFanvueCreatorUploadPartUrl|uploadFanvueSignedPart|waitForFanvueMediaReady|api\/autopost\/run|from [^\n]*platformRegistry|platformRegistry\./i)
  assert.doesNotMatch(routeSource, /GET\(|PUT\(|PATCH\(|DELETE\(/)
  assert.match(routeSource, /FANVUE_UPLOAD_DIAGNOSTIC_SECRET/)
  assert.match(routeSource, /FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS/)
  const runRouteSource = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  assert.doesNotMatch(runRouteSource, /internal-video-proof-seed|fanvueInternalVideoProofSeed/i)
  const platformRegistrySource = readFileSync('lib/autopost/platformRegistry.ts', 'utf8')
  assert.doesNotMatch(platformRegistrySource, /internal-video-proof-seed|fanvue_internal_video_proof_seed/i)
}

run().then(() => console.log('Fanvue internal video proof seed route tests passed')).catch((error) => { console.error(error); process.exit(1) })
