import "server-only";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sirensApiFetch } from "@/lib/sirensApi";

export type TwinLifecycleErrorCode =
  | "NOT_FOUND"
  | "STATE_CONFLICT"
  | "RESTORE_WINDOW_EXPIRED"
  | "ACTIVE_COMPUTE"
  | "ACTIVE_TRAINER"
  | "UPLOAD_WINDOW_ACTIVE"
  | "PURGE_ALREADY_CLAIMED"
  | "PURGE_UNAVAILABLE"
  | "LIFECYCLE_UNAVAILABLE";

export class TwinLifecycleError extends Error {
  constructor(public readonly code: TwinLifecycleErrorCode, public readonly status: number) {
    super(code);
  }
}

function rpcMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function mapRpcError(error: unknown): TwinLifecycleError {
  const message = rpcMessage(error);
  if (message.includes("TWIN_NOT_FOUND")) return new TwinLifecycleError("NOT_FOUND", 404);
  if (message.includes("TWIN_RESTORE_WINDOW_EXPIRED")) return new TwinLifecycleError("RESTORE_WINDOW_EXPIRED", 409);
  if (message.includes("TWIN_PURGE_BLOCKED_ACTIVE_COMPUTE")) return new TwinLifecycleError("ACTIVE_COMPUTE", 409);
  if (message.includes("TWIN_PURGE_BLOCKED_ACTIVE_TRAINER")) return new TwinLifecycleError("ACTIVE_TRAINER", 409);
  if (message.includes("TWIN_PURGE_BLOCKED_UPLOAD_WINDOW")) return new TwinLifecycleError("UPLOAD_WINDOW_ACTIVE", 409);
  if (message.includes("TWIN_PURGE_ALREADY_CLAIMED") || message.includes("TWIN_TRAINING_DATA_PURGE_ALREADY_CLAIMED")) {
    return new TwinLifecycleError("PURGE_ALREADY_CLAIMED", 409);
  }
  if (message.includes("TWIN_STATE_CONFLICT") || message.includes("TWIN_NOT_ACTIVE") || message.includes("TWIN_TRAINING_DATA_NOT_ACTIVE") || message.includes("TWIN_PURGE_NOT_DUE") || message.includes("TWIN_PURGE_CLAIM_INVALID")) {
    return new TwinLifecycleError("STATE_CONFLICT", 409);
  }
  return new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
}

function firstRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data && typeof data === "object" ? data as T : null;
}

export async function trashTwin(twinId: string, ownerId: string) {
  const { data, error } = await getSupabaseAdmin().rpc("trash_user_lora", { p_lora_id: twinId, p_owner_id: ownerId });
  if (error) throw mapRpcError(error);
  const row = firstRpcRow<{ lora_id: string; lifecycle_state: string; trashed_at: string; purge_after: string }>(data);
  if (!row) throw new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  return row;
}

export async function restoreTwin(twinId: string, ownerId: string) {
  const { data, error } = await getSupabaseAdmin().rpc("restore_user_lora", { p_lora_id: twinId, p_owner_id: ownerId });
  if (error) throw mapRpcError(error);
  const row = firstRpcRow<{ lora_id: string; lifecycle_state: string }>(data);
  if (!row) throw new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  return row;
}

async function callStoragePurge(twinId: string, scope: "training_data" | "twin") {
  let response: Response;
  try {
    response = await sirensApiFetch("/internal/twin-storage/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ twin_id: twinId, scope }),
      cache: "no-store",
    });
  } catch {
    throw new TwinLifecycleError("PURGE_UNAVAILABLE", 502);
  }
  if (!response.ok) throw new TwinLifecycleError("PURGE_UNAVAILABLE", 502);
}

export async function purgeTwinTrainingData(twinId: string, ownerId: string) {
  const admin = getSupabaseAdmin();
  const lookup = await admin.from("user_loras").select("id,training_data_state,training_data_purge_claim_token").eq("id", twinId).eq("user_id", ownerId).maybeSingle();
  if (lookup.error) throw new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  if (!lookup.data) throw new TwinLifecycleError("NOT_FOUND", 404);
  if (lookup.data.training_data_state === "purged") return { twinId, trainingDataState: "purged" as const, idempotent: true };
  const token = lookup.data.training_data_state === "purge_pending" ? lookup.data.training_data_purge_claim_token : randomUUID();
  if (!token) throw new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);

  const claim = await admin.rpc("claim_user_lora_training_data_purge", { p_lora_id: twinId, p_owner_id: ownerId, p_claim_token: token });
  if (claim.error) throw mapRpcError(claim.error);
  await callStoragePurge(twinId, "training_data");
  const finalized = await admin.rpc("finalize_user_lora_training_data_purge", { p_lora_id: twinId, p_owner_id: ownerId, p_claim_token: token });
  if (finalized.error) throw mapRpcError(finalized.error);
  const row = firstRpcRow<{ lora_id: string; training_data_state: string }>(finalized.data);
  if (!row || row.training_data_state !== "purged") throw new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  return { twinId: row.lora_id, trainingDataState: "purged" as const, idempotent: false };
}

export async function reactivateTwinTrainingData(twinId: string, ownerId: string) {
  const { data, error } = await getSupabaseAdmin().rpc("reactivate_user_lora_training_data", { p_lora_id: twinId, p_owner_id: ownerId });
  if (error) throw mapRpcError(error);
  const row = firstRpcRow<{ lora_id: string; training_data_state: string }>(data);
  if (!row) throw new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  return row;
}

export async function purgeTwin(twinId: string, ownerId: string) {
  const admin = getSupabaseAdmin();
  const lookup = await admin.from("user_loras").select("id,lifecycle_state,purge_claim_token,purge_reason").eq("id", twinId).eq("user_id", ownerId).maybeSingle();
  if (lookup.error) throw new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  if (!lookup.data) throw new TwinLifecycleError("NOT_FOUND", 404);
  if (lookup.data.lifecycle_state === "purged") return { twinId, lifecycleState: "purged" as const, idempotent: true };
  if (lookup.data.lifecycle_state === "active") throw new TwinLifecycleError("STATE_CONFLICT", 409);
  const token = lookup.data.lifecycle_state === "purge_pending" ? lookup.data.purge_claim_token : randomUUID();
  if (!token) throw new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  const reason = lookup.data.lifecycle_state === "purge_pending" ? lookup.data.purge_reason ?? "creator_permanent_delete" : "creator_permanent_delete";

  const claim = await admin.rpc("claim_user_lora_purge", { p_lora_id: twinId, p_owner_id: ownerId, p_claim_token: token, p_reason: reason, p_allow_early: true });
  if (claim.error) throw mapRpcError(claim.error);
  await callStoragePurge(twinId, "twin");
  const finalized = await admin.rpc("finalize_user_lora_purge", { p_lora_id: twinId, p_owner_id: ownerId, p_claim_token: token });
  if (finalized.error) throw mapRpcError(finalized.error);
  const row = firstRpcRow<{ lora_id: string; lifecycle_state: string }>(finalized.data);
  if (!row || row.lifecycle_state !== "purged") throw new TwinLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  return { twinId: row.lora_id, lifecycleState: "purged" as const, idempotent: false };
}
