import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { AI_TWIN_CONSENT_TEXT, AI_TWIN_CONSENT_VERSION, getAiTwinConsentTextSha256 } from "../../../lib/creator-publishing-queue/consent/copy"
import { hasProtectedAiTwinConsentFields, parseAiTwinConsentRpcResult, saveAiTwinConsentWithDeps } from "../../../lib/creator-publishing-queue/consent/serviceCore"

const migration = fs.readFileSync("supabase/migrations/20260710001000_creator_publishing_ai_twin_consent.sql", "utf8")
const form = fs.readFileSync("app/creator/publishing-queue/ai-twin-consent/AiTwinConsentForm.tsx", "utf8")
const page = fs.readFileSync("app/creator/publishing-queue/ai-twin-consent/page.tsx", "utf8")
const actions = fs.readFileSync("app/creator/publishing-queue/ai-twin-consent/actions.ts", "utf8")
const service = fs.readFileSync("lib/creator-publishing-queue/consent/service.ts", "utf8")
const loaders = fs.readFileSync("lib/creator-publishing-queue/consent/loaders.ts", "utf8")

test("migration source assertions cover table, RLS, RPC, transitions, idempotency, and boundaries", () => {
  assert.deepEqual(fs.readdirSync("supabase/migrations").filter(f => /ai_twin_consent/.test(f)), ["20260710001000_creator_publishing_ai_twin_consent.sql"])
  for (const f of ["20260710000100_creator_publishing_queue_foundation.sql","20260710000200_creator_publishing_compliance_manual_review_outcome.sql","20260710000300_creator_publishing_manual_review_workflow.sql","20260710000400_creator_publishing_creator_approval_queue.sql","20260710000500_creator_publishing_media_upload_intents.sql","20260710000600_creator_publishing_generated_media_association.sql","20260710000700_creator_publishing_platform_account_setup.sql","20260710000800_creator_publishing_package_composer.sql","20260710000900_creator_publishing_trusted_verification.sql"]) assert.ok(fs.existsSync(`supabase/migrations/${f}`))
  assert.match(migration,/create table if not exists public\.creator_publishing_ai_twin_consents/) ; assert.match(migration,/creator_id uuid primary key references auth\.users\(id\) on delete cascade/)
  assert.match(migration,/status in \('granted','revoked'\)/); assert.match(migration,/btrim\(attestation_version\) <> ''/); assert.match(migration,/attestation_text_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(migration,/status = 'granted'[\s\S]*revoked_at is null/); assert.match(migration,/status = 'revoked'[\s\S]*revoked_at is not null/); assert.match(migration,/execute function public\.set_updated_at\(\)/)
  assert.match(migration,/enable row level security/); assert.match(migration,/for select using \(auth\.uid\(\) = creator_id\)/); assert.equal((migration.match(/create policy/g)||[]).length, 1)
  assert.match(migration,/revoke execute[\s\S]*from PUBLIC/); assert.match(migration,/from anon/); assert.match(migration,/from authenticated/); assert.match(migration,/grant execute[\s\S]*to service_role/)
  assert.match(migration,/creator_publishing_set_ai_twin_consent\(\s*p_creator_id uuid,[\s\S]*p_idempotency_key text/); assert.match(migration,/security definer/); assert.match(migration,/set search_path = public, pg_temp/)
  assert.match(migration,/status='verified'/); assert.match(migration,/AI_TWIN_CONSENT_CREATOR_NOT_VERIFIED/); assert.match(migration,/p_decision='revoke'[\s\S]*AI_TWIN_CONSENT_NOT_FOUND/)
  assert.match(migration,/p_expected_updated_at is not null[\s\S]*AI_TWIN_CONSENT_STALE/); assert.doesNotMatch(migration,/on conflict[\s\S]*do update/i); assert.match(migration,/exception when unique_violation then raise exception 'AI_TWIN_CONSENT_STALE'/)
  assert.match(migration,/v_row\.updated_at is distinct from p_expected_updated_at/); assert.match(migration,/set status='revoked', revoked_at=v_now/); assert.match(migration,/set status='granted'[\s\S]*revoked_at=null/)
  assert.match(migration,/AI_TWIN_CONSENT_ALREADY_GRANTED/); assert.match(migration,/creator_ai_twin_consent_reattested/); assert.match(migration,/AI_TWIN_CONSENT_ALREADY_REVOKED/)
  assert.match(migration,/pg_advisory_xact_lock\(hashtext\('ai_twin_consent_key:/); assert.match(migration,/pg_advisory_xact_lock\(hashtext\('ai_twin_consent_subject:/); assert.match(migration,/for update/)
  assert.match(migration,/request_fingerprint/); assert.match(migration,/resulting_state_fingerprint/); assert.match(migration,/resulting_updated_at/); assert.match(migration,/v_existing\.id::text/); assert.match(migration,/v_audit_id::text/)
  assert.match(migration,/v_stored_updated_at := \(v_existing\.after_state->>'resulting_updated_at'\)::timestamptz/); assert.match(migration,/exception when others then raise exception 'AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT'/); assert.match(migration,/v_row\.updated_at <> v_stored_updated_at/)
  assert.equal((migration.match(/insert into public\.creator_publishing_audit_events/g)||[]).length, 1); for (const t of ["compliance_reviews","queue_tasks","media_assets","creator_approvals"]) assert.equal(migration.includes(`insert into public.creator_publishing_${t}`), false)
})

test("service parser and safe form handling", async () => {
  assert.equal(AI_TWIN_CONSENT_VERSION, "creator-ai-twin-consent-v1"); assert.equal(getAiTwinConsentTextSha256(), "0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12")
  const good:any = { creator_id:"c", prior_status:null, resulting_status:"granted", attestation_version:"v", attestation_text_sha256:getAiTwinConsentTextSha256(), granted_at:"2026-01-01", revoked_at:null, updated_at:"2026-01-01", idempotent:true, outcome:"idempotent", audit_event_ids:["123"] }
  assert.deepEqual(parseAiTwinConsentRpcResult(good).audit_event_ids, ["123"]); for (const bad of [[123],[""],[{}],["12x"]]) assert.throws(()=>parseAiTwinConsentRpcResult({...good,audit_event_ids:bad}))
  for (const k of ["creatorId","status","attestationVersion","attestationText","attestationTextSha256","grantedAt","revokedAt","reviewerId","password","token","cookie","session","apiKey"]) assert.equal(hasProtectedAiTwinConsentFields({[k]:"x"}), true)
  let rpcArgs:any; const ok = await saveAiTwinConsentWithDeps({decision:"grant", expectedUpdatedAt:null, idempotencyKey:"abcdefgh", confirmGrant:"on"}, { getAuthenticatedUserId: async()=>"creator-1", getAdminClient: () => ({ rpc: async (_n:string,args:any) => { rpcArgs=args; return { data: good, error:null } } }) as any }); assert.equal(ok.ok, true); assert.equal(rpcArgs.p_creator_id, "creator-1"); assert.equal(rpcArgs.p_attestation_version, AI_TWIN_CONSENT_VERSION); assert.equal(rpcArgs.p_attestation_text_sha256, getAiTwinConsentTextSha256())
  assert.equal((await saveAiTwinConsentWithDeps({decision:"grant", idempotencyKey:"abcdefgh"}, { getAuthenticatedUserId: async()=>"c", getAdminClient: null as any })).ok, false)
})

test("UI, loader, and locked boundaries source assertions", () => {
  assert.match(page,/import \{ randomUUID \} from "node:crypto"/); assert.match(page,/const idempotencyKey = randomUUID\(\)/); assert.match(page,/idempotencyKey=\{idempotencyKey\}/)
  assert.doesNotMatch(form+actions,/randomUUID\(/); assert.match(actions,/formData\.get\("idempotencyKey"\)/); assert.match(form,/Grant AI-twin consent/); assert.match(form,/Revoke AI-twin consent/); assert.match(form,/view\.consentStatus === "granted"/); assert.match(form,/!verified/); assert.match(form,/confirmGrant/); assert.match(form,/confirmRevoke/)
  assert.match(form,/AI_TWIN_CONSENT_TEXT/); assert.equal(AI_TWIN_CONSENT_TEXT, "I confirm that I am the verified creator whose likeness is represented by this AI twin, and I consent to Sirens Forge preparing AI-generated content featuring my likeness for manual publishing workflows. This consent does not authorize Sirens Forge to post to external platforms, access platform accounts, or store platform credentials."); assert.match(page,/does not change LoRA trainer uploads/); assert.match(page,/does not authorize automatic posting/); assert.match(page,/does not connect Sirens Forge to OnlyFans or Fansly/); assert.match(page,/You may revoke/)
  assert.doesNotMatch(form+page,/type="file"|camera|drag|identity-document|signature|password|api key|upload button/i)
  assert.match(service,/supabase\.auth\.getUser\(\)/); assert.match(loaders,/eq\("creator_id", creatorId\)/); assert.doesNotMatch(loaders,/auth\.users|training|identity|\.list\(/)

})
