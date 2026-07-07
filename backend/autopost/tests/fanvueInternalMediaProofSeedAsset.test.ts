import assert from 'node:assert/strict'
import { FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG } from '../../../lib/autopost/fanvueMediaReadinessDiagnostic'
import { FANVUE_UPLOAD_DIAGNOSTIC_PNG } from '../../../lib/autopost/fanvueUploadDiagnostic'
import {
  FANVUE_INTERNAL_MEDIA_PROOF_SEED_ASSET_PROFILE,
  FANVUE_INTERNAL_MEDIA_PROOF_SEED_CONTENT_TYPE,
  FANVUE_INTERNAL_MEDIA_PROOF_SEED_FILENAME,
  FANVUE_INTERNAL_MEDIA_PROOF_SEED_MODE,
  buildFanvueInternalMediaProofSeedMetadata,
  buildFanvueInternalMediaProofSeedR2Key,
  createOrReuseFanvueInternalMediaProofSeedAsset,
  type FanvueInternalMediaProofSeedGenerationRow,
} from '../../../lib/autopost/fanvueInternalMediaProofSeedAsset'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const generationId = '623e4567-e89b-42d3-a456-426614174001'
const bucket = 'server-owned-r2-bucket-never-returned'
const r2Key = buildFanvueInternalMediaProofSeedR2Key(userId)

function mockSupabase(existingRows: FanvueInternalMediaProofSeedGenerationRow[] = [], insertedId = generationId) {
  const calls: string[] = []
  const inserted: any[] = []
  const supabaseAdmin = {
    from(table: string) {
      calls.push(`from:${table}`)
      return {
        select(columns: string) {
          calls.push(`select:${columns}`)
          const chain: any = {
            eq(column: string, value: unknown) { calls.push(`eq:${column}:${value}`); return chain },
            or(filter: string) { calls.push(`or:${filter}`); return Promise.resolve({ data: existingRows, error: null }) },
            single() { return Promise.resolve({ data: { id: insertedId }, error: null }) },
          }
          return chain
        },
        insert(payload: Record<string, unknown>) {
          calls.push('insert')
          inserted.push(payload)
          return { select: () => ({ single: () => Promise.resolve({ data: { id: insertedId }, error: null }) }) }
        },
      }
    },
  }
  return { supabaseAdmin, calls, inserted }
}

