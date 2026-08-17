import { AI_TWIN_CONSENT_VERSION } from "../consent/copy"
import { getAiTwinConsentTextSha256 } from "../consent/hash"
import { evaluateAiAndProvenanceRules, requiresAiTwinConsent } from "../compliance/aiRules"
import { evaluateTextRules } from "../compliance/textRules"
import type { ComplianceEvaluation, ComplianceInput, ComplianceRuleHit } from "../compliance/types"
import { deriveTrustedComplianceInput } from "../compliance/submission/deriveInput"
import type { TrustedComplianceFacts } from "../compliance/submission/types"
import { fanvuePolicy } from "../policies"

function currentConsent(facts:TrustedComplianceFacts){
  return facts.ai_twin_consent.status === "granted" &&
    facts.ai_twin_consent.attestation_version === AI_TWIN_CONSENT_VERSION &&
    facts.ai_twin_consent.attestation_text_sha256 === getAiTwinConsentTextSha256() &&
    facts.ai_twin_consent.revoked_at === null
}
function hit(rule_id:string,severity:"allow"|"review"|"block",category:string,message:string,field:string):ComplianceRuleHit{
  return {rule_id,severity,category,message,source:`fanvue:${fanvuePolicy.policy_version}`,field,evidence:field,override_allowed:severity==="review"}
}
function outcome(hits:readonly ComplianceRuleHit[]){ if(hits.some(h=>h.severity==="block"))return "blocked" as const;if(hits.some(h=>h.severity==="review"))return "manual_review" as const;return "passed" as const }

export function deriveFanvueDirectComplianceInput(facts:TrustedComplianceFacts,oauthDestinationVerified:boolean):ComplianceInput{
  const generated=facts.generation_manifest.length>0
  if(!generated){
    return {
      content_package_id:facts.package.id,
      creator_id:facts.package.creator_id,
      target_platform:"fanvue",
      policy:fanvuePolicy,
      title:facts.package.title,
      caption_body:facts.package.caption_body,
      ai_flag:"none",
      ai_detail:{},
      media_provenance:[],
      creator_verification_status:facts.creator_verification.status,
      platform_account_verification_status:oauthDestinationVerified?"verified":"unverified",
      ai_twin_consent_status:"not_applicable",
      second_person_present:facts.package.second_person_present,
      co_performer_release_status:facts.package.second_person_present?(facts.co_performer_summary.record_count>0&&facts.co_performer_summary.all_platform_release_confirmed?"confirmed":"missing"):"not_applicable",
      co_performer_verification_status:facts.package.second_person_present?"missing":"not_applicable",
      virtual_entity_registration_status:"not_applicable",
    }
  }
  const derived=deriveTrustedComplianceInput(facts)
  const requiresConsent=requiresAiTwinConsent(derived.input)
  return {
    ...derived.input,
    target_platform:"fanvue",
    policy:fanvuePolicy,
    platform_account_verification_status:oauthDestinationVerified?"verified":"unverified",
    ai_twin_consent_status:requiresConsent?(currentConsent(facts)?"granted":"missing"):"not_applicable",
  }
}

export function evaluateFanvueDirectCompliance(input:ComplianceInput):ComplianceEvaluation{
  if(input.target_platform!=="fanvue")throw new Error("Fanvue direct compliance requires a Fanvue package.")
  const hits=[...evaluateAiAndProvenanceRules({...input,policy:fanvuePolicy}),...evaluateTextRules(input)]
  if(requiresAiTwinConsent(input)&&input.ai_twin_consent_status!=="granted")hits.push(hit("fanvue-ai-twin-consent-missing","block","missing AI twin consent","Generated creator likeness requires current AI twin consent before Fanvue direct publishing.","ai_twin_consent_status"))
  hits.sort((a,b)=>a.rule_id.localeCompare(b.rule_id))
  const resolved=outcome(hits)
  return Object.freeze({
    outcome:resolved,
    hard_block:resolved==="blocked",
    platform:"fanvue",
    policy_version:fanvuePolicy.policy_version,
    rule_hits:Object.freeze(hits),
    reasons:Object.freeze(hits.filter(h=>h.severity!=="allow").map(h=>h.message)),
    review_requirements:Object.freeze(hits.filter(h=>h.severity==="review").map(h=>h.message)),
    forced_disclosure_text:null,
    normalized_caption:input.caption_body,
    creator_approval_allowed:resolved==="passed",
    escalated_approval_allowed:false,
    evaluated_at:input.evaluated_at??"1970-01-01T00:00:00.000Z",
    metadata:Object.freeze({evaluator:"creator_publishing_queue_compliance_v1" as const,policy_mode:"direct_api",queue_enabled:false}),
  })
}
