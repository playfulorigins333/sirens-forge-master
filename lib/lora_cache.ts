// lib/lora_cache.ts
// Thin TypeScript wrapper for resolving LoRAs on the generation pod

export async function resolveLoraToLocalPath(args: {
  loraId: string;
  storagePath: string;
}): Promise<string> {
  if (!args.storagePath) {
    throw new Error("Missing LoRA storage path");
  }

  // Launch-safe canonical path
  return `/workspace/cache/loras/${args.loraId}.safetensors`;
}
