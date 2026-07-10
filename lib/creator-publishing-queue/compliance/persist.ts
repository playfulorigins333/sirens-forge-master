import { getSupabaseAdmin } from "../../supabaseAdmin"
import { evaluateCreatorPublishingCompliance } from "./evaluate"
import type { ComplianceEvaluation, ComplianceInput, ComplianceOutcome } from "./types"

type DbResult<T = unknown> = Promise<{ data: T | null; error: Error | null }>
type Query = { select: (c?: string) => Query; eq: (c: string, v: unknown) => Query; single: () => DbResult; insert: (p: unknown) => Query; update: (p: unknown) => Query }
export type CompliancePersistenceDb = { from: (table: string) => Query }

const reviewOutcome: Record<ComplianceOutcome, "pass" | "block" | "escalate"> = { passed: "pass", blocked: "block", manual_review: "escalate" }

async function must<T = unknown>(result: unknown) {
  const resolved = await (result as PromiseLike<{ data: T | null; error: Error | null }>)
  if (resolved.error) throw resolved.error
  return resolved.data
}

export async function evaluateAndPersistCreatorPublishingCompliance(input: ComplianceInput, deps: { supabaseAdmin?: CompliancePersistenceDb; actorId?: string | null; actorRole?: string; now?: () => string } = {}): Promise<ComplianceEvaluation> {
  const db = deps.supabaseAdmin ?? getSupabaseAdmin() as unknown as CompliancePersistenceDb
  const actorRole = deps.actorRole ?? "creator_publishing_compliance_service"
  const timestamp = deps.now?.() ?? input.evaluated_at ?? new Date().toISOString()
  const existing = await must<any>(db.from("creator_publishing_content_packages").select("id,compliance_status,compliance_policy_version,forced_disclosure_text,creator_approval_status").eq("id", input.content_package_id).single())
  const before = { compliance_status: existing?.compliance_status ?? null, compliance_policy_version: existing?.compliance_policy_version ?? null, forced_disclosure_text: existing?.forced_disclosure_text ?? null, creator_approval_status: existing?.creator_approval_status ?? null }
  await must(db.from("creator_publishing_audit_events").insert({ entity_type: "creator_publishing_content_package", entity_id: input.content_package_id, actor_id: deps.actorId ?? null, actor_role: actorRole, action: "compliance_evaluation_started", before_state: before, after_state: { platform: input.target_platform, timestamp }, created_at: timestamp }))
  const evaluation = evaluateCreatorPublishingCompliance({ ...input, evaluated_at: timestamp })
  const resulting = { compliance_status: evaluation.outcome, compliance_policy_version: evaluation.policy_version, forced_disclosure_text: evaluation.forced_disclosure_text }
  await must(db.from("creator_publishing_compliance_reviews").insert({ content_package_id: input.content_package_id, reviewer_id: deps.actorId ?? null, outcome: reviewOutcome[evaluation.outcome], notes: evaluation.reasons.join("\n") || null, escalated_approval_reason: evaluation.outcome === "manual_review" ? "Deterministic compliance gate requires manual review before any trusted escalation." : null, rule_hits: evaluation.rule_hits, created_at: timestamp }))
  await must(db.from("creator_publishing_content_packages").update(resulting).eq("id", input.content_package_id))
  await must(db.from("creator_publishing_audit_events").insert({ entity_type: "creator_publishing_content_package", entity_id: input.content_package_id, actor_id: deps.actorId ?? null, actor_role: actorRole, action: "compliance_evaluation_completed", before_state: before, after_state: { ...resulting, platform: evaluation.platform, policy_version: evaluation.policy_version, outcome: evaluation.outcome, rule_hits: evaluation.rule_hits, timestamp }, created_at: timestamp }))
  return evaluation
}
