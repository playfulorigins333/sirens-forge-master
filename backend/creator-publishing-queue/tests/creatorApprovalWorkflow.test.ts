import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCreatorPublishingApprovalSnapshot, CreatorPublishingApprovalError, hashCreatorPublishingApprovalSnapshot, performCreatorPublishingCreatorApproval, validateCreatorPublishingPackageForCreatorApproval, type CreatorPublishingApprovalInput, type CreatorPublishingMediaAssetForApproval, type CreatorPublishingPackageForApproval } from '../../../lib/creator-publishing-queue/approval'
import { findForbiddenNetworkCalls } from '../../../scripts/creatorPublishingQueueSafetyGuard'

const creator = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const updated = '2026-07-10T03:00:00.000Z'
const pkg = (patch: Partial<CreatorPublishingPackageForApproval> = {}): CreatorPublishingPackageForApproval => ({ id: 'pkg-1', creator_id: creator, platform_account_id: 'acct-1', target_platform: 'onlyfans', title: 'Final set', caption_body: 'Final caption', forced_disclosure_text: '#ai', ai_flag: 'ai_generated', ai_detail: { model: 'internal' }, second_person_present: false, compliance_status: 'passed', compliance_policy_version: 'onlyfans-manual-handoff-2026-07-10-v1', creator_approval_status: 'pending', creator_approved_at: null, creator_approved_by: null, scheduled_for: null, created_at: '2026-07-10T02:00:00.000Z', updated_at: updated, ...patch })
const asset = (patch: Partial<CreatorPublishingMediaAssetForApproval> = {}): CreatorPublishingMediaAssetForApproval => ({ id: 'asset-1', content_package_id: 'pkg-1', storage_key: 'creator/pkg-1/a.jpg', mime_type: 'image/jpeg', sha256: 'a'.repeat(64), source: 'ai_pipeline', ai_generation_metadata: { prompt_ref: 'safe' }, created_at: '2026-07-10T02:10:00.000Z', ...patch })
const input = (patch: Partial<CreatorPublishingApprovalInput> = {}): CreatorPublishingApprovalInput => ({ content_package_id: 'pkg-1', creator_id: creator, decision: 'approve', expected_compliance_status: 'passed', expected_policy_version: 'onlyfans-manual-handoff-2026-07-10-v1', expected_package_updated_at: updated, idempotency_key: 'idem-1', ...patch })
function assertCode(fn: () => unknown, code: string) { assert.throws(fn, (e) => e instanceof CreatorPublishingApprovalError && e.code === code) }

validateCreatorPublishingPackageForCreatorApproval(pkg(), input(), [asset()])
validateCreatorPublishingPackageForCreatorApproval(pkg({ compliance_status: 'escalated_approved' }), input({ expected_compliance_status: 'escalated_approved' }), [asset()])
for (const status of ['pending','manual_review','blocked'] as const) assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg({ compliance_status: status }), input({ expected_compliance_status: status }), [asset()]), 'APPROVAL_INVALID_COMPLIANCE_STATUS')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg({ compliance_policy_version: 'unassigned' }), input({ expected_policy_version: 'unassigned' }), [asset()]), 'APPROVAL_STALE_POLICY_VERSION')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg(), input({ expected_policy_version: 'old' }), [asset()]), 'APPROVAL_STALE_POLICY_VERSION')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg({ creator_approval_status: 'approved' }), input(), [asset()]), 'APPROVAL_ALREADY_DECIDED')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg({ creator_approval_status: 'rejected' }), input(), [asset()]), 'APPROVAL_ALREADY_DECIDED')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg({ target_platform: 'fanvue' }), input(), [asset()]), 'APPROVAL_FANVUE_NOT_SUPPORTED')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(null, input(), []), 'APPROVAL_PACKAGE_NOT_FOUND')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg(), input({ expected_package_updated_at: 'old' }), [asset()]), 'APPROVAL_STALE_PACKAGE')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg(), input(), [asset()], { id: 'review-block', outcome: 'block' }), 'APPROVAL_BLOCKING_REVIEW_EXISTS')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg({ forced_disclosure_text: null }), input(), [asset()]), 'APPROVAL_DISCLOSURE_MISSING')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg(), input(), []), 'APPROVAL_MEDIA_MISSING')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg({ caption_body: ' ' }), input(), [asset()]), 'APPROVAL_FINAL_CAPTION_MISSING')
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg(), input({ creator_id: other }), [asset()]), 'APPROVAL_CREATOR_MISMATCH')
validateCreatorPublishingPackageForCreatorApproval(pkg(), input({ decision: 'reject', rejection_reason: 'Not my final.' }), [])
assertCode(() => validateCreatorPublishingPackageForCreatorApproval(pkg(), input({ decision: 'reject', rejection_reason: ' ' }), []), 'APPROVAL_REJECTION_REASON_REQUIRED')

