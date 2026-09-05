import "server-only";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sirensApiFetch } from "@/lib/sirensApi";

export type PrivateMediaLifecycleState = "active" | "trashed" | "purge_pending" | "purged";
export type PrivateMediaPurgeReason = "creator_permanent_delete" | "retention_expired";
export type PrivateMediaLifecycleErrorCode =
  | "NOT_FOUND"
  | "STATE_CONFLICT"
  | "RESTORE_WINDOW_EXPIRED"
  | "LEGAL_HOLD"
  | "ACTIVE_VIDEO"
  | "SHARED_STORAGE_OBJECT"
  | "PURGE_UNAVAILABLE"
  | "LIFECYCLE_UNAVAILABLE";

export class PrivateMediaLifecycleError extends Error {
  constructor(
    public readonly code: PrivateMediaLifecycleErrorCode,
    public readonly status: number,
  ) {
    super(code);
  }
}

function rpcMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function mapLifecycleRpcError(error: unknown): PrivateMediaLifecycleError {
  const message = rpcMessage(error);
  if (message.includes("PRIVATE_MEDIA_ASSET_NOT_FOUND")) return new PrivateMediaLifecycleError("NOT_FOUND", 404);
  if (message.includes("PRIVATE_MEDIA_RESTORE_WINDOW_EXPIRED")) return new PrivateMediaLifecycleError("RESTORE_WINDOW_EXPIRED", 409);
  if (message.includes("PRIVATE_MEDIA_LEGAL_HOLD")) return new PrivateMediaLifecycleError("LEGAL_HOLD", 409);
  if (message.includes("PRIVATE_MEDIA_PURGE_BLOCKED_ACTIVE_VIDEO")) return new PrivateMediaLifecycleError("ACTIVE_VIDEO", 409);
  if (message.includes("PRIVATE_MEDIA_SHARED_STORAGE_OBJECT")) return new PrivateMediaLifecycleError("SHARED_STORAGE_OBJECT", 409);
  if (
    message.includes("PRIVATE_MEDIA_ASSET_STATE_CONFLICT") ||
    message.includes("PRIVATE_MEDIA_PURGE_ALREADY_CLAIMED") ||
    message.includes("PRIVATE_MEDIA_PURGE_NOT_DUE") ||
    message.includes("PRIVATE_MEDIA_PURGE_CLAIM_INVALID")
  ) return new PrivateMediaLifecycleError("STATE_CONFLICT", 409);
  return new PrivateMediaLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
}

function firstRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data && typeof data === "object" ? data as T : null;
}

export async function trashPrivateGenerationAsset(assetId: string, ownerId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("trash_private_generation_asset", {
    p_asset_id: assetId,
    p_owner_id: ownerId,
  });
  if (error) throw mapLifecycleRpcError(error);
  const row = firstRpcRow<{ asset_id: string; lifecycle_state: string; trashed_at: string; purge_after: string }>(data);
  if (!row) throw new PrivateMediaLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  return row;
}

export async function restorePrivateGenerationAsset(assetId: string, ownerId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("restore_private_generation_asset", {
    p_asset_id: assetId,
    p_owner_id: ownerId,
  });
  if (error) throw mapLifecycleRpcError(error);
  const row = firstRpcRow<{ asset_id: string; lifecycle_state: string }>(data);
  if (!row) throw new PrivateMediaLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  return row;
}

type PurgeAssetRow = {
  id: string;
  lifecycle_state: PrivateMediaLifecycleState;
  purge_claim_token: string | null;
  purge_reason: string | null;
};

type PurgeClaimRow = {
  generation_id: string | null;
  object_key: string | null;
};

export async function purgePrivateGenerationAsset(
  assetId: string,
  ownerId: string,
  requestedReason: PrivateMediaPurgeReason = "creator_permanent_delete",
) {
  const admin = getSupabaseAdmin();
  const lookup = await admin
    .from("generation_assets")
    .select("id,lifecycle_state,purge_claim_token,purge_reason")
    .eq("id", assetId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (lookup.error) throw new PrivateMediaLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  if (!lookup.data) throw new PrivateMediaLifecycleError("NOT_FOUND", 404);

  const asset = lookup.data as PurgeAssetRow;
  if (asset.lifecycle_state === "purged") {
    return { assetId, lifecycleState: "purged" as const, idempotent: true };
  }
  if (asset.lifecycle_state === "active") throw new PrivateMediaLifecycleError("STATE_CONFLICT", 409);

  const claimToken = asset.lifecycle_state === "purge_pending"
    ? asset.purge_claim_token
    : randomUUID();
  if (!claimToken) throw new PrivateMediaLifecycleError("LIFECYCLE_UNAVAILABLE", 503);

  const reason = asset.lifecycle_state === "purge_pending"
    ? asset.purge_reason ?? requestedReason
    : requestedReason;
  if (reason !== requestedReason) throw new PrivateMediaLifecycleError("STATE_CONFLICT", 409);

  const claim = await admin.rpc("claim_private_generation_asset_purge", {
    p_asset_id: assetId,
    p_owner_id: ownerId,
    p_claim_token: claimToken,
    p_reason: reason,
    p_allow_early: true,
  });
  if (claim.error) throw mapLifecycleRpcError(claim.error);

  const target = firstRpcRow<PurgeClaimRow>(claim.data);
  if (!target?.generation_id || !target.object_key) {
    const refreshed = await admin
      .from("generation_assets")
      .select("lifecycle_state")
      .eq("id", assetId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (!refreshed.error && refreshed.data?.lifecycle_state === "purged") {
      return { assetId, lifecycleState: "purged" as const, idempotent: true };
    }
    throw new PrivateMediaLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  }

  let purgeResponse: Response;
  try {
    purgeResponse = await sirensApiFetch("/internal/private-media/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generation_id: target.generation_id,
        object_key: target.object_key,
      }),
      cache: "no-store",
    });
  } catch {
    throw new PrivateMediaLifecycleError("PURGE_UNAVAILABLE", 502);
  }

  if (!purgeResponse.ok) throw new PrivateMediaLifecycleError("PURGE_UNAVAILABLE", 502);

  const finalized = await admin.rpc("finalize_private_generation_asset_purge", {
    p_asset_id: assetId,
    p_owner_id: ownerId,
    p_claim_token: claimToken,
  });
  if (finalized.error) throw mapLifecycleRpcError(finalized.error);

  const row = firstRpcRow<{ asset_id: string; lifecycle_state: string; purged_at: string }>(finalized.data);
  if (!row || row.lifecycle_state !== "purged") throw new PrivateMediaLifecycleError("LIFECYCLE_UNAVAILABLE", 503);
  return { assetId: row.asset_id, lifecycleState: "purged" as const, idempotent: false };
}
