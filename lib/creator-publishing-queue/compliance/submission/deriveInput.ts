import { AI_TWIN_CONSENT_VERSION } from "../../consent/copy"
import { getAiTwinConsentTextSha256 } from "../../consent/hash"
import { getCreatorPublishingPlatformPolicy } from "../../policies"
import { requiresAiTwinConsent } from "../aiRules"
import type { ComplianceAiDetail, ComplianceInput } from "../types"
import { SAFE_CLASSIFICATION_KEYS } from "./facts"
import type { DerivedCompliance, TrustedComplianceFacts } from "./types"
function nonblank(v:string|null|undefined){ return typeof v==="string"&&v.trim().length>0 }
export function deriveTrustedComplianceInput(facts: TrustedComplianceFacts): DerivedCompliance {
  const lora = facts.generation_manifest.some(g=>nonblank(g.lora_used))
  const everyNonPhoto = facts.generation_manifest.length>0 && facts.generation_manifest.every(g=>g.safe_classification_metadata.non_photorealistic===true)
  const anyPhoto = facts.generation_manifest.some(g=>g.safe_classification_metadata.photorealistic===true || g.safe_classification_metadata.lifelike===true)
  const aiDetail: Record<string, boolean> = {}
  for (const key of SAFE_CLASSIFICATION_KEYS) aiDetail[key] = facts.generation_manifest.some(g=>g.safe_classification_metadata[key]===true)
  aiDetail.lora_generated = lora; aiDetail.ai_twin = lora; aiDetail.generated_creator_likeness = lora
  if (lora) { aiDetail.photorealistic = true; aiDetail.lifelike = true; aiDetail.non_photorealistic = false }
  else if (everyNonPhoto && !anyPhoto) { aiDetail.non_photorealistic = true; aiDetail.photorealistic = false; aiDetail.lifelike = false }
  else { aiDetail.photorealistic = true; aiDetail.lifelike = true; aiDetail.non_photorealistic = false }
  const base: ComplianceInput = { content_package_id:facts.package.id, creator_id:facts.package.creator_id, target_platform:facts.package.target_platform, policy:getCreatorPublishingPlatformPolicy(facts.package.target_platform), title:facts.package.title, caption_body:facts.package.caption_body, ai_flag:"ai_generated", ai_detail:aiDetail as ComplianceAiDetail, media_provenance:["ai_pipeline"], creator_verification_status:facts.creator_verification.status, platform_account_verification_status:facts.platform_account.verification_status, second_person_present:facts.package.second_person_present, co_performer_release_status:"not_applicable", co_performer_verification_status:"not_applicable", virtual_entity_registration_status:"not_applicable", ai_twin_consent_status:"not_applicable" }
  const consentRequired = facts.package.target_platform === "onlyfans" && requiresAiTwinConsent(base)
  const currentConsent = facts.ai_twin_consent.status === "granted" && facts.ai_twin_consent.attestation_version === AI_TWIN_CONSENT_VERSION && facts.ai_twin_consent.attestation_text_sha256 === getAiTwinConsentTextSha256() && facts.ai_twin_consent.revoked_at === null
  const second = facts.package.second_person_present ? { co_performer_release_status: facts.co_performer_summary.record_count > 0 && facts.co_performer_summary.all_platform_release_confirmed ? "confirmed" as const : "missing" as const, co_performer_verification_status:"missing" as const } : { co_performer_release_status:"not_applicable" as const, co_performer_verification_status:"not_applicable" as const }
  const virtual_entity_registration_status = facts.package.target_platform === "fansly" && aiDetail.non_photorealistic ? "not_registered" : "not_applicable"
  return { aiDetail: aiDetail as ComplianceAiDetail, input:{ ...base, ...second, virtual_entity_registration_status, ai_twin_consent_status: facts.package.target_platform === "fansly" ? "not_applicable" : consentRequired ? (currentConsent ? "granted" : "missing") : "not_applicable" } }
}
