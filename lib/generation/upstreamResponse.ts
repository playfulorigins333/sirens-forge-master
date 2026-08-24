export type ValidGenerationOutput = {
  kind: "image";
  url?: string;
  r2_bucket?: string;
  r2_key?: string;
};

export type ValidGenerationResponse = Record<string, unknown> & {
  success: true;
  status?: string;
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
const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const optionalString = (value: unknown) => value === undefined || nonblank(value);

function parseOutput(value: unknown): value is ValidGenerationOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const output = value as Record<string, unknown>;
  if ((output.kind ?? output.type) !== "image") return false;
  if (output.url !== undefined && !isHttpUrl(output.url)) return false;
  if (!optionalString(output.r2_bucket) || !optionalString(output.r2_key)) return false;
  const hasBucket = nonblank(output.r2_bucket);
  const hasKey = nonblank(output.r2_key);
  return hasBucket === hasKey && (isHttpUrl(output.url) || (hasBucket && hasKey));
}

export function parseGenerationSuccess(value: unknown): ValidGenerationResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.success !== true) return null;
  if (!optionalString(data.prompt_id) || !optionalString(data.generation_id) ||
      !optionalString(data.r2_bucket) || !optionalString(data.r2_key)) return null;
  if (data.placeholder !== undefined && typeof data.placeholder !== "boolean") return null;
  if (data.image_url !== undefined && !isHttpUrl(data.image_url)) return null;
  if (data.output_url !== undefined && !isHttpUrl(data.output_url)) return null;
  if (data.images !== undefined && (!Array.isArray(data.images) || data.images.length > 4 || !data.images.every(isHttpUrl))) return null;
  if (data.outputs !== undefined && (!Array.isArray(data.outputs) || data.outputs.length < 1 || data.outputs.length > 4 || !data.outputs.every(parseOutput))) return null;
  const hasLegacyAsset = isHttpUrl(data.image_url) || isHttpUrl(data.output_url) ||
    (Array.isArray(data.images) && data.images.length > 0);
  const hasOutputs = Array.isArray(data.outputs) && data.outputs.length > 0;
  return hasLegacyAsset || hasOutputs ? data as ValidGenerationResponse : null;
}

export function requirePrivateOutputs(response: ValidGenerationResponse): Array<Required<Pick<ValidGenerationOutput, "kind" | "r2_bucket" | "r2_key">>> {
  if (!Array.isArray(response.outputs) || response.outputs.length < 1 || response.outputs.length > 4) throw new Error("PRIVATE_OUTPUTS_REQUIRED");
  return response.outputs.map((output) => {
    if (output.kind !== "image" || !nonblank(output.r2_bucket) || !nonblank(output.r2_key)) throw new Error("PRIVATE_OUTPUT_INVALID");
    return { kind: "image", r2_bucket: output.r2_bucket.trim(), r2_key: output.r2_key.trim() };
  });
}
