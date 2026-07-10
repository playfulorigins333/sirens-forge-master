import type { ComplianceInput, ComplianceRuleHit } from "./types"

const HARD: Array<[string, string, RegExp, string]> = [
  ["text-youth-coded", "underage/youth-coded", /\b(?:teen|young\s*girl|schoolgirl|barely\s*legal|jailbait|under\s*18|minor)\b/i, "Youth-coded or underage implication detected."],
  ["text-incest", "incest/family roleplay", /\b(?:incest|step\s*(?:dad|daddy|brother|sister|mom|mother)|father\s*daughter|family\s*role\s*play)\b/i, "Incest/family roleplay language detected."],
  ["text-non-consent", "non-consensual", /\b(?:rape|raped|non[-\s]?consensual|without\s+consent|forced\s+me|force\s+her|force\s+him)\b/i, "Explicit non-consent framing detected."],
  ["text-lack-capacity", "lack-of-capacity", /\b(?:passed\s*out|asleep|unconscious|blackout|too\s*drunk|drugged|hypnoti[sz]ed|intoxicated)\b/i, "Asleep/intoxicated/lack-of-capacity framing detected."],
  ["text-public-nudity", "prohibited public nudity", /\b(?:public\s+nudit|naked\s+in\s+public|public\s+sex|exposed\s+in\s+public)\b/i, "Clearly prohibited public nudity phrasing detected."],
  ["text-prohibited-drugs", "prohibited drugs", /\b(?:cocaine|heroin|meth|drug\s+deal|illegal\s+drugs)\b/i, "Prohibited drug activity phrasing detected."],
]

const REVIEW: Array<[string, string, RegExp, string]> = [
  ["text-cnc", "borderline consent language", /\b(?:cnc|consensual\s+non[-\s]?consent)\b/i, "CNC wording requires manual review."],
  ["text-degradation", "degradation", /\b(?:degrade|degradation|worthless|humiliat(?:e|ion))\b/i, "Degradation wording requires manual review."],
  ["text-breeding", "breeding", /\b(?:breed|breeding|bred)\b/i, "Breeding wording requires manual review."],
  ["text-daddy", "daddy", /\b(?:daddy)\b/i, "Daddy language requires manual review."],
  ["text-choking", "choking", /\b(?:chok(?:e|ing))\b/i, "Choking language requires manual review."],
  ["text-coercion", "ambiguous consent language", /\b(?:coerc(?:e|ion)|reluctant|made\s+to|pressured)\b/i, "Ambiguous consent/coercion language requires manual review."],
  ["text-weapons", "weapons", /\b(?:gun|knife|weapon|pistol|rifle)\b/i, "Weapon context requires manual review."],
  ["text-blood", "blood", /\b(?:blood|bloody|bleeding)\b/i, "Blood context requires manual review."],
]

function hit(rule_id: string, severity: "review" | "block", category: string, message: string, evidence: string): ComplianceRuleHit {
  return { rule_id, severity, category, message, source: "deterministic_text_first_pass", field: "title/caption_body", evidence, override_allowed: severity === "review" }
}

export function evaluateTextRules(input: ComplianceInput): readonly ComplianceRuleHit[] {
  const text = `${input.title}\n${input.caption_body}`.normalize("NFKC")
  const hits: ComplianceRuleHit[] = []
  for (const [id, category, pattern, message] of HARD) if (pattern.test(text)) hits.push(hit(id, "block", category, message, pattern.source))
  for (const [id, category, pattern, message] of REVIEW) if (pattern.test(text)) hits.push(hit(id, input.target_platform === "fansly" && (id === "text-blood" || id === "text-weapons") ? "block" : "review", category, message, pattern.source))
  const flags = { ...input.text_classifier_flags, ...input.category_flags }
  for (const [key, value] of Object.entries(flags)) if (value) {
    const block = ["youth_coded","underage_implication","incest_family_roleplay","non_consent","lack_of_capacity","prohibited_public_nudity","prohibited_drugs","harmful_illegal_activity"].includes(key) || (input.target_platform === "fansly" && ["blood","weapons"].includes(key))
    hits.push(hit(`flag-${key}`, block ? "block" : "review", key, `Precomputed content flag requires ${block ? "block" : "review"}: ${key}.`, key))
  }
  return hits
}
