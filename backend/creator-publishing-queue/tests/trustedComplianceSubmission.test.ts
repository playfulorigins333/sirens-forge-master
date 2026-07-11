import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { deriveTrustedComplianceInput } from "../../../lib/creator-publishing-queue/compliance/submission/deriveInput"
import { normalizeComplianceSubmissionFormInput, submitTrustedComplianceWithDeps } from "../../../lib/creator-publishing-queue/compliance/submission/serviceCore"
import { parseApplyRpcResponse, parseTrustedFactsRpcResponse } from "../../../lib/creator-publishing-queue/compliance/submission/facts"
import { AI_TWIN_CONSENT_VERSION } from "../../../lib/creator-publishing-queue/consent/copy"
import { getAiTwinConsentTextSha256 } from "../../../lib/creator-publishing-queue/consent/hash"
const migration = readFileSync("supabase/migrations/20260710001100_creator_publishing_trusted_compliance_submission.sql","utf8")
const page = readFileSync("app/creator/publishing-queue/[contentPackageId]/page.tsx","utf8")
const panel = readFileSync("app/creator/publishing-queue/[contentPackageId]/ComplianceEvaluationPanel.tsx","utf8")
const actions = readFileSync("app/creator/publishing-queue/[contentPackageId]/compliance-actions.ts","utf8")
const uuid="11111111-1111-4111-8111-111111111111", pkg="22222222-2222-4222-8222-222222222222", acct="33333333-3333-4333-8333-333333333333", media="44444444-4444-4444-8444-444444444444", gen="55555555-5555-4555-8555-555555555555", hash="a".repeat(64)
function facts(over:any={}){ return { facts:{ schema_version:"creator-publishing-compliance-facts-v1", package:{ id:pkg, creator_id:uuid, platform_account_id:acct, target_platform:"onlyfans", title:"t", caption_body:"c", second_person_present:false, creator_approval_status:"pending", compliance_status:"pending", compliance_policy_version:"unassigned", updated_at:"2026-01-01T00:00:00.123456Z", ...(over.package||{}) }, platform_account:{ id:acct, creator_id:uuid, platform:"onlyfans", verification_status:"verified", updated_at:"2026-01-01T00:00:00Z", is_virtual_entity:false, ...(over.platform_account||{}) }, creator_verification:{ status:"verified", updated_at:null, ...(over.creator_verification||{}) }, ai_twin_consent:{ status:"granted", attestation_version:AI_TWIN_CONSENT_VERSION, attestation_text_sha256:getAiTwinConsentTextSha256(), granted_at:"2026-01-01T00:00:00Z", revoked_at:null, updated_at:"2026-01-01T00:00:00Z", ...(over.ai_twin_consent||{}) }, media_manifest:[{ id:media, storage_key:"k", mime_type:"image/png", sha256:hash, source:"ai_pipeline", ai_generation_metadata:{ generation_id:gen } }], generation_manifest:[{ generation_id:gen, user_id:uuid, status:"completed", lora_used:null, job_type:null, body_type:null, mode:null, r2_bucket:"b", r2_key:"k", safe_classification_metadata:{ non_photorealistic:true }, ...(over.generation||{}) }], co_performer_summary:{ record_count:0, all_platform_release_confirmed:false, ...(over.co_performer_summary||{}) }, active_queue_task:false, human_review_lock:{ locked:false, reason:null, latest_review_id:null, latest_review_outcome:null, latest_review_created_at:null, content_fingerprint:hash }, ...(over.facts||{}) }, facts_fingerprint:hash, media_manifest_hash:hash } }
assert.equal(readdirSync("supabase/migrations").filter(f=>f.includes("trusted_compliance_submission")).length,1)
assert.match(migration,/creator_publishing_build_compliance_facts\(p_creator_id uuid, p_content_package_id uuid\)/)
assert.match(migration,/creator_publishing_load_compliance_facts\(p_creator_id uuid, p_content_package_id uuid\)/)
assert.match(migration,/creator_publishing_apply_automated_compliance_evaluation\(p_creator_id uuid,p_content_package_id uuid,p_expected_package_updated_at timestamptz/)
assert.match(migration,/security definer/g); assert.match(migration,/set search_path = public, pg_temp/g)
assert.match(migration,/revoke .*creator_publishing_build_compliance_facts[\s\S]*from PUBLIC/i); assert.match(migration,/from anon/i); assert.match(migration,/from authenticated/i); assert.match(migration,/grant execute[\s\S]*creator_publishing_load_compliance_facts[\s\S]*to service_role/i); assert.match(migration,/grant execute[\s\S]*creator_publishing_apply_automated_compliance_evaluation[\s\S]*to service_role/i)
assert.match(migration,/creator_publishing_compliance_evaluated_actor_key_uidx/); assert.match(migration,/hashtextextended/); assert.doesNotMatch(migration,/hashtext\(/); assert.doesNotMatch(migration,/insert into public\.creator_publishing_queue_tasks/i); assert.doesNotMatch(migration,/platform api|fetch\(|http/i)
for (const code of ["COMPLIANCE_PACKAGE_NOT_FOUND","COMPLIANCE_FANVUE_NOT_SUPPORTED","COMPLIANCE_PLATFORM_ACCOUNT_INVALID","COMPLIANCE_MEDIA_REQUIRED","COMPLIANCE_UNTRUSTED_MEDIA_SOURCE","COMPLIANCE_GENERATION_LINK_INVALID","COMPLIANCE_GENERATION_NOT_FOUND","COMPLIANCE_GENERATION_NOT_OWNED","COMPLIANCE_GENERATION_NOT_ELIGIBLE","COMPLIANCE_PACKAGE_LOCKED","COMPLIANCE_STALE","COMPLIANCE_INVALID_EVALUATION","COMPLIANCE_IDEMPOTENCY_CONFLICT"]) assert.match(migration,new RegExp(code))
const parsed=parseTrustedFactsRpcResponse(facts(), uuid); assert.equal(parsed.facts.package.id,pkg); assert.equal(parsed.facts.media_manifest[0].source,"ai_pipeline")
for (const bad of [facts({package:{creator_id:"99999999-9999-4999-8999-999999999999"}}), facts({package:{target_platform:"fanvue"}}), facts({platform_account:{creator_id:"99999999-9999-4999-8999-999999999999"}}), facts({facts:{active_queue_task:true}}), facts({package:{creator_approval_status:"approved"}})]) assert.throws(()=>parseTrustedFactsRpcResponse(bad, uuid))
let d=deriveTrustedComplianceInput(parsed.facts); assert.equal(d.aiDetail.non_photorealistic,true); assert.equal(d.aiDetail.photorealistic,false); assert.equal(d.input.ai_twin_consent_status,"not_applicable")
d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts({generation:{lora_used:"lora-x", safe_classification_metadata:{identity_lora:true}}}),uuid).facts); assert.equal(d.aiDetail.lora_generated,true); assert.equal(d.aiDetail.ai_twin,true); assert.equal(d.aiDetail.generated_creator_likeness,true); assert.equal(d.aiDetail.photorealistic,true); assert.equal(d.aiDetail.lifelike,true); assert.equal(d.input.ai_twin_consent_status,"granted")
d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts({ai_twin_consent:{revoked_at:"2026-01-01T00:00:01Z"}, generation:{lora_used:"x"}}),uuid).facts); assert.equal(d.input.ai_twin_consent_status,"missing")
d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts({package:{target_platform:"fansly"}, platform_account:{platform:"fansly"}}),uuid).facts); assert.equal(d.input.ai_twin_consent_status,"not_applicable"); assert.equal(d.input.virtual_entity_registration_status,"not_registered")
assert.equal(normalizeComplianceSubmissionFormInput([["contentPackageId",pkg],["expectedPackageUpdatedAt","2026-01-01T00:00:00.123456Z"],["expectedMediaManifestHash",hash],["idempotencyKey","abcdefgh"]]).ok,true)
for (const entry of [["creator_id",uuid],["policy_version","x"],["outcome","passed"],["ai_detail","{}"],["consentStatus","granted"],["verificationStatus","verified"],["contentPackageId","bad"]]) assert.equal(normalizeComplianceSubmissionFormInput([["contentPackageId",pkg],["expectedPackageUpdatedAt","2026-01-01T00:00:00Z"],["expectedMediaManifestHash",hash],["idempotencyKey","abcdefgh"], entry as any]).ok,false)
assert.equal(normalizeComplianceSubmissionFormInput([["$ACTION_ID","x"],["contentPackageId",pkg],["expectedPackageUpdatedAt","2026-01-01T00:00:00Z"],["expectedMediaManifestHash",hash],["idempotencyKey","abcdefgh"]]).ok,true)
assert.equal(normalizeComplianceSubmissionFormInput([["contentPackageId",pkg],["expectedPackageUpdatedAt","2026-01-01"],["expectedMediaManifestHash",hash],["idempotencyKey","abcdefgh"]]).ok,false); assert.equal(normalizeComplianceSubmissionFormInput([["contentPackageId",pkg],["expectedPackageUpdatedAt","2026-02-31T00:00:00Z"],["expectedMediaManifestHash",hash],["idempotencyKey","abcdefgh"]]).ok,false)
assert.equal(parseApplyRpcResponse({content_package_id:pkg,creator_id:uuid,prior_compliance_status:"pending",resulting_compliance_status:"passed",policy_version:"v",review_record_id:media,audit_event_ids:["123"],idempotent:false,outcome:"evaluated",evaluated_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"},uuid,pkg).audit_event_ids[0],"123")
assert.throws(()=>parseApplyRpcResponse({content_package_id:pkg,creator_id:uuid,resulting_compliance_status:"weird",policy_version:"v",review_record_id:media,audit_event_ids:[],idempotent:false,outcome:"evaluated",evaluated_at:"x",updated_at:"x"},uuid,pkg))
assert.equal((await submitTrustedComplianceWithDeps({contentPackageId:pkg,expectedPackageUpdatedAt:"2026-01-01T00:00:00Z",expectedMediaManifestHash:hash,idempotencyKey:"abcdefgh"},{getAuthenticatedUserId:async()=>null,getAdminClient:null as any})).code,"UNAUTHENTICATED")
assert.equal((await submitTrustedComplianceWithDeps({contentPackageId:pkg,expectedPackageUpdatedAt:"2026-01-01T00:00:00Z",expectedMediaManifestHash:hash,idempotencyKey:"abcdefgh"},{getAuthenticatedUserId:async()=>uuid,getAdminClient:()=>({rpc:async()=>({data:null,error:new Error("COMPLIANCE_STALE")})}) as any})).code,"COMPLIANCE_STALE")
for (const text of ["ComplianceEvaluationPanel","Run compliance review","Re-run compliance review","router.refresh()","no platform login occurs","no credentials are accessed","LoRA trainer uploads are unchanged","only Sirens Forge-generated media is evaluated","mediaManifestHash","pkg.updated_at","pkg.compliance_status","pkg.compliance_policy_version"]) assert.match(page+panel,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")))
assert.doesNotMatch(panel+actions,/randomUUID\(|type="file"|password|api key/i)
assert.match(actions,/normalizeComplianceSubmissionFormInput\(formData\.entries\(\)\)/)
console.log("trusted compliance submission tests passed")
import { hashComplianceSubmissionBrowserMediaManifest } from "../../../lib/creator-publishing-queue/compliance/submission/mediaManifest"
import { normalizeOnlyFansDisclosure } from "../../../lib/creator-publishing-queue/compliance/evaluate"

const gen2="66666666-6666-4666-8666-666666666666", media2="77777777-7777-4777-8777-777777777777", hashB="b".repeat(64)
const multiFacts = facts({ facts:{ media_manifest:[{ id:media2, storage_key:"z", mime_type:"video/mp4", sha256:hashB.toUpperCase(), source:"ai_pipeline", ai_generation_metadata:{ generation_id:gen2, ignored:"x" } },{ id:media, storage_key:"a", mime_type:"image/png", sha256:hash, source:"ai_pipeline", ai_generation_metadata:{ generation_id:gen } }], generation_manifest:[{ generation_id:gen2, user_id:uuid, status:"completed", lora_used:null, job_type:null, body_type:null, mode:null, r2_bucket:"b", r2_key:"z", safe_classification_metadata:{ photorealistic:"true", deepfake:true, unknown_flag:true } },{ generation_id:gen, user_id:uuid, status:"completed", lora_used:null, job_type:null, body_type:null, mode:null, r2_bucket:"b", r2_key:"a", safe_classification_metadata:{ non_photorealistic:true } }] } })
const parsedMulti = parseTrustedFactsRpcResponse(multiFacts, uuid)
const browserHash = hashComplianceSubmissionBrowserMediaManifest([{ id:media, storage_key:"a", mime_type:"image/png", sha256:hash, source:"ai_pipeline", ai_generation_metadata:{ generation_id:gen } },{ id:media2, storage_key:"z", mime_type:"video/mp4", sha256:hashB, source:"ai_pipeline", ai_generation_metadata:{ generation_id:gen2 } }])
assert.equal(hashComplianceSubmissionBrowserMediaManifest(parsedMulti.facts.media_manifest), browserHash)
assert.notEqual(browserHash, parsedMulti.media_manifest_hash, "browser/media UI hash and trusted SQL media hash stay independent")
assert.equal(hashComplianceSubmissionBrowserMediaManifest([...parsedMulti.facts.media_manifest].reverse()), browserHash, "ordering is deterministic")
for (const changed of ["id","storage_key","mime_type","sha256","source","generation_id"] as const) { const copy:any = structuredClone(parsedMulti.facts.media_manifest); if (changed === "generation_id") copy[0].ai_generation_metadata.generation_id = gen; else copy[0][changed] = changed === "sha256" ? "c".repeat(64) : "changed"; assert.notEqual(hashComplianceSubmissionBrowserMediaManifest(copy), browserHash, `${changed} changes hash`) }
assert.equal((await submitTrustedComplianceWithDeps({contentPackageId:pkg,expectedPackageUpdatedAt:"2026-01-01T00:00:00Z",expectedMediaManifestHash:"c".repeat(64),idempotencyKey:"abcdefgh"},{getAuthenticatedUserId:async()=>uuid,getAdminClient:()=>({rpc:async()=>({data:multiFacts,error:null})}) as any})).code,"COMPLIANCE_STALE")

for (const bad of [facts({facts:{media_manifest:[{ id:media, storage_key:"k", mime_type:"image/png", sha256:"bad", source:"ai_pipeline", ai_generation_metadata:{generation_id:gen}}]}}), facts({facts:{media_manifest:[{ id:media, storage_key:"k1", mime_type:"image/png", sha256:hash, source:"ai_pipeline", ai_generation_metadata:{generation_id:gen}},{ id:media, storage_key:"k2", mime_type:"image/png", sha256:hash, source:"ai_pipeline", ai_generation_metadata:{generation_id:gen2}}], generation_manifest:[{ generation_id:gen, user_id:uuid, status:"completed", lora_used:null, job_type:null, body_type:null, mode:null, r2_bucket:"b", r2_key:"k", safe_classification_metadata:{}},{ generation_id:gen2, user_id:uuid, status:"completed", lora_used:null, job_type:null, body_type:null, mode:null, r2_bucket:"b", r2_key:"k", safe_classification_metadata:{}}]}}), facts({facts:{generation_manifest:[]}}), facts({co_performer_summary:{record_count:-1}}), facts({co_performer_summary:{record_count:1.2}}), facts({package:{updated_at:"2026-02-31T00:00:00Z"}})]) assert.throws(()=>parseTrustedFactsRpcResponse(bad, uuid))
assert.equal(parsedMulti.facts.generation_manifest[0].safe_classification_metadata.photorealistic, undefined)
assert.equal(parsedMulti.facts.generation_manifest[0].safe_classification_metadata.deepfake, true)
assert.throws(()=>parseApplyRpcResponse({content_package_id:pkg,creator_id:uuid,prior_compliance_status:"pending",resulting_compliance_status:"passed",policy_version:"v",review_record_id:media,audit_event_ids:["123"],idempotent:true,outcome:"evaluated",evaluated_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"},uuid,pkg))
assert.throws(()=>parseApplyRpcResponse({content_package_id:pkg,creator_id:uuid,prior_compliance_status:"pending",resulting_compliance_status:"passed",policy_version:"",review_record_id:"bad",audit_event_ids:["01","2"],idempotent:false,outcome:"evaluated",evaluated_at:"2026-02-31T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"},uuid,pkg))
for (const token of ["#ai","#AI","#AIGenerated","#aigenerated"]) assert.equal(normalizeOnlyFansDisclosure(`${token} caption`, true).normalized_caption.match(/#ai|#AIGenerated/i)?.[0]?.toLowerCase().startsWith("#ai"), true)
assert.equal((normalizeOnlyFansDisclosure("caption #ai", true).normalized_caption.match(/#ai|#AIGenerated/ig) ?? []).length, 1)
assert.equal((normalizeOnlyFansDisclosure("#ai #AIGenerated caption", true).normalized_caption.match(/#ai|#AIGenerated/ig) ?? []).length, 1)
assert.match(migration,/p_forced_disclosure_text !~\*/)
assert.match(migration,/regexp_count\(p_normalized_caption/)
assert.match(migration,/COMPLIANCE_HUMAN_REVIEW_LOCKED/)
assert.match(migration,/review_source='human'[\s\S]*outcome in \('block','manual_review','escalate'\)/)
assert.match(migration,/g\.user_id is null/)
assert.match(migration,/jsonb_typeof\(g\.metadata->'placeholder'\)='boolean'/)
assert.match(migration,/jsonb_typeof\(h->'rule_id'\) IS DISTINCT FROM 'string'/)
assert.match(migration,/jsonb_array_elements\(p_reasons\)/)
assert.match(migration,/p_effective_ai_twin_consent_status/)
assert.match(migration,/effective_ai_twin_consent_status/)
assert.match(migration,/raw_ai_twin_consent_evidence/)
assert.match(migration,/trusted_ai_summary[\s\S]*raw_ai_twin_consent_evidence/)
assert.doesNotMatch(migration,/insert into public\.creator_publishing_queue_tasks/i)
assert.doesNotMatch(migration,/type="file"|upload-intent|signed-url/i)
console.log("trusted compliance submission expanded review-fix tests passed")

assert.match(page,/media_manifest_hash: view\.approvalMediaManifestHash/)
assert.match(page,/mediaManifestHash=\{view\.complianceSubmissionMediaManifestHash\}/)
assert.match(page,/view\.complianceSubmissionMediaManifestHash/)
assert.match(migration,/platform_account_id[\s\S]*visibility_notes[\s\S]*media_manifest/)
assert.match(migration,/creator_publishing_package_updated[\s\S]*changed_fields/)
assert.doesNotMatch(migration,/r\.created_at >= v_package\.updated_at/)
assert.match(migration,/p_forced_disclosure_text is null/)
assert.match(migration,/queue_enabled[\s\S]*boolean/)
console.log("trusted compliance submission final blocker tests passed")

const lockedFacts = facts({ facts:{ human_review_lock:{ locked:true, reason:"COMPLIANCE_HUMAN_REVIEW_LOCKED", latest_review_id:media, latest_review_outcome:"block", latest_review_created_at:"2026-01-01T00:00:00Z", content_fingerprint:hash } } })
assert.throws(()=>parseTrustedFactsRpcResponse(lockedFacts, uuid), /human review locked/)
for (const badLock of [
  { locked:true, reason:"WRONG", latest_review_id:media, latest_review_outcome:"block", latest_review_created_at:"2026-01-01T00:00:00Z", content_fingerprint:hash },
  { locked:true, reason:"COMPLIANCE_HUMAN_REVIEW_LOCKED", latest_review_id:null, latest_review_outcome:"block", latest_review_created_at:"2026-01-01T00:00:00Z", content_fingerprint:hash },
  { locked:true, reason:"COMPLIANCE_HUMAN_REVIEW_LOCKED", latest_review_id:media, latest_review_outcome:"pass", latest_review_created_at:"2026-01-01T00:00:00Z", content_fingerprint:hash },
  { locked:true, reason:"COMPLIANCE_HUMAN_REVIEW_LOCKED", latest_review_id:media, latest_review_outcome:"block", latest_review_created_at:null, content_fingerprint:hash },
  { locked:false, reason:null, latest_review_id:null, latest_review_outcome:null, latest_review_created_at:null, content_fingerprint:"bad" },
  { locked:false, reason:"COMPLIANCE_HUMAN_REVIEW_LOCKED", latest_review_id:null, latest_review_outcome:null, latest_review_created_at:null, content_fingerprint:hash },
]) assert.throws(()=>parseTrustedFactsRpcResponse(facts({ facts:{ human_review_lock:badLock } }), uuid), /human review lock|human review locked/)

d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts({ generation:{lora_used:"x"} }),uuid).facts); assert.equal(d.input.ai_twin_consent_status,"granted")
d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts({ ai_twin_consent:{attestation_version:"old"}, generation:{lora_used:"x"} }),uuid).facts); assert.equal(d.input.ai_twin_consent_status,"missing")
d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts({ ai_twin_consent:{attestation_text_sha256:"b".repeat(64)}, generation:{lora_used:"x"} }),uuid).facts); assert.equal(d.input.ai_twin_consent_status,"missing")
d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts({ ai_twin_consent:{revoked_at:"2026-01-01T00:00:01Z"}, generation:{lora_used:"x"} }),uuid).facts); assert.equal(d.input.ai_twin_consent_status,"missing")
d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts({ ai_twin_consent:{status:"revoked"}, generation:{lora_used:"x"} }),uuid).facts); assert.equal(d.input.ai_twin_consent_status,"missing")
d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts(),uuid).facts); assert.equal(d.input.ai_twin_consent_status,"not_applicable")
d=deriveTrustedComplianceInput(parseTrustedFactsRpcResponse(facts({package:{target_platform:"fansly"}, platform_account:{platform:"fansly"}, generation:{lora_used:"x"}}),uuid).facts); assert.equal(d.input.ai_twin_consent_status,"not_applicable")
assert.match(migration,new RegExp(AI_TWIN_CONSENT_VERSION))
assert.match(migration,new RegExp(getAiTwinConsentTextSha256()))
assert.match(migration,/attestation_version'='creator-ai-twin-consent-v1'/)
assert.match(migration,/attestation_text_sha256'='[0-9a-f]{64}'/)
assert.match(migration,/revoked_at' is null/)

assert.match(migration,/entity_type='creator_publishing_media_asset' and a\.action in \('generated_media_attached','creator_publishing_media_asset_registered'\)/)
assert.match(migration,/after_state->>'content_package_id'/)
assert.match(migration,/::uuid = v_package\.id/)
assert.match(migration,/public\.creator_publishing_media_assets m where m\.id=a\.entity_id and m\.content_package_id=v_package\.id/)
assert.doesNotMatch(migration,/a\.entity_type='creator_publishing_content_package' and a\.entity_id=v_package\.id and a\.created_at > r\.created_at and \(a\.action in \('generated_media_attached'/)
assert.match(migration,/creator_publishing_package_updated' and exists[\s\S]*changed_fields/)
assert.doesNotMatch(migration,/scheduled_for|schedule_timezone|platform_meta/)
const loaderSource = readFileSync("lib/creator-publishing-queue/ui/loaders.ts","utf8")
assert.match(loaderSource,/entity_type", "creator_publishing_media_asset"/)
assert.match(loaderSource,/after_state->>content_package_id/)
assert.match(loaderSource,/currentMediaIds\.has\(a\.entity_id\)/)
assert.match(loaderSource,/validPackageUuid\(a\.after_state\?\.content_package_id\)/)

for (const field of ["rule_id","severity","category","message","source","field","evidence","override_allowed"]) {
  assert.match(migration,new RegExp(`not \\(h \\? '${field}'\\)`), `${field} must be explicitly required`)
  assert.match(migration,new RegExp(`jsonb_typeof\\(h->'${field}'\\) IS DISTINCT FROM`), `${field} must fail closed on type`)
}
for (const field of ["evaluator","policy_mode","queue_enabled"]) assert.match(migration,new RegExp(`not \\(p_evaluator_metadata \\? '${field}'\\)`))
assert.match(migration,/p_evaluator_metadata->>'evaluator' IS DISTINCT FROM 'creator_publishing_queue_compliance_v1'/)
assert.match(migration,/p_evaluator_metadata->>'policy_mode' IS DISTINCT FROM 'manual_handoff'/)
assert.match(migration,/jsonb_typeof\(p_evaluator_metadata->'queue_enabled'\) IS DISTINCT FROM 'boolean'/)
console.log("trusted compliance submission final media/consent/sql fail-closed tests passed")
