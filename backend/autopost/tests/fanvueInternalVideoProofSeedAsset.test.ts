import assert from 'node:assert/strict'
import {
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_ASSET_PROFILE,
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_CONTENT_TYPE,
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_FILENAME,
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_MODE,
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_MP4,
  buildFanvueInternalVideoProofSeedContentPayload,
  buildFanvueInternalVideoProofSeedMetadata,
  buildFanvueInternalVideoProofSeedR2Key,
  createOrReuseFanvueInternalVideoProofSeedAsset,
  type FanvueInternalVideoProofSeedGenerationRow,
  type FanvueInternalVideoProofSeedJobRow,
  type FanvueInternalVideoProofSeedRuleRow,
} from '../../../lib/autopost/fanvueInternalVideoProofSeedAsset'

const userId = '879c8a17-f9e8-473d-8de1-1fd1a77c080e'
const generationId = '623e4567-e89b-42d3-a456-426614174001'
const ruleId = '723e4567-e89b-42d3-a456-426614174001'
const jobId = '823e4567-e89b-42d3-a456-426614174001'
const bucket = 'server-owned-r2-bucket-never-returned'
const r2Key = buildFanvueInternalVideoProofSeedR2Key(userId)

function mockSupabase(input: { generations?: FanvueInternalVideoProofSeedGenerationRow[]; rules?: FanvueInternalVideoProofSeedRuleRow[]; jobs?: FanvueInternalVideoProofSeedJobRow[] } = {}) {
  const calls: string[] = []
  const inserted: Record<string, any[]> = { generations: [], autopost_rules: [], autopost_jobs: [] }
  const ids: Record<string, string> = { generations: generationId, autopost_rules: ruleId, autopost_jobs: jobId }
  const rows: Record<string, any[]> = { generations: input.generations ?? [], autopost_rules: input.rules ?? [], autopost_jobs: input.jobs ?? [] }
  const supabaseAdmin = {
    from(table: string) {
      calls.push(`from:${table}`)
      return {
        select(columns: string) {
          calls.push(`select:${table}:${columns}`)
          const chain: any = {
            eq(column: string, value: unknown) { calls.push(`eq:${table}:${column}:${value}`); return chain },
            or(filter: string) { calls.push(`or:${table}:${filter}`); return Promise.resolve({ data: rows[table] ?? [], error: null }) },
            then(resolve: any) { return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve) },
            single() { return Promise.resolve({ data: { id: ids[table] }, error: null }) },
          }
          return chain
        },
        insert(payload: Record<string, unknown>) {
          calls.push(`insert:${table}`)
          inserted[table].push(payload)
          return { select: () => ({ single: () => Promise.resolve({ data: { id: ids[table] }, error: null }) }) }
        },
      }
    },
  }
  return { supabaseAdmin, calls, inserted }
}

