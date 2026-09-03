import { RP_META_SENTINEL } from "./admin-rp"
import type { CreatorReplyAuthoritySource } from "./creator-reply"

export const CREATOR_REPLY_MAX_VISIBLE_CHARS = 12_000
const CREATOR_REPLY_MAX_CLAIMS = 32
const CREATOR_REPLY_MAX_CLAIM_CHARS = 1_500
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

export type CreatorReplyViolation =
  | "EMPTY_VISIBLE"
  | "VISIBLE_TOO_LONG"
  | "CONTROL_CHARACTERS"
  | "SENTINEL_LEAK"
  | "MALFORMED_METADATA"
  | "INVALID_CLAIM"
  | "UNKNOWN_SOURCE"
  | "UNGROUNDED_EVIDENCE"
  | "CLAIM_NOT_VISIBLE"
  | "SUBSCRIBER_PUPPETING"
  | "ROLE_INVERSION"
  | "UNSUPPORTED_WORLD_REFERENCE"

export type CreatorReplyClaim = {
  claim: string
  source_id: string
}

type GroundedRange = { start: number; end: number }

const SUBSCRIBER_ACTION_OR_STATE = /\byou\s+(?:kneel(?:ed|s|ing)?|came|come(?:s|ing)?|moved?|moves|moving|walk(?:ed|s|ing)?|step(?:ped|s|ping)?|stand(?:s|ing)?|stood|sit(?:s|ting)?|sat|lean(?:ed|s|ing)?|press(?:ed|es|ing)?|reach(?:ed|es|ing)?|turn(?:ed|s|ing)?|freeze|froze|freezes|freezing|flinch(?:ed|es|ing)?|trembl(?:e|ed|es|ing)|shiver(?:ed|s|ing)?|gasp(?:ed|s|ing)?|moan(?:ed|s|ing)?|smil(?:e|ed|es|ing)|grin(?:ned|s|ning)?|nod(?:ded|s|ding)?|shake|shakes|shook|shaking|stare(?:d|s|ing)?|watch(?:ed|es|ing)?|wait(?:ed|s|ing)?|stay(?:ed|s|ing)?|look(?:ed|s|ing)?|feel(?:s|ing|t)?|think(?:s|ing)?|want(?:ed|s|ing)?|decid(?:e|ed|es|ing))\b/gi
const SUBSCRIBER_PROGRESSIVE_STATE = /\byou(?:'re|\s+are|\s+were)\s+(?:standing|sitting|kneeling|walking|moving|wearing|shivering|trembling|gasping|smiling|grinning|waiting|staying|leaning|pressed|nervous|afraid|angry|excited|aroused|drunk|intoxicated|cold|warm|wet|hurt|injured)\b/gi
const SUBSCRIBER_POSSESSIVE_STATE = /\byour\s+(?:body|hands?|arms?|legs?|eyes?|face|hair|mouth|lips?|clothes?|clothing|coat|shirt|pants|dress|skirt|heels?|shoes?|boots?|posture|expression|breathing|breath|voice)\s+(?:is|are|was|were|look(?:s|ed)?|feel(?:s|t)?|move(?:s|d)?|shake(?:s|n)?|shiver(?:s|ed)?|tremble(?:s|d)?|glisten(?:s|ed)?|drip(?:s|ped)?|press(?:es|ed)?|tighten(?:s|ed)?|relax(?:es|ed)?|strike(?:s)?|hit(?:s)?|click(?:s|ed)?)\b|\byour\s+(?:wet|cold|warm|shaking|shivering|trembling|flushed|pale|bare|naked|dressed)\s+(?:body|hands?|arms?|legs?|eyes?|face|hair|mouth|lips?|clothes?|clothing|coat|shirt|pants|dress|skirt|heels?|shoes?|boots?)\b/gi
const THIRD_PERSON_SUBSCRIBER = /\bthe subscriber\s+(?:kneels?|moves?|walks?|stands?|sits?|leans?|reaches?|turns?|shivers?|gasps?|smiles?|grins?|nods?|waits?|stays?|looks?|feels?|thinks?|wants?|decides?)\b/gi
const THIRD_PERSON_CREATOR = /\b(?:the creator|creator)\s+(?:smiles?|grins?|steps?|walks?|moves?|leans?|reaches?|turns?|waits?|speaks?|says?|looks?|watches?|approaches?|emerges?)\b/gi
const OBVIOUS_WORLD_REFERENCE = /\b(?:the|a|an)\s+(?:door|doorway|dumpster|fireplace|hearth|bell|sign|shotgun|lantern|weapon|barstool|stool|table|chair|couch|sofa|bed|window|curtain|crowd|guest|guests|patron|patrons|bouncer|guard)\b/gi
const SUBSCRIBER_MOTIVE_OR_INTENT = /\byou(?:'re|\s+are)\s+(?:trying|hoping|intending|planning)\s+to\b|\byou\s+(?:intend|plan|mean|want)\s+to\b|\byou\s+hope(?:\s+to\b|\s+I(?:’|'|’)ll\b)/gi
const SUBSCRIBER_GENDERED_IDENTITY = /\b(?:you(?:'re|\s+are)\s+(?:a\s+)?(?:boy|girl|man|woman|princess)|(?:good|bad|naughty|pretty|little)\s+(?:boy|girl|princess)|my\s+(?:boy|girl|princess))\b/gi

function exactKeys(raw: Record<string, unknown>, allowed: string[]) {
  const keys = Object.keys(raw)
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key))
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Claims are instructed to copy an exact visible substring. In practice some providers
 * normalize curly quotes, punctuation, case, or whitespace between visible prose and
 * hidden metadata. Tolerate only those mechanical differences; never synonyms,
 * reordered words, or semantic fuzzy matching.
 */
function claimRanges(visible: string, claim: string): GroundedRange[] {
  const ranges: GroundedRange[] = []
  let from = 0
  while (from <= visible.length - claim.length) {
    const at = visible.indexOf(claim, from)
    if (at < 0) break
    ranges.push({ start: at, end: at + claim.length })
    from = at + Math.max(1, claim.length)
  }
  if (ranges.length) return ranges

  const words = claim.match(/[\p{L}\p{N}]+/gu) ?? []
  if (!words.length) return ranges
  const separator = "[\\s\\p{P}\\p{S}]+"
  const pattern = new RegExp(words.map(escapeRegex).join(separator), "giu")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(visible))) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
    if (!match[0].length) pattern.lastIndex++
  }
  return ranges
}

