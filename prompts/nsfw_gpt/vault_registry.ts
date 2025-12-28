// prompts/nsfw_gpt/vault_registry.ts
// SirensForge — NSFW GPT Vault Registry (LOCKED)
// Single source of truth for vault definitions + gating + validation.

export type Mode = "SAFE" | "NSFW" | "ULTRA";

export type VaultCategory =
  | "core_visual"
  | "body"
  | "context"
  | "psychology"
  | "multi_person"
  | "style_identity"
  | "sensory_intensity";

export type VaultId =
  // 🎥 Core Visual / Structural
  | "composition_framing_ultra"
  | "lighting_environment"
  | "camera_style_lens"
  | "color_tone_mood"
  // 🧍 Body-Focused
  | "breasts_chest_upper_body"
  | "legs_thighs_hips"
  | "bondage_positions"
  | "face_mouth_expressions"
  | "eyes_gaze_emotion"
  | "skin_sweat_marks_texture"
  // 🌍 Context & Scenario
  | "public_risk_exhibition_ultra"
  | "private_intimacy_soft"
  | "anal_ass_tail_ultra"
  | "oral_throat_mouth"
  | "fluid_mess_aftermath"
  // 🧠 Psychological / Power Dynamics
  | "domination_control"
  | "submission_obedience"
  | "praise_degradation_mindplay"
  | "ritual_ceremony_symbolism"
  | "hands_fingers_nails_ultra"
  // 👥 Multi-Person / Advanced Dynamics
  | "multi_partner_orgy_cuckoldry_ultra"
  | "partner_interaction_power_exchange"
  | "voyeur_filming_performance"
  | "audience_crowd_exposure"
  // 🧥 Style, Clothing & Identity
  | "clothing_lingerie_accessories"
  | "latex_leather_fetishwear"
  | "roleplay_fantasy_costume_ultra"
  // 🧪 Sensory & Physical Intensity
  | "smell_sweat_pheromones_ultra"
  | "pain_endurance_threshold"
  | "ultra_extremes_no_limits";

export type VaultDef = {
  id: VaultId;
  label: string; // UI label
  category: VaultCategory;
  minMode: Mode; // gating
  description?: string; // optional UI helper text
};

export const MODE_RANK: Record<Mode, number> = {
  SAFE: 0,
  NSFW: 1,
  ULTRA: 2,
};

export function isModeAllowed(current: Mode, requiredMin: Mode): boolean {
  return MODE_RANK[current] >= MODE_RANK[requiredMin];
}

