import type { BodyMode } from "./contract";
import path from "path";
import fs from "fs/promises";
import { ensureUserLoraCached, type LoraCacheDependencies } from "./ensureUserLoraCached";

export type ResolvedLora = { path: string; strength: number };
export type ResolvedLoraStack = { base_model: { path: string }; loras: ResolvedLora[]; trigger_token: string | null };
const BIGLUST_BASE_PATH = "/workspace/sirensforge/models/base/bigLust_v16.safetensors";
const BODY_LORA_STRENGTH = 0.0;
const IDENTITY_LORA_STRENGTH = 1.15;
const COMFY_LORA_DIR = "/workspace/ComfyUI/models/loras";
const BODY_LORA_NAMES: Record<Exclude<BodyMode, "none">, string> = {
  body_feminine: "body_feminine.safetensors", body_masculine: "body_masculine.safetensors",
  body_mtf: "body_mtf.safetensors", body_ftm: "body_ftm.safetensors",
};

export async function resolveLoraStack(
  bodyMode: BodyMode,
  identityLoraId: string | null | undefined,
  authenticatedUserId: string,
  cacheDeps?: LoraCacheDependencies,
): Promise<ResolvedLoraStack> {
  if (bodyMode === "body_mtf" || bodyMode === "body_ftm") throw new Error(`Unsupported body mode for launch: ${bodyMode}`);
  const loras: ResolvedLora[] = bodyMode === "none" ? [] : [{ path: BODY_LORA_NAMES[bodyMode], strength: BODY_LORA_STRENGTH }];
  let trigger_token: string | null = null;
  if (identityLoraId) {
    const { localPath, metadata } = await ensureUserLoraCached(identityLoraId, authenticatedUserId, cacheDeps);
    const comfyFileName = `identity_${identityLoraId}.safetensors`;
    const comfyPath = path.join(COMFY_LORA_DIR, comfyFileName);
    try { await fs.access(comfyPath); } catch {
      try { await fs.mkdir(COMFY_LORA_DIR, { recursive: true }); await fs.copyFile(localPath, comfyPath); } catch { /* the generation host may already own materialization */ }
    }
    loras.push({ path: comfyFileName, strength: IDENTITY_LORA_STRENGTH });
    trigger_token = metadata.trigger_token?.trim() || null;
  }
  return { base_model: { path: BIGLUST_BASE_PATH }, loras, trigger_token };
}