function collectGroundedRanges(visible: string, claims: CreatorReplyClaim[]): GroundedRange[] {
  return claims.flatMap(({ claim }) => claimRanges(visible, claim))
}

function rangeIsGrounded(start: number, end: number, grounded: GroundedRange[]) {
  return grounded.some((range) => start >= range.start && end <= range.end)
}

function identitySourceSupports(label: string, sourceText: string) {
  const normalized = label.toLowerCase()
  if (/\b(?:boy|man)\b/.test(normalized)) return /\b(?:male|he|him|boy|man)\b/i.test(sourceText)
  if (/\b(?:girl|woman|princess)\b/.test(normalized)) return /\b(?:female|she|her|girl|woman|princess)\b/i.test(sourceText)
  return false
}

function firstUnsupportedIdentity(
  visible: string,
  claims: CreatorReplyClaim[],
  sourceById: Map<string, CreatorReplyAuthoritySource>,
) {
  SUBSCRIBER_GENDERED_IDENTITY.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SUBSCRIBER_GENDERED_IDENTITY.exec(visible))) {
    if (looksConditionalPrefix(visible, match.index) || looksInterrogativeContext(visible, match.index, match.index + match[0].length)) continue
    const supported = claims.some((claim) =>
      claimRanges(visible, claim.claim).some((range) => match!.index >= range.start && match!.index + match![0].length <= range.end) &&
      identitySourceSupports(match![0], sourceById.get(claim.source_id)?.text ?? ""))
    if (!supported) return match[0]
  }
  return null
}

function looksConditionalPrefix(visible: string, start: number) {
  const prefix = visible.slice(Math.max(0, start - 18), start).toLowerCase()
  return /\b(?:if|when|once|unless|until|should)\s*$/.test(prefix)
}

function looksInterrogativeContext(visible: string, start: number, end: number) {
  const prefix = visible.slice(Math.max(0, start - 72), start).toLowerCase()
  if (/\b(?:do|does|did|can|could|would|will|won't|should|are|were|have|has|had)\s*$/.test(prefix)) return true
  if (/\b(?:tell|show|ask|say|explain)\s+(?:me\s+)?(?:what|whether|if|how)\s*$/.test(prefix)) return true
  if (/\b(?:want|need|like)\s+to\s+(?:know|hear)\s+(?:what|whether|if|how)\s*$/.test(prefix)) return true

  const tail = visible.slice(end, Math.min(visible.length, end + 240))
  const punctuation = tail.match(/[.!?]/)
  return punctuation?.[0] === "?"
}

function looksSpeculativePrefix(visible: string, start: number) {
  const prefix = visible.slice(Math.max(0, start - 48), start).toLowerCase()
  return /\b(?:maybe|perhaps)\s*$/.test(prefix) || /\bi\s+wonder\s+(?:whether|if)\s*$/.test(prefix)
}

function firstUngroundedMatch(
  visible: string,
  pattern: RegExp,
  grounded: GroundedRange[],
  allowConditional = false,
  allowInterrogative = false,
  allowSpeculative = false,
) {
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(visible))) {
    if (allowConditional && looksConditionalPrefix(visible, match.index)) continue
    if (allowInterrogative && looksInterrogativeContext(visible, match.index, match.index + match[0].length)) continue
    if (allowSpeculative && looksSpeculativePrefix(visible, match.index)) continue
    if (!rangeIsGrounded(match.index, match.index + match[0].length, grounded)) return match[0]
  }
  return null
}

