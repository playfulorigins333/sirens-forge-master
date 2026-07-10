import "server-only"
import { notFound, redirect } from "next/navigation"
import { randomUUID } from "node:crypto"
import { buildCreatorPublishingApprovalSnapshot, hashCreatorPublishingMediaManifest } from "../approval/snapshot"
import { selectCurrentCreatorApprovalComplianceEvidence } from "../approval/service"
import type { CreatorPublishingApprovalReviewEvidence } from "../approval/service"
import type { CreatorPublishingMediaAssetForApproval, CreatorPublishingPackageForApproval, CreatorPublishingQueueTaskStatus } from "../approval/types"
import { getCreatorPublishingPlatformPolicy } from "../policies"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { supabaseServer } from "../../supabaseServer"
import { complianceStatusLabel, queueStatusLabel } from "./status"

export type QueueTaskRow = { id: string; content_package_id: string; target_platform: string; status: CreatorPublishingQueueTaskStatus; scheduled_for?: string | null; updated_at?: string | null }
export type MediaForUi = CreatorPublishingMediaAssetForApproval & { signedUrl: string | null }
export type ApprovalDetailView = { pkg: CreatorPublishingPackageForApproval; media: MediaForUi[]; reviews: CreatorPublishingApprovalReviewEvidence[]; queueTask: QueueTaskRow | null; snapshot: ReturnType<typeof buildCreatorPublishingApprovalSnapshot>["snapshot"]; snapshotHash: string; mediaManifestHash: string; idempotencyKey: string; approvable: boolean; ineligibleReason: string | null }
export type ApprovalListItem = { id: string; title: string; target_platform: string; compliance_status: string; creator_approval_status: string; scheduled_for: string | null; updated_at: string; thumbnailUrl: string | null; queueStatus: CreatorPublishingQueueTaskStatus | null; actionLabel: string; approvable: boolean }
export type ApprovalListView = { awaiting: ApprovalListItem[]; approved: ApprovalListItem[]; rejected: ApprovalListItem[]; readyForHandoff: ApprovalListItem[]; scheduledInternally: ApprovalListItem[]; readonly: ApprovalListItem[] }

async function currentCreatorId() { const supabase = await supabaseServer(); const { data, error } = await supabase.auth.getUser(); if (error || !data.user?.id) redirect("/login"); return data.user.id }
function storageBucket() { return process.env.CREATOR_PUBLISHING_MEDIA_BUCKET || "creator-publishing-media" }
async function signedUrl(storageKey: string | null | undefined) { if (!storageKey) return null; const admin = getSupabaseAdmin(); const { data, error } = await admin.storage.from(storageBucket()).createSignedUrl(storageKey, 300); if (error) return null; return data?.signedUrl ?? null }
function isApprovable(pkg: Pick<CreatorPublishingPackageForApproval,"target_platform"|"creator_approval_status"|"compliance_status"|"compliance_policy_version">) { return pkg.target_platform !== "fanvue" && pkg.creator_approval_status === "pending" && ["passed","escalated_approved"].includes(pkg.compliance_status) && Boolean(pkg.compliance_policy_version && pkg.compliance_policy_version !== "unassigned") }
function ineligibleReason(pkg: CreatorPublishingPackageForApproval, evidence: unknown, blocking: unknown) { if (pkg.target_platform === "fanvue") return "Fanvue packages are not routed through creator approval."; if (pkg.creator_approval_status !== "pending") return null; if (!["passed","escalated_approved"].includes(pkg.compliance_status)) return "Compliance review must be completed before approval."; if (!pkg.compliance_policy_version || pkg.compliance_policy_version === "unassigned") return "A current policy version is required before approval."; if (!evidence) return "Current compliance evidence is required before approval."; if (blocking) return "A later blocking or unresolved review prevents approval."; return null }

