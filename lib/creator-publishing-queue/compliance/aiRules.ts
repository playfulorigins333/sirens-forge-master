import type { ComplianceInput, ComplianceRuleHit } from "./types"

function hit(rule_id: string, severity: "allow" | "review" | "block", category: string, message: string, field: string, source: string): ComplianceRuleHit {
  return { rule_id, severity, category, message, source, field, evidence: field, override_allowed: severity === "review" }
}
const verified = (s?: string) => s === "verified" || s === "creator_attested"
const hasAi = (i: ComplianceInput) => i.ai_flag !== "none" || i.media_provenance.includes("ai_pipeline") || Object.values(i.ai_detail ?? {}).some(Boolean)

export function evaluateAiAndProvenanceRules(input: ComplianceInput): readonly ComplianceRuleHit[] {
  const d = input.ai_detail ?? {}
  const hits: ComplianceRuleHit[] = []
  const policySource = `${input.target_platform}:${input.policy?.policy_version ?? input.policy_version ?? "selected"}`
  if (!verified(input.creator_verification_status) || !verified(input.platform_account_verification_status ?? input.creator_verification_status)) hits.push(hit("verification-missing-creator", "block", "missing verification", "Creator/platform account verification is missing.", "creator_verification_status", policySource))
  if (input.second_person_present) {
    const ok = input.co_performer_release_status === "confirmed" && input.co_performer_verification_status === "verified"
    hits.push(hit(ok ? "co-performer-review" : "co-performer-missing", ok ? "review" : "block", "second person", ok ? "Second-person content requires manual review even with claimed release." : "Second person is present without required release/verification.", "second_person_present", policySource))
  }
  if (input.target_platform === "onlyfans") {
    if (hasAi(input) && input.ai_twin_consent_status !== "granted" && input.ai_twin_consent_status !== "not_applicable") hits.push(hit("onlyfans-ai-twin-consent-missing", "block", "missing AI twin consent", "AI content requires AI twin consent where applicable.", "ai_twin_consent_status", policySource))
    if (d.synthetic_persona || d.fictional_persona) hits.push(hit("onlyfans-fictional-persona", "block", "third-party deepfake", "Fictional explicit AI persona cannot match the verified creator.", "ai_detail.synthetic_persona", policySource))
    if (d.composite_persona) hits.push(hit("onlyfans-composite-persona", "block", "composite AI persona", "Composite AI persona is hard-blocked.", "ai_detail.composite_persona", policySource))
    if (d.deepfake || d.third_party_likeness) hits.push(hit("onlyfans-third-party-deepfake", "block", "third-party deepfake", "Third-party deepfake or likeness use is hard-blocked.", "ai_detail.deepfake", policySource))
    if (d.face_swap && (d.unauthorized_face_swap || d.third_party_likeness)) hits.push(hit("onlyfans-unauthorized-face-swap", "block", "unauthorized face swap", "Unauthorized or third-party face swap is hard-blocked.", "ai_detail.face_swap", policySource))
    else if (d.face_swap) hits.push(hit("onlyfans-face-swap-review", "review", "AI alteration", "Creator-only face swap requires manual review.", "ai_detail.face_swap", policySource))
    if (d.creator_likeness_drift || d.heavy_alteration) hits.push(hit("onlyfans-likeness-drift", "review", "likeness drift", "Creator likeness drift/heavy alteration requires manual review.", "ai_detail.creator_likeness_drift", policySource))
    if (d.ai_outfit_edit || d.body_adjacent_edit) hits.push(hit("onlyfans-body-adjacent-edit", "review", "AI outfit/body-adjacent edits", "AI outfit or body-adjacent edits require manual review.", "ai_detail.ai_outfit_edit", policySource))
    if (d.ambiguous_background_people) hits.push(hit("onlyfans-ambiguous-background-people", "review", "ambiguous background people", "Ambiguous background people require manual review.", "ai_detail.ambiguous_background_people", policySource))
  }
  if (input.target_platform === "fansly") {
    if (d.photorealistic || d.lora_generated || d.lifelike || d.deepfake || d.face_swap || d.synthetic_persona || d.fictional_persona) hits.push(hit("fansly-photorealistic-ai-hard-block", "block", "photorealistic AI", "Fansly photorealistic/lifelike AI, LoRA output, deepfakes, face swaps, and fictional photorealistic personas are hard-blocked; disclosure does not cure this.", "ai_detail", policySource))
    if (input.caption_body.match(/#ai|#aigenerated/i) && (d.photorealistic || d.lora_generated || d.lifelike)) hits.push(hit("fansly-disclosure-workaround-block", "block", "disclosure workaround", "Disclosure cannot be used as a workaround for prohibited Fansly AI.", "caption_body", policySource))
    if (d.non_photorealistic && input.virtual_entity_registration_status !== "registered") hits.push(hit("fansly-non-photorealistic-registration", "block", "virtual entity registration", "Non-photorealistic content without virtual-entity registration is blocked by the safer policy interpretation.", "virtual_entity_registration_status", policySource))
    if (d.ai_background_edit || d.ai_outfit_edit || d.ai_lighting_edit || d.body_adjacent_edit || d.ai_contribution_more_than_cosmetic || d.borderline_lifelike_stylized) hits.push(hit("fansly-ai-edit-review", "review", "AI edit", "AI edits or borderline lifelike stylized content require manual review.", "ai_detail", policySource))
    if (input.second_person_present && input.co_performer_verification_status !== "verified") hits.push(hit("fansly-co-performer-verification-missing", "block", "missing co-performer verification", "Fansly co-performer verification is required.", "co_performer_verification_status", policySource))
  }
  return hits
}

export function isAiFlagged(input: ComplianceInput) { return hasAi(input) }
