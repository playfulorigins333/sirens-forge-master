import "server-only"
import { createHash } from "node:crypto"
import { evaluateFanvueDirectCompliance, deriveFanvueDirectComplianceInput } from "./directCompliance"
import type { TrustedComplianceFacts } from "../compliance/submission/types"

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH=/^[a-f0-9]{64}$/
function obj(v:unknown):Record<string,any>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("FANVUE_PREPARATION_FACTS_INVALID");return v as Record<string,any>}
function text(v:unknown){if(typeof v!=="string")throw new Error("FANVUE_PREPARATION_FACTS_INVALID");return v}
function uuid(v:unknown){const s=text(v);if(!UUID.test(s))throw new Error("FANVUE_PREPARATION_FACTS_INVALID");return s}
function timestamp(v:unknown){const s=text(v);if(!Number.isFinite(Date.parse(s)))throw new Error("FANVUE_PREPARATION_FACTS_INVALID");return s}
function subKey(prefix:string,creatorId:string,packageId:string,planKey:string){return `${prefix}_${createHash("sha256").update(`${creatorId}:${packageId}:${planKey}`).digest("hex").slice(0,48)}`}

function parseFacts(data:unknown,creatorId:string,packageId:string){
 const root=obj(data),facts=obj(root.facts),pkg=obj(facts.package),account=obj(facts.platform_account),verification=obj(facts.creator_verification),consent=obj(facts.ai_twin_consent),co=obj(facts.co_performer_summary),lock=obj(facts.human_review_lock)
 const factsFingerprint=text(root.facts_fingerprint),mediaHash=text(root.media_manifest_hash)
 if(!HASH.test(factsFingerprint)||!HASH.test(mediaHash)||facts.schema_version!=="creator-publishing-fanvue-direct-compliance-facts-v1")throw new Error("FANVUE_PREPARATION_FACTS_INVALID")
 if(uuid(pkg.id)!==packageId||uuid(pkg.creator_id)!==creatorId||pkg.target_platform!=="fanvue"||uuid(account.id)!==uuid(pkg.platform_account_id)||uuid(account.creator_id)!==creatorId||account.platform!=="fanvue"||facts.oauth_destination_verified!==true||facts.active_queue_task!==false||lock.locked!==false)throw new Error("FANVUE_PREPARATION_FACTS_INVALID")
 const media=Array.isArray(facts.media_manifest)?facts.media_manifest:[]; const generations=Array.isArray(facts.generation_manifest)?facts.generation_manifest:[]
 if(media.length>1||generations.length>1||media.length!==generations.length)throw new Error("FANVUE_PREPARATION_FACTS_INVALID")
 const normalized:any={
  schema_version:"creator-publishing-compliance-facts-v1",
  package:{id:packageId,creator_id:creatorId,platform_account_id:uuid(pkg.platform_account_id),target_platform:"fanvue",title:text(pkg.title),caption_body:text(pkg.caption_body),second_person_present:pkg.second_person_present===true,creator_approval_status:text(pkg.creator_approval_status),compliance_status:text(pkg.compliance_status),compliance_policy_version:pkg.compliance_policy_version===null?null:text(pkg.compliance_policy_version),updated_at:timestamp(pkg.updated_at)},
  platform_account:{id:uuid(account.id),creator_id:creatorId,platform:"fanvue",verification_status:text(account.verification_status),updated_at:null,is_virtual_entity:false},
  creator_verification:{status:text(verification.status),updated_at:verification.updated_at===null?null:timestamp(verification.updated_at)},
  ai_twin_consent:{status:text(consent.status),attestation_version:consent.attestation_version===null?null:text(consent.attestation_version),attestation_text_sha256:consent.attestation_text_sha256===null?null:text(consent.attestation_text_sha256),granted_at:consent.granted_at===null?null:timestamp(consent.granted_at),revoked_at:consent.revoked_at===null?null:timestamp(consent.revoked_at),updated_at:consent.updated_at===null?null:timestamp(consent.updated_at)},
  media_manifest:media,
  generation_manifest:generations,
  co_performer_summary:{record_count:Number.isSafeInteger(co.record_count)?co.record_count:0,all_platform_release_confirmed:co.all_platform_release_confirmed===true},
  active_queue_task:false,
  human_review_lock:{locked:false,reason:null,latest_review_id:null,latest_review_outcome:null,latest_review_created_at:null,content_fingerprint:text(lock.content_fingerprint)}
 }
 return{facts:normalized as unknown as TrustedComplianceFacts,factsFingerprint,mediaHash,packageUpdatedAt:normalized.package.updated_at}
}

