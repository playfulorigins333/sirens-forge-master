import { RP_META_SENTINEL } from "./admin-rp"

export const CREATOR_REPLY_MAX_VISIBLE_CHARS = 12_000
export type CreatorReplyViolation =
  | "EMPTY_VISIBLE" | "VISIBLE_TOO_LONG" | "SENTINEL_LEAK" | "MALFORMED_METADATA"
  | "VISIBLE_MISMATCH" | "INVALID_SEGMENT" | "SECOND_PERSON_NARRATION"
  | "SUBSCRIBER_PUPPETING" | "UNGROUNDED_REFERENCE"

type Segment = { kind: "dialogue" | "creator_action" | "creator_thought" | "grounded_reference"; text: string; evidence?: string }
type Contract = { version: 1; segments: Segment[] }

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const SECOND_PERSON_ACTION = /(?:^|[.!?]\s+)(?:\*\s*)?(?:you|your)\s+(?:walk|step|move|stand|sit|turn|lean|reach|emerge|cross|approach|wear|wore|are wearing|look|stare|smile|shiver|tremble|nod|obey|comply|follow|come|enter|leave|kneel|rise|grab|take|touch|feel|react|flinch)\b/i
const SECOND_PERSON_PHYSICAL_CLAIM = /\byour\s+(?:body|face|eyes?|hair|hands?|feet|legs?|arms?|chest|waist|hips?|skin|clothes?|coat|dress|shirt|pants|shoes?|boots?|heels?|posture|expression)\b/i
const SUBSCRIBER_THIRD_PERSON_ACTION = /(?:^|[.!?]\s+)(?:the subscriber|subscriber|they|he|she)\s+(?:walks?|steps?|moves?|stands?|sits?|turns?|leans?|reaches?|smiles?|shivers?|trembles?|nods?|obeys?|complies?|follows?|comes?|enters?|leaves?|kneels?|rises?|grabs?|takes?|touches?|feels?|reacts?|flinches?)\b/i
const CREATOR_FIRST_PERSON = /\b(?:I|I'm|I’ll|I'll|I’d|I'd|I’ve|I've|me|my|mine)\b/

function parseContract(value: unknown): Contract | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || Object.keys(raw).some((key) => !["version", "segments"].includes(key)) || !Array.isArray(raw.segments) || !raw.segments.length || raw.segments.length > 24) return null
  const segments: Segment[] = []
  for (const value of raw.segments) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const segment = value as Record<string, unknown>
    if (!["dialogue", "creator_action", "creator_thought", "grounded_reference"].includes(String(segment.kind)) || typeof segment.text !== "string" || !segment.text.trim() || segment.text.length > 3000 || CONTROL.test(segment.text)) return null
    if (Object.keys(segment).some((key) => !["kind", "text", "evidence"].includes(key))) return null
    if (segment.kind === "grounded_reference" && (typeof segment.evidence !== "string" || !segment.evidence.trim())) return null
    if (segment.kind !== "grounded_reference" && segment.evidence !== undefined) return null
    segments.push(segment as Segment)
  }
  return { version: 1, segments }
}

/** Validates a deliberately restricted, single-completion response contract. */
export function validateCreatorReplyCandidate(visibleInput: string, metadata: unknown, authoritativeSources: string[]) {
  const visible = visibleInput.trim()
  if (!visible) return { ok: false as const, code: "EMPTY_VISIBLE" as CreatorReplyViolation }
  if (visible.length > CREATOR_REPLY_MAX_VISIBLE_CHARS) return { ok: false as const, code: "VISIBLE_TOO_LONG" as CreatorReplyViolation }
  if (visible.includes(RP_META_SENTINEL)) return { ok: false as const, code: "SENTINEL_LEAK" as CreatorReplyViolation }
  const contract = parseContract(metadata)
  if (!contract) return { ok: false as const, code: "MALFORMED_METADATA" as CreatorReplyViolation }
  const rendered = contract.segments.map((segment) => segment.text).join("").trim()
  if (rendered !== visible) return { ok: false as const, code: "VISIBLE_MISMATCH" as CreatorReplyViolation }
  const authority = authoritativeSources.join("\n")
  for (const segment of contract.segments) {
    if (SECOND_PERSON_ACTION.test(segment.text) || SECOND_PERSON_PHYSICAL_CLAIM.test(segment.text)) return { ok: false as const, code: "SECOND_PERSON_NARRATION" as CreatorReplyViolation }
    if (SUBSCRIBER_THIRD_PERSON_ACTION.test(segment.text)) return { ok: false as const, code: "SUBSCRIBER_PUPPETING" as CreatorReplyViolation }
    if ((segment.kind === "creator_action" || segment.kind === "creator_thought") && !CREATOR_FIRST_PERSON.test(segment.text)) return { ok: false as const, code: "INVALID_SEGMENT" as CreatorReplyViolation }
    if (segment.kind === "grounded_reference" && (!authority.includes(segment.evidence!) || !segment.text.includes(segment.evidence!))) return { ok: false as const, code: "UNGROUNDED_REFERENCE" as CreatorReplyViolation }
  }
  return { ok: true as const, text: visible, code: "OK" as const }
}

export function parseCreatorReplyMetadata(value: unknown): unknown {
  if (typeof value !== "string") return null
  try { return JSON.parse(value.trim()) } catch { return null }
}
