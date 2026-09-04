import "server-only";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadCreatorApprovalDetail as loadBaseCreatorApprovalDetail } from "./loaders";

export async function loadCreatorApprovalDetail(contentPackageId: string) {
  const view = await loadBaseCreatorApprovalDetail(contentPackageId);
  const privateAssetIds = view.generatedMediaCandidates
    .map((candidate) => candidate.generationAssetId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (privateAssetIds.length === 0) return view;

  const { data, error } = await getSupabaseAdmin()
    .from("generation_assets")
    .select("id")
    .in("id", privateAssetIds)
    .eq("lifecycle_state", "active");

  if (error) throw new Error("Private generated media lifecycle could not be loaded.");
  const active = new Set((data ?? []).map((row) => row.id));

  return {
    ...view,
    generatedMediaCandidates: view.generatedMediaCandidates.filter(
      (candidate) => candidate.generationAssetId == null || active.has(candidate.generationAssetId),
    ),
  };
}
