export type BaseModelKey = "feminine" | "masculine" | "mtf" | "ftm";

export interface LoraConfig {
  name: string;
  strength: number;
}

export interface RoutingEntry {
  loras: LoraConfig[];
}

export const LORA_ROUTING: Record<BaseModelKey, RoutingEntry> = {
  feminine: {
    loras: []
  },

  masculine: {
    loras: [
      { name: "Gay_NSFW_SDXL-000001.safetensors", strength: 0.85 }
    ]
  },

  mtf: {
    loras: [
      { name: "realistic-mtf-trans.safetensors", strength: 0.85 },
      { name: "natural_breasts_epoch_5.safetensors", strength: 0.65 }
    ]
  },

  ftm: {
    loras: [
      { name: "FTM_trans_man.safetensors", strength: 0.85 }
    ]
  }
};