export type FanvuePreparationResult={ok:true}|{ok:false;code:string}
export async function prepareFanvueDirectPackage(input:{client:any;creatorId:string;packageId:string;planIdempotencyKey:string}):Promise<FanvuePreparationResult>{
 const {client,creatorId,packageId,planIdempotencyKey}=input
 const state=await client.from("creator_publishing_content_packages").select("id,creator_id,target_platform,creator_approval_status,compliance_status,compliance_policy_version").eq("id",packageId).maybeSingle()
 if(state.error||!state.data||state.data.creator_id!==creatorId||state.data.target_platform!=="fanvue")return{ok:false,code:"CONTENT_PACKAGE_NOT_FOUND"}
 if(state.data.creator_approval_status==="approved"&&state.data.compliance_status==="passed"&&state.data.compliance_policy_version==="fanvue-reference-2026-07-10-v1")return{ok:true}
 if(state.data.creator_approval_status!=="pending")return{ok:false,code:"FANVUE_PREPARATION_REQUIRED"}
 const loaded=await client.rpc("creator_publishing_load_fanvue_direct_compliance_facts",{p_creator_id:creatorId,p_content_package_id:packageId})
 if(loaded.error)return{ok:false,code:String(loaded.error.message??loaded.error.code??"FANVUE_PREPARATION_FAILED")}
 let parsed;try{parsed=parseFacts(loaded.data,creatorId,packageId)}catch{return{ok:false,code:"FANVUE_PREPARATION_FACTS_INVALID"}}
 const evaluation=evaluateFanvueDirectCompliance(deriveFanvueDirectComplianceInput(parsed.facts,true))
 const complianceKey=subKey("fvcomp",creatorId,packageId,planIdempotencyKey)
 const applied=await client.rpc("creator_publishing_apply_fanvue_direct_compliance",{
  p_creator_id:creatorId,p_content_package_id:packageId,p_expected_package_updated_at:parsed.packageUpdatedAt,p_facts_fingerprint:parsed.factsFingerprint,p_media_manifest_hash:parsed.mediaHash,p_policy_version:evaluation.policy_version,p_outcome:evaluation.outcome,p_normalized_caption:evaluation.normalized_caption,p_ai_flag:evaluation.rule_hits.length===0&&parsed.facts.media_manifest.length===0?"none":"ai_generated",p_ai_detail:deriveFanvueDirectComplianceInput(parsed.facts,true).ai_detail??{},p_rule_hits:evaluation.rule_hits,p_reasons:evaluation.reasons,p_review_requirements:evaluation.review_requirements,p_evaluator_metadata:evaluation.metadata,p_effective_ai_twin_consent_status:deriveFanvueDirectComplianceInput(parsed.facts,true).ai_twin_consent_status??"not_applicable",p_idempotency_key:complianceKey
 })
 if(applied.error)return{ok:false,code:String(applied.error.message??applied.error.code??"FANVUE_PREPARATION_FAILED")}
 if(evaluation.outcome!=="passed")return{ok:false,code:evaluation.outcome==="blocked"?"FANVUE_COMPLIANCE_BLOCKED":"FANVUE_COMPLIANCE_REVIEW_REQUIRED"}
 const updated=await client.from("creator_publishing_content_packages").select("id,updated_at,compliance_policy_version,compliance_status,creator_approval_status").eq("id",packageId).maybeSingle()
 if(updated.error||!updated.data||updated.data.compliance_status!=="passed"||updated.data.creator_approval_status!=="pending")return{ok:false,code:"FANVUE_PREPARATION_STALE"}
 const approvalKey=subKey("fvappr",creatorId,packageId,planIdempotencyKey)
 const approved=await client.rpc("creator_publishing_approve_fanvue_direct_package",{p_creator_id:creatorId,p_content_package_id:packageId,p_expected_package_updated_at:updated.data.updated_at,p_expected_policy_version:updated.data.compliance_policy_version,p_idempotency_key:approvalKey})
 if(approved.error)return{ok:false,code:String(approved.error.message??approved.error.code??"FANVUE_PREPARATION_FAILED")}
 return{ok:true}
}
