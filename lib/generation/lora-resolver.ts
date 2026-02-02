// lib/generation/lora-resolver.ts
// PRODUCTION-LOCKED — Identity-first LoRA resolution
// UI does NOT control strengths. Engine guarantees consistency.

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
 * 🔒 LOCKED STRENGTHS (PRODUCTION)
 * These are engine decisions, not UX decisions.
 */
const BODY_LORA_STRENGTH = 0.75;
const IDENTITY_LORA_STRENGTH = 1.0;

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
 * Strength is LOCKED for identity dominance.
 */
function resolveUserLora(userLora?: UserLora): ResolvedLora | null {
  if (!userLora) return null;

  return {
    path: `/workspace/cache/loras/${userLora.id}.safetensors`,
    strength: IDENTITY_LORA_STRENGTH,
  };
}

/**
 * MAIN RESOLVER — SINGLE SOURCE OF TRUTH
 * Order matters: Body → Identity
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

  // 1️⃣ Body modifier (supportive only)
  if (bodyMode !== "none") {
    const bodyPath = BODY_LORA_PATHS[bodyMode];
    loras.push({
      path: bodyPath,
      strength: BODY_LORA_STRENGTH,
    });
  }

  // 2️⃣ Identity LoRA (dominant, always last)
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
