import { getSupabaseAdmin } from "../../supabaseAdmin"
import { getCreatorPublishingPlatformPolicy } from "../policies"
import { assertCreatorPublishingApprovalAuthorized } from "./authorize"
import { buildCreatorPublishingApprovalSnapshot, hashCreatorPublishingMediaManifest } from "./snapshot"
import { CreatorPublishingApprovalError, type CreatorPublishingApprovalInput, type CreatorPublishingApprovalResult, type CreatorPublishingCreatorAuthorization, type CreatorPublishingMediaAssetForApproval, type CreatorPublishingPackageForApproval } from "./types"

type DbResult<T = unknown> = Promise<{ data: T | null; error: Error | null }>
type Query = { select: (c?: string) => Query; eq: (c: string, v: unknown) => Query; neq?: (c: string, v: unknown) => Query; single: () => DbResult; maybeSingle?: () => DbResult; insert: (p: unknown) => Query; update: (p: unknown) => Query; order?: (c: string, o?: unknown) => Query; limit?: (n: number) => Query }
export type CreatorPublishingApprovalDb = { from: (table: string) => Query; rpc?: (fn: string, args: Record<string, unknown>) => DbResult }
async function must<T = unknown>(result: unknown) { const r = await (result as PromiseLike<{ data: T | null; error: Error | null }>); if (r.error) throw r.error; return r.data }
const okStatuses = new Set(["passed", "escalated_approved"])
function nonblank(value: string | null | undefined) { return typeof value === "string" && value.trim().length > 0 }
export type CreatorPublishingApprovalReviewEvidence = Readonly<{ outcome: string; review_source?: string | null; escalated_approval_reason?: string | null; created_at?: string | null }>