async function run() {
  const metadata = buildFanvueInternalMediaProofSeedMetadata()
  assert.deepEqual(metadata, {
    engine: 'server_seed',
    kind: 'image',
    mode: FANVUE_INTERNAL_MEDIA_PROOF_SEED_MODE,
    placeholder: false,
    test: false,
    unsafe: false,
    asset_profile: FANVUE_INTERNAL_MEDIA_PROOF_SEED_ASSET_PROFILE,
    source: 'server_bundled_safe_static_png_64x64_readiness_diagnostic',
    fanvue_upload_attempted: false,
    fanvue_post_attempted: false,
    dispatch_attempted: false,
    schedule_attempted: false,
  })

  let uploaded: any[] = []
  const createDb = mockSupabase([])
  const created = await createOrReuseFanvueInternalMediaProofSeedAsset({ userId }, {
    supabaseAdmin: createDb.supabaseAdmin as any,
    r2Bucket: bucket,
    now: () => new Date('2026-07-07T00:00:00.000Z'),
    r2PutObject: async (input) => { uploaded.push(input) },
  })
  assert.equal(created.ok, true)
  assert.equal(created.generation_inserted, true)
  assert.equal(created.generation_reused, false)
  assert.equal(created.r2_uploaded, true)
  assert.equal(created.r2_object_present, true)
  assert.equal(created.generation_id_present, true)
  assert.equal(uploaded.length, 1)
  assert.equal(uploaded[0].bucket, bucket)
  assert.equal(uploaded[0].key, r2Key)
  assert.equal(uploaded[0].contentType, FANVUE_INTERNAL_MEDIA_PROOF_SEED_CONTENT_TYPE)
  assert.equal(FANVUE_INTERNAL_MEDIA_PROOF_SEED_ASSET_PROFILE, 'fanvue_internal_media_proof_seed_safe_static_png_v2')
  assert.equal(FANVUE_INTERNAL_MEDIA_PROOF_SEED_FILENAME, 'fanvue-internal-media-proof-seed-safe-static-v2.png')
  assert.equal(r2Key, `fanvue/internal-media-proof-seeds/${userId}/safe-static-v2.png`)
  assert.equal(uploaded[0].body, FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG)
  assert.notEqual(uploaded[0].body, FANVUE_UPLOAD_DIAGNOSTIC_PNG)
  assert(Buffer.isBuffer(uploaded[0].body))
  assert.equal(createDb.inserted.length, 1)
  assert.equal(createDb.inserted[0].user_id, userId)
  assert.equal(createDb.inserted[0].status, 'completed')
  assert.equal(createDb.inserted[0].job_type, 'image')
  assert.equal(createDb.inserted[0].mode, FANVUE_INTERNAL_MEDIA_PROOF_SEED_MODE)
  assert.equal(createDb.inserted[0].r2_bucket, bucket)
  assert.equal(createDb.inserted[0].r2_key, r2Key)
  assert.deepEqual(createDb.inserted[0].metadata, metadata)

  const existing = { id: generationId, user_id: userId, status: 'completed', job_type: 'image', mode: FANVUE_INTERNAL_MEDIA_PROOF_SEED_MODE, metadata, r2_bucket: bucket, r2_key: r2Key }
  const oldV1 = { ...existing, metadata: { ...metadata, asset_profile: 'fanvue_internal_media_proof_seed_safe_static_png_v1' }, r2_key: `fanvue/internal-media-proof-seeds/${userId}/safe-static-v1.png` }
  uploaded = []
  const oldOnlyDb = mockSupabase([oldV1])
  const ignoresOldV1 = await createOrReuseFanvueInternalMediaProofSeedAsset({ userId }, { supabaseAdmin: oldOnlyDb.supabaseAdmin as any, r2Bucket: bucket, r2PutObject: async (input) => { uploaded.push(input) } })
  assert.equal(ignoresOldV1.ok, true)
  assert.equal(ignoresOldV1.generation_inserted, true)
  assert.equal(ignoresOldV1.generation_reused, false)
  assert.equal(uploaded.length, 1)
  assert.equal(oldOnlyDb.inserted.length, 1)

  uploaded = []
  const reuseDb = mockSupabase([existing])
  const reused = await createOrReuseFanvueInternalMediaProofSeedAsset({ userId }, { supabaseAdmin: reuseDb.supabaseAdmin as any, r2Bucket: bucket, r2PutObject: async (input) => { uploaded.push(input) } })
  assert.equal(reused.ok, true)
  assert.equal(reused.generation_reused, true)
  assert.equal(reused.generation_inserted, false)
  assert.equal(reused.r2_uploaded, false)
  assert.equal(uploaded.length, 0)
  assert.equal(reuseDb.inserted.length, 0)

  const multipleDb = mockSupabase([existing, { ...existing, id: '723e4567-e89b-42d3-a456-426614174002' }])
  const multiple = await createOrReuseFanvueInternalMediaProofSeedAsset({ userId }, { supabaseAdmin: multipleDb.supabaseAdmin as any, r2Bucket: bucket, r2PutObject: async () => { throw new Error('must not upload') } })
  assert.equal(multiple.ok, false)
  assert.equal(multiple.safe_code, 'FANVUE_INTERNAL_MEDIA_PROOF_SEED_MULTIPLE_MATCHES')
  assert.equal(multipleDb.inserted.length, 0)

  const missingR2Db = mockSupabase([{ ...existing, r2_key: null }])
  const missingR2 = await createOrReuseFanvueInternalMediaProofSeedAsset({ userId }, { supabaseAdmin: missingR2Db.supabaseAdmin as any, r2Bucket: bucket })
  assert.equal(missingR2.ok, false)
  assert.equal(missingR2.safe_code, 'FANVUE_INTERNAL_MEDIA_PROOF_SEED_R2_OBJECT_REQUIRED')

  const serialized = JSON.stringify(created)
  assert.doesNotMatch(serialized, /server-owned-r2-bucket-never-returned|fanvue\/internal-media-proof-seeds|iVBOR|PNG|bytes|Body|signed|provider|mediaUuid|uploadId/i)

  const acceptsOnlyUserId = await createOrReuseFanvueInternalMediaProofSeedAsset({ userId, bytes: 'caller-bytes', url: 'https://example.test/file.png', providerId: 'provider' } as any, { supabaseAdmin: mockSupabase([existing]).supabaseAdmin as any, r2Bucket: bucket })
  assert.equal(acceptsOnlyUserId.ok, true)
  assert.equal(acceptsOnlyUserId.generation_reused, true)
}

run().then(() => console.log('Fanvue internal media proof seed asset tests passed')).catch((error) => { console.error(error); process.exit(1) })
