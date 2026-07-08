import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  completeFanvueCreatorUploadSession,
  completeFanvueUploadSession,
  createFanvueMediaPost,
  createFanvueUploadSession,
  getFanvueUploadPartUrl,
  readFanvueMedia,
  readFanvuePost,
  uploadFanvueSignedPart,
  waitForFanvueMediaReady,
  type FanvueFetch,
} from '../../../lib/autopost/fanvueApiClientCore'
import { validateFanvueLivePostProof } from '../../../lib/autopost/fanvueProof'

const token = 'mock-token-never-returned'
const mediaUuid = '223e4567-e89b-42d3-a456-426614174000'
const postUuid = '123e4567-e89b-42d3-a456-426614174000'
const uploadId = 'mock-upload-session'
const apiBaseUrl = 'https://api.test.fanvue.example'
const config = (fetch: FanvueFetch) => ({ accessToken: token, apiBaseUrl, apiVersion: '2025-06-26', fetch })

type Call = { url: string; init: Parameters<FanvueFetch>[1] }
function response(status: number, data: unknown, retryAfter?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    headers: { get: (name: string) => name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null },
  }
}

function textResponse(status: number, body: string, options: { jsonThrows?: boolean } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => {
      if (options.jsonThrows) throw new Error('mock json parser must not be used for text/plain signed URLs')
      return JSON.parse(body)
    },
    headers: { get: () => null },
  }
}

