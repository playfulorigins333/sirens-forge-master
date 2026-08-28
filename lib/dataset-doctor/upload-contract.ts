export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const DATASET_SOURCE_TYPES = Object.freeze({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" } as const);
export type DatasetSourceMime = keyof typeof DATASET_SOURCE_TYPES;
export function datasetSourceExtension(mime: unknown): string | null { return typeof mime === "string" && mime in DATASET_SOURCE_TYPES ? DATASET_SOURCE_TYPES[mime as DatasetSourceMime] : null; }
export function validDatasetSourceDescriptor(value: unknown): value is { mime_type: DatasetSourceMime; size_bytes: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row=value as Record<string,unknown>;
  return Object.keys(row).sort().join(",")==="mime_type,size_bytes" && datasetSourceExtension(row.mime_type)!==null && Number.isInteger(row.size_bytes) && Number(row.size_bytes)>0 && Number(row.size_bytes)<=MAX_SOURCE_BYTES;
}
