import type { CreatorPublishingPolicyPlatform, PlatformPolicy } from "../policies/schema"

export type ComplianceOutcome = "passed" | "manual_review" | "blocked"
export type ComplianceSeverity = "allow" | "review" | "block"
export type AiFlag = "none" | "ai_enhanced" | "ai_generated"
export type MediaProvenanceSource = "camera_upload" | "ai_pipeline" | "edited"

export type ComplianceAiDetail = Readonly<Partial<Record<
  | "lora_generated" | "ai_twin" | "generated_creator_likeness" | "photorealistic" | "lifelike" | "deepfake" | "face_swap" | "unauthorized_face_swap"
  | "third_party_likeness" | "ai_background_edit" | "ai_outfit_edit" | "ai_lighting_edit" | "body_adjacent_edit"
  | "upscaled" | "non_photorealistic" | "creator_likeness_drift" | "heavy_alteration" | "synthetic_persona"
  | "fictional_persona" | "composite_persona" | "ai_contribution_more_than_cosmetic" | "borderline_lifelike_stylized"
  | "ambiguous_background_people", boolean>>>

export type ComplianceCategoryFlags = Readonly<Partial<Record<
  | "youth_coded" | "underage_implication" | "incest_family_roleplay" | "non_consent" | "lack_of_capacity"
  | "prohibited_public_nudity" | "prohibited_drugs" | "harmful_illegal_activity" | "borderline_consent"
  | "degradation" | "cnc" | "breeding" | "daddy" | "choking" | "weapons" | "blood", boolean>>>

export type ComplianceInput = Readonly<{
  content_package_id: string
  creator_id: string
  target_platform: CreatorPublishingPolicyPlatform
  policy_version?: string
  policy?: PlatformPolicy
  caption_body: string
  title: string
  ai_flag: AiFlag
  ai_detail?: ComplianceAiDetail
  media_provenance: readonly MediaProvenanceSource[]
  creator_verification_status: "verified" | "unverified" | "revoked" | "unattested" | "creator_attested"
  ai_twin_consent_status?: "granted" | "missing" | "not_applicable"
  second_person_present: boolean
  co_performer_release_status?: "confirmed" | "missing" | "pending" | "not_applicable"
  co_performer_verification_status?: "verified" | "missing" | "pending" | "not_applicable"
  virtual_entity_registration_status?: "registered" | "not_registered" | "pending" | "not_applicable"
  platform_account_verification_status?: "verified" | "unverified" | "revoked" | "unattested" | "creator_attested"
  category_flags?: ComplianceCategoryFlags
  text_classifier_flags?: ComplianceCategoryFlags
  evaluated_at?: string
}>

export type ComplianceRuleHit = Readonly<{
  rule_id: string
  severity: ComplianceSeverity
  category: string
  message: string
  source: string
  field: string
  evidence: string
  override_allowed: boolean
}>

export type ComplianceEvaluation = Readonly<{
  outcome: ComplianceOutcome
  hard_block: boolean
  platform: CreatorPublishingPolicyPlatform
  policy_version: string
  rule_hits: readonly ComplianceRuleHit[]
  reasons: readonly string[]
  review_requirements: readonly string[]
  forced_disclosure_text: string | null
  normalized_caption: string
  creator_approval_allowed: boolean
  escalated_approval_allowed: boolean
  evaluated_at: string
  metadata: Readonly<{ evaluator: "creator_publishing_queue_compliance_v1"; policy_mode: string; queue_enabled: boolean }>
}>