const snapA = buildCreatorPublishingApprovalSnapshot(pkg(), [asset()])
const snapB = buildCreatorPublishingApprovalSnapshot(pkg(), [asset()])
assert.deepEqual(snapA.snapshot, snapB.snapshot)
assert.equal(snapA.hash, snapB.hash)
assert.equal(hashCreatorPublishingApprovalSnapshot(snapA.snapshot), snapA.hash)
assert.notEqual(buildCreatorPublishingApprovalSnapshot(pkg({ caption_body: 'Changed' }), [asset()]).hash, snapA.hash)
assert.notEqual(buildCreatorPublishingApprovalSnapshot(pkg(), [asset({ id: 'asset-2', storage_key: 'other.jpg' })]).hash, snapA.hash)
assert.notEqual(buildCreatorPublishingApprovalSnapshot(pkg({ compliance_policy_version: 'onlyfans-manual-handoff-2026-07-10-v2' }), [asset()]).hash, snapA.hash)
assert.equal(snapA.snapshot.final_caption, '#ai\n\nFinal caption')
assert.equal(snapA.snapshot.forced_disclosure, '#ai')
assert.equal(JSON.stringify(snapA.snapshot).includes('credential'), false)
assert.equal(JSON.stringify(snapA.snapshot).includes('session'), false)
assert.equal(JSON.stringify(snapA.snapshot).includes('cookie'), false)

function mockDb(row = pkg(), media = [asset()], opts: { existingTask?: any, latestReview?: any, rpcError?: Error | null } = {}) {
  const calls: any[] = []
  const db = { from(table: string) { const q: any = { filters: [] as any[], select(c?: string) { calls.push(['select', table, c]); return q }, eq(c: string, v: unknown) { q.filters.push([c,v]); calls.push(['eq', table, c, v]); return q }, order() { return q }, limit() { return q }, maybeSingle() { calls.push(['maybeSingle', table]); if (table === 'creator_publishing_queue_tasks') return Promise.resolve({ data: opts.existingTask ?? null, error: null }); if (table === 'creator_publishing_compliance_reviews') return Promise.resolve({ data: opts.latestReview ?? null, error: null }); return Promise.resolve({ data: null, error: null }) }, single() { calls.push(['single', table]); if (table === 'creator_publishing_content_packages') return Promise.resolve({ data: row, error: null }); return Promise.resolve({ data: null, error: null }) }, then(resolve: any) { calls.push(['then', table]); resolve({ data: table === 'creator_publishing_media_assets' ? media : null, error: null }) } }; return q }, rpc(fn: string, args: Record<string, unknown>) { calls.push(['rpc', fn, args]); return Promise.resolve({ data: { content_package_id: row.id, creator_id: row.creator_id, target_platform: row.target_platform, decision: args.p_decision, prior_creator_approval_status: 'pending', resulting_creator_approval_status: args.p_decision === 'approve' ? 'approved' : 'rejected', compliance_status: row.compliance_status, policy_version: row.compliance_policy_version, snapshot_hash: args.p_snapshot_hash, queue_task_created: row.target_platform === 'onlyfans' && args.p_decision === 'approve', queue_task_id: row.target_platform === 'onlyfans' && args.p_decision === 'approve' ? 'task-1' : null, queue_task_status: row.target_platform === 'onlyfans' && args.p_decision === 'approve' ? 'ready_for_handoff' : null, queue_creation_allowed: row.target_platform === 'onlyfans' && args.p_decision === 'approve', approved_at: args.p_decision === 'approve' ? '2026-07-10T04:00:00.000Z' : null, rejected_at: args.p_decision === 'reject' ? '2026-07-10T04:00:00.000Z' : null, audit_event_ids: [1] }, error: opts.rpcError ?? null }) } }
  return { db, calls }
}

