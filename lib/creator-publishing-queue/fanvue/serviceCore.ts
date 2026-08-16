import { AI_TWIN_CONSENT_VERSION } from "../consent/copy"
import { getAiTwinConsentTextSha256 } from "../consent/hash"
import { isEligibleGeneratedMediaRecord, type GeneratedMediaLike } from "../media/generatedMediaEligibility"
const nonblank=(v:unknown)=>typeof v==="string"&&v.trim().length>0
export function validateFanvueExecutionFacts(f:any){
 if(!f.job||!f.destination||!f.oauth||!f.contentPackage)return"FANVUE_CPQ_REQUIREMENTS_INVALID"
 if(f.destination.id!==f.job.platform_account_id||f.destination.creator_id!==f.job.creator_id||f.destination.platform!=="fanvue"||f.destination.oauth_account_id!==f.job.oauth_account_id)return"FANVUE_CPQ_DESTINATION_INVALID"
 if(f.oauth.id!==f.job.oauth_account_id||f.oauth.user_id!==f.job.creator_id||f.oauth.platform!=="fanvue"||!nonblank(f.oauth.provider_account_id))return"FANVUE_CPQ_OAUTH_INVALID"
 if(f.oauth.connection_status!=="CONNECTED")return"FANVUE_CPQ_OAUTH_DISCONNECTED"
 const p=f.contentPackage;if(p.creator_id!==f.job.creator_id||p.platform_account_id!==f.destination.id||p.target_platform!=="fanvue"||p.creator_approval_status!=="approved"||!p.creator_approved_at)return"FANVUE_CPQ_PACKAGE_NOT_APPROVED"
 if(!["passed","escalated_approved"].includes(p.compliance_status)||!f.complianceEvidence||f.laterBlockingReview)return"FANVUE_CPQ_COMPLIANCE_INVALID"
 if(f.verification?.status!=="verified")return"FANVUE_CPQ_CREATOR_NOT_VERIFIED"
 if(f.consent?.status!=="granted"||f.consent.revoked_at!==null||f.consent.attestation_version!==AI_TWIN_CONSENT_VERSION||f.consent.attestation_text_sha256!==getAiTwinConsentTextSha256())return"FANVUE_CPQ_CONSENT_INVALID"
 if(p.second_person_present&&(!f.performers?.length||f.performers.some((x:any)=>x.platform_release_confirmed!==true||!nonblank(x.release_document_reference))))return"FANVUE_CPQ_RELEASE_INVALID"
 if(f.sourceCurrent!==true)return"FANVUE_CPQ_SOURCE_STALE"
 return null
}
export {nonblank}
export function isFanvueGenerationEligible(row:GeneratedMediaLike&{user_id?:unknown},authUserId:string,profileId:string|null){return typeof row.user_id==="string"&&[authUserId,profileId].includes(row.user_id)&&isEligibleGeneratedMediaRecord(row)}
