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
  dnaImageNames?: string[]; // Comfy filenames in /input
  fluxLock?: FluxLock;
}

/**
 * IMPORTANT:
 * This assumes your ComfyUI has:
 * - LoadImage (standard)
 * - ImageBatch (standard)
 * - A FaceID/IPAdapter node installed that accepts:
 *    model + image batch + weight/strength and outputs conditioned model
 *
 * In most setups, this comes from IPAdapter / FaceID custom nodes.
 * If your node name differs, change FACEID_NODE_CLASS below to match.
 */
const FACEID_NODE_CLASS = "IPAdapterFaceID"; // <-- if your node class differs, change this

export function buildWorkflow({
  prompt,
  negative,
  seed,
  steps,
  cfg,
  width,
  height,
  baseModel,
  dnaImageNames = [],
  fluxLock = null,
}: BuildWorkflowArgs) {
  const wf: any = JSON.parse(JSON.stringify(baseWorkflow));
  const nodeIds = Object.keys(wf);

  const maxId = nodeIds.reduce((m, id) => Math.max(m, parseInt(id, 10)), 0);
  let nextId = Number.isFinite(maxId) ? maxId + 1 : 100;

  // ---- find nodes we already have
  const loraNodeId = nodeIds.find((id) => wf[id]?.class_type === "LoraLoader");
  if (!loraNodeId) throw new Error("❌ No LoraLoader node found in workflow-base.json");

  // ---- inject LoRAs from routing table
  const routing = LORA_ROUTING[baseModel] || { loras: [] };
  wf[loraNodeId].inputs.loras = routing.loras.map((l) => ({
    lora_name: l.name,
    strength: l.strength,
  }));

  // ---- inject prompt / negative
  for (const id of Object.keys(wf)) {
    const node = wf[id];
    if (node?.class_type === "CLIPTextEncode") {
      if (node.inputs?.text === "{prompt}") node.inputs.text = prompt;
      if (node.inputs?.text === "{negative_prompt}") node.inputs.text = negative;
    }
  }

  // ---- inject sampler + latent size
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
  // DNA BLENDING (3–8 refs) — inject nodes
  // ------------------------------------------------------------
  // We condition the model BEFORE sampling:
  // CheckpointLoader → LoraLoader → (optional FaceID/IPAdapter) → KSampler
  //
  // In base workflow, KSampler model input is ["1",0] (LoraLoader output).
  // If DNA refs exist, we insert a conditioner node and redirect KSampler model input.
  // ------------------------------------------------------------
  if (dnaImageNames.length >= 3) {
    // 1) Create LoadImage nodes for each DNA ref
    const loadIds: string[] = [];

    for (const name of dnaImageNames.slice(0, 8)) {
      const id = String(nextId++);
      wf[id] = {
        class_type: "LoadImage",
        inputs: {
          image: name,      // Comfy input filename
          upload: "image",  // harmless if ignored
        },
      };
      loadIds.push(id);
    }

    // 2) Create ImageBatch node (standard Comfy) to combine images
    // Many Comfy builds use: class_type = "ImageBatch"
    // and inputs: image1, image2, ...
    const batchId = String(nextId++);
    const batchInputs: any = {};
    loadIds.forEach((id, idx) => {
      batchInputs[`image${idx + 1}`] = [id, 0];
    });

    wf[batchId] = {
      class_type: "ImageBatch",
      inputs: batchInputs,
    };

    // 3) Create FaceID/IPAdapter conditioning node
    // This node should output a MODEL that is identity-conditioned.
    // If your node outputs different ports, adjust indices.
    const faceStrength =
      fluxLock?.strength === "subtle" ? 0.55 : fluxLock?.strength === "strong" ? 0.9 : 0.75;

    const faceNodeId = String(nextId++);
    wf[faceNodeId] = {
      class_type: FACEID_NODE_CLASS,
      inputs: {
        model: [loraNodeId, 0],   // LoraLoader MODEL
        image: [batchId, 0],      // batched DNA refs
        weight: faceStrength,     // blend strength
      },
    };

    // 4) Redirect KSampler to use conditioned model
    for (const id of Object.keys(wf)) {
      const node = wf[id];
      if (node?.class_type === "KSampler") {
        node.inputs.model = [faceNodeId, 0];
      }
    }
  }

  return wf;
}