const approvedDb = mockDb()
const approved = await performCreatorPublishingCreatorApproval(input({ approval_snapshot_hash: snapA.hash }), { supabaseAdmin: approvedDb.db as any, authorization: { user_id: creator } })
assert.equal(approved.resulting_creator_approval_status, 'approved')
assert.equal(approved.creator_id, creator)
assert.equal(approved.queue_task_created, true)
assert.equal(approved.queue_task_status, 'ready_for_handoff')
assert.equal(approved.queue_creation_allowed, true)
assert.equal(approvedDb.calls.some((c) => c[0] === 'rpc' && c[1] === 'creator_publishing_apply_creator_approval_decision'), true)
assert.equal(JSON.stringify(approvedDb.calls).includes('fetch('), false)
await assert.rejects(() => performCreatorPublishingCreatorApproval(input(), { supabaseAdmin: mockDb().db as any }), (e) => e instanceof CreatorPublishingApprovalError && e.code === 'APPROVAL_UNAUTHORIZED')
await assert.rejects(() => performCreatorPublishingCreatorApproval(input({ creator_id: other }), { supabaseAdmin: mockDb().db as any, authorization: { user_id: creator } }), (e) => e instanceof CreatorPublishingApprovalError && e.code === 'APPROVAL_CREATOR_MISMATCH')
await assert.rejects(() => performCreatorPublishingCreatorApproval(input(), { supabaseAdmin: mockDb().db as any, authorization: { user_id: creator, service_role: true } }), (e) => e instanceof CreatorPublishingApprovalError && e.code === 'APPROVAL_UNAUTHORIZED')
await assert.rejects(() => performCreatorPublishingCreatorApproval(input({ approval_snapshot_hash: 'stale' }), { supabaseAdmin: mockDb().db as any, authorization: { user_id: creator } }), (e) => e instanceof CreatorPublishingApprovalError && e.code === 'APPROVAL_STALE_PACKAGE')
const fansly = await performCreatorPublishingCreatorApproval(input({ expected_policy_version: 'fansly-manual-handoff-2026-07-10-v1' }), { supabaseAdmin: mockDb(pkg({ target_platform: 'fansly', compliance_policy_version: 'fansly-manual-handoff-2026-07-10-v1', forced_disclosure_text: null })).db as any, authorization: { user_id: creator } })
assert.equal(fansly.queue_task_created, false)
assert.equal(fansly.queue_creation_allowed, false)
const rejected = await performCreatorPublishingCreatorApproval(input({ decision: 'reject', rejection_reason: 'No longer approved.' }), { supabaseAdmin: mockDb().db as any, authorization: { user_id: creator } })
assert.equal(rejected.resulting_creator_approval_status, 'rejected')
assert.equal(rejected.queue_task_created, false)

const migration = readFileSync('supabase/migrations/20260710000400_creator_publishing_creator_approval_queue.sql', 'utf8')
assert.match(migration, /security definer/i)
assert.match(migration, /for update/i)
assert.match(migration, /clock_timestamp\(\)/)
assert.match(migration, /revoke all on function public\.creator_publishing_apply_creator_approval_decision[\s\S]*from PUBLIC/)
assert.match(migration, /from anon;/)
assert.match(migration, /from authenticated;/)
assert.match(migration, /grant execute[\s\S]*to service_role/)
assert.match(migration, /creator_publishing_queue_one_task_per_package_platform_uidx/)
assert.match(migration, /status <> 'archived'/)
assert.match(migration, /target_platform = 'fanvue'[\s\S]*APPROVAL_FANVUE_NOT_SUPPORTED/)
assert.match(migration, /v_queue_allowed := v_package\.target_platform = 'onlyfans'/)
assert.doesNotMatch(migration, /apiv3\.fansly\.com|fetch\(|puppeteer|playwright|fanvueApiClient|fanvueAdapter/)
assert.deepEqual(findForbiddenNetworkCalls(['lib/creator-publishing-queue/approval/service.ts','lib/creator-publishing-queue/approval/snapshot.ts','lib/creator-publishing-queue/approval/authorize.ts']), [])
console.log('Creator Publishing Queue creator approval workflow tests passed')