export async function loadCreatorApprovalList(): Promise<ApprovalListView> {
  const creatorId = await currentCreatorId(); const admin = getSupabaseAdmin()
  const { data: packages, error } = await admin.from("creator_publishing_content_packages").select("id,creator_id,target_platform,title,compliance_status,compliance_policy_version,creator_approval_status,scheduled_for,updated_at").eq("creator_id", creatorId).neq("target_platform", "fanvue").order("updated_at", { ascending: false }).limit(100)
  if (error) throw error
  const ids = (packages ?? []).map((p: any) => p.id)
  const { data: tasks } = ids.length ? await admin.from("creator_publishing_queue_tasks").select("id,content_package_id,target_platform,status,scheduled_for,updated_at").in("content_package_id", ids).neq("status", "archived") : { data: [] }
  const { data: media } = ids.length ? await admin.from("creator_publishing_media_assets").select("id,content_package_id,storage_key,mime_type").in("content_package_id", ids).order("id", { ascending: true }) : { data: [] }
  const taskByPackage = new Map((tasks ?? []).map((t: any) => [t.content_package_id, t])); const firstMedia = new Map<string, any>(); for (const m of media ?? []) if (!firstMedia.has((m as any).content_package_id)) firstMedia.set((m as any).content_package_id, m)
  const items: ApprovalListItem[] = []
  for (const p of packages ?? []) { const m = firstMedia.get((p as any).id); const task = taskByPackage.get((p as any).id) as any; items.push({ id: (p as any).id, title: (p as any).title, target_platform: (p as any).target_platform, compliance_status: (p as any).compliance_status, creator_approval_status: (p as any).creator_approval_status, scheduled_for: (p as any).scheduled_for ?? task?.scheduled_for ?? null, updated_at: (p as any).updated_at, thumbnailUrl: m?.mime_type?.startsWith("image/") ? await signedUrl(m.storage_key) : null, queueStatus: task?.status ?? null, actionLabel: isApprovable(p as any) ? "Review and approve" : "View status", approvable: isApprovable(p as any) }) }
  return { awaiting: items.filter(i => i.approvable), approved: items.filter(i => i.creator_approval_status === "approved"), rejected: items.filter(i => i.creator_approval_status === "rejected"), readyForHandoff: items.filter(i => i.queueStatus === "ready_for_handoff" || i.queueStatus === "due_now"), scheduledInternally: items.filter(i => i.queueStatus === "scheduled_internally"), readonly: items.filter(i => !i.approvable && i.creator_approval_status === "pending") }
}

export async function loadCreatorApprovalDetail(contentPackageId: string): Promise<ApprovalDetailView> {
  const creatorId = await currentCreatorId(); const admin = getSupabaseAdmin()
  const { data: pkg, error } = await admin.from("creator_publishing_content_packages").select("id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,second_person_present,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_at,creator_approved_by,scheduled_for,created_at,updated_at").eq("id", contentPackageId).eq("creator_id", creatorId).neq("target_platform", "fanvue").maybeSingle()
  if (error) throw error; if (!pkg) notFound()
  const [mediaRes, reviewsRes, taskRes] = await Promise.all([
    admin.from("creator_publishing_media_assets").select("id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at").eq("content_package_id", contentPackageId).order("id", { ascending: true }),
    admin.from("creator_publishing_compliance_reviews").select("id,outcome,review_source,escalated_approval_reason,compliance_policy_version,created_at").eq("content_package_id", contentPackageId).order("created_at", { ascending: false }),
    admin.from("creator_publishing_queue_tasks").select("id,content_package_id,target_platform,status,scheduled_for,updated_at").eq("content_package_id", contentPackageId).eq("target_platform", (pkg as any).target_platform).neq("status", "archived").maybeSingle(),
  ])
  if (mediaRes.error) throw mediaRes.error; if (reviewsRes.error) throw reviewsRes.error
  const media = (mediaRes.data ?? []) as CreatorPublishingMediaAssetForApproval[]; const reviews = (reviewsRes.data ?? []) as CreatorPublishingApprovalReviewEvidence[]; const { evidence, laterBlockingReview } = selectCurrentCreatorApprovalComplianceEvidence(pkg as any, reviews)
  const { snapshot, hash } = buildCreatorPublishingApprovalSnapshot(pkg as any, media, evidence ?? null)
  return { pkg: pkg as any, media: await Promise.all(media.map(async m => ({ ...m, signedUrl: await signedUrl(m.storage_key) }))), reviews, queueTask: (taskRes.data as any) ?? null, snapshot, snapshotHash: hash, mediaManifestHash: hashCreatorPublishingMediaManifest(media), idempotencyKey: randomUUID(), approvable: isApprovable(pkg as any) && Boolean(evidence) && !laterBlockingReview, ineligibleReason: ineligibleReason(pkg as any, evidence, laterBlockingReview) }
}
export { complianceStatusLabel, queueStatusLabel }
