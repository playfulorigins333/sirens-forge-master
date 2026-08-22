import { lstat, realpath } from "node:fs/promises";
import { getCandidate } from "./registry";
import { assertNoSecret, validateLocalPath } from "./security";
import { sha256File } from "./verifier";
import { EVIDENCE_CATEGORIES, RIGHT_FIELDS, type ArtifactResult, type EvidenceCategory, type Rights, type TensorResult, type ValidationState } from "./types";

export interface EvidenceInput { category: EvidenceCategory; sourceReference: string; path: string }
export interface EvidenceRecord extends EvidenceInput { sha256: string }
export interface EvidenceManifest {
  schemaVersion: 1; candidate: ReturnType<typeof getCandidate>; capturedAtUtc: string;
  evidenceSources: string[]; evidenceRecords: EvidenceRecord[]; rights: Rights;
  artifactVerification: ArtifactResult; tensorScan: TensorResult[];
  interpretation: string; status: Exclude<ValidationState, "PRODUCTION_APPROVED">;
  laterGates: ["TECHNICAL_CANARY", "QUALITY_REVIEW", "LEGAL_RIGHTS_REVIEW", "EXPLICIT_ADULT_GENERATION_REVIEW", "PRODUCTION_APPROVAL"];
}

export function validateRights(input: Partial<Rights>): Rights {
  const result = {} as Rights;
  for (const field of RIGHT_FIELDS) { const value = input[field] ?? "UNKNOWN"; if (!["CONFIRMED", "UNKNOWN", "REJECTED"].includes(value)) throw new Error(`INVALID_RIGHTS_STATE: ${field}`); result[field] = value; }
  return result;
}

export async function preserveEvidence(inputs: EvidenceInput[]): Promise<EvidenceRecord[]> {
  const keys = new Set<string>(); const output: EvidenceRecord[] = [];
  for (const input of [...inputs].sort((a, b) => a.category.localeCompare(b.category))) {
    if (!EVIDENCE_CATEGORIES.includes(input.category) || typeof input.sourceReference !== "string") throw new Error("INVALID_EVIDENCE_RECORD");
    assertNoSecret(input.sourceReference, "evidence source reference"); const safe = validateLocalPath(input.path); const stat = await lstat(safe);
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(safe) !== safe) throw new Error("UNSAFE_PATH: evidence must be a regular, canonical file");
    const key = `${input.category}\0${input.sourceReference}`; if (keys.has(key)) throw new Error("DUPLICATE_EVIDENCE_RECORD"); keys.add(key);
    output.push({ category: input.category, sourceReference: input.sourceReference, path: safe, sha256: await sha256File(safe) });
  }
  return output;
}

export async function createManifest(args: { candidateId: string; capturedAtUtc: string; evidence: EvidenceInput[]; rights: Partial<Rights>; artifact: ArtifactResult; tensors: TensorResult[]; scanState: ValidationState }): Promise<EvidenceManifest> {
  assertNoSecret(JSON.stringify(args.rights), "rights"); const timestamp = new Date(args.capturedAtUtc);
  if (Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== args.capturedAtUtc) throw new Error("INVALID_UTC_CAPTURE_TIME");
  const candidate = getCandidate(args.candidateId), rights = validateRights(args.rights), evidenceRecords = await preserveEvidence(args.evidence);
  const completeEvidence = candidate.requiredEvidence.every((required) => required.sourceReference !== "OPERATOR_EVIDENCE_REQUIRED" && evidenceRecords.some((record) => record.category === required.category && record.sourceReference === required.sourceReference));
  const exactArtifact = args.artifact.ok && args.artifact.candidateId === candidate.candidateId && args.artifact.filename === candidate.filename && args.artifact.bytes === candidate.bytes && args.artifact.sha256 === candidate.sha256 && args.artifact.failures.length === 0;
  const completeScan = args.scanState === "TENSOR_VERIFIED" && args.tensors.length > 0;
  const rejected = Object.values(rights).includes("REJECTED"), unknown = Object.values(rights).includes("UNKNOWN"); let status: EvidenceManifest["status"];
  if (!exactArtifact || args.scanState === "BLOCKED" || rejected || (args.scanState === "TENSOR_VERIFIED" && !completeScan)) status = "BLOCKED";
  else if (args.scanState === "REVIEW_REQUIRED") status = "REVIEW_REQUIRED";
  else if (unknown || !completeEvidence) status = "EVIDENCE_INCOMPLETE";
  else status = "READY_FOR_TECHNICAL_CANARY";
  return { schemaVersion: 1, candidate, capturedAtUtc: timestamp.toISOString(), evidenceSources: candidate.evidenceSources, evidenceRecords, rights, artifactVerification: args.artifact, tensorScan: [...args.tensors].sort((a, b) => a.name.localeCompare(b.name)), interpretation: `${status}: production approval is outside this subsystem`, status, laterGates: ["TECHNICAL_CANARY", "QUALITY_REVIEW", "LEGAL_RIGHTS_REVIEW", "EXPLICIT_ADULT_GENERATION_REVIEW", "PRODUCTION_APPROVAL"] };
}

export function serializeManifest(manifest: EvidenceManifest): string { return `${JSON.stringify(manifest, null, 2)}\n`; }
