import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findCredentialShapedQueueSchema, findForbiddenNetworkCalls } from '../../../scripts/creatorPublishingQueueSafetyGuard'

const migrationPath = 'supabase/migrations/20260710000100_creator_publishing_queue_foundation.sql'
const sql = readFileSync(migrationPath, 'utf8')


const credentialKeyFunctionMatch = sql.match(/create or replace function public\.creator_publishing_queue_jsonb_has_forbidden_credential_key\(value jsonb\)[\s\S]*?\n\$\$;/)
assert.ok(credentialKeyFunctionMatch, 'credential-key helper function is defined')
const credentialKeyFunctionSql = credentialKeyFunctionMatch[0]

const forbiddenCredentialKeys = [
  'password',
  'access_token',
  'refresh_token',
  'auth_token',
  'session',
  'session_id',
  'cookie',
  'cookies',
  'two_factor_secret',
  'recovery_code',
  'platform_secret',
]

function jsonbHasForbiddenCredentialKeyFixture(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => jsonbHasForbiddenCredentialKeyFixture(entry))
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, childValue]) => {
      return forbiddenCredentialKeys.includes(key.toLowerCase()) || jsonbHasForbiddenCredentialKeyFixture(childValue)
    })
  }

  return false
}

assert.match(credentialKeyFunctionSql, /language plpgsql[\s\S]*immutable/, 'credential-key helper remains an immutable PostgreSQL function')
assert.match(credentialKeyFunctionSql, /jsonb_each\(\$1\)/, 'credential-key helper traverses root and nested JSON objects')
assert.match(credentialKeyFunctionSql, /jsonb_array_elements\(\$1\)/, 'credential-key helper traverses JSON arrays')
assert.match(credentialKeyFunctionSql, /lower\(object_key\) in/, 'credential-key helper inspects object keys case-insensitively')
assert.match(credentialKeyFunctionSql, /creator_publishing_queue_jsonb_has_forbidden_credential_key\(object_value\)/, 'credential-key helper recursively checks nested object values')
assert.match(credentialKeyFunctionSql, /creator_publishing_queue_jsonb_has_forbidden_credential_key\(array_value\)/, 'credential-key helper recursively checks values inside arrays')
for (const key of forbiddenCredentialKeys) {
  assert.match(credentialKeyFunctionSql, new RegExp(`'${key}'`), `credential-key helper rejects ${key}`)
}
assert.doesNotMatch(credentialKeyFunctionSql, /with recursive walk/i, 'credential-key helper does not restore the invalid recursive CTE')
assert.doesNotMatch(credentialKeyFunctionSql, /from walk[\s\S]*union all[\s\S]*from walk/i, 'credential-key helper does not contain two recursive UNION ALL branches')
assert.equal(jsonbHasForbiddenCredentialKeyFixture({ password: 'secret' }), true, 'direct forbidden key returns true')
assert.equal(jsonbHasForbiddenCredentialKeyFixture({ profile: { settings: { refresh_token: 'secret' } } }), true, 'deeply nested forbidden key returns true')
assert.equal(jsonbHasForbiddenCredentialKeyFixture([{ caption: 'safe' }, { cookie: 'secret' }]), true, 'forbidden key inside an array returns true')
assert.equal(jsonbHasForbiddenCredentialKeyFixture({ posts: [{ metadata: { session_id: 'secret' } }] }), true, 'forbidden key inside an object contained in an array returns true')
assert.equal(jsonbHasForbiddenCredentialKeyFixture({ Platform_Secret: 'secret' }), true, 'mixed-case forbidden key returns true')
assert.equal(jsonbHasForbiddenCredentialKeyFixture({ profile: { tags: ['safe', { notes: ['still safe'] }], meta: { platform: 'fanvue' } } }), false, 'clean deeply nested objects and arrays return false')
assert.equal(jsonbHasForbiddenCredentialKeyFixture('password'), false, 'JSON string scalar returns false')
assert.equal(jsonbHasForbiddenCredentialKeyFixture(42), false, 'JSON number scalar returns false')
assert.equal(jsonbHasForbiddenCredentialKeyFixture(true), false, 'JSON boolean scalar returns false')
assert.equal(jsonbHasForbiddenCredentialKeyFixture(null), false, 'JSON null returns false')
assert.equal(jsonbHasForbiddenCredentialKeyFixture({}), false, 'empty object returns false')
assert.equal(jsonbHasForbiddenCredentialKeyFixture([]), false, 'empty array returns false')

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
assert.match(sql, /Title changes are treated as compliance-invalidating/, 'title edits are documented as compliance-invalidating')
assert.match(sql, /compliance_invalidating_content_changed :=[\s\S]*old\.caption_body is distinct from new\.caption_body/, 'changing caption_body invalidates compliance and approval')
assert.match(sql, /compliance_invalidating_content_changed :=[\s\S]*old\.ai_flag is distinct from new\.ai_flag/, 'changing ai_flag invalidates compliance and approval')
assert.match(sql, /compliance_invalidating_content_changed :=[\s\S]*old\.ai_detail is distinct from new\.ai_detail/, 'changing ai_detail invalidates compliance and approval')
assert.match(sql, /compliance_invalidating_content_changed :=[\s\S]*old\.second_person_present is distinct from new\.second_person_present/, 'changing second_person_present invalidates compliance and approval')
assert.match(sql, /compliance_invalidating_content_changed :=[\s\S]*old\.target_platform is distinct from new\.target_platform/, 'changing target_platform invalidates compliance and approval')
assert.match(sql, /compliance_invalidating_content_changed :=[\s\S]*old\.platform_account_id is distinct from new\.platform_account_id/, 'changing platform_account_id invalidates compliance and approval')
assert.match(sql, /compliance_invalidating_content_changed :=[\s\S]*old\.title is distinct from new\.title/, 'changing title invalidates compliance and approval')
assert.match(sql, /compliance_invalidating_content_changed :=[\s\S]*old\.price_notes is distinct from new\.price_notes/, 'changing price_notes invalidates compliance and approval')
assert.match(sql, /compliance_invalidating_content_changed :=[\s\S]*old\.visibility_notes is distinct from new\.visibility_notes/, 'changing visibility_notes invalidates compliance and approval')
assert.match(sql, /if compliance_invalidating_content_changed then[\s\S]*new\.compliance_status = 'pending'[\s\S]*new\.compliance_policy_version = 'unassigned'[\s\S]*new\.forced_disclosure_text = null[\s\S]*new\.creator_approval_status = 'pending'[\s\S]*new\.creator_approved_by = null[\s\S]*new\.creator_approved_at = null/, 'compliance-invalidating edits reset compliance and approval state')
assert.match(sql, /protected_fields_changed and not compliance_invalidating_content_changed[\s\S]*raise exception/, 'ordinary creators still cannot directly set compliance_status to passed or creator_approval_status to approved')
assert.match(sql, /current_user in \('authenticated', 'anon'\)/, 'trusted service/admin workflows remain possible because protection is scoped to authenticated/anon roles')
assert.match(sql, /queue_tasks is 'Task 1 foundation:[\s\S]*intentionally service-role-only/, 'queue tasks writes are documented as service-role-only')
assert.match(sql, /compliance_reviews is 'Task 1 foundation:[\s\S]*intentionally service-role-only/, 'review writes are documented as service-role-only')
assert.doesNotMatch(sql, /creator_publishing_queue_tasks for insert|creator_publishing_compliance_reviews for insert|creator_publishing_audit_events for insert/, 'queue/review/audit tables do not get broad authenticated insert policies')

const fixture = 'backend/creator-publishing-queue/fixtures/forbidden-egress.fixture.ts'
const variantsFixture = 'backend/creator-publishing-queue/fixtures/forbidden-egress-variants.fixture.ts'
assert.deepEqual(findForbiddenNetworkCalls([fixture]), [fixture], 'forbidden-host egress guard catches fixture network call')
assert.deepEqual(findForbiddenNetworkCalls([variantsFixture]), [variantsFixture], 'forbidden-host egress guard catches adversarial network call variants')
assert.deepEqual(findForbiddenNetworkCalls(['lib/autopost/fanvueApiClientCore.ts']), [], 'guard does not block approved Fanvue provider code when scoped')

const badSql = `create table if not exists public.creator_publishing_bad (id uuid, access_token text);`
assert.deepEqual(findCredentialShapedQueueSchema(badSql), ['creator_publishing_bad.access_token'], 'credential-shaped schema guard catches forbidden queue field')
assert.deepEqual(findCredentialShapedQueueSchema(sql), [], 'migration does not add credential-shaped queue fields')

console.log('Creator Publishing Queue foundation tests passed')
