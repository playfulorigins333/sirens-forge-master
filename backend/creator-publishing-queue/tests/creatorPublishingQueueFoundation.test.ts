import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findCredentialShapedQueueSchema, findForbiddenNetworkCalls } from '../../../scripts/creatorPublishingQueueSafetyGuard'

const migrationPath = 'supabase/migrations/20260710000100_creator_publishing_queue_foundation.sql'
const sql = readFileSync(migrationPath, 'utf8')

assert.match(sql, /creator_publishing_content_not_approved_when_blocked_or_pending[\s\S]*creator_approval_status <> 'approved' or compliance_status not in \('blocked','pending'\)/, 'blocked content package cannot be creator-approved')
assert.match(sql, /creator_publishing_content_not_approved_when_blocked_or_pending[\s\S]*'pending'/, 'pending compliance package cannot be creator-approved')
assert.match(sql, /creator_publishing_review_escalate_requires_reason[\s\S]*outcome <> 'escalate' or length\(btrim\(coalesce\(escalated_approval_reason, ''\)\)\) > 0/, 'escalated compliance review requires reason')
assert.match(sql, /creator_publishing_queue_confirmed_requires_confirmation[\s\S]*status <> 'confirmed_posted_manual' or posted_confirmation is true/, 'confirmed manual task requires posted_confirmation')
assert.match(sql, /creator_publishing_queue_confirmed_requires_url_or_skip[\s\S]*final_post_url is not null or final_post_url_skip_reason is not null/, 'confirmed manual task requires URL or skip reason')
assert.match(sql, /creator_publishing_audit_events_prevent_mutation[\s\S]*append-only/, 'audit mutation trigger raises append-only error')
assert.match(sql, /before update on public\.creator_publishing_audit_events/, 'audit events cannot be ordinarily updated')
assert.match(sql, /before delete on public\.creator_publishing_audit_events/, 'audit events cannot be ordinarily deleted')
assert.match(sql, /creator_publishing_escalated_approved_has_review[\s\S]*outcome = 'escalate'[\s\S]*escalated_approval_reason/, 'escalated_approved requires a related review reason')
assert.match(sql, /creator_publishing_content_platform_meta_no_credentials[\s\S]*not public\.creator_publishing_queue_jsonb_has_forbidden_credential_key\(platform_meta\)/, 'platform_meta rejects credential-shaped keys')

const fixture = 'backend/creator-publishing-queue/fixtures/forbidden-egress.fixture.ts'
assert.deepEqual(findForbiddenNetworkCalls([fixture]), [fixture], 'forbidden-host egress guard catches fixture network call')
assert.deepEqual(findForbiddenNetworkCalls(['lib/autopost/fanvueApiClientCore.ts']), [], 'guard does not block approved Fanvue provider code when scoped')

const badSql = `create table if not exists public.creator_publishing_bad (id uuid, access_token text);`
assert.deepEqual(findCredentialShapedQueueSchema(badSql), ['creator_publishing_bad.access_token'], 'credential-shaped schema guard catches forbidden queue field')
assert.deepEqual(findCredentialShapedQueueSchema(sql), [], 'migration does not add credential-shaped queue fields')

console.log('Creator Publishing Queue foundation tests passed')
