// lib/comfy/buildWorkflow.ts
// LAUNCH-SAFE — Deterministic workflow builder
// Uses explicit LoRA stack (BigLust + optional body + optional user)

import type { ResolvedLoraStack } from "@/lib/generation/lora-resolver";

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

  // ✅ LOCKED: explicit ordered LoRA stack
  loraStack: ResolvedLoraStack;

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
  loraStack,
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
  // APPLY EXPLICIT LoRA STACK (ORDERED, DETERMINISTIC)
  // ------------------------------------------------------------
  wf[loraNodeId].inputs.loras = loraStack.loras.map((l) => ({
    lora_name: l.path.includes("/workspace/cache/loras/")
      ? `sirensforge_cache/${l.path.split("/").pop()}`
      : l.path.split("/").pop(),
    strength: l.strength,
  }));

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
