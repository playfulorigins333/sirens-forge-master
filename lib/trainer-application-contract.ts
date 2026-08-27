import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function canonicalUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

export const RECOMMENDED_TRAINER_RECIPE = Object.freeze({
  version: "sf-sdxl-recommended-v1",
  mode: "recommended",
  settings: Object.freeze({
    resolution: Object.freeze([1024, 1024]), enable_bucket: true,
    min_bucket_reso: 512, max_bucket_reso: 1024, bucket_reso_steps: 64,
    train_batch_size: 1, learning_rate: 0.0001, network_module: "networks.lora",
    network_dim: 64, network_alpha: 32, mixed_precision: "fp16",
    gradient_checkpointing: true, save_model_as: "safetensors", save_every_n_steps: 200,
    target_effective_samples: 1200, caption_extension: ".txt",
    caption_model: "Salesforce/blip-image-captioning-base", trigger_suffix: "woman",
  }),
});

export function buildRecommendedTrainerRecipe() {
  return structuredClone(RECOMMENDED_TRAINER_RECIPE);
}

export function canonicalSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalSerialize((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function trainerRequestFingerprint(request: unknown): string {
  return createHash("sha256").update(canonicalSerialize(request)).digest("hex");
}
