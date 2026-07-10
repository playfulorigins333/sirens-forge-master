import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performTrustedCreatorPublishingReview, validateCreatorPublishingPackageForTrustedReview, resolveCreatorPublishingReviewTransition, CreatorPublishingReviewError, type CreatorPublishingPackageForReview, type CreatorPublishingTrustedReviewInput } from '../../../lib/creator-publishing-queue/review'
import { findForbiddenNetworkCalls } from '../../../scripts/creatorPublishingQueueSafetyGuard'

const creator = '00000000-0000-4000-8000-000000000001'
const reviewer = '00000000-0000-4000-8000-000000000002'
const pkg = (patch: Partial<CreatorPublishingPackageForReview> = {}): CreatorPublishingPackageForReview => ({ id: 'pkg-1', creator_id: creator, target_platform: 'onlyfans', compliance_status: 'manual_review', compliance_policy_version: 'onlyfans-manual-handoff-2026-07-10-v1', forced_disclosure_text: '#ai', creator_approval_status: 'pending', creator_approved_at: null, creator_approved_by: null, updated_at: '2026-07-10T00:00:00.000Z', ...patch })
const input = (patch: Partial<CreatorPublishingTrustedReviewInput> = {}): CreatorPublishingTrustedReviewInput => ({ content_package_id: 'pkg-1', reviewer_id: reviewer, decision: 'approve_escalation', reason: 'Human reviewer confirmed creator-only permitted AI edit.', expected_current_status: 'manual_review', expected_policy_version: 'onlyfans-manual-handoff-2026-07-10-v1', idempotency_key: 'idem-1', reviewed_at: '2026-07-10T02:00:00.000Z', ...patch })
const auth = { reviewer_id: reviewer, trusted: true, role: 'reviewer' as const, active: true }

function assertCode(fn: () => unknown, code: string) { assert.throws(fn, (e) => e instanceof CreatorPublishingReviewError && e.code === code) }

assert.equal(resolveCreatorPublishingReviewTransition('approve_escalation').to, 'escalated_approved')
assert.equal(resolveCreatorPublishingReviewTransition('reject').to, 'manual_review')
assert.equal(resolveCreatorPublishingReviewTransition('block').to, 'blocked')
assert.equal(resolveCreatorPublishingReviewTransition('request_changes').to, 'pending')
assertCode(() => resolveCreatorPublishingReviewTransition('ready_for_handoff'), 'REVIEW_INVALID_DECISION')

