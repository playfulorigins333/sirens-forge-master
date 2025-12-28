/* ============================================================
   Sirens Forge — Vault Capabilities Registry (PRODUCTION)
   ------------------------------------------------------------
   PURPOSE
   - Define vaults as STRUCTURAL CAPABILITIES, not text blobs
   - Gate by Mode AND OutputType
   - Enable suggestion + orchestration layers
   - Future-proof for expansion (Vault 31+)
   ============================================================ */

export type Mode = "SAFE" | "NSFW" | "ULTRA";
export type OutputType = "IMAGE" | "VIDEO" | "STORY";

/* ------------------------------------------------------------
   Structural contract for what a vault contributes
   ------------------------------------------------------------ */
export interface VaultContribution {
  /** Semantic tags used by prompt / scene builder */
  attributes: string[];

  /** Optional weighted hints (used by orchestrator) */
  weights?: Record<string, number>;

  /** Optional scene flags */
  flags?: string[];
}

/* ------------------------------------------------------------
   Vault definition
   ------------------------------------------------------------ */
export interface VaultCapability {
  id: string;
  label: string;
  category:
    | "composition"
    | "lighting"
    | "camera"
    | "color"
    | "body"
    | "expression"
    | "texture"
    | "context"
    | "psychology"
    | "multi"
    | "style"
    | "sensory"
    | "extreme";

  /** Minimum mode required to unlock */
  minMode: Mode;

  /** Allowed output targets */
  allowedOutputs: OutputType[];

  /** Structured contributions by output type */
  contributions: Partial<Record<OutputType, VaultContribution>>;

  /** Optional synergy vault IDs */
  synergy?: string[];
}

/* ------------------------------------------------------------
   Mode ordering helper
   ------------------------------------------------------------ */
const MODE_ORDER: Mode[] = ["SAFE", "NSFW", "ULTRA"];

export function isVaultAllowed(
  vault: VaultCapability,
  mode: Mode,
  output: OutputType
): boolean {
  return (
    MODE_ORDER.indexOf(mode) >= MODE_ORDER.indexOf(vault.minMode) &&
    vault.allowedOutputs.includes(output)
  );
}

/* ------------------------------------------------------------
   VAULT REGISTRY
   ------------------------------------------------------------ */
export const VAULT_CAPABILITIES: VaultCapability[] = [
  /* =============================
     Core Visual / Structural
     ============================= */

  {
    id: "composition_framing_ultra",
    label: "Composition & Framing Ultra",
    category: "composition",
    minMode: "SAFE",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "cinematic framing",
          "intentional composition",
          "dynamic perspective",
        ],
      },
      VIDEO: {
        attributes: [
          "cinematic blocking",
          "camera-driven storytelling",
        ],
      },
    },
  },

  {
    id: "lighting_environment",
    label: "Lighting & Environmental Effects",
    category: "lighting",
    minMode: "SAFE",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "dramatic lighting",
          "atmospheric shadows",
          "environmental depth",
        ],
      },
      VIDEO: {
        attributes: [
          "dynamic lighting transitions",
          "environmental ambience",
        ],
      },
    },
  },

  {
    id: "camera_lens_style",
    label: "Camera Style & Lens Effects",
    category: "camera",
    minMode: "SAFE",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "shallow depth of field",
          "cinematic lens language",
        ],
      },
      VIDEO: {
        attributes: [
          "lens-driven motion",
          "cinematic camera movement",
        ],
      },
    },
  },

  {
    id: "color_mood",
    label: "Color, Tone & Visual Mood",
    category: "color",
    minMode: "SAFE",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "intentional color grading",
          "mood-driven palette",
        ],
      },
      VIDEO: {
        attributes: [
          "tonal continuity",
          "emotional color arcs",
        ],
      },
    },
  },

  /* =============================
     Body / Physical Focus
     ============================= */

  {
    id: "upper_body_focus",
    label: "Breasts, Chest & Upper Body",
    category: "body",
    minMode: "NSFW",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "upper body emphasis",
          "anatomical focus",
        ],
      },
      VIDEO: {
        attributes: [
          "body-driven framing",
        ],
      },
    },
  },

  {
    id: "legs_hips_focus",
    label: "Legs, Thighs & Hips",
    category: "body",
    minMode: "NSFW",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "lower body emphasis",
          "sensual posture",
        ],
      },
    },
  },

  {
    id: "bondage_positions",
    label: "Position, Restraint & Bondage",
    category: "context",
    minMode: "NSFW",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "restrained positioning",
          "implied control",
        ],
      },
      VIDEO: {
        attributes: [
          "positional dominance",
        ],
      },
    },
  },

  {
    id: "face_expression",
    label: "Face, Mouth & Expressions",
    category: "expression",
    minMode: "SAFE",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "expressive facial detail",
          "emotional nuance",
        ],
      },
    },
  },

  {
    id: "eyes_gaze",
    label: "Eyes, Gaze & Emotion",
    category: "expression",
    minMode: "SAFE",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "intentional eye contact",
          "emotional gaze",
        ],
      },
    },
  },

  {
    id: "skin_texture",
    label: "Skin, Sweat, Marks & Texture",
    category: "texture",
    minMode: "NSFW",
    allowedOutputs: ["IMAGE", "VIDEO"],
    contributions: {
      IMAGE: {
        attributes: [
          "realistic skin texture",
          "physical realism",
        ],
      },
    },
  },

  /* =============================
     Context & Power
     ============================= */

  {
    id: "public_risk_ultra",
    label: "Public Risk & Exhibition Ultra",
    category: "context",
    minMode: "ULTRA",
    allowedOutputs: ["IMAGE", "VIDEO", "STORY"],
    contributions: {
      STORY: {
        attributes: [
          "public exposure",
          "risk escalation",
        ],
      },
    },
  },

  {
    id: "private_intimacy",
    label: "Private Intimacy & Soft Scenes",
    category: "context",
    minMode: "SAFE",
    allowedOutputs: ["IMAGE", "VIDEO", "STORY"],
    contributions: {
      STORY: {
        attributes: [
          "emotional closeness",
          "private connection",
        ],
      },
    },
  },

  {
    id: "domination_control",
    label: "Domination & Control",
    category: "psychology",
    minMode: "ULTRA",
    allowedOutputs: ["IMAGE", "VIDEO", "STORY"],
    contributions: {
      STORY: {
        attributes: [
          "power imbalance",
          "command authority",
        ],
      },
    },
  },

  {
    id: "submission_obedience",
    label: "Submission & Obedience",
    category: "psychology",
    minMode: "NSFW",
    allowedOutputs: ["IMAGE", "VIDEO", "STORY"],
    contributions: {
      STORY: {
        attributes: [
          "voluntary submission",
          "obedient mindset",
        ],
      },
    },
  },

  {
    id: "ultra_extremes",
    label: "Ultra Extremes / No-Limits Layer",
    category: "extreme",
    minMode: "ULTRA",
    allowedOutputs: ["IMAGE", "VIDEO", "STORY"],
    contributions: {
      STORY: {
        attributes: [
          "limit removal",
          "no-restraint escalation",
        ],
      },
    },
  },
];

/* ------------------------------------------------------------
   Utility helpers
   ------------------------------------------------------------ */
export function getVaultById(id: string): VaultCapability | undefined {
  return VAULT_CAPABILITIES.find((v) => v.id === id);
}

export function getAllowedVaults(
  mode: Mode,
  output: OutputType
): VaultCapability[] {
  return VAULT_CAPABILITIES.filter((v) =>
    isVaultAllowed(v, mode, output)
  );
}
