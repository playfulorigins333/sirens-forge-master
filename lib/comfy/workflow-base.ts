// lib/comfy/workflow-base.ts
// ComfyUI base workflow exported as a TS module so Vercel can bundle it

const workflowBase = {
  "3": {
    inputs: {
      seed: 0,
      steps: 20,
      cfg: 7,
      sampler_name: "dpmpp_2m",
      scheduler: "karras",
      denoise: 1,
      model: ["4", 0],
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: ["5", 0]
    },
    class_type: "KSampler",
    _meta: { title: "KSampler" }
  },

  "4": {
    inputs: { ckpt_name: "bigLust_v16.safetensors" },
    class_type: "CheckpointLoaderSimple",
    _meta: { title: "Load Checkpoint" }
  },

  "5": {
    inputs: { width: 1024, height: 1024, batch_size: 1 },
    class_type: "EmptyLatentImage",
    _meta: { title: "Empty Latent Image" }
  },

  "6": {
    inputs: { text: "photo of a person", clip: ["4", 1] },
    class_type: "CLIPTextEncode",
    _meta: { title: "{prompt}" }
  },

  "7": {
    inputs: { text: "blurry, low quality", clip: ["4", 1] },
    class_type: "CLIPTextEncode",
    _meta: { title: "{negative_prompt}" }
  },

  "8": {
    inputs: { samples: ["3", 0], vae: ["4", 2] },
    class_type: "VAEDecode",
    _meta: { title: "VAE Decode" }
  },

  "9": {
    inputs: { filename_prefix: "sf_base", images: ["8", 0] },
    class_type: "SaveImage",
    _meta: { title: "Save Image" }
  },

  "15": {
    inputs: { images: ["8", 0] },
    class_type: "SaveImageWebsocket",
    _meta: { title: "SaveImageWebsocket" }
  }
} as const;

export default workflowBase;