validateCreatorPublishingPackageForTrustedReview(pkg(), input(), { outcome: 'manual_review', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' })
for (const status of ['pending','passed','escalated_approved'] as const) assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg({ compliance_status: status }), input(), { outcome: 'manual_review', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' }), 'REVIEW_INVALID_CURRENT_STATUS')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg({ compliance_status: 'blocked' }), input(), { outcome: 'manual_review', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' }), 'REVIEW_BLOCKED_NOT_ESCALATABLE')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg({ target_platform: 'fanvue' }), input(), { outcome: 'manual_review', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' }), 'REVIEW_FANVUE_NOT_SUPPORTED')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg({ compliance_policy_version: 'old' }), input(), { outcome: 'manual_review', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' }), 'REVIEW_STALE_POLICY_VERSION')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg({ compliance_policy_version: 'unassigned' }), input({ expected_policy_version: 'unassigned' }), { outcome: 'manual_review', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' }), 'REVIEW_POLICY_VERSION_UNASSIGNED')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(null, input()), 'REVIEW_PACKAGE_NOT_FOUND')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg(), input({ expected_current_status: 'pending' }), { outcome: 'manual_review', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' }), 'REVIEW_INVALID_CURRENT_STATUS')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg(), input(), null), 'REVIEW_AUTOMATED_REVIEW_REQUIRED')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg(), input(), { outcome: 'pass', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' }), 'REVIEW_AUTOMATED_REVIEW_REQUIRED')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg(), input(), { outcome: 'block', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' }), 'REVIEW_AUTOMATED_REVIEW_REQUIRED')
assertCode(() => validateCreatorPublishingPackageForTrustedReview(pkg(), input(), { outcome: 'manual_review', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' }, { outcome: 'block', review_source: 'human', created_at: '2026-07-10T01:05:00.000Z' }), 'REVIEW_BLOCKED_NOT_ESCALATABLE')

function mockDb(row: CreatorPublishingPackageForReview, opts: { duplicate?: boolean, conflict?: boolean, automated?: any, laterBlock?: any } = {}) {
  const calls: any[] = []
  const db = { from(table: string) { const q: any = { table, payload: undefined, filters: [] as any[], select(c?: string) { calls.push(['select', table, c]); return q }, eq(c: string, v: unknown) { q.filters.push([c,v]); calls.push(['eq', table, c, v]); return q }, order() { return q }, limit() { return q }, maybeSingle() { calls.push(['maybeSingle', table]); if (table === 'creator_publishing_audit_events') return Promise.resolve({ data: opts.duplicate ? { id: 7 } : null, error: null }); if (table === 'creator_publishing_compliance_reviews' && q.filters.some((f: any[]) => f[0] === 'outcome' && f[1] === 'block')) return Promise.resolve({ data: opts.laterBlock ?? null, error: null }); if (table === 'creator_publishing_compliance_reviews') return Promise.resolve({ data: opts.automated === undefined ? { outcome: 'manual_review', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' } : opts.automated, error: null }); return Promise.resolve({ data: null, error: null }) }, single() { calls.push(['single', table]); if (table === 'creator_publishing_content_packages' && !q.payload) return Promise.resolve({ data: row, error: null }); if (table === 'creator_publishing_content_packages' && q.payload) return Promise.resolve({ data: opts.conflict ? null : { id: row.id }, error: null }); if (table === 'creator_publishing_compliance_reviews') return Promise.resolve({ data: { id: 'review-1' }, error: null }); if (table === 'creator_publishing_audit_events') return Promise.resolve({ data: { id: 9 }, error: null }); return Promise.resolve({ data: null, error: null }) }, insert(p: unknown) { q.payload = p; calls.push(['insert', table, p]); return q }, update(p: unknown) { q.payload = p; calls.push(['update', table, p]); return q } }; return q } }
  return { db, calls }
}

async function run(decision: CreatorPublishingTrustedReviewInput['decision'], patch: Partial<CreatorPublishingTrustedReviewInput> = {}, row = pkg()) {
  const { db, calls } = mockDb(row)
  const result = await performTrustedCreatorPublishingReview(input({ decision, idempotency_key: `${decision}-1`, ...patch }), { supabaseAdmin: db as any, reviewerAuthorization: auth, now: () => '2026-07-10T02:00:00.000Z' })
  return { result, calls, review: calls.find((c) => c[0] === 'insert' && c[1] === 'creator_publishing_compliance_reviews')?.[2], update: calls.find((c) => c[0] === 'update' && c[1] === 'creator_publishing_content_packages')?.[2], audit: calls.find((c) => c[0] === 'insert' && c[1] === 'creator_publishing_audit_events')?.[2] }
}

const approved = await run('approve_escalation')
assert.equal(approved.result.resulting_compliance_status, 'escalated_approved')
assert.equal(approved.result.creator_approval_allowed, true)
assert.equal(approved.result.queue_creation_allowed, false)
assert.equal(approved.review.outcome, 'escalate')
assert.equal(approved.review.review_source, 'human')
assert.equal(approved.review.reviewer_id, reviewer)
assert.equal(approved.review.escalated_approval_reason, input().reason)
assert.equal(approved.update.compliance_status, 'escalated_approved')
assert.equal(approved.update.compliance_policy_version, undefined)
assert.equal(approved.update.forced_disclosure_text, undefined)
assert.equal(JSON.stringify(approved.calls).includes('creator_publishing_queue_tasks'), false)
assert.equal(JSON.stringify(approved.calls).includes('creator_approval_status":"approved'), false)
assert.equal(approved.audit.action, 'manual_review_approved_for_escalation')
assert.equal(approved.review.created_at, '2026-07-10T02:00:00.000Z')
assert.equal(approved.audit.created_at, '2026-07-10T02:00:00.000Z')
const timestampAttempt = await run('reject', { reviewed_at: '1999-01-01T00:00:00.000Z' })
assert.equal(timestampAttempt.review.created_at, '2026-07-10T02:00:00.000Z')
assert.equal(timestampAttempt.audit.created_at, '2026-07-10T02:00:00.000Z')

for (const bad of ['', '   ']) await assert.rejects(() => performTrustedCreatorPublishingReview(input({ reason: bad }), { supabaseAdmin: mockDb(pkg()).db as any, reviewerAuthorization: auth }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_REASON_REQUIRED')
await assert.rejects(() => performTrustedCreatorPublishingReview(input({ reviewer_id: '' }), { supabaseAdmin: mockDb(pkg()).db as any, reviewerAuthorization: { ...auth, reviewer_id: '' } as any }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_UNAUTHORIZED')
await assert.rejects(() => performTrustedCreatorPublishingReview(input(), { supabaseAdmin: mockDb(pkg()).db as any, reviewerAuthorization: { reviewer_id: reviewer, trusted: false, role: 'reviewer', active: true } as any }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_UNAUTHORIZED')
await assert.rejects(() => performTrustedCreatorPublishingReview(input({ reviewer_id: creator }), { supabaseAdmin: mockDb(pkg()).db as any, reviewerAuthorization: { reviewer_id: creator, trusted: true, role: 'admin', active: true } as any }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_SELF_REVIEW_FORBIDDEN')
await assert.rejects(() => performTrustedCreatorPublishingReview(input(), { supabaseAdmin: mockDb(pkg()).db as any, reviewerAuthorization: { reviewer_id: reviewer, trusted: true, role: 'reviewer', active: false } as any }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_UNAUTHORIZED')
await assert.rejects(() => performTrustedCreatorPublishingReview(input(), { supabaseAdmin: mockDb(pkg(), { duplicate: true }).db as any, reviewerAuthorization: auth }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_DUPLICATE')
await assert.rejects(() => performTrustedCreatorPublishingReview(input({ expected_policy_version: 'old' }), { supabaseAdmin: mockDb(pkg()).db as any, reviewerAuthorization: auth }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_STALE_POLICY_VERSION')
await assert.rejects(() => performTrustedCreatorPublishingReview(input(), { supabaseAdmin: mockDb(pkg({ compliance_status: 'blocked' })).db as any, reviewerAuthorization: auth }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_BLOCKED_NOT_ESCALATABLE')
await assert.rejects(() => performTrustedCreatorPublishingReview(input({ reviewer_id: '00000000-0000-4000-8000-000000000003' }), { supabaseAdmin: mockDb(pkg()).db as any, reviewerAuthorization: auth }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_IDENTITY_MISMATCH')
await assert.rejects(() => performTrustedCreatorPublishingReview(input(), { supabaseAdmin: mockDb(pkg()).db as any }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_UNAUTHORIZED')
await assert.rejects(() => performTrustedCreatorPublishingReview(input(), { supabaseAdmin: mockDb(pkg(), { automated: null }).db as any, reviewerAuthorization: auth }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_AUTOMATED_REVIEW_REQUIRED')
await assert.rejects(() => performTrustedCreatorPublishingReview(input(), { supabaseAdmin: mockDb(pkg(), { automated: { outcome: 'pass', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' } }).db as any, reviewerAuthorization: auth }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_AUTOMATED_REVIEW_REQUIRED')
await assert.rejects(() => performTrustedCreatorPublishingReview(input(), { supabaseAdmin: mockDb(pkg(), { automated: { outcome: 'block', review_source: 'automated', created_at: '2026-07-10T01:00:00.000Z' } }).db as any, reviewerAuthorization: auth }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_AUTOMATED_REVIEW_REQUIRED')
await assert.rejects(() => performTrustedCreatorPublishingReview(input(), { supabaseAdmin: mockDb(pkg(), { laterBlock: { outcome: 'block', review_source: 'human', created_at: '2026-07-10T01:05:00.000Z' } }).db as any, reviewerAuthorization: auth }), (e) => e instanceof CreatorPublishingReviewError && e.code === 'REVIEW_BLOCKED_NOT_ESCALATABLE')

const rejected = await run('reject', { reviewer_notes: 'Needs more context.' })
assert.equal(rejected.review.outcome, 'manual_review')
assert.equal(rejected.update.compliance_status, 'manual_review')
assert.equal(rejected.review.escalated_approval_reason, null)
assert.match(rejected.review.notes, /Needs more context/)
assert.equal(rejected.audit.action, 'manual_review_rejected')
assert.equal(rejected.result.creator_approval_allowed, false)
const blocked = await run('block')
assert.equal(blocked.review.outcome, 'block')
assert.equal(blocked.update.compliance_status, 'blocked')
assert.equal(blocked.audit.action, 'manual_review_blocked')
assert.equal(blocked.result.creator_approval_allowed, false)
const changes = await run('request_changes')
assert.equal(changes.review.outcome, 'manual_review')
assert.equal(changes.review.review_source, 'human')
assert.equal(changes.update.compliance_status, 'pending')
assert.equal(changes.update.compliance_policy_version, 'unassigned')
assert.equal(changes.update.forced_disclosure_text, null)
assert.equal(changes.update.creator_approval_status, 'pending')
assert.equal(changes.update.creator_approved_by, null)
assert.equal(changes.update.creator_approved_at, null)
assert.equal(changes.audit.action, 'manual_review_changes_requested')
assert.equal(JSON.stringify(changes.calls).includes('title'), false)
assert.equal(JSON.stringify(changes.calls).includes('caption_body'), false)

const migration = readFileSync('supabase/migrations/20260710000300_creator_publishing_manual_review_workflow.sql', 'utf8')
assert.match(migration, /creator_publishing_trusted_reviewers/, 'narrow reviewer allowlist exists')
assert.match(migration, /review_source text not null default 'automated'/, 'review source distinguishes automated and human reviews')
assert.match(migration, /security definer/, 'atomic RPC is security definer')
assert.match(migration, /for update/, 'RPC locks the package row')
assert.match(migration, /v_package\.creator_id = p_reviewer_id/, 'DB-level self-review guard exists in RPC')
assert.match(migration, /revoke all on function public\.creator_publishing_apply_manual_review_decision\(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text\) from PUBLIC/, 'RPC explicitly revokes PUBLIC execute')
assert.match(migration, /grant execute[\s\S]*to service_role/, 'RPC is service-role only')
assert.match(migration, /from anon;/, 'anon cannot execute RPC')
assert.match(migration, /from authenticated;/, 'authenticated cannot execute RPC')
assert.doesNotMatch(migration, /insert into public\.creator_publishing_queue_tasks|ready_for_handoff|creator_approval_status = 'approved'/, 'RPC does not create queue tasks, approve content, or route Fanvue')
assert.match(migration, /outcome = 'block'/, 'later blocking review blocks escalation')
assert.match(migration, /review_source = 'automated'[\s\S]*v_latest_automated\.outcome <> 'manual_review'/, 'latest automated manual_review is required')
assert.match(migration, /created_at > v_latest_automated\.created_at/, 'later blocking review prevents escalation')
assert.match(migration, /v_reviewed_at timestamptz := clock_timestamp\(\)/, 'RPC uses database-controlled timestamp')
assert.doesNotMatch(migration, /create policy[\s\S]*creator_publishing_trusted_reviewers[\s\S]*for (insert|update|all)/i, 'trusted reviewer table has no broad authenticated write policy')

const complianceMigration = readFileSync('supabase/migrations/20260710000200_creator_publishing_compliance_manual_review_outcome.sql', 'utf8')
assert.match(complianceMigration, /r\.outcome = 'escalate'[\s\S]*escalated_approval_reason/, 'only genuine escalate reviews authorize escalated_approved')
assert.deepEqual(findForbiddenNetworkCalls(['lib/creator-publishing-queue/review/service.ts','lib/creator-publishing-queue/review/transitions.ts','lib/creator-publishing-queue/review/authorize.ts']), [])
console.log('Creator Publishing Queue manual review workflow tests passed')
