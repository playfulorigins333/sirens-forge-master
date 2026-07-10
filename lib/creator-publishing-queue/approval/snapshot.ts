import { createHash } from "node:crypto"
import { normalizeOnlyFansDisclosure } from "../compliance/evaluate"
import { getCreatorPublishingPlatformPolicy } from "../policies"
import type { CreatorPublishingApprovalSnapshot, CreatorPublishingMediaAssetForApproval, CreatorPublishingPackageForApproval } from "./types"

export function canonicalCreatorPublishingApprovalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalCreatorPublishingApprovalJson).join(",")}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalCreatorPublishingApprovalJson((value as Record<string, unknown>)[key])}`).join(",")}}`
}
export function hashCreatorPublishingApprovalSnapshot(snapshot: CreatorPublishingApprovalSnapshot) { return createHash("sha256").update(canonicalCreatorPublishingApprovalJson(snapshot)).digest("hex") }
export function buildCreatorPublishingMediaManifest(mediaAssets: readonly CreatorPublishingMediaAssetForApproval[]) {
  return [...mediaAssets].sort((a,b) => a.id.localeCompare(b.id)).map((asset) => ({ id: asset.id, storage_key: asset.storage_key, mime_type: asset.mime_type, sha256: asset.sha256, source: asset.source, ai_generation_metadata: asset.ai_generation_metadata ?? {} }))
}
export function hashCreatorPublishingMediaManifest(mediaAssets: readonly CreatorPublishingMediaAssetForApproval[]) {
  return createHash("sha256").update(canonicalCreatorPublishingApprovalJson(buildCreatorPublishingMediaManifest(mediaAssets))).digest("hex")
}
export function buildCreatorPublishingApprovalSnapshot(pkg: CreatorPublishingPackageForApproval, mediaAssets: readonly CreatorPublishingMediaAssetForApproval[], reviewSummary: Record<string, unknown> | null = null): { snapshot: CreatorPublishingApprovalSnapshot; hash: string } {
  const policy = getCreatorPublishingPlatformPolicy(pkg.target_platform)
  const finalCaption = pkg.target_platform === "onlyfans"
    ? normalizeOnlyFansDisclosure(pkg.caption_body ?? "", pkg.ai_flag !== "none" || Object.values(pkg.ai_detail ?? {}).some(Boolean) || mediaAssets.some((asset) => asset.source === "ai_pipeline"), policy.disclosure_policy.allowed_signifiers, policy.disclosure_policy.default_disclosure ?? "#ai").normalized_caption
    : (pkg.caption_body ?? "").trim()
  const snapshot: CreatorPublishingApprovalSnapshot = {
    content_package_id: pkg.id, creator_id: pkg.creator_id, target_platform: pkg.target_platform, platform_account_id: pkg.platform_account_id,
    policy_version: pkg.compliance_policy_version, compliance_status: pkg.compliance_status, title: pkg.title, final_caption: finalCaption, forced_disclosure: pkg.forced_disclosure_text,
    media_assets: buildCreatorPublishingMediaManifest(mediaAssets),
    ai_flag: pkg.ai_flag, ai_detail: pkg.ai_detail ?? {}, second_person_present: pkg.second_person_present,
    compliance_summary: { status: pkg.compliance_status, policy_version: pkg.compliance_policy_version, required_disclosure_present: Boolean(pkg.forced_disclosure_text?.trim()) }, review_summary: reviewSummary,
    platform_handoff_checklist: policy.handoff_checklist, platform_disclaimers: policy.disclaimers, created_at: pkg.created_at, updated_at: pkg.updated_at,
  }
  return { snapshot, hash: hashCreatorPublishingApprovalSnapshot(snapshot) }
}
