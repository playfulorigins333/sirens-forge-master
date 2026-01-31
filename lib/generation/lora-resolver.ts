// lib/generation/lora-resolver.ts

import type { BodyMode, UserLora } from "./contract";

export type ResolvedLora = {
  path: string;
  strength: number;
};

export type ResolvedLoraStack = {
  base_model: {
    path: string;
  };
  loras: ResolvedLora[];
};

/**
 * LOCKED CONSTANTS (LAUNCH)
 * BigLust is ALWAYS the base.
 */
const BIGLUST_BASE_PATH =
  "/workspace/sirensforge/models/base/bigLust_v16.safetensors";

/**
 * Body LoRA paths (already symlinked into ComfyUI)
 */
const BODY_LORA_PATHS: Record<Exclude<BodyMode, "none">, string> = {
  body_feminine:
    "/workspace/ComfyUI/models/loras/body_feminine.safetensors",
  body_masculine:
    "/workspace/ComfyUI/models/loras/body_masculine.safetensors",
  body_mtf:
    "/workspace/ComfyUI/models/loras/body_mtf.safetensors",
  body_ftm:
    "/workspace/ComfyUI/models/loras/body_ftm.safetensors",
};

/**
 * User-trained LoRAs are loaded from the shared cache.
 * This SAME path will be used for image + video.
 */
function resolveUserLora(userLora?: UserLora): ResolvedLora | null {
  if (!userLora) return null;

  return {
    path: `/workspace/cache/loras/${userLora.id}.safetensors`,
    strength: userLora.strength ?? 0.85,
  };
}

/**
 * MAIN RESOLVER — SINGLE SOURCE OF TRUTH
 */
export function resolveLoraStack(
  bodyMode: BodyMode,
  userLora?: UserLora
): ResolvedLoraStack {
  const loras: ResolvedLora[] = [];

  // 🚫 LAUNCH GUARD — Fem / Masc only
  if (bodyMode === "body_mtf" || bodyMode === "body_ftm") {
    throw new Error(`Unsupported body mode for launch: ${bodyMode}`);
  }

  // 1️⃣ Body modifier (optional)
  if (bodyMode !== "none") {
    const bodyPath = BODY_LORA_PATHS[bodyMode];
    loras.push({
      path: bodyPath,
      strength: 1.0,
    });
  }

  // 2️⃣ Optional SINGLE user LoRA
  const resolvedUser = resolveUserLora(userLora);
  if (resolvedUser) {
    loras.push(resolvedUser);
  }

  return {
    base_model: {
      path: BIGLUST_BASE_PATH,
    },
    loras,
  };
}
