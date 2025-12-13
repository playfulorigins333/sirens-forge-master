import baseWorkflow from "./workflow-base.json";
import { LORA_ROUTING, BaseModelKey } from "../lora/lora-routing";

interface BuildWorkflowArgs {
  prompt: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  baseModel: BaseModelKey;
}

export function buildWorkflow({
  prompt,
  negative,
  seed,
  steps,
  cfg,
  baseModel,
}: BuildWorkflowArgs) {
  
  // 🔥 1. Deep clone the workflow JSON so we don’t mutate the original template
  const wf: any = JSON.parse(JSON.stringify(baseWorkflow));

  // 🔥 2. Find LoraLoader node dynamically
  // (We don’t hardcode node IDs — safer for future workflow changes)
  const nodeIds = Object.keys(wf);
  const loraNodeId = nodeIds.find(
    (id) => wf[id]?.class_type === "LoraLoader"
  );

  if (!loraNodeId) {
    throw new Error("❌ No LoraLoader node found in workflow-base.json");
  }

  // 🔥 3. Load LoRAs from routing table
  const routing = LORA_ROUTING[baseModel] || { loras: [] };

  const lorasPayload = routing.loras.map((l) => ({
    lora_name: l.name,
    strength: l.strength,
  }));

  // Inject LoRAs array into that node
  wf[loraNodeId].inputs.loras = lorasPayload;

  // 🔥 4. Inject prompt + negative prompt into the CLIPTextEncode nodes
  for (const id of nodeIds) {
    const node = wf[id];
    if (!node?.class_type) continue;

    if (node.class_type === "CLIPTextEncode") {
      if (node.inputs?.text === "{prompt}") {
        node.inputs.text = prompt;
      }

      if (node.inputs?.text === "{negative_prompt}") {
        node.inputs.text = negative;
      }
    }
  }

  // 🔥 5. Inject sampler params
  for (const id of nodeIds) {
    const node = wf[id];
    if (node?.class_type === "KSampler") {
      node.inputs.seed = seed;
      node.inputs.steps = steps;
      node.inputs.cfg = cfg;
    }
  }

  return wf;
}
