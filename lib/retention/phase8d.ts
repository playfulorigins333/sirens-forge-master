import "server-only";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { purgePrivateGenerationAsset, trashPrivateGenerationAsset, PrivateMediaLifecycleError } from "@/lib/private-creator-media/lifecycle";
import { purgeTwin, trashTwin, TwinLifecycleError } from "@/lib/twin-lifecycle";

export type Phase8dRunResult = {
  ok: boolean;
  code: string;
  accountsSelected: number;
  accountsHeld: number;
  accountsPurged: number;
  accountsBlocked: number;
  mediaPurged: number;
  twinsPurged: number;
};

type ClaimRow = {
  retention_id?: unknown;
  auth_user_id?: unknown;
  profile_id?: unknown;
  claim_token?: unknown;
  claim_state?: unknown;
};

function rows(data: unknown): ClaimRow[] {
  return Array.isArray(data) ? data as ClaimRow[] : [];
}

function firstRow(data: unknown): Record<string, unknown> | null {
  return Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) ?? null : data && typeof data === "object" ? data as Record<string, unknown> : null;
}

function expectedPrivateMediaBlock(error: unknown) {
  return error instanceof PrivateMediaLifecycleError && ["LEGAL_HOLD", "ACTIVE_VIDEO", "SHARED_STORAGE_OBJECT", "STATE_CONFLICT"].includes(error.code);
}

function expectedTwinBlock(error: unknown) {
  return error instanceof TwinLifecycleError && ["LEGAL_HOLD", "ACTIVE_COMPUTE", "ACTIVE_TRAINER", "UPLOAD_WINDOW_ACTIVE", "STATE_CONFLICT"].includes(error.code);
}

export async function runPhase8dCanceledAccountEnforcement(): Promise<Phase8dRunResult> {
  const admin = getSupabaseAdmin();
  const result: Phase8dRunResult = {
    ok: true,
    code: "PHASE8D_CANCELED_ACCOUNT_ENFORCEMENT_COMPLETED",
    accountsSelected: 0,
    accountsHeld: 0,
    accountsPurged: 0,
    accountsBlocked: 0,
    mediaPurged: 0,
    twinsPurged: 0,
  };

  const claims = await admin.rpc("phase8d_claim_expired_canceled_accounts", { p_limit: 10 });
  if (claims.error) return { ...result, ok: false, code: "PHASE8D_ACCOUNT_SELECTION_FAILED" };

  for (const claim of rows(claims.data)) {
    const retentionId = typeof claim.retention_id === "string" ? claim.retention_id : null;
    const authUserId = typeof claim.auth_user_id === "string" ? claim.auth_user_id : null;
    const profileId = typeof claim.profile_id === "string" ? claim.profile_id : null;
    const claimToken = typeof claim.claim_token === "string" ? claim.claim_token : null;
    const claimState = typeof claim.claim_state === "string" ? claim.claim_state : null;
    if (!retentionId || !authUserId || !profileId) continue;

    result.accountsSelected += 1;
    if (claimState === "held") {
      result.accountsHeld += 1;
      continue;
    }
    if (claimState !== "claimed" || !claimToken) return { ...result, ok: false, code: "PHASE8D_ACCOUNT_CLAIM_INVALID" };

    const assets = await admin
      .from("generation_assets")
      .select("id,lifecycle_state")
      .eq("owner_id", authUserId)
      .neq("lifecycle_state", "purged")
      .limit(100);
    if (assets.error) return { ...result, ok: false, code: "PHASE8D_MEDIA_LOOKUP_FAILED" };

    for (const asset of assets.data ?? []) {
      if (typeof asset.id !== "string") continue;
      try {
        if (asset.lifecycle_state === "active") await trashPrivateGenerationAsset(asset.id, authUserId);
        await purgePrivateGenerationAsset(asset.id, authUserId);
        result.mediaPurged += 1;
      } catch (error) {
        if (expectedPrivateMediaBlock(error)) {
          result.accountsBlocked += 1;
          continue;
        }
        return { ...result, ok: false, code: "PHASE8D_MEDIA_PURGE_FAILED" };
      }
    }

    const twins = await admin
      .from("user_loras")
      .select("id,user_id,lifecycle_state")
      .in("user_id", [authUserId, profileId])
      .neq("lifecycle_state", "purged")
      .limit(100);
    if (twins.error) return { ...result, ok: false, code: "PHASE8D_TWIN_LOOKUP_FAILED" };

    for (const twin of twins.data ?? []) {
      if (typeof twin.id !== "string" || typeof twin.user_id !== "string") continue;
      try {
        if (twin.lifecycle_state === "active") await trashTwin(twin.id, twin.user_id);
        await purgeTwin(twin.id, twin.user_id);
        result.twinsPurged += 1;
      } catch (error) {
        if (expectedTwinBlock(error)) {
          result.accountsBlocked += 1;
          continue;
        }
        return { ...result, ok: false, code: "PHASE8D_TWIN_PURGE_FAILED" };
      }
    }

    const finalized = await admin.rpc("phase8d_finalize_canceled_account_purge", {
      p_retention_id: retentionId,
      p_auth_user_id: authUserId,
      p_claim_token: claimToken,
    });
    if (finalized.error) return { ...result, ok: false, code: "PHASE8D_ACCOUNT_FINALIZE_FAILED" };
    const finalRow = firstRow(finalized.data);
    if (finalRow?.finalized === true) result.accountsPurged += 1;
    else result.accountsBlocked += Number(finalRow?.blocked_count ?? 1) || 1;
  }

  return result;
}
