import { RP_META_SENTINEL } from "./admin-rp"
import { buildCreatorReplyAuthorityUnits, type CreatorReplyAuthoritySource, type CreatorReplyAuthorityUnit } from "./creator-reply"

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
  authority_id: string
}

type GroundedRange = { start: number; end: number }

const SUBSCRIBER_ACTION_OR_STATE = /\byou\s+(?:kneel(?:ed|s|ing)?|came|come(?:s|ing)?|moved?|moves|moving|walk(?:ed|s|ing)?|step(?:ped|s|ping)?|stand(?:s|ing)?|stood|sit(?:s|ting)?|sat|lean(?:ed|s|ing)?|press(?:ed|es|ing)?|reach(?:ed|es|ing)?|turn(?:ed|s|ing)?|freeze|froze|freezes|freezing|flinch(?:ed|es|ing)?|trembl(?:e|ed|es|ing)|shiver(?:ed|s|ing)?|gasp(?:ed|s|ing)?|moan(?:ed|s|ing)?|smil(?:e|ed|es|ing)|grin(?:ned|s|ning)?|nod(?:ded|s|ding)?|shake|shakes|shook|shaking|stare(?:d|s|ing)?|watch(?:ed|es|ing)?|wait(?:ed|s|ing)?|stay(?:ed|s|ing)?|look(?:ed|s|ing)?|feel(?:s|ing|t)?|think(?:s|ing)?|want(?:ed|s|ing)?|decid(?:e|ed|es|ing))\b/gi
const SUBSCRIBER_PROGRESSIVE_STATE = /\b(?:look\s+who(?:'s|\s+is)\s+|you(?:'re|\s+are|\s+were)\s+|you\s+seem\s+)(?:standing|sitting|kneeling|walking|moving|wearing|shivering|trembling|gasping|smiling|grinning|waiting|staying|leaning|pressed|eager|nervous|afraid|angry|excited|aroused|drunk|intoxicated|cold|warm|wet|hurt|injured|wealthy)\b/gi
const SUBSCRIBER_MOTIVE_OR_INTENT = /\byou(?:(?:'re|\s+are)\s+|\s+)(?:trying|hoping|intending|planning|wanting)\s+(?:to|i(?:'ll|\s+will))\b|\byou\s+(?:intend|plan|mean|want)\s+to\b|\byou\s+hope\b/gi
const SUBSCRIBER_GENERAL_FACT = /\byou(?:'re|\s+are)\s+(?:eager|wealthy)\b|\byou\s+(?:love|loved)\s+this\b|\byou(?:'ve|\s+have)\s+paid\s+before\b/gi
const SUBSCRIBER_GENDERED_IDENTITY = /\b(?:you(?:'re|\s+are)\s+(?:a\s+)?(?:boy|girl|man|woman|princess)|(?:good|bad|naughty)\s+(?:boy|girl)|(?:my|little)\s+(?:boy|girl|man|woman|princess))\b/gi
const SUBSCRIBER_POSSESSIVE_STATE = /\byour\s+(?:body|hands?|arms?|legs?|eyes?|face|hair|mouth|lips?|clothes?|clothing|coat|shirt|pants|dress|skirt|heels?|shoes?|boots?|posture|expression|breathing|breath|voice)\s+(?:is|are|was|were|look(?:s|ed)?|feel(?:s|t)?|move(?:s|d)?|shake(?:s|n)?|shiver(?:s|ed)?|tremble(?:s|d)?|glisten(?:s|ed)?|drip(?:s|ped)?|press(?:es|ed)?|tighten(?:s|ed)?|relax(?:es|ed)?|strike(?:s)?|hit(?:s)?|click(?:s|ed)?)\b|\byour\s+(?:wet|cold|warm|shaking|shivering|trembling|flushed|pale|bare|naked|dressed)\s+(?:body|hands?|arms?|legs?|eyes?|face|hair|mouth|lips?|clothes?|clothing|coat|shirt|pants|dress|skirt|heels?|shoes?|boots?)\b/gi
const THIRD_PERSON_SUBSCRIBER = /\bthe subscriber\s+(?:kneels?|moves?|walks?|stands?|sits?|leans?|reaches?|turns?|shivers?|gasps?|smiles?|grins?|nods?|waits?|stays?|looks?|feels?|thinks?|wants?|decides?)\b/gi
const THIRD_PERSON_CREATOR = /\b(?:the creator|creator)\s+(?:smiles?|grins?|steps?|walks?|moves?|leans?|reaches?|turns?|waits?|speaks?|says?|looks?|watches?|approaches?|emerges?)\b/gi
const OBVIOUS_WORLD_REFERENCE = /\b(?:the|a|an)\s+(?:door|doorway|dumpster|fireplace|hearth|bell|sign|shotgun|lantern|weapon|barstool|stool|table|chair|couch|sofa|bed|window|curtain|crowd|guest|guests|patron|patrons|bouncer|guard)\b/gi
/**
 * Structural backstop for the provider-authored manifest. Any finite declarative
 * predicate owned by "you" is a subscriber claim, regardless of its particular
 * adjective or verb. This deliberately avoids an emotion/action blacklist: new
 * paraphrases fail closed unless their visible span is tied to server authority.
 */
const SECOND_PERSON_DECLARATIVE = /\byou(?:'re|'ve|'d|\s+(?:are|were|seem|seemed|appear|appeared|look|looked|feel|felt|think|thought|know|knew|want|wanted|need|needed|love|loved|adore|adored|enjoy|enjoyed|prefer|preferred|crave|craved|like|liked|hate|hated|keep|kept|try|tried|hope|hoped|plan|planned|intend|intended|mean|meant|paid|pay|did|do|have|had))\b/gi
const EMBEDDED_SUBSCRIBER_INFERENCE = /\bi\s+(?:can\s+)?(?:tell|see|know|sense|notice|bet)\s+(?:that\s+)?you(?:'re|'ve|'d|\s+(?:are|were|have|had|want|wanted|feel|felt|think|thought|love|loved|need|needed))\b/gi
const LOOK_WHO_ASSERTION = /\blook\s+who(?:'s|\s+is|\s+was)\b/gi
const ANAPHORIC_SUBSCRIBER_STATE = /\b(?:that|your)\s+(?:confidence|desperation|excitement|nervousness|impatience|eagerness|arousal|fear|anger|jealousy|desire|need|motive|intention|obedience|compliance|submission)\b/gi

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

const SUPPORT_STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "before", "do", "does", "did", "for", "from", "good", "have", "has", "had", "in", "is", "it", "of", "on", "that", "the", "this", "to", "was", "were", "when", "who"])
const NEGATION = new Set(["not", "never", "no", "cannot"])
type Perspective = "subscriber_source" | "profile_source" | "creator_claim"

function expandContractions(value: string) {
  return value.normalize("NFKC").replace(/[’‘]/g, "'").toLowerCase()
    .replace(/\b(i|you|we|they|he|she|it)'m\b/g, "$1 am")
    .replace(/\b(i|you|we|they|he|she|it)'re\b/g, "$1 are")
    .replace(/\b(i|you|we|they|he|she|it)'ve\b/g, "$1 have")
    .replace(/\b(i|you|we|they|he|she|it)'ll\b/g, "$1 will")
    .replace(/\b(i|you|we|they|he|she|it)'d\b/g, "$1 would")
    .replace(/\b(can)'t\b/g, "cannot")
    .replace(/\b(won)'t\b/g, "will not")
    .replace(/\b(ain|aren|isn|wasn|weren|don|doesn|didn|haven|hasn|hadn|couldn|wouldn|shouldn|mustn|needn)'t\b/g, (_, stem: string) => ({ ain: "is not", aren: "are not", isn: "is not", wasn: "was not", weren: "were not", don: "do not", doesn: "does not", didn: "did not", haven: "have not", hasn: "has not", hadn: "had not", couldn: "could not", wouldn: "would not", shouldn: "should not", mustn: "must not", needn: "need not" })[stem]!)
}

function stemSupportToken(token: string) {
  if (token.endsWith("ied")) return `${token.slice(0, -3)}y`
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3)
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2)
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1)
  return token
}

/** Canonicalize speaker-relative wording without discarding role, order, or polarity. */
function canonicalFact(value: string, perspective: Perspective) {
  const normalized = expandContractions(value)
  const explicitProfilePronouns = perspective === "profile_source" && /\bpronouns?\b/.test(normalized)
  const raw = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const tokens = raw.flatMap((token) => {
    if (["i", "me", "my", "mine"].includes(token)) return [perspective === "subscriber_source" ? "SUBSCRIBER" : "CREATOR"]
    if (["you", "your", "yours"].includes(token)) return [perspective === "subscriber_source" ? "CREATOR" : "SUBSCRIBER"]
    if (token === "subscriber") return ["SUBSCRIBER"]
    if (["female", "girl", "woman"].includes(token)) return ["FEMALE"]
    if (["male", "boy", "man"].includes(token)) return ["MALE"]
    if (["she", "her"].includes(token)) return explicitProfilePronouns ? ["SUBSCRIBER", "FEMALE"] : ["THIRD_PARTY"]
    if (["he", "him"].includes(token)) return explicitProfilePronouns ? ["SUBSCRIBER", "MALE"] : ["THIRD_PARTY"]
    if (SUPPORT_STOP_WORDS.has(token)) return []
    return [stemSupportToken(token)]
  })
  if (!tokens.includes("SUBSCRIBER") && !tokens.includes("CREATOR")) tokens.unshift("SUBSCRIBER")
  return { tokens, negative: tokens.some((token) => NEGATION.has(token)) }
}

function orderedSubsequence(needle: string[], haystack: string[]) {
  let index = 0
  for (const token of haystack) if (token === needle[index]) index++
  return index === needle.length
}

/** Fail closed unless one unit preserves the claim's roles, predicate order, and polarity. */
function authoritySupportsClaim(unit: CreatorReplyAuthorityUnit, claim: string) {
  const perspective: Perspective = ["current_inbound", "recent_subscriber", "continuity_subscriber"].includes(unit.kind)
    ? "subscriber_source"
    : "profile_source"
  const authority = canonicalFact(unit.text, perspective)
  const visible = canonicalFact(claim, "creator_claim")
  return visible.tokens.length > 1 && authority.negative === visible.negative && orderedSubsequence(visible.tokens, authority.tokens)
}

function rangeIsGrounded(start: number, end: number, grounded: GroundedRange[]) {
  return grounded.some((range) => start >= range.start && end <= range.end)
}

function predicateComplementIsGrounded(visible: string, end: number, grounded: GroundedRange[]) {
  const boundary = visible.slice(end).search(/[.!?;\n]|\b(?:and|but|while|although)\b/i)
  const clauseEnd = boundary < 0 ? visible.length : end + boundary
  return grounded.some((range) => range.start >= end && range.start < clauseEnd)
}

function looksConditionalPrefix(visible: string, start: number) {
  const prefix = visible.slice(Math.max(0, start - 40), start).toLowerCase()
  return /\b(?:if|when|once|unless|until|should|maybe|perhaps)\s*$/.test(prefix)
    || /\bi\s+(?:wonder|suspect)\s+(?:whether|if)\s*$/.test(prefix)
}

function looksSpeculativeContext(visible: string, start: number) {
  const prefix = visible.slice(Math.max(0, start - 80), start).toLowerCase()
  return /\b(?:maybe|perhaps|possibly|probably)\s*$/.test(prefix)
    || /\b(?:i\s+)?(?:wonder|suspect|guess|imagine)\s+(?:that\s+|whether\s+|if\s+)?$/.test(prefix)
}

function looksInterrogativeContext(visible: string, start: number, end: number) {
  const prefix = visible.slice(Math.max(0, start - 72), start).toLowerCase()
  if (/\b(?:do|does|did|can|could|would|will|won't|should|are|were|have|has|had)\s*$/.test(prefix)) return true
  if (/\b(?:tell|show|ask|say|explain)\s+(?:me\s+)?(?:what|whether|if|how)\s*$/.test(prefix)) return true
  if (/\b(?:tell|show|ask)\b[^.!?;\n]{0,48}\b(?:what|whether|if|how)\s*$/.test(prefix)) return true
  if (/\b(?:want|need|like)\s+to\s+(?:know|hear)\s+(?:what|whether|if|how)\s*$/.test(prefix)) return true

  const tail = visible.slice(end, Math.min(visible.length, end + 240))
  const punctuation = tail.match(/[.!?]/)
  return punctuation?.[0] === "?"
}

function firstUngroundedMatch(
  visible: string,
  pattern: RegExp,
  grounded: GroundedRange[],
  allowConditional = false,
  allowInterrogative = false,
  allowGroundedComplement = false,
) {
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(visible))) {
    if (allowConditional && looksConditionalPrefix(visible, match.index)) continue
    if (allowInterrogative && looksInterrogativeContext(visible, match.index, match.index + match[0].length)) continue
    if (allowConditional && looksSpeculativeContext(visible, match.index)) continue
    if (!rangeIsGrounded(match.index, match.index + match[0].length, grounded)
      && !(allowGroundedComplement && predicateComplementIsGrounded(visible, match.index + match[0].length, grounded))) return match[0]
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
  if (raw.version !== 5 || !exactKeys(raw, ["version", "claims"]) || !Array.isArray(raw.claims) || raw.claims.length > CREATOR_REPLY_MAX_CLAIMS) {
    return { ok: false as const, code: "MALFORMED_METADATA" as CreatorReplyViolation }
  }

  const authorityUnits = buildCreatorReplyAuthorityUnits(authoritativeSources)
  const authorityById = new Map(authorityUnits.map((unit) => [unit.id, unit]))
  if (authorityById.size !== authorityUnits.length) return { ok: false as const, code: "MALFORMED_METADATA" as CreatorReplyViolation }

  const claims: CreatorReplyClaim[] = []
  const seenClaims = new Set<string>()
  for (const item of raw.claims) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false as const, code: "INVALID_CLAIM" as CreatorReplyViolation }
    const claimRaw = item as Record<string, unknown>
    if (!exactKeys(claimRaw, ["claim", "authority_id"])) return { ok: false as const, code: "INVALID_CLAIM" as CreatorReplyViolation }
    const claim = typeof claimRaw.claim === "string" ? claimRaw.claim.trim() : ""
    const authorityId = typeof claimRaw.authority_id === "string" ? claimRaw.authority_id.trim() : ""
    if (!claim || !authorityId || claim.length > CREATOR_REPLY_MAX_CLAIM_CHARS || CONTROL.test(claim) || CONTROL.test(authorityId)) {
      return { ok: false as const, code: "INVALID_CLAIM" as CreatorReplyViolation }
    }
    if (!claimRanges(text, claim).length) return { ok: false as const, code: "CLAIM_NOT_VISIBLE" as CreatorReplyViolation }
    const authority = authorityById.get(authorityId)
    if (!authority) return { ok: false as const, code: "UNKNOWN_SOURCE" as CreatorReplyViolation }
    if (!authoritySupportsClaim(authority, claim)) return { ok: false as const, code: "UNGROUNDED_EVIDENCE" as CreatorReplyViolation }
    const identity = `${claim}\u0000${authorityId}`
    if (seenClaims.has(identity)) return { ok: false as const, code: "INVALID_CLAIM" as CreatorReplyViolation }
    seenClaims.add(identity)
    claims.push({ claim, authority_id: authorityId })
  }

  const grounded = collectGroundedRanges(text, claims)
  if (
    firstUngroundedMatch(text, SUBSCRIBER_ACTION_OR_STATE, grounded, true, true) ||
    firstUngroundedMatch(text, SUBSCRIBER_PROGRESSIVE_STATE, grounded, true, true) ||
    firstUngroundedMatch(text, SUBSCRIBER_MOTIVE_OR_INTENT, grounded, true, true) ||
    firstUngroundedMatch(text, SUBSCRIBER_GENERAL_FACT, grounded, true, true) ||
    firstUngroundedMatch(text, SUBSCRIBER_GENDERED_IDENTITY, grounded, true, true) ||
    firstUngroundedMatch(text, SUBSCRIBER_POSSESSIVE_STATE, grounded, false, true) ||
    firstUngroundedMatch(text, THIRD_PERSON_SUBSCRIBER, grounded) ||
    firstUngroundedMatch(text, SECOND_PERSON_DECLARATIVE, grounded, true, true, true) ||
    firstUngroundedMatch(text, EMBEDDED_SUBSCRIBER_INFERENCE, grounded, true, true, true) ||
    firstUngroundedMatch(text, LOOK_WHO_ASSERTION, grounded) ||
    firstUngroundedMatch(text, ANAPHORIC_SUBSCRIBER_STATE, grounded, true, true)
  ) {
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
