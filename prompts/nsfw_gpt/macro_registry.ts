/** Canonical Macro registry. IDs map exactly to macros/<id>.txt. */
import { MODE_RANK, type Mode } from "./vault_registry"

export interface MacroDefinition {
  id: string
  label: string
  minMode: Mode
  category: "detail" | "escalation" | "perspective" | "intensity"
  description: string
}

export const MACROS: readonly MacroDefinition[] = [
  { id: "macro_detail_amplifier", label: "Detail Amplifier", minMode: "SAFE", category: "detail", description: "Adds tactile realism, micro-detail, sensory layering, and physical cues." },
  { id: "macro_escalation_pressure", label: "Escalation Pressure", minMode: "NSFW", category: "escalation", description: "Builds progressive pressure, anticipation, and tension." },
  { id: "macro_intensity_ultra", label: "Intensity Ultra", minMode: "ULTRA", category: "intensity", description: "Sustains maximum energy, intensity, and relentless pacing." },
  { id: "macro_perspective_control", label: "Perspective Control", minMode: "NSFW", category: "perspective", description: "Guides viewpoint, positioning, focus, and controlled framing." },
  { id: "macro_taboo_amplifier_ultra", label: "Taboo Amplifier Ultra", minMode: "ULTRA", category: "intensity", description: "Adds ULTRA-only transgressive creative framing." },
] as const

const MACRO_MAP = new Map(MACROS.map((macro) => [macro.id, macro]))
export function listMacrosForMode(mode: Mode): MacroDefinition[] {
  return MACROS.filter((macro) => MODE_RANK[mode] >= MODE_RANK[macro.minMode])
}
export function validateMacroIds(input: string[] | undefined, mode: Mode) {
  const macro_ids: string[] = [], invalid_ids: string[] = [], blocked_ids: string[] = []
  if (!Array.isArray(input)) return { macro_ids, invalid_ids, blocked_ids }
  for (const id of input) {
    const macro = MACRO_MAP.get(id)
    if (!macro) invalid_ids.push(id)
    else if (MODE_RANK[mode] < MODE_RANK[macro.minMode]) blocked_ids.push(id)
    else macro_ids.push(id)
  }
  return { macro_ids, invalid_ids, blocked_ids }
}
