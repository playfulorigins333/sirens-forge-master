import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
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

async function run() {
  const calls: Call[] = []
  const upload = await createFanvueUploadSession(config(queueFetch([{ status: 200, data: { mediaUuid, uploadId } }], calls)), {
    name: 'Mock image', filename: 'mock-image', mediaType: 'image',
  })
  assert.equal(upload.ok, true)
  assert.equal(upload.mediaUuid, mediaUuid)
  assert.equal(upload.uploadId, uploadId)
  assert.equal(calls[0].url, `${apiBaseUrl}/media/uploads`)
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { name: 'Mock image', filename: 'mock-image', mediaType: 'image' })

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

  const signedFailure = await getFanvueUploadPartUrl(config(queueFetch([{ status: 500, data: {} }])), { uploadId, partNumber: 1 })
  assert.equal(signedFailure.ok, false)

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

  const errored = await waitForFanvueMediaReady(config(queueFetch([{ status: 200, data: { uuid: mediaUuid, status: 'error' } }])), { uuid: mediaUuid, maxAttempts: 3 })
  assert.equal(errored.ok, false)
  assert.equal(errored.error_code, 'FANVUE_MEDIA_PROCESSING_ERROR')

  const timedOut = await waitForFanvueMediaReady(config(queueFetch([
    { status: 200, data: { uuid: mediaUuid, status: 'created' } },
    { status: 200, data: { uuid: mediaUuid, status: 'processing' } },
  ])), { uuid: mediaUuid, maxAttempts: 2 })
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.error_code, 'FANVUE_MEDIA_READY_TIMEOUT')

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
  assert.doesNotMatch(oauth, /write:creator/, 'write:creator must not be added')
  const client = readFileSync('lib/autopost/fanvueApiClientCore.ts', 'utf8')
  assert.doesNotMatch(client, /\/creators\//, 'normal Fanvue client scaffold must not use creator-scoped routes')
  assert.doesNotMatch(client, /globalThis\.fetch|window\.fetch|node-fetch|api\.fanvue\.com/, 'client scaffold must use injected fetch and no live API base')
  const availability = readFileSync('lib/autopost/platformAvailability.ts', 'utf8')
  assert.match(availability, /public_selectable:\s*false/)
  assert.match(availability, /can_schedule:\s*false/)
  assert.match(availability, /supports_media_posting:\s*false/)
  const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  assert.doesNotMatch(runRoute, /fanvue/i, 'Fanvue must remain absent from public run dispatch')
}

run().then(() => console.log('Fanvue mocked media-native scaffold tests passed'))
