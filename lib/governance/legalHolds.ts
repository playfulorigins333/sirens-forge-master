import { createHash } from "node:crypto"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export const LEGAL_HOLD_POLICY_VERSION = "legal-hold-v1"
export const LEGAL_HOLD_IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export type LegalHoldTargetInput = {
  target_type: string
  target_id: string
  subject_user_id: string
  preservation_scope: string
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message
  }
  return ""
}

function safeRpcCode(error: unknown, fallback: string) {
  const message = errorMessage(error)
  const allowed = [
    "GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED",
    "GOVERNANCE_LEGAL_HOLD_FRESH_AUTH_REQUIRED",
    "GOVERNANCE_LEGAL_HOLD_INVALID",
    "GOVERNANCE_LEGAL_HOLD_TARGET_INVALID",
    "GOVERNANCE_LEGAL_HOLD_ACCOUNT_TARGET_INVALID",
    "GOVERNANCE_LEGAL_HOLD_IDEMPOTENCY_CONFLICT",
    "GOVERNANCE_LEGAL_HOLD_NOT_FOUND",
    "GOVERNANCE_LEGAL_HOLD_NOT_ACTIVE",
    "GOVERNANCE_LEGAL_HOLD_EXPIRED",
    "GOVERNANCE_LEGAL_HOLD_REVIEW_CANNOT_SHORTEN",
    "GOVERNANCE_LEGAL_HOLD_STATUS_FILTER_INVALID",
    "GOVERNANCE_LEGAL_HOLD_LIST_LIMIT_INVALID",
  ]
  return allowed.find((code) => message.includes(code)) ?? fallback
}

function deterministicCorrelationId(scope: string, actorUserId: string, idempotencyKey: string) {
  const hex = createHash("sha256").update(`${scope}|${actorUserId}|${idempotencyKey}`).digest("hex").slice(0, 32).split("")
  hex[12] = "4"
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  const value = hex.join("")
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function validDate(value: string) {
  return value.length > 0 && Number.isFinite(new Date(value).getTime())
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validText(value: string, min: number, max: number) {
  return value.length >= min && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)
}

export function validateIdempotencyKey(value: string | null) {
  return typeof value === "string" && LEGAL_HOLD_IDEMPOTENCY_PATTERN.test(value)
}

export function validateOpenLegalHoldInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const allowed = new Set(["category", "reason", "case_reference", "review_due_at", "expires_at", "policy_version", "targets"])
  if (Object.keys(input).some((key) => !allowed.has(key))) return null
  const category = typeof input.category === "string" ? input.category.trim() : ""
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  const caseReference = input.case_reference === null || input.case_reference === undefined ? null : typeof input.case_reference === "string" ? input.case_reference.trim() : ""
  const reviewDueAt = typeof input.review_due_at === "string" ? input.review_due_at : ""
  const expiresAt = typeof input.expires_at === "string" ? input.expires_at : ""
  const policyVersion = typeof input.policy_version === "string" ? input.policy_version.trim() : LEGAL_HOLD_POLICY_VERSION
  if (!validText(category, 3, 80) || !validText(reason, 3, 1000)) return null
  if (caseReference !== null && !validText(caseReference, 1, 200)) return null
  if (!validDate(reviewDueAt) || !validDate(expiresAt) || new Date(expiresAt).getTime() < new Date(reviewDueAt).getTime()) return null
  if (!validText(policyVersion, 3, 120) || !Array.isArray(input.targets) || input.targets.length < 1 || input.targets.length > 100) return null
  const targets: LegalHoldTargetInput[] = []
  for (const raw of input.targets) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
    const target = raw as Record<string, unknown>
    if (Object.keys(target).some((key) => !["target_type", "target_id", "subject_user_id", "preservation_scope"].includes(key))) return null
    const targetType = typeof target.target_type === "string" ? target.target_type.trim() : ""
    const targetId = typeof target.target_id === "string" ? target.target_id.trim() : ""
    const subjectUserId = typeof target.subject_user_id === "string" ? target.subject_user_id.trim() : ""
    const preservationScope = typeof target.preservation_scope === "string" ? target.preservation_scope.trim() : ""
    if (!/^[a-z0-9][a-z0-9_]{2,79}$/.test(targetType) || !validText(targetId, 1, 200) || !validUuid(subjectUserId) || !validText(preservationScope, 3, 200)) return null
    if (targetType === "account" && targetId !== subjectUserId) return null
    targets.push({ target_type: targetType, target_id: targetId, subject_user_id: subjectUserId, preservation_scope: preservationScope })
  }
  return { category, reason, caseReference, reviewDueAt, expiresAt, policyVersion, targets }
}

