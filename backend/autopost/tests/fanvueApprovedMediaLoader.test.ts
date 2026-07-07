import assert from 'node:assert/strict'
import { loadFanvueApprovedMedia, type FanvueApprovedMediaGenerationRow } from '../../../lib/autopost/fanvueApprovedMediaLoader'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const assetId = '623e4567-e89b-42d3-a456-426614174001'
const baseRow: FanvueApprovedMediaGenerationRow = {
  id: assetId,
  user_id: userId,
  status: 'completed',
  job_type: 'image',
  mode: 'txt2img',
  metadata: { placeholder: false },
  r2_bucket: 'server-owned-bucket-never-returned',
  r2_key: 'generations/asset.png',
}

async function exercise(overrides: {
  sourceAssetIds?: string[]
  row?: FanvueApprovedMediaGenerationRow | null
  getR2ObjectThrows?: boolean
  contentType?: string | null
} = {}) {
  let loadedGeneration = 0
  let downloaded = 0
  const result = await loadFanvueApprovedMedia({
    userId,
    sourceAssetIds: overrides.sourceAssetIds ?? [assetId],
    loadGeneration: async ({ userId: lookupUserId, assetId: lookupAssetId }) => {
      loadedGeneration++
      assert.equal(lookupUserId, userId)
      assert.equal(lookupAssetId, (overrides.sourceAssetIds ?? [assetId])[0])
      return overrides.row === undefined ? baseRow : overrides.row
    },
    getR2Object: async ({ bucket, key }) => {
      downloaded++
      assert.equal(bucket, baseRow.r2_bucket)
      assert.equal(key, overrides.row?.r2_key ?? baseRow.r2_key)
      if (overrides.getR2ObjectThrows) throw new Error('r2 unavailable')
      return { bytes: new Blob(['safe-test-bytes']), contentType: overrides.contentType ?? 'image/png' }
    },
  })
  return { result, loadedGeneration, downloaded }
}

async function run() {
  const empty = await exercise({ sourceAssetIds: [] })
  assert.equal(empty.result.ok, false)
  assert.equal((empty.result as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED')
  assert.equal(empty.loadedGeneration, 0)
  assert.equal(empty.downloaded, 0)

  const multiple = await exercise({ sourceAssetIds: [assetId, '723e4567-e89b-42d3-a456-426614174002'] })
  assert.equal(multiple.result.ok, false)
  assert.equal((multiple.result as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_SINGLE_ASSET_ONLY')
  assert.equal(multiple.loadedGeneration, 0)

  const invalidUuid = await exercise({ sourceAssetIds: ['asset_1'] })
  assert.equal(invalidUuid.result.ok, false)
  assert.equal((invalidUuid.result as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_FOUND')
  assert.equal(invalidUuid.loadedGeneration, 0)

  const missing = await exercise({ row: null })
  assert.equal(missing.result.ok, false)
  assert.equal((missing.result as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_FOUND')

  const incomplete = await exercise({ row: { ...baseRow, status: 'failed' } })
  assert.equal(incomplete.result.ok, false)
  assert.equal((incomplete.result as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_COMPLETED')

  const placeholder = await exercise({ row: { ...baseRow, metadata: { placeholder: true } } })
  assert.equal(placeholder.result.ok, false)
  assert.equal((placeholder.result as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_COMPLETED')

  const missingR2 = await exercise({ row: { ...baseRow, r2_key: null } })
  assert.equal(missingR2.result.ok, false)
  assert.equal((missingR2.result as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_R2_OBJECT_REQUIRED')
  assert.equal(missingR2.downloaded, 0)

  const loadFailed = await exercise({ getR2ObjectThrows: true })
  assert.equal(loadFailed.result.ok, false)
  assert.equal((loadFailed.result as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_LOAD_FAILED')

  const videoRejected = await exercise({ row: { ...baseRow, job_type: 'video', r2_key: 'generations/asset.mp4' }, contentType: 'video/mp4' })
  assert.equal(videoRejected.result.ok, false)
  assert.equal((videoRejected.result as any).safe_code, 'FANVUE_SERVER_OWNED_MEDIA_UNSUPPORTED_TYPE')

  const success = await exercise()
  assert.equal(success.result.ok, true)
  assert.equal((success.result as any).media.filename, `fanvue-approved-${assetId}.png`)
  assert.equal((success.result as any).media.mediaType, 'image')
  assert((success.result as any).media.bytes instanceof Blob)

  const leaked = JSON.stringify(success.result)
  assert.doesNotMatch(leaked, /server-owned-bucket-never-returned|generations\/asset\.png|safe-test-bytes/)
}

run().then(() => console.log('Fanvue approved media loader tests passed')).catch((error) => { console.error(error); process.exit(1) })
