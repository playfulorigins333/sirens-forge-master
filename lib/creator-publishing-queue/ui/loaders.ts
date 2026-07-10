import "server-only"
import { notFound, redirect } from "next/navigation"
import { randomUUID } from "node:crypto"
import { buildCreatorPublishingApprovalSnapshot, hashCreatorPublishingMediaManifest } from "../approval/snapshot"
import { selectCurrentCreatorApprovalComplianceEvidence } from "../approval/service"
import type { CreatorPublishingApprovalReviewEvidence } from "../approval/service"
import type { CreatorPublishingMediaAssetForApproval, CreatorPublishingPackageForApproval, CreatorPublishingQueueTaskStatus } from "../approval/types"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { createCreatorPublishingSignedMediaUrl } from "../media"
import { supabaseServer } from "../../supabaseServer"
import { complianceStatusLabel, queueStatusLabel } from "./status"
import { CREATOR_APPROVAL_QUEUE_TASK_SELECT, baseCreatorApprovalEligible, creatorApprovalListEligibility } from "./viewModel"

const PACKAGE_LIST_SELECT = "id,creator_id,target_platform,title,compliance_status,compliance_policy_version,creator_approval_status,scheduled_for,updated_at"
const REVIEW_SELECT = "id,content_package_id,outcome,review_source,escalated_approval_reason,compliance_policy_version,created_at"

export type QueueTaskRow = { id: string; content_package_id: string; target_platform: string; status: CreatorPublishingQueueTaskStatus; due_at?: string | null; updated_at?: string | null }
export type MediaForUi = CreatorPublishingMediaAssetForApproval & { signedUrl: string | null }
export type GeneratedMediaCandidate = { generationId: string; kind: "image" | "video"; previewUrl: string; promptExcerpt: string; createdAt: string | null; mode: string | null; alreadyAttached: boolean }
export type ApprovalDetailView = { pkg: CreatorPublishingPackageForApproval; media: MediaForUi[]; reviews: CreatorPublishingApprovalReviewEvidence[]; queueTask: QueueTaskRow | null; snapshot: ReturnType<typeof buildCreatorPublishingApprovalSnapshot>["snapshot"]; snapshotHash: string; mediaManifestHash: string; idempotencyKey: string; approvable: boolean; ineligibleReason: string | null; generatedMediaCandidates: GeneratedMediaCandidate[]; generatedMediaSelectionAllowed: boolean; generatedMediaSelectionBlockedReason: string | null }
export type ApprovalListItem = { id: string; title: string; target_platform: string; compliance_status: string; creator_approval_status: string; scheduled_for: string | null; queue_due_at: string | null; updated_at: string; thumbnailUrl: string | null; queueStatus: CreatorPublishingQueueTaskStatus | null; actionLabel: string; approvable: boolean; ineligibleReason: string | null }
export type ApprovalListView = { awaiting: ApprovalListItem[]; approved: ApprovalListItem[]; rejected: ApprovalListItem[]; readyForHandoff: ApprovalListItem[]; scheduledInternally: ApprovalListItem[]; readonly: ApprovalListItem[] }

type PackageListRow = Pick<CreatorPublishingPackageForApproval, "id" | "creator_id" | "target_platform" | "title" | "compliance_status" | "compliance_policy_version" | "creator_approval_status" | "scheduled_for" | "updated_at">
type MediaListRow = { id: string; content_package_id: string; storage_key: string; mime_type: string }
type LoaderResult<T> = { data: T | null; error: unknown }