export const VAULT_DEFS: readonly VaultDef[] = [
  // ---------------------------------------------------------------------------
  // 🎥 Core Visual / Structural Vaults
  // ---------------------------------------------------------------------------
  {
    id: "composition_framing_ultra",
    label: "Composition & Framing Ultra",
    category: "core_visual",
    minMode: "SAFE",
    description: "Camera angles, POV, framing logic, cinematic positioning.",
  },
  {
    id: "lighting_environment",
    label: "Lighting & Environmental Effects",
    category: "core_visual",
    minMode: "SAFE",
    description: "Lighting, weather, atmosphere, reflections, ambience.",
  },
  {
    id: "camera_style_lens",
    label: "Camera Style & Lens Effects",
    category: "core_visual",
    minMode: "SAFE",
    description: "Depth of field, blur, grain, cinematic lens language.",
  },
  {
    id: "color_tone_mood",
    label: "Color, Tone & Visual Mood",
    category: "core_visual",
    minMode: "SAFE",
    description: "Neon, monochrome, pastel, noir, warm/cold palettes.",
  },

  // ---------------------------------------------------------------------------
  // 🧍 Body-Focused Vaults
  // ---------------------------------------------------------------------------
  {
    id: "breasts_chest_upper_body",
    label: "Breasts, Chest & Upper Body",
    category: "body",
    minMode: "NSFW",
  },
  {
    id: "legs_thighs_hips",
    label: "Legs, Thighs & Hips",
    category: "body",
    minMode: "NSFW",
  },
  {
    id: "bondage_positions",
    label: "Position, Restraint & Bondage",
    category: "body",
    minMode: "NSFW",
    description: "Poses, tied positions, furniture, suspension (stack-dependent).",
  },
  {
    id: "face_mouth_expressions",
    label: "Face, Mouth & Expressions",
    category: "body",
    minMode: "SAFE",
  },
  {
    id: "eyes_gaze_emotion",
    label: "Eyes, Gaze & Emotion",
    category: "body",
    minMode: "SAFE",
  },
  {
    id: "skin_sweat_marks_texture",
    label: "Skin, Sweat, Marks & Texture",
    category: "body",
    minMode: "NSFW",
  },

  // ---------------------------------------------------------------------------
  // 🌍 Context & Scenario Vaults
  // ---------------------------------------------------------------------------
  {
    id: "public_risk_exhibition_ultra",
    label: "Public Risk & Exhibition Ultra",
    category: "context",
    minMode: "ULTRA",
    description: "Public locations, risk, exposure, voyeurism.",
  },
  {
    id: "private_intimacy_soft",
    label: "Private Intimacy & Soft Scenes",
    category: "context",
    minMode: "NSFW",
  },
  {
    id: "anal_ass_tail_ultra",
    label: "Anal, Ass & Tail Ultra",
    category: "context",
    minMode: "ULTRA",
    description: "Rear focus, plugs, positioning.",
  },
  {
    id: "oral_throat_mouth",
    label: "Oral, Throat & Mouth Play",
    category: "context",
    minMode: "NSFW",
  },
  {
    id: "fluid_mess_aftermath",
    label: "Fluid, Mess & Aftermath",
    category: "context",
    minMode: "ULTRA",
  },

  // ---------------------------------------------------------------------------
  // 🧠 Psychological / Power Dynamics
  // ---------------------------------------------------------------------------
  {
    id: "domination_control",
    label: "Domination & Control",
    category: "psychology",
    minMode: "ULTRA",
  },
  {
    id: "submission_obedience",
    label: "Submission & Obedience",
    category: "psychology",
    minMode: "ULTRA",
  },
  {
    id: "praise_degradation_mindplay",
    label: "Praise, Degradation & Mindplay",
    category: "psychology",
    minMode: "ULTRA",
  },
  {
    id: "ritual_ceremony_symbolism",
    label: "Ritual, Ceremony & Symbolism",
    category: "psychology",
    minMode: "NSFW",
  },
  {
    id: "hands_fingers_nails_ultra",
    label: "Hands, Fingers & Nails Ultra",
    category: "psychology",
    minMode: "NSFW",
    description: "Tactile focus, grip, control (becomes extreme when stacked).",
  },

  // ---------------------------------------------------------------------------
  // 👥 Multi-Person / Advanced Dynamics
  // ---------------------------------------------------------------------------
  {
    id: "multi_partner_orgy_cuckoldry_ultra",
    label: "Multi-Partner, Orgy & Cuckoldry Ultra",
    category: "multi_person",
    minMode: "ULTRA",
  },
  {
    id: "partner_interaction_power_exchange",
    label: "Partner Interaction & Power Exchange",
    category: "multi_person",
    minMode: "NSFW",
  },
  {
    id: "voyeur_filming_performance",
    label: "Voyeur, Filming & Performance",
    category: "multi_person",
    minMode: "ULTRA",
  },
  {
    id: "audience_crowd_exposure",
    label: "Audience, Crowd & Exposure",
    category: "multi_person",
    minMode: "ULTRA",
  },

  // ---------------------------------------------------------------------------
  // 🧥 Style, Clothing & Identity
  // ---------------------------------------------------------------------------
  {
    id: "clothing_lingerie_accessories",
    label: "Clothing, Lingerie & Accessories",
    category: "style_identity",
    minMode: "SAFE",
  },
  {
    id: "latex_leather_fetishwear",
    label: "Latex, Leather & Fetishwear",
    category: "style_identity",
    minMode: "NSFW",
  },
  {
    id: "roleplay_fantasy_costume_ultra",
    label: "Roleplay, Fantasy & Costume Ultra",
    category: "style_identity",
    minMode: "ULTRA",
    description: "Characters, archetypes, uniforms.",
  },

  // ---------------------------------------------------------------------------
  // 🧪 Sensory & Physical Intensity
  // ---------------------------------------------------------------------------
  {
    id: "smell_sweat_pheromones_ultra",
    label: "Smell, Sweat & Pheromones Ultra",
    category: "sensory_intensity",
    minMode: "ULTRA",
  },
  {
    id: "pain_endurance_threshold",
    label: "Pain, Endurance & Threshold",
    category: "sensory_intensity",
    minMode: "ULTRA",
  },
  {
    id: "ultra_extremes_no_limits",
    label: "Ultra Extremes / No-Limits Layer",
    category: "sensory_intensity",
    minMode: "ULTRA",
    description: "Flag-gated, mode-locked, expansion-ready.",
  },
] as const;

export const VAULT_BY_ID: Record<VaultId, VaultDef> = (() => {
  const out = Object.create(null) as Record<VaultId, VaultDef>;
  for (const v of VAULT_DEFS) out[v.id] = v;
  return out;
})();

export function listVaultsForMode(mode: Mode): VaultDef[] {
  return VAULT_DEFS.filter((v) => isModeAllowed(mode, v.minMode));
}

export type ValidateVaultIdsResult = {
  ok: boolean;
  vault_ids: VaultId[];
  invalid_ids: string[];
  blocked_ids: VaultId[];
};

export function validateVaultIds(input: unknown, mode: Mode): ValidateVaultIdsResult {
  // Accept: undefined/null => empty, string => [string], array => array
  const rawList: unknown[] =
    input == null
      ? []
      : typeof input === "string"
        ? [input]
        : Array.isArray(input)
          ? input
          : [];

  const vault_ids: VaultId[] = [];
  const invalid_ids: string[] = [];
  const blocked_ids: VaultId[] = [];

  for (const raw of rawList) {
    if (typeof raw !== "string") continue;

    const id = raw.trim();
    if (!id) continue;

    // Validate existence
    const def = (VAULT_BY_ID as Record<string, VaultDef | undefined>)[id];
    if (!def) {
      invalid_ids.push(id);
      continue;
    }

    // Gate by mode
    if (!isModeAllowed(mode, def.minMode)) {
      blocked_ids.push(def.id);
      continue;
    }

    vault_ids.push(def.id);
  }

  return {
    ok: invalid_ids.length === 0 && blocked_ids.length === 0,
    vault_ids,
    invalid_ids,
    blocked_ids,
  };
}

export function normalizeVaultIds(input: unknown): VaultId[] {
  const res = validateVaultIds(input, "ULTRA");
  // This is purely normalization; "ULTRA" ensures all valid vaults are allowed.
  // Call validateVaultIds(...) when you need real gating enforcement.
  return res.vault_ids;
}
// END OF FILE
