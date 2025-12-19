// lib/comfy/buildWorkflow.ts
// LAUNCH-SAFE — BigLust base + body LoRA + optional user LoRA (stacked correctly)

import { LORA_ROUTING, BaseModelKey } from "@/lib/lora/lora-routing";

// Node-safe JSON load (avoids TS resolveJsonModule issues)
const baseWorkflow = require("./workflow-base.json");

type FluxLock = { type?: string; strength?: string } | null;

interface BuildWorkflowArgs {
  prompt: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  baseModel: BaseModelKey;

  // Optional USER LoRA (already resolved to local pod path)
  loraPath?: string | null;

  // DNA / FaceID (future-ready)
  dnaImageNames?: string[];
  fluxLock?: FluxLock;
}

// Change ONLY if your node name differs
const FACEID_NODE_CLASS = "IPAdapterFaceID";

export function buildWorkflow({
  prompt,
  negative,
  seed,
  steps,
  cfg,
  width,
  height,
  baseModel,
  loraPath = null,
  dnaImageNames = [],
  fluxLock = null,
}: BuildWorkflowArgs) {
  // Deep clone base workflow
  const wf: any = JSON.parse(JSON.stringify(baseWorkflow));
  const nodeIds = Object.keys(wf);

  const maxId = nodeIds.reduce((m, id) => Math.max(m, parseInt(id, 10)), 0);
  let nextId = Number.isFinite(maxId) ? maxId + 1 : 100;

  // ------------------------------------------------------------
  // REQUIRED: LoraLoader
  // ------------------------------------------------------------
  const loraNodeId = nodeIds.find((id) => wf[id]?.class_type === "LoraLoader");
  if (!loraNodeId) {
    throw new Error("No LoraLoader node found in workflow-base.json");
  }

  // ------------------------------------------------------------
  // BASE + BODY LoRAs (BigLust already loaded by CheckpointLoader)
  // ------------------------------------------------------------
  const routing = LORA_ROUTING[baseModel] || { loras: [] };

  wf[loraNodeId].inputs.loras = routing.loras.map((l: any) => ({
    lora_name: l.name,
    strength: l.strength,
  }));

  // ------------------------------------------------------------
  // USER LoRA (ALWAYS LAST)
  // ------------------------------------------------------------
  if (loraPath) {
    const filename = loraPath.split("/").pop();
    wf[loraNodeId].inputs.loras.push({
      // Resolved via symlink:
      // /workspace/ComfyUI/models/loras/sirensforge_cache -> /workspace/cache/loras
      lora_name: `sirensforge_cache/${filename}`,
      strength: 1.0,
    });
  }

  // ------------------------------------------------------------
  // PROMPT / NEGATIVE
  // ------------------------------------------------------------
  for (const id of Object.keys(wf)) {
    const node = wf[id];
    if (node?.class_type === "CLIPTextEncode") {
      if (node.inputs?.text === "{prompt}") node.inputs.text = prompt;
      if (node.inputs?.text === "{negative_prompt}") node.inputs.text = negative;
    }
  }

  // ------------------------------------------------------------
  // SAMPLER + LATENT
  // ------------------------------------------------------------
  for (const id of Object.keys(wf)) {
    const node = wf[id];
    if (node?.class_type === "KSampler") {
      node.inputs.seed = seed;
      node.inputs.steps = steps;
      node.inputs.cfg = cfg;
    }
    if (node?.class_type === "EmptyLatentImage") {
      node.inputs.width = width;
      node.inputs.height = height;
      node.inputs.batch_size = 1;
    }
  }

  // ------------------------------------------------------------
  // DNA / FACE ID (future-ready, inactive at launch)
  // ------------------------------------------------------------
  if (dnaImageNames.length >= 3) {
    const loadIds: string[] = [];

    for (const name of dnaImageNames.slice(0, 8)) {
      const id = String(nextId++);
      wf[id] = {
        class_type: "LoadImage",
        inputs: { image: name },
      };
      loadIds.push(id);
    }

    const batchId = String(nextId++);
    const batchInputs: any = {};
    loadIds.forEach((id, i) => {
      batchInputs[`image${i + 1}`] = [id, 0];
    });

    wf[batchId] = {
      class_type: "ImageBatch",
      inputs: batchInputs,
    };

    const strength =
      fluxLock?.strength === "subtle"
        ? 0.55
        : fluxLock?.strength === "strong"
        ? 0.9
        : 0.75;

    const faceNodeId = String(nextId++);
    wf[faceNodeId] = {
      class_type: FACEID_NODE_CLASS,
      inputs: {
        model: [loraNodeId, 0],
        image: [batchId, 0],
        weight: strength,
      },
    };

    for (const id of Object.keys(wf)) {
      const node = wf[id];
      if (node?.class_type === "KSampler") {
        node.inputs.model = [faceNodeId, 0];
      }
    }
  }

  return wf;
}
