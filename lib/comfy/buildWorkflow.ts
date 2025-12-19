import baseWorkflow from "./workflow-base.json";
import { LORA_ROUTING, BaseModelKey } from "../lora/lora-routing";

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

  // Optional launch features
  loraPath?: string | null;      // 👈 FIX: allow resolved user LoRA
  dnaImageNames?: string[];      // Comfy filenames in /input
  fluxLock?: FluxLock;
}

/**
 * IMPORTANT:
 * This assumes your ComfyUI has:
 * - LoadImage
 * - ImageBatch
 * - LoraLoader
 * - IPAdapter / FaceID node
 */
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
  const wf: any = JSON.parse(JSON.stringify(baseWorkflow));
  const nodeIds = Object.keys(wf);

  const maxId = nodeIds.reduce((m, id) => Math.max(m, parseInt(id, 10)), 0);
  let nextId = Number.isFinite(maxId) ? maxId + 1 : 100;

  // ------------------------------------------------------------
  // FIND REQUIRED NODES
  // ------------------------------------------------------------
  const loraNodeId = nodeIds.find(
    (id) => wf[id]?.class_type === "LoraLoader"
  );
  if (!loraNodeId) {
    throw new Error("❌ No LoraLoader node found in workflow-base.json");
  }

  // ------------------------------------------------------------
  // BASE MODEL ROUTING (system LoRAs)
  // ------------------------------------------------------------
  const routing = LORA_ROUTING[baseModel] || { loras: [] };
  wf[loraNodeId].inputs.loras = routing.loras.map((l) => ({
    lora_name: l.name,
    strength: l.strength,
  }));

  // ------------------------------------------------------------
  // USER LoRA (single, optional, launch-safe)
  // ------------------------------------------------------------
  if (loraPath) {
    wf[loraNodeId].inputs.loras.push({
      lora_name: loraPath,
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
  // DNA / FACE ID BLENDING (3–8 refs)
  // ------------------------------------------------------------
  if (dnaImageNames.length >= 3) {
    const loadIds: string[] = [];

    for (const name of dnaImageNames.slice(0, 8)) {
      const id = String(nextId++);
      wf[id] = {
        class_type: "LoadImage",
        inputs: {
          image: name,
          upload: "image",
        },
      };
      loadIds.push(id);
    }

    const batchId = String(nextId++);
    const batchInputs: any = {};
    loadIds.forEach((id, idx) => {
      batchInputs[`image${idx + 1}`] = [id, 0];
    });

    wf[batchId] = {
      class_type: "ImageBatch",
      inputs: batchInputs,
    };

    const faceStrength =
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
        weight: faceStrength,
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
