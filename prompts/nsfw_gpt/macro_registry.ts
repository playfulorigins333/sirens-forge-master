/**
 * ULTRA MACRO REGISTRY
 *
 * Macros are intensity / modifier layers.
 * They NEVER replace vaults.
 * They stack on top of vaults to amplify tone, pacing, power, realism, or extremity.
 *
 * Rules:
 * - Macros are always optional
 * - Macros are mode-gated
 * - Macros do NOT inject raw text directly (validated + loaded via runtime files)
 */

export type Mode = "SAFE" | "NSFW" | "ULTRA";

export interface MacroDefinition {
  id: string;
  label: string;
  minMode: Mode;
}

/**
 * MODE ORDER — used for gating
 */
const MODE_ORDER: Mode[] = ["SAFE", "NSFW", "ULTRA"];

function modeAllows(current: Mode, required: Mode) {
  return MODE_ORDER.indexOf(current) >= MODE_ORDER.indexOf(required);
}

/**
 * MACRO REGISTRY (LOCKED)
 * IDs must match filenames in:
 * prompts/nsfw_gpt/macros/<id>.txt
 */
export const MACROS: MacroDefinition[] = [
  // 🔥 INTENSITY & DEPTH
  { id: "macro_intensity_boost", label: "Intensity Boost", minMode: "NSFW" },
  { id: "macro_slow_burn", label: "Slow Burn Escalation", minMode: "NSFW" },
  { id: "macro_relentless", label: "Relentless Pace", minMode: "ULTRA" },

  // 🧠 PSYCHOLOGICAL / CONTROL
  { id: "macro_power_imbalance", label: "Power Imbalance", minMode: "NSFW" },
  { id: "macro_psychological_pressure", label: "Psychological Pressure", minMode: "ULTRA" },
  { id: "macro_submission_focus", label: "Submission Focus", minMode: "NSFW" },
  { id: "macro_domination_focus", label: "Domination Focus", minMode: "NSFW" },

  // 🧪 REALISM / PHYSICALITY
  { id: "macro_heightened_realism", label: "Heightened Physical Realism", minMode: "NSFW" },
  { id: "macro_sensory_overload", label: "Sensory Overload", minMode: "ULTRA" },
  { id: "macro_exhaustion", label: "Endurance & Fatigue", minMode: "ULTRA" },

  // 🎭 PERFORMANCE / DISPLAY
  { id: "macro_performative", label: "Performative Emphasis", minMode: "NSFW" },
  { id: "macro_exhibitionism", label: "Exhibitionism Amplifier", minMode: "ULTRA" },
  { id: "macro_voyeur_pressure", label: "Voyeur Pressure", minMode: "ULTRA" },

  // 💥 EXTREMITY (LOCKED)
  { id: "macro_no_limits", label: "No Limits Layer", minMode: "ULTRA" },
  { id: "macro_edge_play", label: "Edge Play Intensifier", minMode: "ULTRA" },
  { id: "macro_overstimulation", label: "Overstimulation", minMode: "ULTRA" },
];

/**
 * QUICK LOOKUP
 */
const MACRO_MAP = new Map(MACROS.map((m) => [m.id, m]));

/**
 * VALIDATION RESULT
 */
export interface MacroValidationResult {
  macro_ids: string[];
  invalid_ids: string[];
  blocked_ids: string[];
}

/**
 * VALIDATE MACROS AGAINST MODE
 */
export function validateMacroIds(
  input: string[] | undefined,
  mode: Mode
): MacroValidationResult {
  const macro_ids: string[] = [];
  const invalid_ids: string[] = [];
  const blocked_ids: string[] = [];

  if (!Array.isArray(input)) {
    return { macro_ids, invalid_ids, blocked_ids };
  }

  for (const id of input) {
    const macro = MACRO_MAP.get(id);
    if (!macro) {
      invalid_ids.push(id);
      continue;
    }

    if (!modeAllows(mode, macro.minMode)) {
      blocked_ids.push(id);
      continue;
    }

    macro_ids.push(id);
  }

  return { macro_ids, invalid_ids, blocked_ids };
}
