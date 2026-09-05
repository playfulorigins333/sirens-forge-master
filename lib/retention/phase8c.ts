import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sirensApiFetch } from "@/lib/sirensApi";

export type Phase8cRunResult = {
  ok: boolean;
  code: string;
  draftPurged: number;
  draftHeld: number;
  mediaAttempted: number;
  mediaPurged: number;
  mediaHeldOrBlocked: number;
};

function firstRow(data: unknown): Record<string, unknown> | null {
  return Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) ?? null : data && typeof data === "object" ? data as Record<string, unknown> : null;
}

function message(error: unknown) {
  return error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
    ? String((error as { message: string }).message)
    : "";
}

export async function runPhase8cRetention(): Promise<Phase8cRunResult> {
  const admin = getSupabaseAdmin();
  const result: Phase8cRunResult = { ok: true, code: "PHASE8C_RETENTION_COMPLETED", draftPurged: 0, draftHeld: 0, mediaAttempted: 0, mediaPurged: 0, mediaHeldOrBlocked: 0 };

  const drafts = await admin.rpc("phase8c_purge_expired_planner_drafts", { p_limit: 100 });
  if (drafts.error) return { ...result, ok: false, code: "PHASE8C_DRAFT_PURGE_FAILED" };
  const draftRow = firstRow(drafts.data);
  result.draftPurged = Number(draftRow?.purged_count ?? 0) || 0;
  result.draftHeld = Number(draftRow?.held_count ?? 0) || 0;

  const due = await admin.rpc("phase8c_claim_due_private_media_purges", { p_limit: 25 });
  if (due.error) return { ...result, ok: false, code: "PHASE8C_MEDIA_SELECTION_FAILED" };
  const rows = Array.isArray(due.data) ? due.data as Array<{ asset_id?: unknown; owner_id?: unknown; generation_id?: unknown }> : [];

  for (const row of rows) {
    if (typeof row.asset_id !== "string" || typeof row.owner_id !== "string") continue;
    result.mediaAttempted += 1;
    const claimToken = randomUUID();
    const claim = await admin.rpc("claim_private_generation_asset_purge", {
      p_asset_id: row.asset_id,
      p_owner_id: row.owner_id,
      p_claim_token: claimToken,
      p_reason: "retention_expired",
      p_allow_early: false,
    });
    if (claim.error) {
      const msg = message(claim.error);
      if (msg.includes("PRIVATE_MEDIA_LEGAL_HOLD") || msg.includes("PRIVATE_MEDIA_PURGE_BLOCKED_ACTIVE_VIDEO")) {
        result.mediaHeldOrBlocked += 1;
        continue;
      }
      return { ...result, ok: false, code: "PHASE8C_MEDIA_CLAIM_FAILED" };
    }
    const target = firstRow(claim.data);
    if (typeof target?.generation_id !== "string" || typeof target?.object_key !== "string") continue;

    let response: Response;
    try {
      response = await sirensApiFetch("/internal/private-media/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation_id: target.generation_id, object_key: target.object_key }),
        cache: "no-store",
      });
    } catch {
      return { ...result, ok: false, code: "PHASE8C_MEDIA_BINARY_PURGE_FAILED" };
    }
    if (!response.ok) return { ...result, ok: false, code: "PHASE8C_MEDIA_BINARY_PURGE_FAILED" };

    const finalized = await admin.rpc("finalize_private_generation_asset_purge", {
      p_asset_id: row.asset_id,
      p_owner_id: row.owner_id,
      p_claim_token: claimToken,
    });
    if (finalized.error) return { ...result, ok: false, code: "PHASE8C_MEDIA_FINALIZE_FAILED" };
    result.mediaPurged += 1;
  }

  return result;
}
