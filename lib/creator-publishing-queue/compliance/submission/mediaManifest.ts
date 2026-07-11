import { createHash } from "node:crypto"
import { canonicalCreatorPublishingApprovalJson } from "../../approval/snapshot"

export type ComplianceMediaManifestInput = {
  id: string
  storage_key: string
  mime_type: string
  sha256: string
  source: string
  ai_generation_metadata?: { generation_id?: unknown } | Record<string, unknown> | null
}

export function buildComplianceSubmissionBrowserMediaManifest(media: readonly ComplianceMediaManifestInput[]) {
  return [...media]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((asset) => ({
      id: asset.id,
      storage_key: asset.storage_key,
      mime_type: asset.mime_type,
      sha256: asset.sha256.toLowerCase(),
      source: asset.source,
      generation_id: typeof asset.ai_generation_metadata?.generation_id === "string" ? asset.ai_generation_metadata.generation_id : null,
    }))
}

export function hashComplianceSubmissionBrowserMediaManifest(media: readonly ComplianceMediaManifestInput[]) {
  return createHash("sha256").update(canonicalCreatorPublishingApprovalJson(buildComplianceSubmissionBrowserMediaManifest(media))).digest("hex")
}
