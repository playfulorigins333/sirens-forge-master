import baseWorkflow from "./workflow-base.json";
import { LORA_ROUTING, BaseModelKey } from "../lora/lora-routing";

interface BuildWorkflowArgs {
  prompt: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  baseModel: BaseModelKey;

  // DNA Lock (optional)
  dnaImageName?: string | null;
  dnaStrength?: number;
}

export function buildWorkflow({
  prompt,
  negative,
  seed,
  steps,
  cfg,
  baseModel,
  dnaImageName = null,
  dnaStrength = 0.85,
}: BuildWorkflowArgs) {
  const wf: any = JSON.parse(JSON.stringify(baseWorkflow));
  const nodeIds = Object.keys(wf);

  // --- Find nodes dynamically
  const findNode = (type: string) =>
    nodeIds.find((id) => wf[id]?.class_type === type);

  const loraNodeId = findNode("LoraLoader");
  const ipAdapterId = findNode("IPAdapterFaceID");
  const loadImageId = findNode("LoadImage");

  if (!loraNodeId) {
    throw new Error("No LoraLoader node found");
  }

  // --- LoRA routing
  const routing = LORA_ROUTING[baseModel] || { loras: [] };
  wf[loraNodeId].inputs.loras = routing.loras;

  // --- Inject prompt + negative
  for (const id of nodeIds) {
    const node = wf[id];
    if (node?.class_type === "CLIPTextEncode") {
      if (node.inputs.text === "{prompt}") node.inputs.text = prompt;
      if (node.inputs.text === "{negative_prompt}") node.inputs.text = negative;
    }
  }

  // --- Sampler params
  for (const id of nodeIds) {
    const node = wf[id];
    if (node?.class_type === "KSampler") {
      node.inputs.seed = seed;
      node.inputs.steps = steps;
      node.inputs.cfg = cfg;
    }
  }

  // --- DNA Lock logic
  if (ipAdapterId && loadImageId) {
    if (dnaImageName && dnaImageName.trim()) {
      wf[loadImageId].inputs.image = dnaImageName;
      wf[ipAdapterId].inputs.weight = clamp01(dnaStrength);
    } else {
      // No ref → behave like pure txt2img
      wf[loadImageId].inputs.image = "___NO_DNA___.png";
      wf[ipAdapterId].inputs.weight = 0;
    }
  }

  return wf;
}

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
