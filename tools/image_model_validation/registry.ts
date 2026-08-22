import registryJson from "./registry.json" with { type: "json" };
import type { Candidate } from "./types";

const candidates = registryJson.candidates as Candidate[];
export function getCandidate(candidateId: string): Candidate {
  const candidate = candidates.find((item) => item.candidateId === candidateId);
  if (!candidate) throw new Error(`UNKNOWN_CANDIDATE: ${candidateId}`);
  return structuredClone(candidate);
}
export function listCandidates(): Candidate[] { return structuredClone(candidates); }
