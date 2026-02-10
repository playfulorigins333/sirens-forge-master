// lib/generation/lora-resolver.ts
// PRODUCTION-LOCKED — Identity-first LoRA resolution (ID-based)

import type { BodyMode } from "./contract";
import path from "path";
import fs from "fs/promises";
import { ensureUserLoraCached } from "./ensureUserLoraCached";
import { createClient } from "@supabase/supabase-js";

/**
 * 🔒 SUPABASE (server-side only)
 * NOTE: requires SUPABASE_SERVICE_ROLE_KEY to be present in the server runtime
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * 🔒 EXPORTED TYPES (REQUIRED BY buildWorkflow)
 */
export type ResolvedLora = {
  path: string; // FILENAME ONLY (what Comfy uses)
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
 * Accepts the LoRA ID string (UUID).
 */
async function resolveUserLora(loraId?: string | null): Promise<ResolvedLora | null> {
  if (!loraId) return null;

  // 1) Cache the LoRA file locally (Vercel-safe /tmp)
  const cachedPath = await ensureUserLoraCached(loraId);

  // 2) The filename Comfy should load
  const comfyFileName = `identity_${loraId}.safetensors`;
  const comfyPath = path.join(COMFY_LORA_DIR, comfyFileName);

  // 3) Try to copy into ComfyUI models dir (works on RunPod; may fail on Vercel)
  try {
    await fs.access(comfyPath);
  } catch {
    try {
      await fs.mkdir(COMFY_LORA_DIR, { recursive: true });
      await fs.copyFile(cachedPath, comfyPath);
    } catch (e) {
      // IMPORTANT: Do not crash generation on platforms that can't write /workspace.
      // If the generation pod already has the LoRA, Comfy will still succeed.
      console.warn(
        `[lora-resolver] Could not materialize LoRA into ${COMFY_LORA_DIR}. ` +
          `Continuing with filename-only. Error:`,
        e
      );
    }
  }

  return {
    path: comfyFileName,
    strength: IDENTITY_LORA_STRENGTH,
  };
}

/**
 * Fetch trigger token from Supabase
 */
async function fetchTriggerToken(loraId?: string | null): Promise<string | null> {
  if (!loraId) return null;

  const { data, error } = await supabase
    .from("user_loras")
    .select("trigger_token")
    .eq("id", loraId)
    .single();

  if (error || !data?.trigger_token) return null;

  return data.trigger_token;
}

/**
 * MAIN RESOLVER — ASYNC
 * Accepts (bodyMode, identityLoraId)
 */
export async function resolveLoraStack(
  bodyMode: BodyMode,
  identityLoraId?: string | null
): Promise<ResolvedLoraStack> {
  const loras: ResolvedLora[] = [];

  // Launch-only guard
  if (bodyMode === "body_mtf" || bodyMode === "body_ftm") {
    throw new Error(`Unsupported body mode for launch: ${bodyMode}`);
  }

  // Body LoRA (currently strength 0.0 for isolation testing)
  if (bodyMode !== "none") {
    loras.push({
      path: BODY_LORA_NAMES[bodyMode],
      strength: BODY_LORA_STRENGTH,
    });
  }

  // Identity LoRA
  const identity = await resolveUserLora(identityLoraId);
  if (identity) {
    loras.push(identity);
  }

  const trigger_token = await fetchTriggerToken(identityLoraId);

  return {
    base_model: { path: BIGLUST_BASE_PATH },
    loras,
    trigger_token,
  };
}
