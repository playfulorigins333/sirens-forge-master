import { getSupabaseAdmin } from "../../supabaseAdmin"
import { getCreatorPublishingPlatformPolicy } from "../policies"
import { assertTrustedCreatorPublishingReviewer } from "./authorize"
import { resolveCreatorPublishingReviewTransition } from "./transitions"
import { CreatorPublishingReviewError, type CreatorPublishingPackageForReview, type CreatorPublishingReviewerAuthorization, type CreatorPublishingTrustedReviewInput, type CreatorPublishingTrustedReviewResult } from "./types"

type DbResult<T = unknown> = Promise<{ data: T | null; error: Error | null }>
type Query = { select: (c?: string) => Query; eq: (c: string, v: unknown) => Query; single: () => DbResult; maybeSingle?: () => DbResult; insert: (p: unknown) => Query; update: (p: unknown) => Query; limit?: (n: number) => Query; order?: (c: string, o?: unknown) => Query }
export type CreatorPublishingReviewDb = { from: (table: string) => Query; rpc?: (fn: string, args: Record<string, unknown>) => DbResult }
async function must<T = unknown>(result: unknown) { const r = await (result as PromiseLike<{ data: T | null; error: Error | null }>); if (r.error) throw r.error; return r.data }
function nonblank(value: string | null | undefined) { return typeof value === "string" && value.trim().length > 0 }

export function validateCreatorPublishingPackageForTrustedReview(pkg: CreatorPublishingPackageForReview | null | undefined, input: CreatorPublishingTrustedReviewInput) {
  if (!pkg) throw new CreatorPublishingReviewError("REVIEW_PACKAGE_NOT_FOUND", "Content package was not found.")
  if (pkg.target_platform === "fanvue") throw new CreatorPublishingReviewError("REVIEW_FANVUE_NOT_SUPPORTED", "Fanvue is not routed through manual review.")
  const policy = getCreatorPublishingPlatformPolicy(pkg.target_platform)
  if (policy.mode !== "manual_handoff") throw new CreatorPublishingReviewError("REVIEW_INVALID_CURRENT_STATUS", "Package platform is not a manual-handoff platform.")
  if (pkg.compliance_status !== "manual_review" || input.expected_current_status !== "manual_review") {
    if (pkg.compliance_status === "blocked") throw new CreatorPublishingReviewError("REVIEW_BLOCKED_NOT_ESCALATABLE", "Blocked content cannot be escalated.")
    throw new CreatorPublishingReviewError("REVIEW_INVALID_CURRENT_STATUS", "Only manual_review packages can be reviewed.")
  }
  if (!nonblank(pkg.compliance_policy_version) || pkg.compliance_policy_version === "unassigned") throw new CreatorPublishingReviewError("REVIEW_POLICY_VERSION_UNASSIGNED", "Package has no assigned compliance policy version.")
  if (input.expected_policy_version !== pkg.compliance_policy_version) throw new CreatorPublishingReviewError("REVIEW_STALE_POLICY_VERSION", "Package policy version is stale.")
  return pkg
}