export function selectCurrentCreatorApprovalComplianceEvidence(pkg: CreatorPublishingPackageForApproval, reviews: readonly CreatorPublishingApprovalReviewEvidence[] = []) {
  const sorted = [...reviews].filter((review) => review.created_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const qualifies = (review: CreatorPublishingApprovalReviewEvidence) => pkg.compliance_status === "passed"
    ? review.review_source === "automated" && review.outcome === "pass"
    : review.review_source === "human" && review.outcome === "escalate" && nonblank(review.escalated_approval_reason)
  const evidence = sorted.find(qualifies)
  if (!evidence) return { evidence: null, laterBlockingReview: null }
  const laterBlockingReview = sorted.find((review) => String(review.created_at) > String(evidence.created_at) && ["block", "manual_review"].includes(review.outcome)) ?? null
  return { evidence, laterBlockingReview }
}

export function validateCreatorPublishingPackageForCreatorApproval(pkg: CreatorPublishingPackageForApproval | null | undefined, input: CreatorPublishingApprovalInput, mediaAssets: readonly CreatorPublishingMediaAssetForApproval[], currentEvidence?: CreatorPublishingApprovalReviewEvidence | null, blockingReview?: unknown | null, existingTask?: unknown | null) {
  if (!pkg) throw new CreatorPublishingApprovalError("APPROVAL_PACKAGE_NOT_FOUND", "Content package was not found.")
  assertCreatorPublishingApprovalAuthorized(input, { user_id: input.creator_id }, pkg)
  if (!(["approve", "reject"] as const).includes(input.decision)) throw new CreatorPublishingApprovalError("APPROVAL_INVALID_DECISION", "Invalid creator approval decision.")
  if (pkg.target_platform === "fanvue") throw new CreatorPublishingApprovalError("APPROVAL_FANVUE_NOT_SUPPORTED", "Fanvue is not supported by creator approval queue workflow.")
  const policy = getCreatorPublishingPlatformPolicy(pkg.target_platform)
  if (policy.mode !== "manual_handoff") throw new CreatorPublishingApprovalError("APPROVAL_INVALID_COMPLIANCE_STATUS", "Only manual handoff platforms can be approved.")
  if (pkg.creator_approval_status !== "pending") throw new CreatorPublishingApprovalError("APPROVAL_ALREADY_DECIDED", "Creator approval has already been decided.")
  if (!okStatuses.has(pkg.compliance_status) || input.expected_compliance_status !== pkg.compliance_status) throw new CreatorPublishingApprovalError("APPROVAL_INVALID_COMPLIANCE_STATUS", "Package compliance status is not approvable.")
  if (!nonblank(pkg.compliance_policy_version) || pkg.compliance_policy_version === "unassigned" || input.expected_policy_version !== pkg.compliance_policy_version) throw new CreatorPublishingApprovalError("APPROVAL_STALE_POLICY_VERSION", "Package policy version is stale or unassigned.")
  if (input.expected_package_updated_at !== pkg.updated_at) throw new CreatorPublishingApprovalError("APPROVAL_STALE_PACKAGE", "Package has changed since approval payload was loaded.")
  if (!currentEvidence) throw new CreatorPublishingApprovalError("APPROVAL_CURRENT_COMPLIANCE_EVIDENCE_REQUIRED", "Current pass/escalation evidence is required.")
  if (blockingReview) throw new CreatorPublishingApprovalError("APPROVAL_BLOCKING_REVIEW_EXISTS", "A later blocking or unresolved review prevents approval.")
  if (input.decision === "reject") { if (!nonblank(input.rejection_reason)) throw new CreatorPublishingApprovalError("APPROVAL_REJECTION_REASON_REQUIRED", "Reject requires a nonblank reason."); return pkg }
  if (existingTask) throw new CreatorPublishingApprovalError("APPROVAL_DUPLICATE", "A queue task already exists for this package platform.")
  if (!nonblank(pkg.caption_body)) throw new CreatorPublishingApprovalError("APPROVAL_FINAL_CAPTION_MISSING", "Final caption is required.")
  if (policy.disclosure_policy.copy_caption_must_include_disclosure && !nonblank(pkg.forced_disclosure_text)) throw new CreatorPublishingApprovalError("APPROVAL_DISCLOSURE_MISSING", "Required forced disclosure is missing.")
  if (policy.capabilities.image_posts || policy.capabilities.video_posts) { if (mediaAssets.length === 0) throw new CreatorPublishingApprovalError("APPROVAL_MEDIA_MISSING", "At least one owned media asset is required.") }
  return pkg
}

export async function performCreatorPublishingCreatorApproval(input: CreatorPublishingApprovalInput, deps: { supabaseAdmin?: CreatorPublishingApprovalDb; authorization?: CreatorPublishingCreatorAuthorization } = {}): Promise<CreatorPublishingApprovalResult> {
  const db = deps.supabaseAdmin ?? getSupabaseAdmin() as unknown as CreatorPublishingApprovalDb
  assertCreatorPublishingApprovalAuthorized(input, deps.authorization)
  if (!input.idempotency_key?.trim()) throw new CreatorPublishingApprovalError("APPROVAL_DUPLICATE", "Idempotency key is required.")
  if (!(["approve", "reject"] as const).includes(input.decision)) throw new CreatorPublishingApprovalError("APPROVAL_INVALID_DECISION", "Invalid decision.")
  const pkg = await must<CreatorPublishingPackageForApproval>(db.from("creator_publishing_content_packages").select("id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,second_person_present,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_at,creator_approved_by,scheduled_for,created_at,updated_at").eq("id", input.content_package_id).single())
  assertCreatorPublishingApprovalAuthorized(input, deps.authorization, pkg)
  const media = await must<CreatorPublishingMediaAssetForApproval[]>(db.from("creator_publishing_media_assets").select("id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at").eq("content_package_id", input.content_package_id)) ?? []
  const reviews = await must<CreatorPublishingApprovalReviewEvidence[]>(db.from("creator_publishing_compliance_reviews").select("outcome,review_source,escalated_approval_reason,created_at").eq("content_package_id", input.content_package_id).order?.("created_at", { ascending: false }) ?? Promise.resolve({ data: [], error: null })) ?? []
  const { evidence, laterBlockingReview } = selectCurrentCreatorApprovalComplianceEvidence(pkg, reviews)
  let taskQuery = db.from("creator_publishing_queue_tasks").select("id,status,target_platform").eq("content_package_id", input.content_package_id).eq("target_platform", pkg.target_platform)
  taskQuery = taskQuery.neq ? taskQuery.neq("status", "archived") : taskQuery
  const existingTask = await must<any>(taskQuery.maybeSingle?.() ?? Promise.resolve({ data: null, error: null }))
  const mediaManifestHash = hashCreatorPublishingMediaManifest(media)
  if (input.media_manifest_hash && input.media_manifest_hash !== mediaManifestHash) throw new CreatorPublishingApprovalError("APPROVAL_STALE_PACKAGE", "Approval media manifest hash is stale.")
  validateCreatorPublishingPackageForCreatorApproval(pkg, input, media, evidence, laterBlockingReview, existingTask)
  const { hash } = buildCreatorPublishingApprovalSnapshot(pkg, media, evidence ?? null)
  if (input.approval_snapshot_hash && input.approval_snapshot_hash !== hash) throw new CreatorPublishingApprovalError("APPROVAL_STALE_PACKAGE", "Approval snapshot hash is stale.")
  if (!db.rpc) throw new CreatorPublishingApprovalError("APPROVAL_UNAUTHORIZED", "Approval requires the trusted service RPC.")
  return await must<CreatorPublishingApprovalResult>(db.rpc("creator_publishing_apply_creator_approval_decision", {
    p_content_package_id: input.content_package_id, p_creator_id: input.creator_id, p_decision: input.decision, p_expected_compliance_status: input.expected_compliance_status,
    p_expected_policy_version: input.expected_policy_version, p_expected_package_updated_at: input.expected_package_updated_at, p_snapshot_hash: hash, p_media_manifest_hash: mediaManifestHash,
    p_client_snapshot_hash: input.approval_snapshot_hash ?? null, p_idempotency_key: input.idempotency_key, p_rejection_reason: input.rejection_reason ?? null, p_creator_notes: input.creator_notes ?? null,
  }))
}
