export type ValidGenerationOutput = { kind: "image"; url: string };
export type ValidGenerationResponse = Record<string, unknown> & {
  success: true;
  prompt_id?: string;
  generation_id?: string;
  image_url?: string;
  output_url?: string;
  images?: string[];
  outputs?: ValidGenerationOutput[];
  r2_bucket?: string;
  r2_key?: string;
  placeholder?: boolean;
};

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
};
const optionalString = (value: unknown) => value === undefined || (typeof value === "string" && value.trim().length > 0);

export function parseGenerationSuccess(value: unknown): ValidGenerationResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.success !== true) return null;
  if (!optionalString(data.prompt_id) || !optionalString(data.generation_id) ||
      !optionalString(data.r2_bucket) || !optionalString(data.r2_key)) return null;
  if (data.placeholder !== undefined && typeof data.placeholder !== "boolean") return null;
  if (data.image_url !== undefined && !isHttpUrl(data.image_url)) return null;
  if (data.output_url !== undefined && !isHttpUrl(data.output_url)) return null;
  if (data.images !== undefined && (!Array.isArray(data.images) || !data.images.every(isHttpUrl))) return null;
  if (data.outputs !== undefined && (!Array.isArray(data.outputs) || !data.outputs.every((output) => {
    if (!output || typeof output !== "object" || Array.isArray(output)) return false;
    const candidate = output as Record<string, unknown>;
    return candidate.kind === "image" && isHttpUrl(candidate.url);
  }))) return null;
  const hasAsset = isHttpUrl(data.image_url) || isHttpUrl(data.output_url) ||
    (Array.isArray(data.images) && data.images.length > 0) ||
    (Array.isArray(data.outputs) && data.outputs.length > 0);
  return hasAsset ? data as ValidGenerationResponse : null;
}
