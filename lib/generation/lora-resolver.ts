// lib/generation/lora-resolver.ts
// PRODUCTION-LOCKED — Identity-first LoRA resolution

import type { BodyMode, UserLora } from "./contract";
import path from "path";
import fs from "fs/promises";
import { ensureUserLoraCached } from "./ensureUserLoraCached";
import { createClient } from "@supabase/supabase-js";

/**
 * 🔒 SUPABASE (server-side only)
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  trigger_token: string | null;
};

/**
 * LOCKED CONSTANTS
 */
const BIGLUST_BASE_PATH =
  "/workspace/sirensforge/models/base/bigLust_v16.safetensors";

/**
 * 🧪 TEMPORARY TUNING VALUES (Identity Isolation Test)
 * Body LoRA disabled, Identity LoRA only.
 */
const BODY_LORA_STRENGTH = 0.0;
const IDENTITY_LORA_STRENGTH = 1.15;

const COMFY_LORA_DIR = "/workspace/ComfyUI/models/loras";

/**
 * Body LoRAs (launch modes only)
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
 * Fetch trigger token from Supabase
 */
async function fetchTriggerToken(
  userLora?: UserLora
): Promise<string | null> {
  if (!userLora) return null;

  const { data, error } = await supabase
    .from("user_loras")
    .select("trigger_token")
    .eq("id", userLora.id)
    .single();

  if (error || !data?.trigger_token) return null;

  return data.trigger_token;
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

  const trigger_token = await fetchTriggerToken(userLora);

  return {
    base_model: {
      path: BIGLUST_BASE_PATH,
    },
    loras,
    trigger_token,
  };
}
