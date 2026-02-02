// lib/comfy/buildWorkflow.ts
// PRODUCTION-LOCKED — Deterministic identity-first workflow builder
// Base → Body → Identity (strict, sequential LoRA application)

import type { ResolvedLoraStack } from "@/lib/generation/lora-resolver";

type FluxLock = { type?: string; strength?: string } | null;

interface BuildWorkflowArgs {
  prompt: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  width: number;
  height: number;

  // Ordered LoRA stack (base already loaded via checkpoint)
  loraStack: ResolvedLoraStack;

  dnaImageNames?: string[];
  fluxLock?: FluxLock;
}

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
  // 🔒 IMPORTANT:
  // Load workflow JSON at CALL TIME, not import time (serverless-safe)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const baseWorkflow = require("./workflow-base.json");

  const wf: any = JSON.parse(JSON.stringify(baseWorkflow));
  const nodeIds = Object.keys(wf);

  let nextId =
    Math.max(...nodeIds.map((id) => parseInt(id, 10))) + 1;

  // ------------------------------------------------------------
  // Find base model + clip source
  // ------------------------------------------------------------
  const baseModelNodeId = nodeIds.find(
    (id) => wf[id]?.class_type === "CheckpointLoaderSimple"
  );
  if (!baseModelNodeId) {
    throw new Error("CheckpointLoaderSimple not found");
  }

  let currentModel: [string, number] = [baseModelNodeId, 0];
  let currentClip: [string, number] = [baseModelNodeId, 1];

  // ------------------------------------------------------------
  // APPLY LoRAs SEQUENTIALLY (BODY → IDENTITY)
  // ------------------------------------------------------------
  for (const l of loraStack.loras) {
    const id = String(nextId++);

    wf[id] = {
      class_type: "LoraLoader",
      inputs: {
        // 🔒 FINAL CONTRACT:
        // Resolver already returned the exact ComfyUI filename.
        lora_name: l.path,
        strength_model: l.strength,
        strength_clip: l.strength,
        model: currentModel,
        clip: currentClip,
      },
    };

    currentModel = [id, 0];
    currentClip = [id, 1];
  }

  // ------------------------------------------------------------
  // PROMPT / NEGATIVE
  // ------------------------------------------------------------
  for (const id of Object.keys(wf)) {
    const node = wf[id];
    if (node?.class_type === "CLIPTextEncode") {
      if (node.inputs?.text === "{prompt}") node.inputs.text = prompt;
      if (node.inputs?.text === "{negative_prompt}") {
        node.inputs.text = negative;
      }
      node.inputs.clip = currentClip;
    }
  }

  // ------------------------------------------------------------
  // SAMPLER + LATENT
  // ------------------------------------------------------------
  for (const id of Object.keys(wf)) {
    const node = wf[id];
    if (node?.class_type === "KSampler") {
      node.inputs.model = currentModel;
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
  // DNA / FACE ID (future-ready)
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
        model: currentModel,
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