async function run() {
  const metadata = buildFanvueInternalVideoProofSeedMetadata()
  assert.equal(FANVUE_INTERNAL_VIDEO_PROOF_SEED_ASSET_PROFILE, 'fanvue_internal_video_proof_seed_safe_tiny_mp4_v1')
  assert.equal(FANVUE_INTERNAL_VIDEO_PROOF_SEED_FILENAME, 'fanvue-internal-video-proof-seed-safe-tiny-v1.mp4')
  assert.equal(FANVUE_INTERNAL_VIDEO_PROOF_SEED_CONTENT_TYPE, 'video/mp4')
  assert.equal(FANVUE_INTERNAL_VIDEO_PROOF_SEED_MODE, 'fanvue_internal_video_proof_seed')
  assert.deepEqual(metadata, {
    engine: 'server_seed', kind: 'video', mode: FANVUE_INTERNAL_VIDEO_PROOF_SEED_MODE, placeholder: false, test: false, unsafe: false,
    asset_profile: FANVUE_INTERNAL_VIDEO_PROOF_SEED_ASSET_PROFILE, source: 'server_bundled_safe_tiny_video_mp4', fanvue_upload_attempted: false, fanvue_post_attempted: false, dispatch_attempted: false, schedule_attempted: false,
  })
  assert(Buffer.isBuffer(FANVUE_INTERNAL_VIDEO_PROOF_SEED_MP4))

  const uploaded: any[] = []
  const db = mockSupabase()
  const created = await createOrReuseFanvueInternalVideoProofSeedAsset({ userId }, { supabaseAdmin: db.supabaseAdmin as any, r2Bucket: bucket, now: () => new Date('2026-07-07T00:00:00Z'), r2PutObject: async (input) => { uploaded.push(input) } })
  assert.equal(created.ok, true)
  assert.equal(created.generation_id, generationId)
  assert.equal(created.rule_id, ruleId)
  assert.equal(created.autopost_job_id, jobId)
  assert.equal(created.r2_uploaded, true)
  assert.equal(created.generation_inserted, true)
  assert.equal(created.rule_inserted, true)
  assert.equal(created.job_inserted, true)
  assert.equal(uploaded.length, 1)
  assert.equal(uploaded[0].bucket, bucket)
  assert.equal(uploaded[0].key, r2Key)
  assert.equal(uploaded[0].contentType, 'video/mp4')
  assert.equal(uploaded[0].body, FANVUE_INTERNAL_VIDEO_PROOF_SEED_MP4)
  assert.equal(db.inserted.generations[0].job_type, 'video')
  assert.equal(db.inserted.generations[0].image_url, null)
  assert.equal(Object.prototype.hasOwnProperty.call(db.inserted.generations[0], 'video_url'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(db.inserted.generations[0], 'output_url'), false)
  assert.equal(db.inserted.generations[0].metadata.kind, 'video')
  assert.equal(db.inserted.generations[0].metadata.placeholder, false)
  assert.equal(db.inserted.generations[0].r2_bucket, bucket)
  assert.equal(db.inserted.generations[0].r2_key, r2Key)
  assert.deepEqual(db.inserted.autopost_rules[0].content_payload, buildFanvueInternalVideoProofSeedContentPayload(generationId))
  assert.equal(db.inserted.autopost_rules[0].approval_state, 'APPROVED')
  assert.equal(db.inserted.autopost_rules[0].enabled, true)
  assert.equal(db.inserted.autopost_jobs[0].platform, 'fanvue')
  assert.equal(db.inserted.autopost_jobs[0].state, 'QUEUED')
  assert.equal(db.inserted.autopost_jobs[0].rule_id, ruleId)
  assert.equal(db.inserted.autopost_jobs[0].result, null)
  assert.equal(db.inserted.autopost_jobs[0].error, null)

  const existingGeneration = { id: generationId, user_id: userId, status: 'completed', job_type: 'video', mode: FANVUE_INTERNAL_VIDEO_PROOF_SEED_MODE, metadata, r2_bucket: bucket, r2_key: r2Key }
  const existingRule = { id: ruleId, user_id: userId, approval_state: 'APPROVED', enabled: true, content_payload: buildFanvueInternalVideoProofSeedContentPayload(generationId), paused_at: null, revoked_at: null }
  const existingJob = { id: jobId, user_id: userId, rule_id: ruleId, platform: 'fanvue', state: 'QUEUED', payload: {}, result: null, error: null }
  const reuseDb = mockSupabase({ generations: [existingGeneration], rules: [existingRule], jobs: [existingJob] })
  const reused = await createOrReuseFanvueInternalVideoProofSeedAsset({ userId }, { supabaseAdmin: reuseDb.supabaseAdmin as any, r2Bucket: bucket, r2PutObject: async () => { throw new Error('must not upload') } })
  assert.equal(reused.ok, true)
  assert.equal(reused.generation_reused, true)
  assert.equal(reused.rule_reused, true)
  assert.equal(reused.job_reused, true)
  assert.equal(reused.r2_uploaded, false)
  assert.equal(reuseDb.inserted.generations.length, 0)

  const multipleDb = mockSupabase({ generations: [existingGeneration, { ...existingGeneration, id: '923e4567-e89b-42d3-a456-426614174000' }] })
  const multiple = await createOrReuseFanvueInternalVideoProofSeedAsset({ userId }, { supabaseAdmin: multipleDb.supabaseAdmin as any, r2Bucket: bucket })
  assert.equal(multiple.ok, false)
  assert.equal(multiple.safe_code, 'FANVUE_INTERNAL_VIDEO_PROOF_SEED_MULTIPLE_GENERATIONS')

  const missingR2Db = mockSupabase({ generations: [{ ...existingGeneration, r2_key: null }] })
  const missingR2 = await createOrReuseFanvueInternalVideoProofSeedAsset({ userId }, { supabaseAdmin: missingR2Db.supabaseAdmin as any, r2Bucket: bucket })
  assert.equal(missingR2.ok, false)
  assert.equal(missingR2.safe_code, 'FANVUE_INTERNAL_VIDEO_PROOF_SEED_R2_OBJECT_REQUIRED')

  const serialized = JSON.stringify(created)
  assert.doesNotMatch(serialized, /server-owned-r2-bucket-never-returned|fanvue\/internal-video-proof-seeds|ftyp|mdat|bytes|Body|signed|provider|mediaUuid|uploadId/i)
  assert.equal(created.fanvue_upload_attempted, false)
  assert.equal(created.fanvue_post_attempted, false)
  assert.equal(created.dispatch_attempted, false)
  assert.equal(created.schedule_attempted, false)
  assert.equal(created.platform_registry_changed, false)
  assert.equal(created.public_ui_added, false)
  assert.equal(created.autopost_run_wired, false)
}

run().then(() => console.log('Fanvue internal video proof seed asset tests passed')).catch((error) => { console.error(error); process.exit(1) })
