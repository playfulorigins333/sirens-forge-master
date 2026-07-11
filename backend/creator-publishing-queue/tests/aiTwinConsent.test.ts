import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { AI_TWIN_CONSENT_TEXT, AI_TWIN_CONSENT_VERSION } from "../../../lib/creator-publishing-queue/consent/copy"
import { getAiTwinConsentTextSha256 } from "../../../lib/creator-publishing-queue/consent/hash"
import { AI_TWIN_CONSENT_PROTECTED_FORM_FIELDS, normalizeAiTwinConsentFormInput, parseAiTwinConsentRpcResult, saveAiTwinConsentWithDeps } from "../../../lib/creator-publishing-queue/consent/serviceCore"

const migration = fs.readFileSync("supabase/migrations/20260710001000_creator_publishing_ai_twin_consent.sql", "utf8")
const form = fs.readFileSync("app/creator/publishing-queue/ai-twin-consent/AiTwinConsentForm.tsx", "utf8")
const page = fs.readFileSync("app/creator/publishing-queue/ai-twin-consent/page.tsx", "utf8")
const actions = fs.readFileSync("app/creator/publishing-queue/ai-twin-consent/actions.ts", "utf8")
const copy = fs.readFileSync("lib/creator-publishing-queue/consent/copy.ts", "utf8")
const hash = fs.readFileSync("lib/creator-publishing-queue/consent/hash.ts", "utf8")
const service = fs.readFileSync("lib/creator-publishing-queue/consent/service.ts", "utf8")
const loaders = fs.readFileSync("lib/creator-publishing-queue/consent/loaders.ts", "utf8")
const creatorId = "123e4567-e89b-42d3-a456-426614174000"
const otherCreatorId = "123e4567-e89b-42d3-a456-426614174001"
const good = (overrides:any = {}) => ({ creator_id:creatorId, prior_status:null, resulting_status:"granted", attestation_version:AI_TWIN_CONSENT_VERSION, attestation_text_sha256:getAiTwinConsentTextSha256(), granted_at:"2026-01-01T00:00:00.123Z", revoked_at:null, updated_at:"2026-01-01T00:00:00.456Z", idempotent:false, outcome:"granted", audit_event_ids:["123"], ...overrides })

