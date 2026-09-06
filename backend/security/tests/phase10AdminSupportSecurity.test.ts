import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const migrationPath="supabase/migrations/20260906070000_phase10_admin_support_security.sql"
const migration=readFileSync(migrationPath,"utf8")
const resolutionHotfix=readFileSync("supabase/migrations/20260906093000_phase10_support_resolution_message.sql","utf8")
const admin=readFileSync("lib/security/adminAuthorization.ts","utf8")
const auditRoute=readFileSync("app/api/admin/governance/audit-events/route.ts","utf8")
const creatorSupportRoute=readFileSync("app/api/account/support/cases/route.ts","utf8")
const adminSupportRoute=readFileSync("app/api/admin/support/cases/route.ts","utf8")
const adminSupportCaseRoute=readFileSync("app/api/admin/support/cases/[caseId]/route.ts","utf8")
const adminSupportUi=readFileSync("app/admin/support/SupportQueueClient.tsx","utf8")
const creatorSupportUi=readFileSync("app/account/support/SupportClient.tsx","utf8")

test("Phase 10 migration is forward, bootstrap-bound, and preserves deletion authority",()=>{
  assert.match(migration,/reason='sole_production_admin_guard'/)
  assert.match(migration,/v_count <> 1/)
  assert.match(migration,/join auth\.users/)
  assert.doesNotMatch(migration,/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
  assert.match(migration,/admin_role_assignments[\s\S]*references auth\.users\(id\) on delete cascade/)
  assert.match(migration,/creator_user_id uuid not null references auth\.users\(id\) on delete cascade/)
  assert.match(migration,/assigned_user_id uuid references auth\.users\(id\) on delete set null/)
  assert.match(migration,/actor_user_id uuid references auth\.users\(id\) on delete set null/)
  for(const t of["admin_roles","admin_capabilities","admin_role_capabilities","admin_role_assignments","support_cases","support_case_activities"])
    assert.match(migration,new RegExp(`alter table public\\.${t} force row level security`))
  assert.match(migration,/revoke all on table[\s\S]*from public,anon,authenticated,service_role/)
  assert.match(migration,/governance_actor_is_founder_admin[\s\S]*admin_actor_has_active_role/)
})

test("admin authorization is fresh-TOTP plus bounded capability",()=>{
  assert.match(admin,/requireFreshTotp/)
  assert.match(admin,/admin_actor_has_capability/)
  assert.doesNotMatch(admin,/email|isAdmin|AUTOPOST_X_ADMIN_USER_IDS/)
})

test("governance audit reads are minimized, audited, deterministic, and bounded",()=>{
  assert.match(migration,/governance\.audit\.read/)
  assert.match(migration,/p_limit not between 1 and 100/)
  assert.match(migration,/order by e\.sequence_no desc limit p_limit/)
  assert.match(migration,/governance\.audit\.read','governance_audit','events'/)
  assert.match(migration,/returned_count/)
  const signature=migration.match(/returns table\(sequence_no[\s\S]*?\)\nlanguage plpgsql volatile/)?.[0]??""
  for(const forbidden of["facts","reference_hashes","reason text","prompt","access_token"])
    assert.doesNotMatch(signature,new RegExp(forbidden,"i"))
  assert.match(auditRoute,/requireAdminCapability\("governance\.audit\.read"\)/)
  assert.match(auditRoute,/admin_operator/)
  assert.match(auditRoute,/no-store/)
})

test("support pagination uses a complete timestamp plus UUID cursor",()=>{
  assert.match(migration,/\(c\.opened_at,c\.id\)<\(p_before,p_before_id\)/)
  assert.match(migration,/\(c\.updated_at,c\.id\)<\(p_before,p_before_id\)/)
  assert.match(creatorSupportRoute,/before_id/)
  assert.match(adminSupportRoute,/before_id/)
  assert.match(creatorSupportRoute,/uuid\.test\(beforeId\)/)
  assert.match(adminSupportRoute,/uuid\.test\(beforeId\)/)
})

test("support lifecycle is bounded, auditable, and reopening clears resolved_at",()=>{
  assert.match(migration,/SUPPORT_TRANSITION_INVALID/)
  assert.match(migration,/char_length\(summary\) between 3 and 500/)
  assert.match(migration,/support\.case\.status_changed/)
  assert.match(migration,/admin_operator/)
  assert.match(migration,/when v_old='resolved' and p_status<>'resolved' then null/)
  assert.match(creatorSupportRoute,/auth\.getUser/)
  assert.match(creatorSupportRoute,/no-store/)
})

test("resolved support cases require and expose one creator-facing resolution message",()=>{
  assert.match(resolutionHotfix,/add column resolution_message text/)
  assert.match(resolutionHotfix,/SUPPORT_RESOLUTION_MESSAGE_REQUIRED/)
  assert.match(resolutionHotfix,/when p_status='resolved' then btrim\(p_note\)/)
  assert.match(resolutionHotfix,/when v_old='resolved' and p_status='in_progress' then null/)
  assert.match(resolutionHotfix,/c\.resolution_message/)
  assert.match(adminSupportCaseRoute,/status==="resolved"&&!note/)
  assert.match(adminSupportCaseRoute,/status!=="resolved"&&x\.note!=null/)
  assert.match(adminSupportUi,/Message to creator/)
  assert.match(adminSupportUi,/Tell the creator what was done before resolving the case/)
  assert.match(creatorSupportUi,/resolution_message/)
  assert.match(creatorSupportUi,/What we did/)
})

test("Phase 10 does not create impersonation, password reset, MFA bypass, or private browsing",()=>{
  const all=migration+resolutionHotfix+admin+auditRoute+creatorSupportRoute+adminSupportRoute+adminSupportCaseRoute
  for(const prohibited of["login as user","resetPasswordForEmail","disable mfa","signedUrl","AUTOPOST_X_ADMIN_USER_IDS"])
    assert.doesNotMatch(all,new RegExp(prohibited,"i"))
})
