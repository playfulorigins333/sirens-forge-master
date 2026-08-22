export type ValidationState =
  | "REGISTERED" | "EVIDENCE_INCOMPLETE" | "ARTIFACT_VERIFIED"
  | "TENSOR_VERIFIED" | "BLOCKED" | "REVIEW_REQUIRED"
  | "READY_FOR_TECHNICAL_CANARY" | "PRODUCTION_APPROVED";

export type RightState = "CONFIRMED" | "UNKNOWN" | "REJECTED";
export const RIGHT_FIELDS = ["commercial_outputs", "outside_paid_saas", "lora_training", "cloud_operation", "lawful_explicit_nsfw", "upstream_chain"] as const;
export type Rights = Record<(typeof RIGHT_FIELDS)[number], RightState>;

export const EVIDENCE_CATEGORIES = ["MODEL_PROVENANCE", "MODEL_LICENSE", "SDXL_MODEL_PROVENANCE", "SDXL_OPEN_RAIL_LICENSE", "STABILITY_CORE_MODELS_SCOPE", "STABILITY_TERMS_CONFLICT_CLAUSE", "STABILITY_ACCEPTABLE_USE_POLICY", "CREATOR_CONTROLLED_SOURCE"] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];
export interface EvidenceRequirement { category: EvidenceCategory; sourceReference: string }

export interface Candidate {
  candidateId: string; model: string; version: string; creator: string; architecture: string;
  modelId: string; versionId: string; fileId?: string; filename: string; bytes: number; sha256: string;
  status: "TECHNICAL_CANARY_CANDIDATE"; productionStatus: "NOT_APPROVED";
  nonFinitePolicy: "BLOCKED" | "REVIEW_REQUIRED"; evidenceSources: string[];
  requiredEvidence: EvidenceRequirement[];
}
export interface TensorResult { name: string; dtype: string; shape: number[]; nanCount: number; positiveInfinityCount: number; negativeInfinityCount: number }
export interface ArtifactResult { ok: boolean; candidateId: string; path: string; filename: string; bytes: number; sha256: string; failures: string[] }