test("migration source assertions cover table, RLS, RPC, transitions, SHA idempotency, and boundaries", () => {
  assert.deepEqual(fs.readdirSync("supabase/migrations").filter(f => /ai_twin_consent/.test(f)), ["20260710001000_creator_publishing_ai_twin_consent.sql"])
  for (const f of ["20260710000100_creator_publishing_queue_foundation.sql","20260710000200_creator_publishing_compliance_manual_review_outcome.sql","20260710000300_creator_publishing_manual_review_workflow.sql","20260710000400_creator_publishing_creator_approval_queue.sql","20260710000500_creator_publishing_media_upload_intents.sql","20260710000600_creator_publishing_generated_media_association.sql","20260710000700_creator_publishing_platform_account_setup.sql","20260710000800_creator_publishing_package_composer.sql","20260710000900_creator_publishing_trusted_verification.sql"]) assert.ok(fs.existsSync(`supabase/migrations/${f}`))
  assert.match(migration,/create table if not exists public\.creator_publishing_ai_twin_consents/); assert.match(migration,/creator_id uuid primary key references auth\.users\(id\) on delete cascade/); assert.match(migration,/status in \('granted','revoked'\)/); assert.match(migration,/btrim\(attestation_version\) <> ''/); assert.match(migration,/attestation_text_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/); assert.match(migration,/status = 'granted'[\s\S]*revoked_at is null/); assert.match(migration,/status = 'revoked'[\s\S]*revoked_at is not null/); assert.match(migration,/execute function public\.set_updated_at\(\)/)
  assert.match(migration,/enable row level security/); assert.match(migration,/for select using \(auth\.uid\(\) = creator_id\)/); assert.equal((migration.match(/create policy/g)||[]).length, 1); assert.match(migration,/revoke execute[\s\S]*from PUBLIC/); assert.match(migration,/from anon/); assert.match(migration,/from authenticated/); assert.match(migration,/grant execute[\s\S]*to service_role/)
  assert.match(migration,/creator_publishing_set_ai_twin_consent\(\s*p_creator_id uuid,[\s\S]*p_idempotency_key text/); assert.match(migration,/security definer/); assert.match(migration,/set search_path = public, pg_temp/); assert.match(migration,/status='verified'/); assert.match(migration,/AI_TWIN_CONSENT_CREATOR_NOT_VERIFIED/); assert.match(migration,/p_decision='revoke'[\s\S]*AI_TWIN_CONSENT_NOT_FOUND/)
  assert.match(migration,/p_expected_updated_at is not null[\s\S]*AI_TWIN_CONSENT_STALE/); assert.doesNotMatch(migration,/on conflict[\s\S]*do update/i); assert.match(migration,/exception when unique_violation then raise exception 'AI_TWIN_CONSENT_STALE'/); assert.match(migration,/v_row\.updated_at is distinct from p_expected_updated_at/); assert.match(migration,/set status='revoked', revoked_at=v_now/); assert.match(migration,/set status='granted'[\s\S]*revoked_at=null/); assert.match(migration,/AI_TWIN_CONSENT_ALREADY_GRANTED/); assert.match(migration,/creator_ai_twin_consent_reattested/); assert.match(migration,/AI_TWIN_CONSENT_ALREADY_REVOKED/)
  assert.match(migration,/pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('ai_twin_consent_key:/); assert.match(migration,/pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('ai_twin_consent_subject:/); assert.match(migration,/for update/); assert.match(migration,/v_request_payload jsonb/); assert.match(migration,/v_request_fingerprint text/); assert.match(migration,/encode\(extensions\.digest\(v_request_payload::text, 'sha256'\), 'hex'\)/); assert.doesNotMatch(migration,/request_fingerprint',v_request_payload|request_fingerprint',v_request,/); assert.doesNotMatch(migration,/md5\(/)
  assert.match(migration,/coalesce\(v_existing\.after_state->>'request_fingerprint',''\) !~ '\^\[0-9a-f\]\{64\}\$'/); assert.match(migration,/request_fingerprint'\) is distinct from v_request_fingerprint/); assert.match(migration,/v_state_payload := jsonb_build_object\('creator_id'/); assert.match(migration,/encode\(extensions\.digest\(v_state_payload::text, 'sha256'\), 'hex'\)/); assert.match(migration,/if not found then raise exception 'AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT'/); assert.match(migration,/coalesce\(v_existing\.after_state->>'resulting_state_fingerprint',''\) !~ '\^\[0-9a-f\]\{64\}\$'/); assert.match(migration,/exception when others then raise exception 'AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT'/); assert.match(migration,/v_row\.updated_at is distinct from v_stored_updated_at/)
  assert.match(migration,/v_existing\.id::text/); assert.match(migration,/v_audit_id::text/); assert.equal((migration.match(/insert into public\.creator_publishing_audit_events/g)||[]).length, 1); for (const t of ["compliance_reviews","queue_tasks","media_assets","creator_approvals"]) assert.equal(migration.includes(`insert into public.creator_publishing_${t}`), false)
})

test("form normalization fails closed and preserves timestamps", () => {
  assert.equal(normalizeAiTwinConsentFormInput([["decision","grant"],["idempotencyKey","abcdefgh"],["confirmGrant","on"]]).ok, true)
  assert.equal(normalizeAiTwinConsentFormInput([["decision","revoke"],["idempotencyKey","abcdefgh"],["confirmRevoke","on"]]).ok, true)
  assert.equal(normalizeAiTwinConsentFormInput([["idempotencyKey","abcdefgh"]]).ok, false)
  const unknown = normalizeAiTwinConsentFormInput([["decision","banana"],["idempotencyKey","abcdefgh"]]); assert.deepEqual(unknown, { ok:false, code:"AI_TWIN_CONSENT_INVALID_FORM" })
  for (const field of AI_TWIN_CONSENT_PROTECTED_FORM_FIELDS) assert.equal(normalizeAiTwinConsentFormInput([["$ACTION_ID","x"],[field,"x"],["decision","grant"],["idempotencyKey","abcdefgh"]]).ok, false)
  assert.equal(normalizeAiTwinConsentFormInput([["$ACTION_ID","x"],["decision","grant"],["idempotencyKey","abcdefgh"],["confirmGrant","on"]]).ok, true)
  const blank = normalizeAiTwinConsentFormInput([["decision","grant"],["idempotencyKey","abcdefgh"],["expectedUpdatedAt",""]]); assert.equal(blank.ok && blank.input.expectedUpdatedAt, null)
  assert.equal(normalizeAiTwinConsentFormInput([["decision","grant"],["idempotencyKey","abcdefgh"],["expectedUpdatedAt","not-a-date"]]).ok, false)
  const precise = "2026-01-01T00:00:00.123456Z"; const parsed = normalizeAiTwinConsentFormInput([["decision","grant"],["idempotencyKey","abcdefgh"],["expectedUpdatedAt",precise]]); assert.equal(parsed.ok && parsed.input.expectedUpdatedAt, precise)
})

test("strict parser binds RPC response to creator, status, outcome, timestamps, and audit ids", () => {
  assert.deepEqual(parseAiTwinConsentRpcResult(good(), creatorId, "grant").audit_event_ids, ["123"])
  assert.throws(()=>parseAiTwinConsentRpcResult(good({creator_id:"bad"}), creatorId, "grant")); assert.throws(()=>parseAiTwinConsentRpcResult(good({creator_id:otherCreatorId}), creatorId, "grant")); assert.throws(()=>parseAiTwinConsentRpcResult(good({prior_status:"pending"}), creatorId, "grant")); assert.throws(()=>parseAiTwinConsentRpcResult(good({resulting_status:"pending"}), creatorId, "grant")); assert.throws(()=>parseAiTwinConsentRpcResult(good({outcome:"noop"}), creatorId, "grant"))
  assert.throws(()=>parseAiTwinConsentRpcResult(good({outcome:"idempotent", idempotent:false}), creatorId, "grant")); assert.throws(()=>parseAiTwinConsentRpcResult(good({outcome:"revoked", resulting_status:"granted"}), creatorId, "grant")); assert.throws(()=>parseAiTwinConsentRpcResult(good({granted_at:"bad"}), creatorId, "grant")); assert.throws(()=>parseAiTwinConsentRpcResult(good({updated_at:"bad"}), creatorId, "grant")); assert.throws(()=>parseAiTwinConsentRpcResult(good({revoked_at:"2026-01-01T00:00:00Z"}), creatorId, "grant")); assert.throws(()=>parseAiTwinConsentRpcResult(good({resulting_status:"revoked", outcome:"revoked", revoked_at:null}), creatorId, "revoke"))
  for (const bad of [[123],[""],[{}],["12x"]]) assert.throws(()=>parseAiTwinConsentRpcResult(good({audit_event_ids:bad}), creatorId, "grant"))
})

test("service wraps thrown lookup admin and RPC errors safely", async () => {
  const input:any = { decision:"grant", expectedUpdatedAt:null, idempotencyKey:"abcdefgh", confirmGrant:"on" }
  assert.equal((await saveAiTwinConsentWithDeps(input, { getAuthenticatedUserId: async()=>{ throw new Error("raw") }, getAdminClient: null as any })).code, "AI_TWIN_CONSENT_SAVE_FAILED")
  assert.equal((await saveAiTwinConsentWithDeps(input, { getAuthenticatedUserId: async()=>creatorId, getAdminClient: () => { throw new Error("raw") } })).code, "AI_TWIN_CONSENT_SAVE_FAILED")
  assert.equal((await saveAiTwinConsentWithDeps(input, { getAuthenticatedUserId: async()=>creatorId, getAdminClient: () => ({ rpc: async()=>{ throw new Error("raw") } }) as any })).code, "AI_TWIN_CONSENT_SAVE_FAILED")
  const rejected = await saveAiTwinConsentWithDeps(input, { getAuthenticatedUserId: async()=>creatorId, getAdminClient: () => ({ rpc: async()=>Promise.reject(new Error("raw")) }) as any }); assert.equal(rejected.code, "AI_TWIN_CONSENT_SAVE_FAILED")
})

test("UI, crypto split, loader, and locked boundaries source assertions", () => {
  assert.match(page,/const grantIdempotencyKey = randomUUID\(\)/); assert.match(page,/const revokeIdempotencyKey = randomUUID\(\)/); assert.match(page,/grantIdempotencyKey=\{grantIdempotencyKey\}/); assert.match(page,/revokeIdempotencyKey=\{revokeIdempotencyKey\}/)
  assert.doesNotMatch(form+actions,/randomUUID\(/); assert.match(actions,/normalizeAiTwinConsentFormInput\(formData\.entries\(\)\)/); assert.match(form,/useRouter/); assert.match(form,/router\.refresh\(\)/); assert.match(form,/showGrant = view\.consentStatus !== "granted" \|\| view\.attestationVersion !== AI_TWIN_CONSENT_VERSION/); assert.match(form,/view\.consentStatus === "granted"/); assert.match(form,/required name="confirmGrant"/); assert.match(form,/required name="confirmRevoke"/)
  assert.match(form,/AI_TWIN_CONSENT_TEXT/); assert.match(form,/AI_TWIN_CONSENT_VERSION/); assert.match(page,/does not change LoRA trainer uploads/); assert.match(page,/does not authorize automatic posting/); assert.match(page,/does not connect Sirens Forge to OnlyFans or Fansly/); assert.match(page,/You may revoke/); assert.doesNotMatch(form+page,/type="file"|camera|drag|identity-document|signature|password|api key|upload button/i)
  assert.equal(copy.includes("node:crypto"), false); assert.match(hash,/import \{ createHash \} from "node:crypto"/); assert.equal(getAiTwinConsentTextSha256(), "0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12"); assert.doesNotMatch(form,/hash\.ts|node:crypto|serviceCore|service\.ts|loaders/)
  assert.match(service,/supabase\.auth\.getUser\(\)/); assert.match(loaders,/eq\("creator_id", creatorId\)/); assert.doesNotMatch(loaders,/auth\.users|training|identity|\.list\(/)
  assert.equal(AI_TWIN_CONSENT_TEXT, "I confirm that I am the verified creator whose likeness is represented by this AI twin, and I consent to Sirens Forge preparing AI-generated content featuring my likeness for manual publishing workflows. This consent does not authorize Sirens Forge to post to external platforms, access platform accounts, or store platform credentials.")
})
