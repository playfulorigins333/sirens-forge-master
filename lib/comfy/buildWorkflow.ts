// lib/comfy/buildWorkflow.ts
// PRODUCTION — Dynamic ComfyUI workflow builder

import fs from "fs";
import path from "path";
import { ResolvedLoraStack } from "@/lib/generation/lora-resolver";

type BuildWorkflowInput = {
  prompt: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  loraStack: ResolvedLoraStack;
  dnaImageNames: string[];
  fluxLock: any;
};

export function buildWorkflow(input: BuildWorkflowInput) {
  const workflowPath = path.join(
    process.cwd(),
    "lib/comfy/workflow-base.json"
  );

  const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf-8"));

  const {
    prompt,
    negative,
    seed,
    steps,
    cfg,
    width,
    height,
    loraStack,
  } = input;

  /* ------------------------------------------------
   * NODE SHORTCUTS
   * ------------------------------------------------ */
  const KSampler = workflow["3"];
  const CheckpointLoader = workflow["4"];
  const EmptyLatent = workflow["5"];
  const PositivePrompt = workflow["6"];
  const NegativePrompt = workflow["7"];
  const BodyLoraNode = workflow["12"];
  const IdentityLoraNode = workflow["13"];

  /* ------------------------------------------------
   * PROMPTS
   * ------------------------------------------------ */
  PositivePrompt.inputs.text = prompt;
  NegativePrompt.inputs.text = negative;

  /* ------------------------------------------------
   * SAMPLER SETTINGS
   * ------------------------------------------------ */
  KSampler.inputs.seed = seed || Math.floor(Math.random() * 999999999);
  KSampler.inputs.steps = steps;
  KSampler.inputs.cfg = cfg;

  /* ------------------------------------------------
   * RESOLUTION
   * ------------------------------------------------ */
  EmptyLatent.inputs.width = width;
  EmptyLatent.inputs.height = height;

  /* ------------------------------------------------
   * BASE MODEL
   * ------------------------------------------------ */
  const baseModelFile = path.basename(loraStack.base_model.path);
  CheckpointLoader.inputs.ckpt_name = baseModelFile;

  /* ------------------------------------------------
   * LoRA INJECTION SYSTEM 🔥
   * ------------------------------------------------ */
  const bodyLora = loraStack.loras.find(l =>
    l.path.startsWith("body_")
  );

  const identityLora = loraStack.loras.find(l =>
    l.path.startsWith("identity_")
  );

  /* ---------------------------
   * BODY LoRA
   * --------------------------- */
  if (bodyLora) {
    BodyLoraNode.inputs.lora_name = bodyLora.path;
    BodyLoraNode.inputs.strength_model = bodyLora.strength;
    BodyLoraNode.inputs.strength_clip = bodyLora.strength * 0.5;
  } else {
    delete workflow["12"]; // remove node if not used
  }

  /* ---------------------------
   * IDENTITY LoRA
   * --------------------------- */
  if (identityLora) {
    IdentityLoraNode.inputs.lora_name = identityLora.path;
    IdentityLoraNode.inputs.strength_model = identityLora.strength;
    IdentityLoraNode.inputs.strength_clip = identityLora.strength;
  } else {
    delete workflow["13"]; // remove node if user selected "None"
  }

  return workflow;
}