export function validateCreatorReplyCandidate(
  providerVisible: string,
  metadata: unknown,
  authoritativeSources: CreatorReplyAuthoritySource[],
) {
  const text = providerVisible.trim()
  if (!text) return { ok: false as const, code: "EMPTY_VISIBLE" as CreatorReplyViolation }
  if (text.length > CREATOR_REPLY_MAX_VISIBLE_CHARS) return { ok: false as const, code: "VISIBLE_TOO_LONG" as CreatorReplyViolation }
  if (CONTROL.test(text)) return { ok: false as const, code: "CONTROL_CHARACTERS" as CreatorReplyViolation }
  if (text.includes(RP_META_SENTINEL)) return { ok: false as const, code: "SENTINEL_LEAK" as CreatorReplyViolation }

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return { ok: false as const, code: "MALFORMED_METADATA" as CreatorReplyViolation }
  const raw = metadata as Record<string, unknown>
  if (raw.version !== 4 || !exactKeys(raw, ["version", "claims"]) || !Array.isArray(raw.claims) || raw.claims.length > CREATOR_REPLY_MAX_CLAIMS) {
    return { ok: false as const, code: "MALFORMED_METADATA" as CreatorReplyViolation }
  }

  const sourceById = new Map(authoritativeSources.map((source) => [source.id, source]))
  if (sourceById.size !== authoritativeSources.length) return { ok: false as const, code: "MALFORMED_METADATA" as CreatorReplyViolation }

  const claims: CreatorReplyClaim[] = []
  const seenClaims = new Set<string>()
  for (const item of raw.claims) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false as const, code: "INVALID_CLAIM" as CreatorReplyViolation }
    const claimRaw = item as Record<string, unknown>
    if (!exactKeys(claimRaw, ["claim", "source_id"])) return { ok: false as const, code: "INVALID_CLAIM" as CreatorReplyViolation }
    const claim = typeof claimRaw.claim === "string" ? claimRaw.claim.trim() : ""
    const sourceId = typeof claimRaw.source_id === "string" ? claimRaw.source_id.trim() : ""
    if (!claim || !sourceId || claim.length > CREATOR_REPLY_MAX_CLAIM_CHARS || CONTROL.test(claim) || CONTROL.test(sourceId)) {
      return { ok: false as const, code: "INVALID_CLAIM" as CreatorReplyViolation }
    }
    if (!claimRanges(text, claim).length) return { ok: false as const, code: "CLAIM_NOT_VISIBLE" as CreatorReplyViolation }
    const source = sourceById.get(sourceId)
    if (!source) return { ok: false as const, code: "UNKNOWN_SOURCE" as CreatorReplyViolation }
    const identity = `${claim}\u0000${sourceId}`
    if (seenClaims.has(identity)) return { ok: false as const, code: "INVALID_CLAIM" as CreatorReplyViolation }
    seenClaims.add(identity)
    claims.push({ claim, source_id: sourceId })
  }

  const grounded = collectGroundedRanges(text, claims)
  if (
    firstUngroundedMatch(text, SUBSCRIBER_ACTION_OR_STATE, grounded, true, true) ||
    firstUngroundedMatch(text, SUBSCRIBER_PROGRESSIVE_STATE, grounded, true, true) ||
    firstUngroundedMatch(text, SUBSCRIBER_POSSESSIVE_STATE, grounded, false, true) ||
    firstUngroundedMatch(text, THIRD_PERSON_SUBSCRIBER, grounded)
  ) {
    return { ok: false as const, code: "SUBSCRIBER_PUPPETING" as CreatorReplyViolation }
  }
  if (firstUngroundedMatch(text, SUBSCRIBER_MOTIVE_OR_INTENT, grounded, true, true, true)) {
    return { ok: false as const, code: "SUBSCRIBER_PUPPETING" as CreatorReplyViolation }
  }
  if (firstUnsupportedIdentity(text, claims, sourceById)) {
    return { ok: false as const, code: "SUBSCRIBER_PUPPETING" as CreatorReplyViolation }
  }
  if (firstUngroundedMatch(text, THIRD_PERSON_CREATOR, [])) {
    return { ok: false as const, code: "ROLE_INVERSION" as CreatorReplyViolation }
  }
  if (firstUngroundedMatch(text, OBVIOUS_WORLD_REFERENCE, grounded)) {
    return { ok: false as const, code: "UNSUPPORTED_WORLD_REFERENCE" as CreatorReplyViolation }
  }

  return { ok: true as const, code: "OK" as const, text, claims }
}
