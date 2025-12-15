// -----------------------------------------------------------------------------
// SirensForge — LoRA Core Types
// This file is the single source of truth for all LoRA-related logic
// Used by: UI, API, training jobs, generation, and future video pod
// -----------------------------------------------------------------------------

/**
 * LoRA training lifecycle states
 */
export type LoRATrainingStatus =
  | "idle"        // Created but not started
  | "queued"      // Waiting for GPU slot
  | "training"    // Actively training
  | "completed"   // Training finished successfully
  | "failed";     // Training failed

/**
 * What kind of LoRA this is
 * (we are starting with FACE_ID only)
 */
export type LoRAType =
  | "face";       // Identity / AI twin (v1 launch)
  // future:
  // | "style"
  // | "body"

/**
 * Where the LoRA can be used
 */
export type LoRAUsage =
  | "image"       // Image generation
  | "video"       // Video generation
  | "both";       // Image + video (default)

/**
 * Core LoRA metadata stored per model
 */
export interface LoRAModel {
  id: string;                 // UUID
  userId: string;             // Owner (Supabase user id)

  name: string;               // User-facing name
  description?: string;       // Optional description

  type: LoRAType;             // face (for now)
  usage: LoRAUsage;           // image | video | both

  status: LoRATrainingStatus; // training lifecycle

  // Training info
  trainingImagesCount: number;
  trainingSteps?: number;
  learningRate?: number;

  // Model file info
  modelPath?: string;         // Internal path on pod
  triggerToken?: string;      // Optional token (not required)

  // System metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight LoRA reference used during generation
 */
export interface ActiveLoRA {
  loraId: string;
  strength: number; // 0.0 → 1.5 (UI-controlled)
}

/**
 * Payload sent when starting a LoRA training job
 */
export interface StartLoRATrainingPayload {
  userId: string;
  name: string;
  description?: string;

  images: string[]; // URLs or temp paths
  steps?: number;
  learningRate?: number;
}

/**
 * API response when a training job is created
 */
export interface LoRATrainingJobResponse {
  loraId: string;
  status: LoRATrainingStatus;
}
