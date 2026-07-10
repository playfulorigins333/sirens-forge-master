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
assert.match(sql, /platform_account_id uuid not null/, 'platform_account_id is required for content packages')
assert.match(sql, /creator_platform_accounts_id_creator_platform_unique unique \(id, creator_id, platform\)/, 'platform account exposes composite uniqueness for package ownership matching')
assert.match(sql, /creator_publishing_content_platform_account_fk[\s\S]*foreign key \(platform_account_id, creator_id, target_platform\)[\s\S]*references public\.creator_platform_accounts\(id, creator_id, platform\)/, 'content package platform account must match creator and target platform')
assert.match(sql, /compliance_policy_version text not null default 'unassigned'/, 'creator inserts get a system placeholder compliance_policy_version by default')
assert.match(sql, /before insert or update on public\.creator_publishing_content_packages/, 'protected-field trigger runs on inserts and updates')
assert.match(sql, /tg_op = 'INSERT'[\s\S]*new\.compliance_status = 'pending'/, 'ordinary creator inserts cannot set compliance_status to passed or escalated_approved')
assert.match(sql, /tg_op = 'INSERT'[\s\S]*new\.creator_approval_status = 'pending'/, 'ordinary creator inserts cannot set creator_approval_status to approved')
assert.match(sql, /tg_op = 'INSERT'[\s\S]*new\.creator_approved_by = null/, 'ordinary creator inserts cannot forge creator_approved_by')
assert.match(sql, /tg_op = 'INSERT'[\s\S]*new\.creator_approved_at = null/, 'ordinary creator inserts cannot forge creator_approved_at')
assert.match(sql, /tg_op = 'INSERT'[\s\S]*new\.forced_disclosure_text = null/, 'ordinary creator inserts cannot set forced_disclosure_text')
assert.match(sql, /tg_op = 'INSERT'[\s\S]*new\.compliance_policy_version = 'unassigned'/, 'ordinary creator inserts cannot select compliance_policy_version')
assert.match(sql, /creator_publishing_prevent_creator_controlled_field_update[\s\S]*tg_op = 'UPDATE'[\s\S]*old\.compliance_status is distinct from new\.compliance_status/, 'ordinary creators cannot change pending compliance to passed or escalated_approved')
assert.match(sql, /old\.compliance_policy_version is distinct from new\.compliance_policy_version/, 'ordinary creators cannot change compliance_policy_version')
assert.match(sql, /old\.forced_disclosure_text is distinct from new\.forced_disclosure_text/, 'ordinary creators cannot alter forced_disclosure_text')
assert.match(sql, /old\.creator_approved_by is distinct from new\.creator_approved_by/, 'ordinary creators cannot forge creator_approved_by')
assert.match(sql, /old\.creator_approved_at is distinct from new\.creator_approved_at/, 'ordinary creators cannot forge creator_approved_at')
assert.match(sql, /old\.creator_approval_status is distinct from new\.creator_approval_status/, 'ordinary creators cannot directly mutate creator approval status')
assert.match(sql, /queue_tasks is 'Task 1 foundation:[\s\S]*intentionally service-role-only/, 'queue tasks writes are documented as service-role-only')
assert.match(sql, /compliance_reviews is 'Task 1 foundation:[\s\S]*intentionally service-role-only/, 'review writes are documented as service-role-only')
assert.doesNotMatch(sql, /creator_publishing_queue_tasks for insert|creator_publishing_compliance_reviews for insert|creator_publishing_audit_events for insert/, 'queue/review/audit tables do not get broad authenticated insert policies')

const fixture = 'backend/creator-publishing-queue/fixtures/forbidden-egress.fixture.ts'
assert.deepEqual(findForbiddenNetworkCalls([fixture]), [fixture], 'forbidden-host egress guard catches fixture network call')
assert.deepEqual(findForbiddenNetworkCalls(['lib/autopost/fanvueApiClientCore.ts']), [], 'guard does not block approved Fanvue provider code when scoped')

const badSql = `create table if not exists public.creator_publishing_bad (id uuid, access_token text);`
assert.deepEqual(findCredentialShapedQueueSchema(badSql), ['creator_publishing_bad.access_token'], 'credential-shaped schema guard catches forbidden queue field')
assert.deepEqual(findCredentialShapedQueueSchema(sql), [], 'migration does not add credential-shaped queue fields')

console.log('Creator Publishing Queue foundation tests passed')
