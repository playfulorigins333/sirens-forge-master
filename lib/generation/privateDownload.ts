export type DownloadableGeneratedItem = { url: string; privateAsset?: boolean; generationAssetId?: string | null };
export async function resolveGeneratedItemDownloadUrl(item: DownloadableGeneratedItem, fetcher: typeof fetch = fetch): Promise<string> {
  if (!item.privateAsset || !item.generationAssetId) return item.url;
  const response = await fetcher(`/api/library/assets/${encodeURIComponent(item.generationAssetId)}/signed-url?mode=download`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.url !== "string" || !body.url) throw new Error("PRIVATE_DOWNLOAD_UNAVAILABLE");
  return body.url;
}
