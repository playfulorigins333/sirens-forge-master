// -----------------------------------------------------------------------------
// SirensForge — LoRA User Utilities
// Bridges authenticated users to their LoRA models
// No training logic, no GPU logic, no UI here
// -----------------------------------------------------------------------------

import {
  LoRAModel,
  ActiveLoRA,
} from "./lora-types";
import {
  getUserLoRAs,
  getLoRAById,
} from "./lora-registry";

/**
 * Get all LoRAs owned by a user
 * Used by:
 * - Generator dropdown
 * - Trainer dashboard
 */
export function listUserLoRAs(userId: string): LoRAModel[] {
  return getUserLoRAs(userId);
}

/**
 * Get only LoRAs that are ready for use
 */
export function listUsableLoRAs(userId: string): LoRAModel[] {
  return getUserLoRAs(userId).filter(
    (lora) => lora.status === "completed"
  );
}

/**
 * Resolve the active LoRA for generation
 * Enforces ONE LoRA at a time
 */
export function resolveActiveLoRA(
  userId: string,
  loraId?: string,
  strength: number = 1.0
): ActiveLoRA | null {
  if (!loraId) return null;

  const lora = getLoRAById(userId, loraId);
  if (!lora) return null;
  if (lora.status !== "completed") return null;

  return {
    loraId: lora.id,
    strength: clampStrength(strength),
  };
}

/**
 * Safety clamp for LoRA strength
 */
function clampStrength(value: number): number {
  if (Number.isNaN(value)) return 1.0;
  if (value < 0.0) return 0.0;
  if (value > 1.5) return 1.5;
  return value;
}
