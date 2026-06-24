// lib/comfy/buildWorkflow.ts
// PRODUCTION — Dynamic ComfyUI workflow builder (FINAL — FIXED FOR API WORKFLOW)

import path from "path";
import workflowBase from "@/lib/comfy/workflow-base";
import type { ResolvedLoraStack } from "@/lib/generation/lora-resolver";

type BuildWorkflowInput = {
  prompt: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  loraStack: ResolvedLoraStack;
  batch?: number;
  dnaImageNames: string[];
  fluxLock: any;
};

export function buildWorkflow(input: BuildWorkflowInput) {
  // Clone the bundled TS workflow template for a fresh mutable graph per request.
  const workflow = JSON.parse(JSON.stringify(workflowBase));

  const {
    prompt,
    negative,
    seed,
    steps,
    cfg,
    width,
    height,
    loraStack,
    batch,
  } = input;

  /* ------------------------------------------------
   * NODE SHORTCUTS (IDs come from exported API workflow)
   * ------------------------------------------------ */
  const KSampler = workflow["3"];
  const CheckpointLoader = workflow["4"];
  const EmptyLatent = workflow["5"];
  const PositivePrompt = workflow["6"];
  const NegativePrompt = workflow["7"];

  /* ------------------------------------------------
   * PROMPTS
   * ------------------------------------------------ */
  PositivePrompt.inputs.text = prompt;
  NegativePrompt.inputs.text = negative;

  /* ------------------------------------------------
   * SAMPLER SETTINGS
   * ------------------------------------------------ */
  KSampler.inputs.seed = seed ?? Math.floor(Math.random() * 999999999);
  KSampler.inputs.steps = steps;
  KSampler.inputs.cfg = cfg;

  /* ------------------------------------------------
   * RESOLUTION
   * ------------------------------------------------ */
  EmptyLatent.inputs.width = width;
  EmptyLatent.inputs.height = height;
  EmptyLatent.inputs.batch_size = batch ?? EmptyLatent.inputs.batch_size;

  /* ------------------------------------------------
   * BASE MODEL
   * ------------------------------------------------ */
  const baseModelFile = path.basename(loraStack.base_model.path);
  CheckpointLoader.inputs.ckpt_name = baseModelFile;

  /* ------------------------------------------------
   * FIND LoRAs
   * ------------------------------------------------ */
  const bodyLora = loraStack.loras.find(l => l.path.startsWith("body_"));
  const identityLora = loraStack.loras.find(l => l.path.startsWith("identity_"));

  /* ------------------------------------------------
   * BUILD MODEL CHAIN 🔥
   * ------------------------------------------------ */
  let lastModelNode: any = ["4", 0];
  let lastClipNode: any  = ["4", 1];

  /* ---------------- BODY LoRA ---------------- */
  if (bodyLora) {
    workflow["12"] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: bodyLora.path,
        strength_model: bodyLora.strength,
        strength_clip: bodyLora.strength * 0.5,
        model: lastModelNode,
        clip: lastClipNode,
      },
    };

    lastModelNode = ["12", 0];
    lastClipNode  = ["12", 1];
  } else {
    delete workflow["12"];
  }

  /* ---------------- IDENTITY LoRA ---------------- */
  if (identityLora) {
    workflow["13"] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: identityLora.path,
        strength_model: 1.15, // locked identity strength
        strength_clip: 1.0,
        model: lastModelNode,
        clip: lastClipNode,
      },
    };

    lastModelNode = ["13", 0];
    lastClipNode  = ["13", 1];
  } else {
    delete workflow["13"];
  }

  /* ------------------------------------------------
   * CONNECT FINAL MODEL TO SAMPLER + CLIP
   * ------------------------------------------------ */
  KSampler.inputs.model = lastModelNode;
  PositivePrompt.inputs.clip = lastClipNode;
  NegativePrompt.inputs.clip = lastClipNode;

  return workflow;
}
