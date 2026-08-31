import { UUID_RE } from "@/lib/video/contract";
type Row = Record<string, any>;
export function parseExactVideoSafeResult(value: unknown, projectId: string): { assetId: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Row; if (Object.keys(row).sort().join(",") !== "asset_ids,generation_id,project_id") return null;
  if (row.project_id !== projectId || row.generation_id !== projectId || !Array.isArray(row.asset_ids) || row.asset_ids.length !== 1 || !UUID_RE.test(row.asset_ids[0])) return null;
  return { assetId: row.asset_ids[0].toLowerCase() };
}
export function videoResultRowsAreCanonical(input: { ownerId: string; projectId: string; assetId: string; project: Row | null; generation: Row | null; assets: Row[] | null }): boolean {
  const { ownerId, projectId, assetId, project, generation, assets } = input; if (!project || !generation || !assets || assets.length !== 1) return false;
  const asset = assets[0], object = Array.isArray(asset.private_storage_objects) ? asset.private_storage_objects[0] : asset.private_storage_objects;
  return project.id === projectId && project.owner_id === ownerId && generation.id === projectId && generation.user_id === ownerId && generation.status === "completed" && generation.job_type === "video" && generation.image_url === null && asset.id === assetId && asset.generation_id === projectId && asset.owner_id === ownerId && asset.ordinal === 0 && asset.kind === "video" && object?.owner_id === ownerId && object?.storage_class === "creator_generation" && object?.mime_type === "video/mp4" && object?.bucket === project.storage_bucket && new RegExp(`^creator-video-projects/${projectId}/final/[^/]+$`).test(object?.object_key ?? "");
}
