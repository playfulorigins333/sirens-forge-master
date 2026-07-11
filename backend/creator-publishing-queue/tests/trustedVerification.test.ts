import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { applyTrustedVerificationDecisionWithDeps, parseVerificationRpcResult } from "../../../lib/creator-publishing-queue/verification/serviceCore"
import { normalizeDecision, normalizeEvidenceReference, normalizeReason, normalizeSubjectType, normalizeTimestamp, normalizeUuid, normalizeVerificationInput } from "../../../lib/creator-publishing-queue/verification/validation"
import { buildTrustedVerificationCreatorIds, TRUSTED_VERIFICATION_CREATOR_LIMIT } from "../../../lib/creator-publishing-queue/verification/subjectDiscovery"
const migrationPath = "supabase/migrations/20260710000900_creator_publishing_trusted_verification.sql"
const migration = fs.readFileSync(migrationPath, "utf8")

function creatorUuid(n: number) { return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}` }

test("subject discovery helper unions, validates, deduplicates, sorts, limits, and preserves inputs", () => {
  const packageOnly = creatorUuid(3), accountOnly = creatorUuid(2), both = creatorUuid(1), repeatedPackage = creatorUuid(5), repeatedAccount = creatorUuid(4)
  const packageRows = [{ creator_id: packageOnly }, { creator_id: both }, { creator_id: both }, { creator_id: repeatedPackage }, { creator_id: repeatedPackage }, { creator_id: null }, { creator_id: undefined }, { creator_id: "" }, { creator_id: "not-a-uuid" }]
  const accountRows = [{ creator_id: accountOnly }, { creator_id: both }, { creator_id: repeatedAccount }, { creator_id: repeatedAccount }, { creator_id: "   " }, { creator_id: "00000000-0000-0000-0000-000000000000" }]
  const packageSnapshot = JSON.stringify(packageRows), accountSnapshot = JSON.stringify(accountRows)
  const result = buildTrustedVerificationCreatorIds(packageRows, accountRows)
  assert.deepEqual(result, [both, accountOnly, packageOnly, repeatedAccount, repeatedPackage])
  assert.equal(result.filter(id => id === both).length, 1)
  assert.equal(result.filter(id => id === repeatedPackage).length, 1)
  assert.equal(result.filter(id => id === repeatedAccount).length, 1)
  assert.equal(JSON.stringify(packageRows), packageSnapshot)
  assert.equal(JSON.stringify(accountRows), accountSnapshot)
  assert.deepEqual(buildTrustedVerificationCreatorIds(packageRows, accountRows, 2), [both, accountOnly])
  assert.throws(() => buildTrustedVerificationCreatorIds(packageRows, accountRows, 0))
  assert.throws(() => buildTrustedVerificationCreatorIds(packageRows, accountRows, TRUSTED_VERIFICATION_CREATOR_LIMIT + 1))
  assert.throws(() => buildTrustedVerificationCreatorIds(packageRows, accountRows, 1.5))
})

test("subject discovery helper prevents high-volume creator crowd-out", () => {
  const creatorA = creatorUuid(1), creatorB = creatorUuid(2), creatorC = creatorUuid(3)
  const packageRows = Array.from({ length: 150 }, () => ({ creator_id: creatorA }))
  packageRows.push({ creator_id: creatorB })
  const result = buildTrustedVerificationCreatorIds(packageRows, [{ creator_id: creatorC }])
  assert.deepEqual(result, [creatorA, creatorB, creatorC])
  assert.equal(result.filter(id => id === creatorA).length, 1)
})

test("subject discovery helper applies final limit after union and sorting", () => {
  const packageRows = Array.from({ length: 40 }, (_, i) => ({ creator_id: creatorUuid(80 - i) }))
  const accountRows = Array.from({ length: 30 }, (_, i) => ({ creator_id: creatorUuid(1 + i) }))
  const allSorted = Array.from(new Set([...packageRows, ...accountRows].map(r => r.creator_id))).sort((a, b) => a.localeCompare(b))
  const result = buildTrustedVerificationCreatorIds(packageRows, accountRows)
  assert.equal(result.length, TRUSTED_VERIFICATION_CREATOR_LIMIT)
  assert.deepEqual(result, allSorted.slice(0, TRUSTED_VERIFICATION_CREATOR_LIMIT))
})

test("migration source implements trusted verification boundaries", () => {
  assert.deepEqual(fs.readdirSync("supabase/migrations").filter(f => f.includes("trusted_verification")), ["20260710000900_creator_publishing_trusted_verification.sql"])
  for (const old of ["20260710000100","20260710000200","20260710000300","20260710000400","20260710000500","20260710000600","20260710000700","20260710000800"]) assert.ok(fs.existsSync(`supabase/migrations/${fs.readdirSync("supabase/migrations").find(f=>f.startsWith(old))}`))
  assert.match(migration, /verification_status in \('unattested','creator_attested','verified','revoked'\)/)
  assert.match(migration, /create table if not exists public\.creator_publishing_creator_verifications/)
  assert.match(migration, /alter table public\.creator_publishing_creator_verifications enable row level security/)
  assert.match(migration, /create policy "creator_publishing_creator_verifications_select_own"[\s\S]*auth\.uid\(\) = creator_id/)
  assert.doesNotMatch(migration, /create policy [^\n]* on public\.creator_publishing_creator_verifications for (insert|update|delete|all)/i)
  assert.match(migration, /v_audit_id bigint/)
  assert.match(migration, /jsonb_build_array\(v_audit_id::text\)/)
  assert.match(migration, /jsonb_build_array\(v_existing.id::text\)/)
  assert.match(migration, /verification_reviewed_by uuid references auth\.users\(id\)/)
  assert.match(migration, /verification_legacy_revoked boolean not null default false/)
  assert.match(migration, /set verification_legacy_revoked = true[\s\S]*where verification_status = 'revoked'/)
  assert.match(migration, /verification_status = 'revoked' and verification_legacy_revoked is true/)
  assert.match(migration, /verification_status in \('unattested','creator_attested'\) and verification_legacy_revoked is false/)
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
  assert.match(migration, /v_account\.verification_status not in \('creator_attested','verified'\)/)
  assert.match(migration, /creator_publishing_verification_audit_reviewer_key_uidx[\s\S]*on public\.creator_publishing_audit_events\(actor_id, idempotency_key\)/)
  assert.doesNotMatch(migration.slice(migration.indexOf("creator_publishing_verification_audit_reviewer_key_uidx"), migration.indexOf("create or replace function public.creator_publishing_apply_trusted_verification_decision")), /entity_id/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /verification-subject/)
  assert.match(migration, /select exists\(select 1 from auth.users where id = p_subject_id\)/)
  assert.match(migration, /VERIFICATION_SUBJECT_NOT_FOUND/)
  assert.match(migration, /exception when unique_violation[\s\S]*VERIFICATION_STALE/)
  assert.doesNotMatch(migration, /on conflict \(creator_id\) do update/i)
  assert.match(migration, /request_fingerprint/)
  assert.match(migration, /resulting_state_fingerprint/)
  assert.match(migration, /resulting_updated_at/)
  assert.doesNotMatch(migration, /updated_at::text is distinct from v_existing\.after_state->>'resulting_updated_at'/)
  assert.match(migration, /v_stored_resulting_updated_at := \(v_existing\.after_state->>'resulting_updated_at'\)::timestamptz/)
  assert.match(migration, /nullif\(btrim\(coalesce\(v_existing\.after_state->>'resulting_updated_at',''\)\), ''\) is null[\s\S]*VERIFICATION_IDEMPOTENCY_CONFLICT/)
  assert.match(migration, /v_creator\.updated_at is distinct from v_stored_resulting_updated_at/)
  assert.match(migration, /v_account\.updated_at is distinct from v_stored_resulting_updated_at/)
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

test("parser accepts decimal-string audit IDs and rejects unsafe audit IDs", () => {
  const base = { subject_type: "creator", subject: { id: "creator" }, prior_status: "unverified", resulting_status: "verified", idempotent: false, outcome: "verified", audit_event_ids: ["123"], reviewed_at: "2026-07-10T00:00:00Z" }
  const parsed = parseVerificationRpcResult(base)
  assert.ok(parsed)
  assert.deepEqual(parsed.audit_event_ids, ["123"])
  const ids: string[] = parsed.audit_event_ids
  assert.deepEqual(ids, ["123"])
  assert.equal(parseVerificationRpcResult({ ...base, audit_event_ids: [123] }), null)
  assert.equal(parseVerificationRpcResult({ ...base, audit_event_ids: [{ id: "123" }] }), null)
  assert.equal(parseVerificationRpcResult({ ...base, audit_event_ids: [""] }), null)
  assert.equal(parseVerificationRpcResult({ ...base, audit_event_ids: ["12x"] }), null)
})


test("service derives reviewer server-side and maps safe RPC results", async () => {
  const calls:any[]=[]; const baseDeps:any={ getAuthenticatedUserId: async()=>"00000000-0000-4000-8000-000000000001", getAdminClient:()=>({ rpc: async(name:string,args:any)=>{ calls.push({name,args}); return {data:{subject_type:args.p_subject_type,subject:{id:args.p_subject_id},prior_status:"unverified",resulting_status:args.p_decision==="verify"?"verified":args.p_decision==="revoke"?"revoked":"unverified",idempotent:false,outcome:args.p_decision==="verify"?"verified":args.p_decision==="revoke"?"revoked":"marked_unverified",audit_event_ids:["99"],reviewed_at:"2026-07-10T00:00:00Z"},error:null}}, from:()=>({})}) }
  assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision:"verify",reason:" ok ",evidenceReference:"case",expectedUpdatedAt:null,idempotencyKey:"abcdefgh"}, baseDeps)).ok, true)
  assert.equal(((await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision:"verify",reason:" ok ",evidenceReference:"case",expectedUpdatedAt:null,idempotencyKey:"abcdefgh"}, baseDeps)) as any).result.audit_event_ids[0], "99"); assert.equal(calls[0].args.p_reviewer_id, "00000000-0000-4000-8000-000000000001"); assert.equal(JSON.stringify(calls).includes("service_role"), false)
  for (const decision of ["revoke","mark_unverified"] as const) assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision,reason:"ok",expectedUpdatedAt:"2026-07-10T00:00:00Z",idempotencyKey:"abcdefgh"}, baseDeps)).ok, true)
  for (const decision of ["verify","revoke","mark_unverified"] as const) assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"platform_account",subjectId:"00000000-0000-4000-8000-000000000003",decision,reason:"ok",evidenceReference:decision==="verify"?"case":null,expectedUpdatedAt:"2026-07-10T00:00:00Z",idempotencyKey:"abcdefgh"}, baseDeps)).ok, true)
  const errorCodes=["VERIFICATION_UNAUTHORIZED","VERIFICATION_REVIEWER_INACTIVE","VERIFICATION_UNAUTHORIZED","VERIFICATION_ATTESTATION_REQUIRED","VERIFICATION_FANVUE_NOT_SUPPORTED","VERIFICATION_SELF_REVIEW_FORBIDDEN","VERIFICATION_SUBJECT_NOT_FOUND","VERIFICATION_STALE","VERIFICATION_IDEMPOTENCY_CONFLICT"]
  for (const code of errorCodes) { const res = await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision:"revoke",reason:"ok",idempotencyKey:"abcdefgh"}, {...baseDeps,getAdminClient:()=>({rpc:async()=>({data:null,error:{message:`db says ${code} internal`}}),from:()=>({})})}); assert.equal((res as any).code, code) }
  assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision:"revoke",reason:"ok",idempotencyKey:"abcdefgh"}, {...baseDeps,getAuthenticatedUserId:async()=>null})).ok, false)
  assert.equal((await applyTrustedVerificationDecisionWithDeps({subjectType:"creator",subjectId:"00000000-0000-4000-8000-000000000002",decision:"revoke",reason:"ok",idempotencyKey:"abcdefgh"}, {...baseDeps,getAdminClient:()=>({rpc:async()=>({data:{service_role:"x"},error:null}),from:()=>({})})}) as any).code, "VERIFICATION_SAVE_FAILED")
})

test("UI and loaders expose verification workflow without forbidden controls", () => {
  const page=fs.readFileSync("app/creator/publishing-queue/review/verifications/page.tsx","utf8"); const form=fs.readFileSync("app/creator/publishing-queue/review/verifications/VerificationDecisionForm.tsx","utf8"); const actions=fs.readFileSync("app/creator/publishing-queue/review/verifications/actions.ts","utf8"); const loaders=fs.readFileSync("lib/creator-publishing-queue/verification/loaders.ts","utf8"); const accounts=fs.readFileSync("app/creator/publishing-queue/accounts/page.tsx","utf8"); const detail=fs.readFileSync("app/creator/publishing-queue/[contentPackageId]/page.tsx","utf8"); const uiLoaders=fs.readFileSync("lib/creator-publishing-queue/ui/loaders.ts","utf8")
  assert.match(loaders, /supabase\.auth\.getUser/); assert.match(loaders, /creator_publishing_trusted_reviewers/); assert.match(loaders, /TRUSTED_VERIFICATION_DISCOVERY_PAGE_SIZE/); assert.match(loaders, /TRUSTED_VERIFICATION_DISCOVERY_MAX_PAGES/); assert.match(loaders, /TRUSTED_VERIFICATION_CREATOR_LIMIT/); assert.match(loaders, /TRUSTED_VERIFICATION_ACCOUNT_SUBJECT_LIMIT/); assert.match(loaders, /loadSupportedPackageCreatorRows/); assert.match(loaders, /loadSupportedAccountCreatorRows/); assert.match(loaders, /\.range\(/); assert.match(loaders, /buildTrustedVerificationCreatorIds/); assert.match(loaders, /accountSubjectDisplayQuery/); assert.match(loaders, /limit\(TRUSTED_VERIFICATION_ACCOUNT_SUBJECT_LIMIT\)/); assert.match(loaders, /Verification subject discovery exceeded its safe pagination boundary/); assert.doesNotMatch(loaders+page, /auto.?enroll|owner bypass/i)
  assert.match(page, /Creator identity/); assert.match(loaders, /\.in\("target_platform", \["onlyfans", "fansly"\]\)/); assert.match(loaders, /\.in\("platform", \["onlyfans", "fansly"\]\)/); assert.match(loaders, /order\("creator_id", \{ ascending: true \}\)\.order\("id", \{ ascending: true \}\)/); assert.doesNotMatch(loaders, /neq\("target_platform", "fanvue"\)/); assert.doesNotMatch(loaders, /auth\.users/); assert.doesNotMatch(loaders, /\.limit\(100\)/); assert.doesNotMatch(loaders, /updated_at", \{ ascending: false \}/); assert.doesNotMatch(loaders, /accountsRes\.data[\s\S]*buildTrustedVerificationCreatorIds/); assert.match(page+loaders, /Fanvue is excluded|\.in\("target_platform", \["onlyfans", "fansly"\]\)/)
  assert.match(form, /value="verify"/); assert.match(form, /value="revoke"/); assert.match(form, /value="mark_unverified"/); assert.match(form, /name="reason"[\s\S]*required/); assert.match(form, /Evidence reference \(required for verify\)/); assert.match(page, /import \{ randomUUID \} from "node:crypto"/); assert.match(page, /idempotencyKey=\{randomUUID\(\)\}/); assert.match(form, /idempotencyKey: string/); assert.match(form, /name="idempotencyKey"/); assert.match(actions, /formData.get\("idempotencyKey"\)/); assert.doesNotMatch(actions, /randomUUID\(\)/); assert.doesNotMatch(form, /randomUUID|crypto\./); assert.match(form, /Self-review is disabled/)
  assert.match(accounts, /Unattested/); assert.match(accounts, /Creator attested/); assert.match(accounts, /Trusted verification recorded/); assert.match(accounts, /Revoked/); assert.match(fs.readFileSync("app/creator/publishing-queue/accounts/PlatformAccountForm.tsx","utf8"), /defaultChecked=\{Boolean\(account\?\.verificationAttestedAt\)\}/); assert.doesNotMatch(fs.readFileSync("app/creator/publishing-queue/accounts/PlatformAccountForm.tsx","utf8"), /defaultChecked=\{account\?\.verificationStatus === "creator_attested"\}/); assert.match(accounts, /Editing this account reference will require verification review again/)
  assert.match(detail, /Creator verification status/); assert.match(detail, /Selected platform-account verification status/); assert.doesNotMatch(detail+page+form, /Submit for compliance|type="file"|capture=|name="password"|name="token"|name="cookie"|name="api.?key"|Connect account|Login|Test connection/i)
  assert.match(uiLoaders, /\["creator_attested","verified"\]/); assert.doesNotMatch(fs.readFileSync("app/creator/publishing-queue/accounts/PlatformAccountForm.tsx","utf8"), /value="verified"|name="verificationStatus"|targetStatus|verification_legacy_revoked/)
})

console.log("Trusted verification source, validation, service, and UI checks passed")