async function currentCreatorId() { const supabase = await supabaseServer(); const { data, error } = await supabase.auth.getUser(); if (error || !data.user?.id) redirect("/login"); return data.user.id }
async function signedPreviewUrl(mediaAssetId: string, creatorId: string) { const result = await createCreatorPublishingSignedMediaUrl({ mediaAssetId, mode: "preview", authenticatedCreatorId: creatorId }); return result.ok ? result.value.signedUrl : null }
function taskKey(contentPackageId: string, targetPlatform: string) { return `${contentPackageId}:${targetPlatform}` }
function ensureRead<T>(result: LoaderResult<T>, label: string): T { if (result.error) throw new Error(`Creator approval ${label} could not be loaded.`); return result.data as T }
function generatedKind(row: any): "image" | "video" { return row?.job_type === "video" || row?.metadata?.generation_kind === "video" || row?.metadata?.kind === "video" ? "video" : "image" }
function generatedBadMetadata(metadata: any): boolean { const text = JSON.stringify(metadata ?? {}).toLowerCase(); return text.includes("placeholder") || text.includes("test") || text.includes("unsafe") || metadata?.placeholder === true || metadata?.is_placeholder === true || metadata?.test === true || metadata?.unsafe === true || metadata?.safety === "unsafe" }
function generatedPreviewUrl(row: any): string | null { const url = typeof row?.image_url === "string" ? row.image_url.trim() : ""; return /^https?:\/\//.test(url) || url.startsWith("/api/generated-output/") ? url : null }
function promptExcerpt(prompt: unknown): string { const text = typeof prompt === "string" ? prompt.replace(/\s+/g, " ").trim() : ""; return text.length > 140 ? `${text.slice(0, 137)}…` : text }
function selectionBlockedReason(pkg: any, task: QueueTaskRow | null): string | null { if (pkg.target_platform === "fanvue") return "Generated media cannot be added to Fanvue packages right now."; if (pkg.creator_approval_status === "approved") return "This package is already approved, so media cannot be changed."; if (task) return "This package has an active publishing task, so media cannot be changed."; return null }
function ineligibleReason(pkg: Pick<CreatorPublishingPackageForApproval,"target_platform"|"creator_approval_status"|"compliance_status"|"compliance_policy_version">, evidence: unknown, blocking: unknown) { if (pkg.target_platform === "fanvue") return "Fanvue packages are not routed through creator approval."; if (pkg.creator_approval_status !== "pending") return null; if (!["passed","escalated_approved"].includes(pkg.compliance_status)) return "Compliance review must be completed before approval."; if (!pkg.compliance_policy_version || pkg.compliance_policy_version === "unassigned") return "A current policy version is required before approval."; if (!evidence) return "Current compliance evidence is required before approval."; if (blocking) return "A later blocking or unresolved review prevents approval."; return null }

export async function loadCreatorApprovalList(): Promise<ApprovalListView> {
  const creatorId = await currentCreatorId(); const admin = getSupabaseAdmin()
  const packagesRes = await admin.from("creator_publishing_content_packages").select(PACKAGE_LIST_SELECT).eq("creator_id", creatorId).neq("target_platform", "fanvue").order("updated_at", { ascending: false }).limit(100)
  const packages = ensureRead<PackageListRow[]>(packagesRes, "packages") ?? []
  const ids = packages.map((p) => p.id)
  const tasksRes = ids.length ? await admin.from("creator_publishing_queue_tasks").select(CREATOR_APPROVAL_QUEUE_TASK_SELECT).in("content_package_id", ids).neq("status", "archived") : { data: [] as QueueTaskRow[], error: null }
  const mediaRes = ids.length ? await admin.from("creator_publishing_media_assets").select("id,content_package_id,storage_key,mime_type").in("content_package_id", ids).order("id", { ascending: true }) : { data: [] as MediaListRow[], error: null }
  const reviewsRes = ids.length ? await admin.from("creator_publishing_compliance_reviews").select(REVIEW_SELECT).in("content_package_id", ids).order("created_at", { ascending: false }) : { data: [] as CreatorPublishingApprovalReviewEvidence[], error: null }
  const tasks = ensureRead<QueueTaskRow[]>(tasksRes, "queue status") ?? []
  const media = ensureRead<MediaListRow[]>(mediaRes, "media") ?? []
  const reviews = ensureRead<CreatorPublishingApprovalReviewEvidence[]>(reviewsRes, "compliance reviews") ?? []
  const taskByPackagePlatform = new Map(tasks.map((task) => [taskKey(task.content_package_id, task.target_platform), task])); const firstMedia = new Map<string, MediaListRow>(); for (const m of media) if (!firstMedia.has(m.content_package_id)) firstMedia.set(m.content_package_id, m)
  const reviewsByPackage = new Map<string, CreatorPublishingApprovalReviewEvidence[]>(); for (const review of reviews as any[]) { const id = review.content_package_id; reviewsByPackage.set(id, [...(reviewsByPackage.get(id) ?? []), review]) }
  const items: ApprovalListItem[] = []
  for (const p of packages) { const m = firstMedia.get(p.id); const task = taskByPackagePlatform.get(taskKey(p.id, p.target_platform)); const eligibility = creatorApprovalListEligibility(p, reviewsByPackage.get(p.id) ?? []); const reason = ineligibleReason(p, eligibility.evidence, eligibility.laterBlockingReview); items.push({ id: p.id, title: p.title, target_platform: p.target_platform, compliance_status: p.compliance_status, creator_approval_status: p.creator_approval_status, scheduled_for: p.scheduled_for ?? null, queue_due_at: task?.due_at ?? null, updated_at: p.updated_at, thumbnailUrl: m?.mime_type?.startsWith("image/") ? await signedPreviewUrl(m.id, creatorId) : null, queueStatus: task?.status ?? null, actionLabel: eligibility.approvable ? "Review and approve" : "View status", approvable: eligibility.approvable, ineligibleReason: reason }) }
  return { awaiting: items.filter(i => i.approvable), approved: items.filter(i => i.creator_approval_status === "approved"), rejected: items.filter(i => i.creator_approval_status === "rejected"), readyForHandoff: items.filter(i => i.queueStatus === "ready_for_handoff" || i.queueStatus === "due_now"), scheduledInternally: items.filter(i => i.queueStatus === "scheduled_internally"), readonly: items.filter(i => !i.approvable && i.creator_approval_status === "pending") }
}

export async function loadCreatorApprovalDetail(contentPackageId: string): Promise<ApprovalDetailView> {
  const creatorId = await currentCreatorId(); const admin = getSupabaseAdmin()
  const { data: pkg, error } = await admin.from("creator_publishing_content_packages").select("id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,second_person_present,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_at,creator_approved_by,scheduled_for,created_at,updated_at").eq("id", contentPackageId).eq("creator_id", creatorId).neq("target_platform", "fanvue").maybeSingle()
  if (error) throw new Error("Creator approval package could not be loaded."); if (!pkg) notFound()
  const [mediaRes, reviewsRes, taskRes] = await Promise.all([
    admin.from("creator_publishing_media_assets").select("id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at").eq("content_package_id", contentPackageId).order("id", { ascending: true }),
    admin.from("creator_publishing_compliance_reviews").select("id,outcome,review_source,escalated_approval_reason,compliance_policy_version,created_at").eq("content_package_id", contentPackageId).order("created_at", { ascending: false }),
    admin.from("creator_publishing_queue_tasks").select(CREATOR_APPROVAL_QUEUE_TASK_SELECT).eq("content_package_id", contentPackageId).eq("target_platform", (pkg as any).target_platform).neq("status", "archived").maybeSingle(),
  ])
  const media = ensureRead<CreatorPublishingMediaAssetForApproval[]>(mediaRes, "media") ?? []
  const reviews = ensureRead<CreatorPublishingApprovalReviewEvidence[]>(reviewsRes, "compliance reviews") ?? []
  const queueTask = ensureRead<QueueTaskRow | null>(taskRes, "queue status") ?? null
  const genRes = await admin.from("generations").select("id,user_id,status,prompt,image_url,mode,body_type,job_type,created_at,r2_bucket,r2_key,metadata").in("user_id", [creatorId]).eq("status", "completed").not("r2_bucket", "is", null).not("r2_key", "is", null).order("created_at", { ascending: false }).limit(80)
  const generations = ensureRead<any[]>(genRes, "generated media") ?? []
  const attachedGenerationIds = new Set(media.filter((m: any) => m.source === "ai_pipeline" && typeof m.ai_generation_metadata?.generation_id === "string").map((m: any) => m.ai_generation_metadata.generation_id))
  const generatedMediaCandidates = generations.filter((g: any) => g.user_id === creatorId && g.status === "completed" && !generatedBadMetadata(g.metadata) && g.r2_bucket && g.r2_key && generatedPreviewUrl(g) && ["image", "video"].includes(generatedKind(g))).map((g: any) => ({ generationId: g.id, kind: generatedKind(g), previewUrl: generatedPreviewUrl(g)!, promptExcerpt: promptExcerpt(g.prompt), createdAt: g.created_at ?? null, mode: g.mode ?? null, alreadyAttached: attachedGenerationIds.has(g.id) }))
  const generatedMediaSelectionBlockedReason = selectionBlockedReason(pkg as any, queueTask)
  const { evidence, laterBlockingReview } = selectCurrentCreatorApprovalComplianceEvidence(pkg as any, reviews)
  const { snapshot, hash } = buildCreatorPublishingApprovalSnapshot(pkg as any, media, evidence ?? null)
  return { pkg: pkg as any, media: await Promise.all(media.map(async m => ({ ...m, signedUrl: await signedPreviewUrl(m.id, creatorId) }))), reviews, queueTask, snapshot, snapshotHash: hash, mediaManifestHash: hashCreatorPublishingMediaManifest(media), idempotencyKey: randomUUID(), approvable: baseCreatorApprovalEligible(pkg as any) && Boolean(evidence) && !laterBlockingReview, ineligibleReason: ineligibleReason(pkg as any, evidence, laterBlockingReview), generatedMediaCandidates, generatedMediaSelectionAllowed: !generatedMediaSelectionBlockedReason, generatedMediaSelectionBlockedReason }
}
export { complianceStatusLabel, queueStatusLabel }
