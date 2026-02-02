// lib/generation/lora-resolver.ts
// PRODUCTION-LOCKED — Identity-first LoRA resolution

import type { BodyMode, UserLora } from "./contract";
import path from "path";
import fs from "fs/promises";
import { ensureUserLoraCached } from "./ensureUserLoraCached";

/**
 * 🔒 EXPORTED TYPES (REQUIRED BY buildWorkflow)
 */
export type ResolvedLora = {
  path: string; // FILENAME ONLY
  strength: number;
};

export type ResolvedLoraStack = {
  base_model: {
    path: string;
  };
  loras: ResolvedLora[];
};

/**
 * LOCKED CONSTANTS
 */
const BIGLUST_BASE_PATH =
  "/workspace/sirensforge/models/base/bigLust_v16.safetensors";

const BODY_LORA_STRENGTH = 0.75;
const IDENTITY_LORA_STRENGTH = 1.0;

const COMFY_LORA_DIR = "/workspace/ComfyUI/models/loras";

/**
 * Body LoRAs (already present)
 */
const BODY_LORA_NAMES: Record<Exclude<BodyMode, "none">, string> = {
  body_feminine: "body_feminine.safetensors",
  body_masculine: "body_masculine.safetensors",
  body_mtf: "body_mtf.safetensors",
  body_ftm: "body_ftm.safetensors",
};

/**
 * Materialize user LoRA into ComfyUI and return filename ONLY
 */
async function resolveUserLora(
  userLora?: UserLora
): Promise<ResolvedLora | null> {
  if (!userLora) return null;

  const cachedPath = await ensureUserLoraCached(userLora.id);

  const comfyFileName = `identity_${userLora.id}.safetensors`;
  const comfyPath = path.join(COMFY_LORA_DIR, comfyFileName);

  try {
    await fs.access(comfyPath);
  } catch {
    await fs.mkdir(COMFY_LORA_DIR, { recursive: true });
    await fs.copyFile(cachedPath, comfyPath);
  }

  return {
    path: comfyFileName,
    strength: IDENTITY_LORA_STRENGTH,
  };
}

/**
 * MAIN RESOLVER — ASYNC
 */
export async function resolveLoraStack(
  bodyMode: BodyMode,
  userLora?: UserLora
): Promise<ResolvedLoraStack> {
  const loras: ResolvedLora[] = [];

  if (bodyMode === "body_mtf" || bodyMode === "body_ftm") {
    throw new Error(`Unsupported body mode for launch: ${bodyMode}`);
  }

  if (bodyMode !== "none") {
    loras.push({
      path: BODY_LORA_NAMES[bodyMode],
      strength: BODY_LORA_STRENGTH,
    });
  }

  const identity = await resolveUserLora(userLora);
  if (identity) {
    loras.push(identity);
  }

  return {
    base_model: {
      path: BIGLUST_BASE_PATH,
    },
    loras,
  };
}