function queueFetch(items: Array<{ status: number; data: unknown; retryAfter?: string }>, calls: Call[] = []): FanvueFetch {
  return async (url, init) => {
    assert.doesNotMatch(url, /api\.fanvue\.com/, 'tests must not call live Fanvue API')
    assert.doesNotMatch(url, /\/creators\//, 'normal connected-user scaffold must not use creator-scoped routes')
    calls.push({ url, init })
    const item = items.shift()
    assert.ok(item, `unexpected request ${init.method} ${url}`)
    return response(item.status, item.data, item.retryAfter)
  }
}

function singleFetch(responseFactory: () => ReturnType<typeof response> | ReturnType<typeof textResponse>, calls: Call[] = []): FanvueFetch {
  return async (url, init) => {
    assert.doesNotMatch(url, /api\.fanvue\.com/, 'tests must not call live Fanvue API')
    assert.doesNotMatch(url, /\/creators\//, 'normal connected-user scaffold must not use creator-scoped routes')
    calls.push({ url, init })
    return responseFactory()
  }
}

async function run() {
  const calls: Call[] = []
  const upload = await createFanvueUploadSession(config(queueFetch([{ status: 200, data: { mediaUuid, uploadId } }], calls)), {
    name: 'Mock image', filename: 'mock-image', mediaType: 'image',
  })
  assert.equal(upload.ok, true)
  assert.equal(upload.mediaUuid, mediaUuid)
  assert.equal(upload.uploadId, uploadId)
  assert.equal(calls[0].url, `${apiBaseUrl}/media/uploads`)
  assert.equal(new URL(calls[0].url).origin, apiBaseUrl)
  assert.equal(new URL(calls[0].url).pathname, '/media/uploads')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, `Bearer ${token}`)
  assert.equal(calls[0].init.headers.Authorization, undefined, 'upload-session request should match successful identity lookup header casing')
  assert.equal(calls[0].init.headers['X-Fanvue-API-Version'], '2025-06-26')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].init.headers.Accept, undefined, 'current mocked scaffold sends no Accept header')
  assert.equal(calls[0].init.headers.accept, undefined, 'current mocked scaffold sends no lowercase accept header')
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Content-Type', 'X-Fanvue-API-Version', 'authorization'].sort())
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { name: 'Mock image', filename: 'mock-image', mediaType: 'image' })
  assert.doesNotMatch(calls[0].init.body ?? '', /provider_account|providerAccount|creator|account|channel|profile|mime|fileSize|checksum|purpose/i)

  const unauthorized = await createFanvueUploadSession(config(queueFetch([{ status: 401, data: { access_token: token, signed_url: 'https://signed-upload.invalid/part-1?X-Amz-Signature=secret', raw: 'raw provider response must not leak' } }])), {
    name: 'Mock unauthorized', filename: 'mock-unauthorized.png', mediaType: 'image',
  })
  assert.equal(unauthorized.ok, false)
  assert.equal(unauthorized.error_code, 'FANVUE_UNAUTHORIZED')
  assert.equal(unauthorized.safe_error_message, 'Fanvue rejected the request authorization.')
  assert.doesNotMatch(JSON.stringify(unauthorized), new RegExp(`${token}|signed-upload|X-Amz-Signature|raw provider response`), 'unauthorized upload-session diagnostics must not leak tokens, signed URLs, or raw responses')

  const uploadFailure = await createFanvueUploadSession(config(queueFetch([{ status: 400, data: { error: 'unsupported-media-type' } }])), {
    name: 'Mock rejected', filename: 'mock.bin', mediaType: 'image',
  })
  assert.equal(uploadFailure.ok, false, 'provider upload-session rejection must be safe failure')

  calls.length = 0
  const signed = await getFanvueUploadPartUrl(config(queueFetch([{ status: 200, data: 'https://signed-upload.invalid/part-1' }], calls)), { uploadId, partNumber: 1 })
  assert.equal(signed.ok, true)
  assert.equal(signed.persisted, false, 'signed URL must not be marked persisted')
  assert.equal(calls[0].url, `${apiBaseUrl}/media/uploads/${uploadId}/parts/1/url`)
  assert.equal(calls[0].init.method, 'GET')

  calls.length = 0
  const textSigned = await getFanvueUploadPartUrl(config(singleFetch(() => textResponse(200, 'https://signed-upload.invalid/text-part?X-Amz-Signature=secret', { jsonThrows: true }), calls)), { uploadId, partNumber: 1 })
  assert.equal(textSigned.ok, true, 'documented text/plain signed URL response must succeed without response.json()')
  assert.equal(textSigned.persisted, false)
  assert.equal(calls[0].url, `${apiBaseUrl}/media/uploads/${uploadId}/parts/1/url`)

  for (const [body, label] of [
    ['', 'empty text body'],
    ['   ', 'blank text body'],
    ['not a url', 'malformed text body'],
  ] as const) {
    const rejected = await getFanvueUploadPartUrl(config(singleFetch(() => textResponse(200, body, { jsonThrows: true }))), { uploadId, partNumber: 1 })
    assert.equal(rejected.ok, false, `${label} must be rejected safely`)
    assert.equal(rejected.error_code, 'FANVUE_SIGNED_URL_MISSING')
    assert.doesNotMatch(JSON.stringify(rejected), /signed-upload|X-Amz-Signature|not a url|raw provider/i, `${label} failure must not leak raw body`)
  }

  const unsupportedEnvelope = await getFanvueUploadPartUrl(config(queueFetch([{ status: 200, data: { url: 'https://signed-upload.invalid/object-part?X-Amz-Signature=secret' } }])), { uploadId, partNumber: 1 })
  assert.equal(unsupportedEnvelope.ok, false, 'unsupported JSON object/envelope signed URL response must be rejected')
  assert.equal(unsupportedEnvelope.error_code, 'FANVUE_SIGNED_URL_MISSING')
  assert.doesNotMatch(JSON.stringify(unsupportedEnvelope), /signed-upload|X-Amz-Signature|object-part/i, 'unsupported object failure must not leak signed URL or raw body')

  const signedFailure = await getFanvueUploadPartUrl(config(queueFetch([{ status: 500, data: { raw: 'raw provider body must not leak', signed_url: 'https://signed-upload.invalid/failure?X-Amz-Signature=secret' } }])), { uploadId, partNumber: 1 })
  assert.equal(signedFailure.ok, false)
  assert.equal(signedFailure.error_code, 'FANVUE_SERVER_ERROR')
  assert.doesNotMatch(JSON.stringify(signedFailure), /signed-upload|X-Amz-Signature|raw provider body/i, 'non-200 signed URL failure must not leak provider body')

  const uploadedPart = await uploadFanvueSignedPart({
    signedUrl: 'https://signed-upload.invalid/part-1',
    partNumber: 1,
    body: Buffer.from('mock'),
    uploader: async ({ signedUrl, partNumber }) => {
      assert.equal(signedUrl, 'https://signed-upload.invalid/part-1')
      assert.equal(partNumber, 1)
      return { ETag: 'mock-etag-1' }
    },
  })
  assert.equal(uploadedPart.ok, true)
  assert.deepEqual(uploadedPart.part, { ETag: 'mock-etag-1', PartNumber: 1 })
  assert.equal(uploadedPart.proof, false, 'ETag is upload metadata, never posted proof')

  const missingEtag = await uploadFanvueSignedPart({ signedUrl: 'https://signed-upload.invalid/part-2', partNumber: 2, body: 'mock', uploader: async () => ({ ETag: '' }) })
  assert.equal(missingEtag.ok, false)
  assert.equal(missingEtag.error_code, 'FANVUE_UPLOAD_PART_ETAG_REQUIRED')

  calls.length = 0
  const complete = await completeFanvueUploadSession(config(queueFetch([{ status: 200, data: { status: 'processing' } }], calls)), { uploadId, parts: [{ ETag: 'mock-etag-1', PartNumber: 1 }] })
  assert.equal(complete.ok, true)
  assert.equal(complete.status, 'processing')
  assert.equal(calls[0].url, `${apiBaseUrl}/media/uploads/${uploadId}`)
  assert.equal(calls[0].init.method, 'PATCH')
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { parts: [{ ETag: 'mock-etag-1', PartNumber: 1 }] })

  calls.length = 0
  const creatorComplete = await completeFanvueCreatorUploadSession(config(async (url, init) => { calls.push({ url, init }); return response(200, { status: 'processing' }) }), { creatorUserUuid: mediaUuid, uploadId, parts: [{ ETag: 'mock-video-etag-1', PartNumber: 1 }] })
  assert.equal(creatorComplete.ok, true)
  assert.equal(calls[0].url, `${apiBaseUrl}/creators/${mediaUuid}/media/uploads/${uploadId}`)
  assert.equal(calls[0].init.method, 'PATCH')
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { parts: [{ ETag: 'mock-video-etag-1', PartNumber: 1 }] }, 'creator video finalize must keep the safe multipart parts payload')
  assert.doesNotMatch(calls[0].init.body ?? '', /signed|url|token|cookie|authorization|r2|bytes|provider|uuid/i, 'creator finalize payload must not include unsafe provider details')
  calls.length = 0
  const creatorVideoComplete = await completeFanvueCreatorUploadSession(config(async (url, init) => { calls.push({ url, init }); return response(200, { status: 'processing' }) }), { creatorUserUuid: mediaUuid, uploadId, parts: [{ ETag: 'mock-video-etag-1', PartNumber: 1 }], mediaType: 'video', filename: 'approved.mp4', contentType: 'video/mp4', size: 1234 })
  assert.equal(creatorVideoComplete.ok, true)
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { parts: [{ ETag: 'mock-video-etag-1', PartNumber: 1 }], filename: 'approved.mp4', contentType: 'video/mp4', size: 1234 }, 'creator video finalize must include safe video metadata')
  assert.doesNotMatch(calls[0].init.body ?? '', /signed|url|token|cookie|authorization|r2|bytes|provider|uuid/i, 'creator video finalize payload must not include unsafe provider details')

  const invalidComplete = await completeFanvueUploadSession(config(queueFetch([])), { uploadId, parts: [{ ETag: '', PartNumber: 1 }] })
  assert.equal(invalidComplete.ok, false, 'complete upload must reject missing ETag before provider call')

  const mediaPending = await readFanvueMedia(config(queueFetch([{ status: 200, data: { uuid: mediaUuid, status: 'created' } }])), { uuid: mediaUuid })
  assert.equal(mediaPending.ok, true)
  assert.equal(mediaPending.ready, false)
  assert.equal(mediaPending.terminal_failure, false)

  const sleeps: number[] = []
  const ready = await waitForFanvueMediaReady(config(queueFetch([
    { status: 200, data: { uuid: mediaUuid, status: 'created' } },
    { status: 200, data: { uuid: mediaUuid, status: 'processing' } },
    { status: 200, data: { uuid: mediaUuid, status: 'ready', mediaType: 'image', name: 'Mock image' } },
  ])), { uuid: mediaUuid, maxAttempts: 4, maxDelayMs: 5, sleep: async (ms) => { sleeps.push(ms) } })
  assert.equal(ready.ok, true)
  assert.equal(ready.proof, 'MEDIA_READY_READBACK')
  assert.equal(ready.attempts, 3)
  assert.deepEqual(sleeps, [5, 5])



  const longProcessingSleeps: number[] = []
  const longProcessingReady = await waitForFanvueMediaReady(config(queueFetch([
    { status: 200, data: { uuid: mediaUuid, status: 'created' } },
    { status: 200, data: { uuid: mediaUuid, status: 'processing' } },
    { status: 200, data: { uuid: mediaUuid, status: 'processing' } },
    { status: 200, data: { uuid: mediaUuid, status: 'processing' } },
    { status: 200, data: { uuid: mediaUuid, status: 'ready' } },
  ])), { uuid: mediaUuid, maxAttempts: 6, maxDelayMs: 5_000, backoffBaseMs: 5_000, sleep: async (ms) => { longProcessingSleeps.push(ms) } })
  assert.equal(longProcessingReady.ok, true, 'created/processing may continue for several polls before ready')
  assert.equal(longProcessingReady.attempts, 5)
  assert.deepEqual(longProcessingSleeps, [5_000, 5_000, 5_000, 5_000])

  for (const status of ['uploaded', 'complete', 'completed', 'available'] as const) {
    const unexpected = await readFanvueMedia(config(queueFetch([{ status: 200, data: { uuid: mediaUuid, status } }])), { uuid: mediaUuid })
    assert.equal(unexpected.ok, false, `${status} must not be silently treated as ready`)
    assert.equal(unexpected.error_code, 'FANVUE_MEDIA_READBACK_MALFORMED')
  }

  for (const data of [
    { uuid: mediaUuid },
    { uuid: mediaUuid, state: 'ready' },
    { uuid: mediaUuid, mediaStatus: 'ready' },
    { id: mediaUuid, status: 'ready' },
  ]) {
    const malformed = await readFanvueMedia(config(queueFetch([{ status: 200, data }])), { uuid: mediaUuid })
    assert.equal(malformed.ok, false, 'missing status or undocumented alternate fields must be rejected')
    assert.equal(malformed.error_code, 'FANVUE_MEDIA_READBACK_MALFORMED')
  }

  const errored = await waitForFanvueMediaReady(config(queueFetch([{ status: 200, data: { uuid: mediaUuid, status: 'error' } }])), { uuid: mediaUuid, maxAttempts: 3 })
  assert.equal(errored.ok, false)
  assert.equal(errored.error_code, 'FANVUE_MEDIA_PROCESSING_ERROR')

  const timedOut = await waitForFanvueMediaReady(config(queueFetch([
    { status: 200, data: { uuid: mediaUuid, status: 'created' } },
    { status: 200, data: { uuid: mediaUuid, status: 'processing' } },
  ])), { uuid: mediaUuid, maxAttempts: 2 })
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.error_code, 'FANVUE_MEDIA_READY_TIMEOUT')
  assert.equal(timedOut.safe_error_message, 'Fanvue upload completed, but media was still processing before the readiness retry limit.')
  assert.doesNotMatch(JSON.stringify(timedOut), new RegExp(`${mediaUuid}|signed-upload|X-Amz-Signature|raw provider body`), 'timeout failure must not leak media UUID, signed URL, or raw body')

  const non200Readback = await readFanvueMedia(config(queueFetch([{ status: 500, data: { uuid: mediaUuid, raw: 'raw provider body must not leak', signed_url: 'https://signed-upload.invalid/failure?X-Amz-Signature=secret' } }])), { uuid: mediaUuid })
  assert.equal(non200Readback.ok, false)
  assert.equal(non200Readback.error_code, 'FANVUE_SERVER_ERROR')
  assert.doesNotMatch(JSON.stringify(non200Readback), /signed-upload|X-Amz-Signature|raw provider body/i, 'non-200 readback must not leak provider body')

  const rateLimitedPoll = await waitForFanvueMediaReady(config(queueFetch([
    { status: 429, data: { error: 'rate_limited' }, retryAfter: '1' },
    { status: 200, data: { uuid: mediaUuid, status: 'ready' } },
  ])), { uuid: mediaUuid, maxAttempts: 3, maxDelayMs: 1, sleep: async (ms) => { assert.equal(ms, 1) } })
  assert.equal(rateLimitedPoll.ok, true, '429 during polling should be retryable within bounded attempts')

  calls.length = 0
  const createPost = await createFanvueMediaPost(config(queueFetch([{ status: 200, data: { uuid: postUuid, mediaUuids: [mediaUuid], audience: 'subscribers', text: 'caption' } }], calls)), {
    audience: 'subscribers', text: 'caption', mediaUuids: [mediaUuid], mediaPreviewUuid: mediaUuid, publishAt: null, expiresAt: null, collectionUuids: [],
  })
  assert.equal(createPost.ok, true)
  assert.equal(createPost.posted_proof, false, 'post creation response is not proof')
  assert.equal(calls[0].url, `${apiBaseUrl}/posts`)
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { audience: 'subscribers', mediaUuids: [mediaUuid], text: 'caption', mediaPreviewUuid: mediaUuid })

  const postProof = await readFanvuePost(config(queueFetch([{ status: 200, data: { uuid: postUuid, mediaUuids: [mediaUuid], audience: 'subscribers', text: 'caption', publishedAt: '2026-07-01T00:00:00.000Z' } }])), {
    uuid: postUuid, expectedText: 'caption', expectedAudience: 'subscribers', expectedMediaUuids: [mediaUuid],
  })
  assert.equal(postProof.ok, true)
  assert.equal(postProof.result_kind, 'POSTED_READY_FOR_PROOF')
  assert.ok(postProof.proof_candidate)
  const validProof = validateFanvueLivePostProof(postProof.proof_candidate)
  assert.equal(validProof.posted, true)
  assert.equal(validProof.proof?.platform_post_id, postUuid)
  assert.deepEqual(validProof.proof?.provider_media_uuids, [mediaUuid])

  const missingPublishedAt = await readFanvuePost(config(queueFetch([{ status: 200, data: { uuid: postUuid, mediaUuids: [mediaUuid], audience: 'subscribers', text: 'caption', publishAt: '2026-07-01T00:00:00.000Z' } }])), {
    uuid: postUuid, expectedText: 'caption', expectedAudience: 'subscribers', expectedMediaUuids: [mediaUuid],
  })
  assert.equal(missingPublishedAt.ok, true)
  assert.equal(missingPublishedAt.result_kind, 'SCHEDULED_CREATED')

  for (const [data, code] of [
    [{ uuid: postUuid, mediaUuids: [], audience: 'subscribers', text: 'caption', publishedAt: '2026-07-01T00:00:00.000Z' }, 'FANVUE_MEDIA_UUID_PROOF_MISMATCH'],
    [{ uuid: postUuid, mediaUuids: [mediaUuid], audience: 'followers-and-subscribers', text: 'caption', publishedAt: '2026-07-01T00:00:00.000Z' }, 'FANVUE_AUDIENCE_PROOF_MISMATCH'],
    [{ uuid: postUuid, mediaUuids: [mediaUuid], audience: 'subscribers', text: 'different', publishedAt: '2026-07-01T00:00:00.000Z' }, 'FANVUE_TEXT_PROOF_MISMATCH'],
  ] as const) {
    const mismatch = await readFanvuePost(config(queueFetch([{ status: 200, data }])), { uuid: postUuid, expectedText: 'caption', expectedAudience: 'subscribers', expectedMediaUuids: [mediaUuid] })
    assert.equal(mismatch.ok, false)
    assert.equal(mismatch.error_code, code)
  }

  const neverProofInputs = [
    { provider_post_uuid: uploadId, label: 'uploadId' },
    { provider_post_uuid: mediaUuid, provider_media_uuids: [mediaUuid], label: 'mediaUuid alone' },
    { provider_post_uuid: 'https://signed-upload.invalid/part-1', label: 'signed URL' },
    { provider_post_uuid: 'mock-etag-1', label: 'S3 ETag' },
    { provider_post_uuid: 'asset_1', label: 'local asset ID' },
    { provider_post_uuid: 'https://example.com/local-asset.jpg', label: 'local asset URL' },
    { provider_post_uuid: 'rule_1', label: 'rule ID' },
    { provider_post_uuid: 'draft_1', label: 'draft ID' },
    { provider_post_uuid: 'workflow_task_1', label: 'workflow/task ID' },
    { provider_post_uuid: 'fake-generated-id', label: 'fake ID' },
  ]
  for (const item of neverProofInputs) {
    assert.equal(validateFanvueLivePostProof({
      platform: 'fanvue', result_kind: 'POSTED_READY_FOR_PROOF', verification_needed: true,
      provider_post_uuid: item.provider_post_uuid, provider_media_uuids: item.provider_media_uuids ?? [mediaUuid],
      provider_published_at: '2026-07-01T00:00:00.000Z', provider_text: 'caption', expected_text: 'caption', provider_audience: 'subscribers', expected_audience: 'subscribers', content_hash: 'hash', api_version: '2025-06-26',
    }).posted, false, `${item.label} must not count as posted proof`)
  }
  assert.equal(validateFanvueLivePostProof({ platform: 'fanvue', result_kind: 'SCHEDULED_CREATED', verification_needed: true, provider_post_uuid: postUuid, provider_publish_at: '2026-07-01T00:00:00.000Z' }).posted, false)
  assert.equal(validateFanvueLivePostProof({ platform: 'fanvue', result_kind: 'POSTED_READY_FOR_PROOF', verification_needed: true, provider_post_uuid: postUuid, provider_published_at: null }).posted, false)

  for (const fn of [
    () => createFanvueUploadSession(config(queueFetch([{ status: 429, data: {} }])), { name: 'a', filename: 'b', mediaType: 'image' }),
    () => getFanvueUploadPartUrl(config(queueFetch([{ status: 429, data: {} }])), { uploadId, partNumber: 1 }),
    () => completeFanvueUploadSession(config(queueFetch([{ status: 429, data: {} }])), { uploadId, parts: [{ ETag: 'etag', PartNumber: 1 }] }),
    () => createFanvueMediaPost(config(queueFetch([{ status: 429, data: {} }])), { audience: 'subscribers', mediaUuids: [mediaUuid], text: 'caption' }),
    () => readFanvuePost(config(queueFetch([{ status: 429, data: {} }])), { uuid: postUuid, expectedText: 'caption', expectedAudience: 'subscribers' }),
  ]) {
    const result = await fn()
    assert.equal(result.ok, false)
    assert.equal(result.error_code, 'FANVUE_RATE_LIMITED')
    assert.ok(!('platform_post_id' in result), 'retryable 429 must not set platform_post_id')
  }

  const oauth = readFileSync('lib/autopost/fanvueOAuth.ts', 'utf8')
  const approvedScopesMatch = oauth.match(/export const FANVUE_APPROVED_SCOPES = \[([\s\S]*?)\] as const/)
  assert.ok(approvedScopesMatch, 'Fanvue approved scopes must be declared')
  const approvedScopes = Array.from(approvedScopesMatch[1].matchAll(/"([^"]+)"/g), (match) => match[1])
  assert.ok(approvedScopes.includes('write:creator'), 'write:creator may be approved for explicit admin-gated creator diagnostics')
  const defaultScopesMatch = oauth.match(/export const FANVUE_DEFAULT_REQUESTED_SCOPES = \[([\s\S]*?)\] as const/)
  assert.ok(defaultScopesMatch, 'Fanvue default requested scopes must be declared separately')
  const defaultScopes = Array.from(defaultScopesMatch[1].matchAll(/"([^"]+)"/g), (match) => match[1])
  assert.ok(!defaultScopes.includes('write:creator'), 'write:creator must not be default requested')
  const requiredScopesMatch = oauth.match(/export const FANVUE_REQUIRED_CONNECTION_SCOPES = \[([\s\S]*?)\] as const/)
  assert.ok(requiredScopesMatch, 'Fanvue required connection scopes must be declared separately')
  const requiredScopes = Array.from(requiredScopesMatch[1].matchAll(/"([^"]+)"/g), (match) => match[1])
  assert.ok(!requiredScopes.includes('write:creator'), 'write:creator must not be required for base connection')
  const optionalCreatorScopesMatch = oauth.match(/export const FANVUE_OPTIONAL_CREATOR_UPLOAD_SCOPES = \[([\s\S]*?)\] as const/)
  assert.ok(optionalCreatorScopesMatch, 'Fanvue optional creator upload scopes must be declared separately')
  const optionalCreatorScopes = Array.from(optionalCreatorScopesMatch[1].matchAll(/"([^"]+)"/g), (match) => match[1])
  assert.deepEqual(optionalCreatorScopes, ['write:creator'], 'write:creator must remain isolated to the optional creator upload scope set')
  const client = readFileSync('lib/autopost/fanvueApiClientCore.ts', 'utf8')
  const connectedUserUploadSessionSource = client.match(/export async function createFanvueUploadSession[\s\S]*?^}/m)?.[0] ?? ''
  const connectedUserSignedUrlSource = client.match(/export async function getFanvueUploadPartUrl[\s\S]*?^}/m)?.[0] ?? ''
  assert.doesNotMatch(`${connectedUserUploadSessionSource}\n${connectedUserSignedUrlSource}`, /\/creators\//, 'normal connected-user upload scaffold helpers must not use creator-scoped routes')
  assert.match(client, /createFanvueCreatorUploadSession/, 'creator-scoped upload helper may exist only for explicit admin-gated diagnostics')
  assert.doesNotMatch(client, /globalThis\.fetch|window\.fetch|node-fetch|api\.fanvue\.com/, 'client scaffold must use injected fetch and no live API base')
  const callback = readFileSync('app/api/autopost/connect/fanvue/callback/route.ts', 'utf8')
  assert.match(callback, /fetch\(`\$\{input\.apiBaseUrl\}\/users\/account`,\s*\{\s*method:\s*"GET"/s, 'identity lookup must use GET /users/account')
  assert.match(callback, /authorization:\s*`Bearer \$\{input\.accessToken\}`/, 'identity lookup must use lowercase bearer authorization')
  assert.match(callback, /accessToken:\s*tokenResponse\.access_token/, 'identity lookup must use the fresh exchanged token before storage')
  assert.match(callback, /const encryptedAccessToken = encryptAutopostToken\(tokenResponse\.access_token\)/, 'callback stores the same exchanged token only after identity lookup')
  assert.doesNotMatch(callback.match(/async function fetchFanvueIdentity[\s\S]*?^}/m)?.[0] ?? '', /body:|"Content-Type"|"content-type"|Accept|accept/, 'identity lookup must not send a body, content-type, or accept header')
  assert.notEqual(callback.includes('async function fetchFanvueIdentity'), client.includes('async function fetchFanvueIdentity'), 'identity and upload session paths must live in different helpers')
  const adminRunner = readFileSync('backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts', 'utf8')
  assert.match(adminRunner, /let encryptedAccessToken = String\(account\?\.encrypted_access_token\)/, 'admin media upload path selects the active stored encrypted autopost_accounts access token')
  assert.match(adminRunner, /const refreshResult = await refresh\(account\)[\s\S]*account = await deps\.loadAccount\(String\(args\.userId\)\)[\s\S]*encryptedAccessToken = String\(account\?\.encrypted_access_token\)/m, 'stale-token refresh branch must reload and select the refreshed stored encrypted access token before decrypt')
  assert.match(adminRunner, /accessToken = deps\.decryptToken\(encryptedAccessToken\)/, 'admin media upload path must decrypt the selected active stored/refreshed autopost_accounts access token')
  assert.match(adminRunner, /const config = \{ accessToken, apiBaseUrl: deps\.apiBaseUrl, apiVersion: deps\.apiVersion, fetch: guardedFetch \}/, 'upload bearer config must be built from the decrypted stored/refreshed access token')
  assert.match(adminRunner, /createFanvueUploadSession\(config, \{ name: file\.filename, filename: file\.filename, mediaType: "image" \}\)/, 'admin upload passes the decrypted-token config to upload-session helper')
  assert.doesNotMatch(adminRunner, /accessToken:\s*["'`][^"'`]+["'`]/, 'admin upload config must not hardcode a direct access token literal')
  assert.doesNotMatch(adminRunner, /\/posts(?:\/|$)/, 'admin upload-only runner must not contain Fanvue post routes')
  assert.match(adminRunner, /env\.FANVUE_API_BASE_URL \?\? env\.FANVUE_API_BASE \?\? "https:\/\/api\.fanvue\.com"/, 'admin upload still has fallback API-base behavior that docs mark unsafe/unverified')
  assert.match(adminRunner, /createFanvueUploadSession\(config, \{ name: file\.filename, filename: file\.filename, mediaType: "image" \}\)/, 'admin upload passes exactly name, filename, and mediaType to upload-session helper')
  const contractNote = readFileSync('docs/autopost/fanvue-media-upload-contract-assumptions.md', 'utf8')
  assert.match(contractNote, /unsafe\/unverified live-upload assumption/i, 'docs must label current upload API-base fallback as unsafe/unverified')
  assert.match(contractNote, /POST `\/media\/uploads`|`POST \/media\/uploads`/, 'docs must label upload session route contract assumption')
  const availability = readFileSync('lib/autopost/platformAvailability.ts', 'utf8')
  assert.match(availability, /public_selectable:\s*false/)
  assert.match(availability, /can_schedule:\s*false/)
  assert.match(availability, /supports_media_posting:\s*false/)
  const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  assert.doesNotMatch(runRoute, /fanvue/i, 'Fanvue must remain absent from public run dispatch')
}

run().then(() => console.log('Fanvue mocked media-native scaffold tests passed'))
