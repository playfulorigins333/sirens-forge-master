// -----------------------------------------------------------------------------
// SirensForge — LoRA Registry
// Central access layer for user LoRAs
// Used by UI, API routes, training jobs, and generation engine
// -----------------------------------------------------------------------------

import {
  LoRAModel,
  LoRATrainingStatus,
  StartLoRATrainingPayload,
} from "./lora-types";

// TEMP in-memory registry (Phase 1)
// Later this will be backed by Supabase
const loraStore: Map<string, LoRAModel[]> = new Map();

/**
 * Get all LoRAs owned by a user
 */
export function getUserLoRAs(userId: string): LoRAModel[] {
  return loraStore.get(userId) ?? [];
}

/**
 * Get a specific LoRA by id
 */
export function getLoRAById(
  userId: string,
  loraId: string
): LoRAModel | undefined {
  return getUserLoRAs(userId).find((l) => l.id === loraId);
}

/**
 * Create a new LoRA record (before training starts)
 */
export function createLoRA(
  payload: StartLoRATrainingPayload
): LoRAModel {
  const now = new Date().toISOString();

  const newLoRA: LoRAModel = {
    id: crypto.randomUUID(),
    userId: payload.userId,

    name: payload.name,
    description: payload.description,

    type: "face",
    usage: "both",

    status: "idle",

    trainingImagesCount: payload.images.length,
    trainingSteps: payload.steps,
    learningRate: payload.learningRate,

    createdAt: now,
    updatedAt: now,
  };

  const existing = loraStore.get(payload.userId) ?? [];
  loraStore.set(payload.userId, [...existing, newLoRA]);

  return newLoRA;
}

/**
 * Update LoRA training status
 */
export function updateLoRAStatus(
  userId: string,
  loraId: string,
  status: LoRATrainingStatus
): void {
  const loras = getUserLoRAs(userId);
  const index = loras.findIndex((l) => l.id === loraId);

  if (index === -1) return;

  loras[index] = {
    ...loras[index],
    status,
    updatedAt: new Date().toISOString(),
  };

  loraStore.set(userId, loras);
}

/**
 * Attach trained model info once training completes
 */
export function attachTrainedModel(
  userId: string,
  loraId: string,
  modelPath: string,
  triggerToken?: string
): void {
  const loras = getUserLoRAs(userId);
  const index = loras.findIndex((l) => l.id === loraId);

  if (index === -1) return;

  loras[index] = {
    ...loras[index],
    status: "completed",
    modelPath,
    triggerToken,
    updatedAt: new Date().toISOString(),
  };

  loraStore.set(userId, loras);
}

/**
 * Mark a LoRA as failed
 */
export function failLoRA(
  userId: string,
  loraId: string
): void {
  updateLoRAStatus(userId, loraId, "failed");
}
