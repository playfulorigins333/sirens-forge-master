import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { applyTrustedVerificationDecisionWithDeps } from "../../../lib/creator-publishing-queue/verification/serviceCore"
import { normalizeDecision, normalizeEvidenceReference, normalizeReason, normalizeSubjectType, normalizeTimestamp, normalizeUuid, normalizeVerificationInput } from "../../../lib/creator-publishing-queue/verification/validation"
const migrationPath = "supabase/migrations/20260710000900_creator_publishing_trusted_verification.sql"
const migration = fs.readFileSync(migrationPath, "utf8")

test("migration source implements trusted verification boundaries", () => {
  assert.deepEqual(fs.readdirSync("supabase/migrations").filter(f => f.includes("trusted_verification")), ["20260710000900_creator_publishing_trusted_verification.sql"])
  for (const old of ["20260710000100","20260710000200","20260710000300","20260710000400","20260710000500","20260710000600","20260710000700","20260710000800"]) assert.ok(fs.existsSync(`supabase/migrations/${fs.readdirSync("supabase/migrations").find(f=>f.startsWith(old))}`))
  assert.match(migration, /verification_status in \('unattested','creator_attested','verified','revoked'\)/)
  assert.match(migration, /create table if not exists public\.creator_publishing_creator_verifications/)
  assert.match(migration, /alter table public\.creator_publishing_creator_verifications enable row level security/)
  assert.match(migration, /create policy "creator_publishing_creator_verifications_select_own"[\s\S]*auth\.uid\(\) = creator_id/)
  assert.doesNotMatch(migration, /create policy [^\n]* on public\.creator_publishing_creator_verifications for (insert|update|delete|all)/i)
  assert.match(migration, /verification_reviewed_by uuid references auth\.users\(id\)/)
  assert.match(migration, /creator_platform_accounts_trusted_metadata_check/)
  assert.match(migration, /creator_publishing_platform_account_clear_trusted_metadata/)
  assert.match(migration, /creator_publishing_trusted_reviewers/)
  assert.match(migration, /role not in \('admin','reviewer','service_reviewer'\)/)
  assert.match(migration, /VERIFICATION_REVIEWER_INACTIVE/)
  assert.match(migration, /VERIFICATION_SELF_REVIEW_FORBIDDEN/)
  assert.match(migration, /platform = 'fanvue'[\s\S]*VERIFICATION_FANVUE_NOT_SUPPORTED/)
  assert.match(migration, /platform not in \('onlyfans','fansly'\)/)
  assert.match(migration, /VERIFICATION_EVIDENCE_REQUIRED/)
  assert.match(migration, /VERIFICATION_REASON_REQUIRED/)
  assert.match(migration, /VERIFICATION_STALE/)
  assert.match(migration, /creator_publishing_verification_audit_reviewer_key_uidx[\s\S]*on public\.creator_publishing_audit_events\(actor_id, idempotency_key\)/)
  assert.doesNotMatch(migration.slice(migration.indexOf("creator_publishing_verification_audit_reviewer_key_uidx"), migration.indexOf("create or replace function public.creator_publishing_apply_trusted_verification_decision")), /entity_id/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /request_fingerprint/)
  assert.match(migration, /resulting_status[\s\S]*VERIFICATION_IDEMPOTENCY_CONFLICT/)
  assert.match(migration, /insert into public\.creator_publishing_audit_events/g)
  assert.doesNotMatch(migration, /on conflict[\s\S]*do nothing/i)
  assert.match(migration, /revoke execute on function public\.creator_publishing_apply_trusted_verification_decision\(uuid,text,uuid,text,text,text,timestamptz,text\) from public/i)
  assert.match(migration, /from anon/i); assert.match(migration, /from authenticated/i); assert.match(migration, /grant execute[\s\S]*to service_role/i)
  assert.match(migration, /verification_status not in \('creator_attested','verified'\)/)
  assert.match(migration, /verification_status = 'revoked'/)
  assert.match(migration, /platform = 'fanvue'/)
  assert.doesNotMatch(migration, /insert into public\.creator_publishing_compliance_reviews/)
  assert.doesNotMatch(migration, /insert into public\.creator_publishing_queue_tasks/)
  assert.doesNotMatch(migration, /insert into public\.creator_publishing_media_assets/)
})

