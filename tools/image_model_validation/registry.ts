import path from "node:path";
import registryJson from "./registry.json" with { type: "json" };
import { EVIDENCE_CATEGORIES, type Candidate, type EvidenceCategory } from "./types";

const candidateFields = new Set(["candidateId", "model", "version", "creator", "architecture", "modelId", "versionId", "fileId", "filename", "bytes", "sha256", "status", "productionStatus", "nonFinitePolicy", "evidenceSources", "requiredEvidence"]);
const requirementFields = new Set(["category", "sourceReference"]);
const url = (value: string) => { try { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password; } catch { return false; } };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exactFields = (value: Record<string, unknown>, allowed: Set<string>, label: string) => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`INVALID_REGISTRY: unknown ${label} field ${unknown[0]}`);
};

export function validateRegistry(value: unknown): Candidate[] {
  if (!object(value)) throw new Error("INVALID_REGISTRY: root must be an object");
  exactFields(value, new Set(["schemaVersion", "candidates"]), "root");
  if (value.schemaVersion !== 1 || !Array.isArray(value.candidates) || !value.candidates.length) throw new Error("INVALID_REGISTRY: schema version or candidates");
  const ids = new Set<string>(), filenames = new Set<string>();
  return value.candidates.map((raw, index) => {
    if (!object(raw)) throw new Error(`INVALID_REGISTRY: candidate ${index}`);
    exactFields(raw, candidateFields, "candidate");
    for (const field of ["candidateId", "model", "version", "creator", "architecture", "modelId", "versionId", "filename", "sha256"] as const) if (typeof raw[field] !== "string" || !raw[field]) throw new Error(`INVALID_REGISTRY: ${field}`);
    if (raw.fileId !== undefined && (typeof raw.fileId !== "string" || !raw.fileId)) throw new Error("INVALID_REGISTRY: fileId");
    if (ids.has(raw.candidateId as string)) throw new Error("INVALID_REGISTRY: duplicate candidate ID"); ids.add(raw.candidateId as string);
    const filename = raw.filename as string;
    if (path.basename(filename) !== filename || !filename.toLowerCase().endsWith(".safetensors") || filenames.has(filename.toLowerCase())) throw new Error("INVALID_REGISTRY: unsafe or duplicate filename"); filenames.add(filename.toLowerCase());
    if (!Number.isSafeInteger(raw.bytes) || (raw.bytes as number) <= 0) throw new Error("INVALID_REGISTRY: bytes");
    if (!/^[A-F0-9]{64}$/.test(raw.sha256 as string)) throw new Error("INVALID_REGISTRY: sha256");
    if (raw.status !== "TECHNICAL_CANARY_CANDIDATE" || raw.productionStatus !== "NOT_APPROVED" || !["BLOCKED", "REVIEW_REQUIRED"].includes(raw.nonFinitePolicy as string)) throw new Error("INVALID_REGISTRY: status or policy");
    if (!Array.isArray(raw.evidenceSources) || !raw.evidenceSources.length || new Set(raw.evidenceSources).size !== raw.evidenceSources.length || raw.evidenceSources.some((ref) => typeof ref !== "string" || (ref !== "OPERATOR_EVIDENCE_REQUIRED" && !url(ref)))) throw new Error("INVALID_REGISTRY: evidence source");
    if (!Array.isArray(raw.requiredEvidence) || !raw.requiredEvidence.length) throw new Error("INVALID_REGISTRY: required evidence");
    const categories = new Set<EvidenceCategory>();
    for (const requirement of raw.requiredEvidence) {
      if (!object(requirement)) throw new Error("INVALID_REGISTRY: evidence requirement"); exactFields(requirement, requirementFields, "requirement");
      if (!EVIDENCE_CATEGORIES.includes(requirement.category as EvidenceCategory) || categories.has(requirement.category as EvidenceCategory)) throw new Error("INVALID_REGISTRY: evidence category"); categories.add(requirement.category as EvidenceCategory);
      if (typeof requirement.sourceReference !== "string" || !(raw.evidenceSources as unknown[]).includes(requirement.sourceReference) || (requirement.sourceReference !== "OPERATOR_EVIDENCE_REQUIRED" && !url(requirement.sourceReference))) throw new Error("INVALID_REGISTRY: required evidence reference");
    }
    return structuredClone(raw) as unknown as Candidate;
  });
}

const candidates = validateRegistry(registryJson);
export function getCandidate(candidateId: string): Candidate { const candidate = candidates.find((item) => item.candidateId === candidateId); if (!candidate) throw new Error(`UNKNOWN_CANDIDATE: ${candidateId}`); return structuredClone(candidate); }
export function listCandidates(): Candidate[] { return structuredClone(candidates); }