export async function performTrustedCreatorPublishingReview(input: CreatorPublishingTrustedReviewInput, deps: { supabaseAdmin?: CreatorPublishingReviewDb; reviewerAuthorization?: CreatorPublishingReviewerAuthorization; now?: () => string } = {}): Promise<CreatorPublishingTrustedReviewResult> {
  const db = deps.supabaseAdmin ?? getSupabaseAdmin() as unknown as CreatorPublishingReviewDb
  const reviewedAt = deps.now?.() ?? input.reviewed_at ?? new Date().toISOString()
  const transition = resolveCreatorPublishingReviewTransition(input.decision)
  if (!nonblank(input.reason)) throw new CreatorPublishingReviewError("REVIEW_REASON_REQUIRED", "A nonblank review reason is required.")
  if (!input.reviewer_id) throw new CreatorPublishingReviewError("REVIEW_UNAUTHORIZED", "Reviewer identity is required.")
  const pkg = validateCreatorPublishingPackageForTrustedReview(await must<CreatorPublishingPackageForReview>(db.from("creator_publishing_content_packages").select("id,creator_id,target_platform,compliance_status,compliance_policy_version,forced_disclosure_text,creator_approval_status,creator_approved_at,creator_approved_by,updated_at").eq("id", input.content_package_id).single()), input)
  assertTrustedCreatorPublishingReviewer(deps.reviewerAuthorization, pkg)
  if (db.rpc) {
    const rpcResult = await must<CreatorPublishingTrustedReviewResult>(db.rpc("creator_publishing_apply_manual_review_decision", {
      p_content_package_id: input.content_package_id, p_reviewer_id: input.reviewer_id, p_decision: input.decision, p_reason: input.reason,
      p_reviewer_notes: input.reviewer_notes ?? null, p_expected_current_status: input.expected_current_status, p_expected_policy_version: input.expected_policy_version,
      p_reviewed_at: reviewedAt, p_rule_hits: input.confirmed_rule_hits ?? [], p_review_metadata: { reviewer_evidence: input.reviewer_evidence ?? null, rule_hit_references: input.rule_hit_references ?? [] }, p_idempotency_key: input.idempotency_key ?? null,
    }))
    return rpcResult
  }
  if (input.idempotency_key) {
    const existing = await must<any>(db.from("creator_publishing_audit_events").select("id").eq("entity_id", input.content_package_id).eq("action", transition.action).eq("idempotency_key", input.idempotency_key).maybeSingle?.() ?? Promise.resolve({ data: null, error: null }))
    if (existing) throw new CreatorPublishingReviewError("REVIEW_DUPLICATE", "This review submission was already processed.")
  }
  const before = { compliance_status: pkg.compliance_status, compliance_policy_version: pkg.compliance_policy_version, forced_disclosure_text: pkg.forced_disclosure_text, creator_approval_status: pkg.creator_approval_status }
  const reviewPayload = { content_package_id: input.content_package_id, reviewer_id: input.reviewer_id, outcome: transition.review_outcome, review_source: "human", notes: [input.reason.trim(), input.reviewer_notes?.trim()].filter(Boolean).join("\n\n") || null, escalated_approval_reason: input.decision === "approve_escalation" ? input.reason.trim() : null, rule_hits: input.confirmed_rule_hits ?? [], review_metadata: { decision: input.decision, reviewer_evidence: input.reviewer_evidence ?? null, rule_hit_references: input.rule_hit_references ?? [], idempotency_key: input.idempotency_key ?? null }, created_at: reviewedAt }
  const review = await must<any>(db.from("creator_publishing_compliance_reviews").insert(reviewPayload).select("id").single())
  const updatePayload = transition.reset_for_reevaluation ? { compliance_status: "pending", compliance_policy_version: "unassigned", forced_disclosure_text: null, creator_approval_status: "pending", creator_approved_by: null, creator_approved_at: null } : { compliance_status: transition.to }
  const updated = await must<any>(db.from("creator_publishing_content_packages").update(updatePayload).eq("id", input.content_package_id).eq("compliance_status", "manual_review").eq("compliance_policy_version", pkg.compliance_policy_version).select("id").single())
  if (!updated) throw new CreatorPublishingReviewError("REVIEW_CONFLICT", "Package changed before the review could be saved.")
  const after = { ...before, ...updatePayload, decision: input.decision, policy_version: pkg.compliance_policy_version, reviewer_id: input.reviewer_id, review_record_id: review?.id ?? null, rule_hits: input.confirmed_rule_hits ?? [], idempotency_key: input.idempotency_key ?? null, timestamp: reviewedAt }
  const audit = await must<any>(db.from("creator_publishing_audit_events").insert({ entity_type: "creator_publishing_content_package", entity_id: input.content_package_id, actor_id: input.reviewer_id, actor_role: deps.reviewerAuthorization?.role ?? "reviewer", action: transition.action, before_state: before, after_state: after, idempotency_key: input.idempotency_key ?? null, created_at: reviewedAt }).select("id").single())
  return { content_package_id: input.content_package_id, creator_id: pkg.creator_id, reviewer_id: input.reviewer_id, decision: input.decision, prior_compliance_status: "manual_review", resulting_compliance_status: transition.to, policy_version: pkg.compliance_policy_version, review_record_id: review?.id ?? null, audit_event_ids: audit?.id == null ? [] : [audit.id], creator_approval_allowed: transition.creator_approval_allowed, queue_creation_allowed: false, reviewed_at: reviewedAt }
}