test("validation normalizes safe verification inputs", () => {
  assert.equal(normalizeSubjectType(" creator "), "creator"); assert.equal(normalizeSubjectType("platform_account"), "platform_account"); assert.throws(()=>normalizeSubjectType("fanvue"))
  assert.equal(normalizeDecision("verify"), "verify"); assert.equal(normalizeDecision("revoke"), "revoke"); assert.equal(normalizeDecision("mark_unverified"), "mark_unverified"); assert.throws(()=>normalizeDecision("verified"))
  assert.equal(normalizeReason("  reviewed   manually "), "reviewed manually"); assert.throws(()=>normalizeReason("   ")); assert.throws(()=>normalizeReason("a".repeat(1001))); assert.throws(()=>normalizeReason("bad\ncontrol"))
  assert.equal(normalizeEvidenceReference("  case-123  ", "verify"), "case-123"); assert.throws(()=>normalizeEvidenceReference("", "verify")); assert.equal(normalizeEvidenceReference(" ", "revoke"), null); assert.throws(()=>normalizeEvidenceReference("token=abc", "verify")); assert.throws(()=>normalizeEvidenceReference("a".repeat(501), "verify"))
  assert.equal(normalizeUuid("00000000-0000-4000-8000-000000000000"), "00000000-0000-4000-8000-000000000000"); assert.throws(()=>normalizeUuid("bad"))
  assert.equal(normalizeTimestamp("2026-07-10T00:00:00Z"), "2026-07-10T00:00:00Z"); assert.equal(normalizeTimestamp(null), null); assert.throws(()=>normalizeTimestamp("yesterday"))
  assert.throws(()=>normalizeVerificationInput({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000000",decision:"verify",reason:"ok",evidenceReference:"case",idempotencyKey:"bad space"}))
  for (const forbidden of ["reviewerId","actorRole","targetStatus","password","token","cookie","session","apiKey"]) assert.throws(()=>normalizeVerificationInput({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000000",decision:"revoke",reason:"ok",idempotencyKey:"abcdefgh",[forbidden]:"x"} as any))
})

test("service derives reviewer server-side and maps safe RPC results", async () => {
  const calls:any[]=[]; const baseDeps:any={ getAuthenticatedUserId: async()=>"00000000-0000-4000-8000-000000000001", randomUUID:()=>"serverkey1", getAdminClient:()=>({ rpc: async(name:string,args:any)=>{ calls.push({name,args}); return {data:{subject_type:args.p_subject_type,subject:{id:args.p_subject_id},prior_status:"unverified",resulting_status:args.p_decision==="verify"?"verified":args.p_decision==="revoke"?"revoked":"unverified",idempotent:false,outcome:args.p_decision==="verify"?"verified":args.p_decision==="revoke"?"revoked":"marked_unverified",audit_event_ids:["00000000-0000-4000-8000-000000000099"],reviewed_at:"2026-07-10T00:00:00Z"},error:null}}, from:()=>({})}) }
  assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision:"verify",reason:" ok ",evidenceReference:"case",expectedUpdatedAt:null}, baseDeps)).ok, true)
  assert.equal(calls[0].args.p_reviewer_id, "00000000-0000-4000-8000-000000000001"); assert.equal(JSON.stringify(calls).includes("service_role"), false)
  for (const decision of ["revoke","mark_unverified"] as const) assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision,reason:"ok",expectedUpdatedAt:"2026-07-10T00:00:00Z",idempotencyKey:"abcdefgh"}, baseDeps)).ok, true)
  for (const decision of ["verify","revoke","mark_unverified"] as const) assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"platform_account",subjectId:"00000000-0000-4000-8000-000000000003",decision,reason:"ok",evidenceReference:decision==="verify"?"case":null,expectedUpdatedAt:"2026-07-10T00:00:00Z",idempotencyKey:"abcdefgh"}, baseDeps)).ok, true)
  const errorCodes=["VERIFICATION_UNAUTHORIZED","VERIFICATION_REVIEWER_INACTIVE","VERIFICATION_UNAUTHORIZED","VERIFICATION_ATTESTATION_REQUIRED","VERIFICATION_FANVUE_NOT_SUPPORTED","VERIFICATION_SELF_REVIEW_FORBIDDEN","VERIFICATION_SUBJECT_NOT_FOUND","VERIFICATION_STALE","VERIFICATION_IDEMPOTENCY_CONFLICT"]
  for (const code of errorCodes) { const res = await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision:"revoke",reason:"ok",idempotencyKey:"abcdefgh"}, {...baseDeps,getAdminClient:()=>({rpc:async()=>({data:null,error:{message:`db says ${code} internal`}}),from:()=>({})})}); assert.equal((res as any).code, code) }
  assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision:"revoke",reason:"ok",idempotencyKey:"abcdefgh"}, {...baseDeps,getAuthenticatedUserId:async()=>null})).ok, false)
  assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision:"revoke",reason:"ok",idempotencyKey:"abcdefgh"}, {...baseDeps,getAdminClient:()=>({rpc:async()=>({data:{service_role:"x"},error:null}),from:()=>({})})}) as any).code, "VERIFICATION_SAVE_FAILED")
})