export function validateReviewLegalHoldInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const allowed = new Set(["review_reason", "next_review_due_at", "new_expires_at", "policy_version"])
  if (Object.keys(input).some((key) => !allowed.has(key))) return null
  const reviewReason = typeof input.review_reason === "string" ? input.review_reason.trim() : ""
  const nextReviewDueAt = typeof input.next_review_due_at === "string" ? input.next_review_due_at : ""
  const newExpiresAt = typeof input.new_expires_at === "string" ? input.new_expires_at : ""
  const policyVersion = typeof input.policy_version === "string" ? input.policy_version.trim() : LEGAL_HOLD_POLICY_VERSION
  if (!validText(reviewReason, 3, 1000) || !validDate(nextReviewDueAt) || !validDate(newExpiresAt)) return null
  if (new Date(newExpiresAt).getTime() < new Date(nextReviewDueAt).getTime() || !validText(policyVersion, 3, 120)) return null
  return { reviewReason, nextReviewDueAt, newExpiresAt, policyVersion }
}

export function validateReleaseLegalHoldInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => key !== "release_reason")) return null
  const releaseReason = typeof input.release_reason === "string" ? input.release_reason.trim() : ""
  return validText(releaseReason, 3, 1000) ? { releaseReason } : null
}

export async function openLegalHold(args: {
  actorUserId: string
  freshTotpAt: string
  idempotencyKey: string
  input: NonNullable<ReturnType<typeof validateOpenLegalHoldInput>>
}) {
  const correlationId = deterministicCorrelationId("legal-hold-open", args.actorUserId, args.idempotencyKey)
  const { data, error } = await getSupabaseAdmin().rpc("open_governance_legal_hold", {
    p_actor_user_id: args.actorUserId,
    p_category: args.input.category,
    p_reason: args.input.reason,
    p_case_reference: args.input.caseReference,
    p_review_due_at: args.input.reviewDueAt,
    p_expires_at: args.input.expiresAt,
    p_fresh_auth_at: args.freshTotpAt,
    p_fresh_auth_method: "totp",
    p_policy_version: args.input.policyVersion,
    p_targets: args.input.targets,
    p_correlation_id: correlationId,
    p_idempotency_key: args.idempotencyKey,
  })
  if (error) return { ok: false as const, code: safeRpcCode(error, "LEGAL_HOLD_OPEN_FAILED") }
  return { ok: true as const, holdId: String(data), correlationId }
}

export async function reviewLegalHold(args: {
  holdId: string
  actorUserId: string
  freshTotpAt: string
  idempotencyKey: string
  input: NonNullable<ReturnType<typeof validateReviewLegalHoldInput>>
}) {
  const correlationId = deterministicCorrelationId(`legal-hold-review:${args.holdId}`, args.actorUserId, args.idempotencyKey)
  const { data, error } = await getSupabaseAdmin().rpc("review_governance_legal_hold", {
    p_hold_id: args.holdId,
    p_actor_user_id: args.actorUserId,
    p_review_reason: args.input.reviewReason,
    p_next_review_due_at: args.input.nextReviewDueAt,
    p_new_expires_at: args.input.newExpiresAt,
    p_fresh_auth_at: args.freshTotpAt,
    p_fresh_auth_method: "totp",
    p_policy_version: args.input.policyVersion,
    p_correlation_id: correlationId,
    p_idempotency_key: args.idempotencyKey,
  })
  if (error) return { ok: false as const, code: safeRpcCode(error, "LEGAL_HOLD_REVIEW_FAILED") }
  return { ok: true as const, reviewId: String(data), correlationId }
}

export async function releaseLegalHold(args: {
  holdId: string
  actorUserId: string
  freshTotpAt: string
  idempotencyKey: string
  input: NonNullable<ReturnType<typeof validateReleaseLegalHoldInput>>
}) {
  const correlationId = deterministicCorrelationId(`legal-hold-release:${args.holdId}`, args.actorUserId, args.idempotencyKey)
  const { data, error } = await getSupabaseAdmin().rpc("release_governance_legal_hold", {
    p_hold_id: args.holdId,
    p_actor_user_id: args.actorUserId,
    p_release_reason: args.input.releaseReason,
    p_fresh_auth_at: args.freshTotpAt,
    p_fresh_auth_method: "totp",
    p_correlation_id: correlationId,
    p_idempotency_key: args.idempotencyKey,
  })
  if (error) return { ok: false as const, code: safeRpcCode(error, "LEGAL_HOLD_RELEASE_FAILED") }
  return { ok: true as const, holdId: String(data), correlationId }
}

export async function listLegalHolds(args: {
  actorUserId: string
  freshTotpAt: string
  status: "active" | "released" | "expired" | null
  limit: number
}) {
  const { data, error } = await getSupabaseAdmin().rpc("list_governance_legal_holds_for_admin", {
    p_actor_user_id: args.actorUserId,
    p_fresh_auth_at: args.freshTotpAt,
    p_fresh_auth_method: "totp",
    p_status: args.status,
    p_limit: args.limit,
  })
  if (error) return { ok: false as const, code: safeRpcCode(error, "LEGAL_HOLD_LIST_FAILED") }
  return { ok: true as const, data }
}

export async function expireLegalHolds(limit = 50) {
  const { data, error } = await getSupabaseAdmin().rpc("phase8f_expire_governance_legal_holds", { p_limit: limit })
  if (error) return { ok: false as const, code: "LEGAL_HOLD_EXPIRY_FAILED", expired: 0 }
  return { ok: true as const, expired: Array.isArray(data) ? data.length : 0 }
}
