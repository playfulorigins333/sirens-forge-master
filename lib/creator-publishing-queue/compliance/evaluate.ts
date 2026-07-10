import { getCreatorPublishingPlatformPolicy } from "../policies"
import { evaluateAiAndProvenanceRules, isAiFlagged } from "./aiRules"
import { evaluateTextRules } from "./textRules"
import type { ComplianceEvaluation, ComplianceInput, ComplianceRuleHit } from "./types"

const DEFAULT_EVALUATED_AT = "1970-01-01T00:00:00.000Z"

export function normalizeOnlyFansDisclosure(caption: string, ai: boolean, signifiers: readonly string[] = ["#ai", "#AIGenerated"], defaultDisclosure = "#ai") {
  const trimmed = caption.trim()
  if (!ai) return { forced_disclosure_text: null, normalized_caption: caption }
  const orderedSignifiers = [...signifiers].sort((a, b) => b.length - a.length)
  const token = String.raw`(?:${orderedSignifiers.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`
  const leading = new RegExp(`^(?:${token})(?:\\s+${token})*\\s*`, "i")
  if (leading.test(trimmed)) {
    const first = trimmed.match(new RegExp(`^${token}`, "i"))?.[0] ?? defaultDisclosure
    const rest = trimmed.replace(leading, "").trimStart()
    return { forced_disclosure_text: first, normalized_caption: rest ? `${first} ${rest}` : first }
  }
  const anywhere = new RegExp(`(?:^|\\s)${token}(?=\\s|$)`, "ig")
  const without = trimmed.replace(anywhere, " ").replace(/\s+/g, " ").trim()
  return { forced_disclosure_text: defaultDisclosure, normalized_caption: without ? `${defaultDisclosure} ${without}` : defaultDisclosure }
}

function resolveOutcome(hits: readonly ComplianceRuleHit[]) {
  if (hits.some((h) => h.severity === "block")) return "blocked" as const
  if (hits.some((h) => h.severity === "review")) return "manual_review" as const
  return "passed" as const
}

export function evaluateCreatorPublishingCompliance(input: ComplianceInput): ComplianceEvaluation {
  const policy = input.policy ?? getCreatorPublishingPlatformPolicy(input.target_platform)
  if (input.target_platform === "fanvue") throw new Error("Fanvue is not routed through Creator Publishing Queue compliance.")
  if (input.policy_version && input.policy_version !== policy.policy_version) throw new Error(`Selected policy version ${input.policy_version} does not match registry version ${policy.policy_version}`)
  const disclosure = input.target_platform === "onlyfans"
    ? normalizeOnlyFansDisclosure(input.caption_body, isAiFlagged(input), policy.disclosure_policy.allowed_signifiers, policy.disclosure_policy.default_disclosure ?? "#ai")
    : { forced_disclosure_text: null, normalized_caption: input.caption_body }
  const hits = [...evaluateAiAndProvenanceRules({ ...input, policy }), ...evaluateTextRules(input)]
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id))
  const outcome = resolveOutcome(hits)
  return Object.freeze({
    outcome,
    hard_block: outcome === "blocked",
    platform: input.target_platform,
    policy_version: policy.policy_version,
    rule_hits: Object.freeze(hits),
    reasons: Object.freeze(hits.filter((h) => h.severity !== "allow").map((h) => h.message)),
    review_requirements: Object.freeze(hits.filter((h) => h.severity === "review").map((h) => h.message)),
    forced_disclosure_text: disclosure.forced_disclosure_text,
    normalized_caption: disclosure.normalized_caption,
    creator_approval_allowed: outcome === "passed",
    escalated_approval_allowed: outcome === "manual_review",
    evaluated_at: input.evaluated_at ?? DEFAULT_EVALUATED_AT,
    metadata: Object.freeze({ evaluator: "creator_publishing_queue_compliance_v1" as const, policy_mode: policy.mode, queue_enabled: policy.enabled_for_queue }),
  })
}