test("UI and loaders expose verification workflow without forbidden controls", () => {
  const page=fs.readFileSync("app/creator/publishing-queue/review/verifications/page.tsx","utf8"); const form=fs.readFileSync("app/creator/publishing-queue/review/verifications/VerificationDecisionForm.tsx","utf8"); const actions=fs.readFileSync("app/creator/publishing-queue/review/verifications/actions.ts","utf8"); const loaders=fs.readFileSync("lib/creator-publishing-queue/verification/loaders.ts","utf8"); const accounts=fs.readFileSync("app/creator/publishing-queue/accounts/page.tsx","utf8"); const detail=fs.readFileSync("app/creator/publishing-queue/[contentPackageId]/page.tsx","utf8"); const uiLoaders=fs.readFileSync("lib/creator-publishing-queue/ui/loaders.ts","utf8")
  assert.match(loaders, /supabase\.auth\.getUser/); assert.match(loaders, /creator_publishing_trusted_reviewers/); assert.doesNotMatch(loaders+page, /auto.?enroll|owner bypass/i)
  assert.match(page, /Creator identity/); assert.match(loaders, /in\("platform", \["onlyfans","fansly"\]\)/); assert.match(page+loaders, /Fanvue is excluded|neq\("target_platform", "fanvue"\)/)
  assert.match(form, /value="verify"/); assert.match(form, /value="revoke"/); assert.match(form, /value="mark_unverified"/); assert.match(form, /name="reason"[\s\S]*required/); assert.match(form, /Evidence reference \(required for verify\)/); assert.match(actions, /randomUUID\(\)/); assert.match(form, /Self-review is disabled/)
  assert.match(accounts, /Unattested/); assert.match(accounts, /Creator attested/); assert.match(accounts, /Trusted verification recorded/); assert.match(accounts, /Revoked/); assert.match(accounts, /Editing this account reference will require verification review again/)
  assert.match(detail, /Creator verification status/); assert.match(detail, /Selected platform-account verification status/); assert.doesNotMatch(detail+page+form, /Submit for compliance|type="file"|capture=|name="password"|name="token"|name="cookie"|name="api.?key"|Connect account|Login|Test connection/i)
  assert.match(uiLoaders, /\["creator_attested","verified"\]/); assert.doesNotMatch(fs.readFileSync("app/creator/publishing-queue/accounts/PlatformAccountForm.tsx","utf8"), /value="verified"|name="verificationStatus"|targetStatus/)
})

console.log("Trusted verification source, validation, service, and UI checks passed")
