import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sirensApiFetch } from "@/lib/sirensApi";
import { signPrivateGenerationObject } from "@/lib/private-creator-media/r2";
import { resolvePrivateR2Config } from "@/lib/private-creator-media/r2Config";

export const ACCOUNT_DELETION_CONFIRMATION_VERSION = "delete-my-account-v1";
export const ACCOUNT_DELETION_CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";
export const DATA_EXPORT_DOWNLOAD_TTL_SECONDS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ExportStatus = "requested" | "processing" | "completed" | "failed" | "downloaded" | "expired";

export class AccountDataRightsError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

function firstRow<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mapDbError(message?: string | null): AccountDataRightsError {
  const text = String(message || "");
  const known: Record<string, [string, number]> = {
    EXPORT_OWNER_NOT_FOUND: ["EXPORT_NOT_AVAILABLE", 404],
    EXPORT_ACCOUNT_UNAVAILABLE: ["EXPORT_NOT_AVAILABLE", 409],
    EXPORT_EXPIRED: ["EXPORT_EXPIRED", 410],
    EXPORT_NOT_READY: ["EXPORT_NOT_READY", 409],
    ACCOUNT_DELETION_PROTECTED_ACCOUNT: ["ACCOUNT_DELETION_PROTECTED_ACCOUNT", 409],
    ACCOUNT_DELETION_BILLING_ACTIVE: ["ACCOUNT_DELETION_BILLING_ACTIVE", 409],
    ACCOUNT_DELETION_EXPORT_NOT_READY: ["ACCOUNT_DELETION_EXPORT_NOT_READY", 409],
    ACCOUNT_DELETION_EXPORT_REQUIRED: ["ACCOUNT_DELETION_EXPORT_REQUIRED", 409],
    ACCOUNT_DELETION_STATE_CONFLICT: ["ACCOUNT_DELETION_STATE_CONFLICT", 409],
    ACCOUNT_DELETION_CONFIRMATION_INVALID: ["ACCOUNT_DELETION_CONFIRMATION_INVALID", 400],
    ACCOUNT_REACTIVATION_WINDOW_EXPIRED: ["ACCOUNT_REACTIVATION_WINDOW_EXPIRED", 410],
    ACCOUNT_REACTIVATION_STATE_CONFLICT: ["ACCOUNT_REACTIVATION_STATE_CONFLICT", 409],
  };
  for (const [needle, [code, status]] of Object.entries(known)) {
    if (text.includes(needle)) return new AccountDataRightsError(code, status);
  }
  return new AccountDataRightsError("ACCOUNT_DATA_RIGHTS_UNAVAILABLE", 503);
}

async function markExportDownloadedOrExpired(exportId: string, authUserId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("mark_creator_data_export_downloaded", {
    p_export_id: exportId,
    p_auth_user_id: authUserId,
  });
  if (error) throw mapDbError(error.message);
  const row = firstRow<any>(data);
  if (!row?.export_status) throw new AccountDataRightsError("ACCOUNT_DATA_RIGHTS_UNAVAILABLE", 503);
  return row.export_status as ExportStatus;
}

export async function requestCreatorDataExport(authUserId: string, profileId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("request_creator_data_export", {
    p_auth_user_id: authUserId,
    p_profile_id: profileId,
  });
  if (error) throw mapDbError(error.message);
  const row = firstRow<any>(data);
  if (!row?.export_id) throw new AccountDataRightsError("ACCOUNT_DATA_RIGHTS_UNAVAILABLE", 503);

  const response = await sirensApiFetch("/internal/data-export/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ export_id: row.export_id, auth_user_id: authUserId }),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) {
    throw new AccountDataRightsError("EXPORT_WORKER_UNAVAILABLE", 503);
  }
  return { id: row.export_id as string, status: row.export_status as ExportStatus, requestedAt: row.requested_at as string };
}

export async function listCreatorDataExports(authUserId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("creator_data_exports")
    .select("id,status,requested_at,processing_started_at,completed_at,failed_at,downloaded_at,expires_at,size_bytes,error_code")
    .eq("auth_user_id", authUserId)
    .order("requested_at", { ascending: false })
    .limit(10);
  if (error) throw new AccountDataRightsError("ACCOUNT_DATA_RIGHTS_UNAVAILABLE", 503);

  const rows = data ?? [];
  for (const row of rows as any[]) {
    if (!["completed", "downloaded"].includes(String(row.status)) || !row.expires_at) continue;
    const expires = new Date(row.expires_at);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() <= Date.now()) {
      const status = await markExportDownloadedOrExpired(row.id, authUserId);
      if (status === "expired") row.status = "expired";
    }
  }

  return rows.map((row: any) => ({
    id: row.id,
    status: row.status as ExportStatus,
    requestedAt: row.requested_at,
    processingStartedAt: row.processing_started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    downloadedAt: row.downloaded_at,
    expiresAt: row.expires_at,
    sizeBytes: row.size_bytes,
    errorCode: row.error_code,
  }));
}

export async function signCreatorDataExportDownload(exportId: string, authUserId: string) {
  if (!UUID_RE.test(exportId)) throw new AccountDataRightsError("EXPORT_NOT_AVAILABLE", 404);
  const admin = getSupabaseAdmin();
  const { data: row, error } = await admin
    .from("creator_data_exports")
    .select("id,status,storage_bucket,storage_object_key,expires_at,completed_at")
    .eq("id", exportId)
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error || !row) throw new AccountDataRightsError("EXPORT_NOT_AVAILABLE", 404);
  if (!["completed", "downloaded"].includes(String(row.status))) {
    if (String(row.status) === "expired") throw new AccountDataRightsError("EXPORT_EXPIRED", 410);
    throw new AccountDataRightsError("EXPORT_NOT_READY", 409);
  }

  const expires = row.expires_at ? new Date(row.expires_at) : null;
  if (!expires || Number.isNaN(expires.getTime())) throw new AccountDataRightsError("EXPORT_DOWNLOAD_UNAVAILABLE", 503);
  if (expires.getTime() <= Date.now()) {
    const status = await markExportDownloadedOrExpired(exportId, authUserId);
    if (status === "expired") throw new AccountDataRightsError("EXPORT_EXPIRED", 410);
    throw new AccountDataRightsError("EXPORT_DOWNLOAD_UNAVAILABLE", 503);
  }

  const privateConfig = resolvePrivateR2Config(process.env);
  const canonicalKey = `creator-exports/${authUserId}/${exportId}.zip`;
  if (row.storage_bucket !== privateConfig.bucket || row.storage_object_key !== canonicalKey) {
    throw new AccountDataRightsError("EXPORT_STORAGE_INVALID", 503);
  }

  const url = await signPrivateGenerationObject({
    bucket: privateConfig.bucket,
    key: canonicalKey,
    filename: `sirens-forge-data-export-${exportId.slice(0, 8)}.zip`,
  }).catch(() => null);
  if (!url) throw new AccountDataRightsError("EXPORT_DOWNLOAD_UNAVAILABLE", 503);

  const status = await markExportDownloadedOrExpired(exportId, authUserId);
  if (status === "expired") throw new AccountDataRightsError("EXPORT_EXPIRED", 410);
  return { url, expiresInSeconds: DATA_EXPORT_DOWNLOAD_TTL_SECONDS };
}

export async function getVoluntaryDeletionState(authUserId: string, profileId: string) {
  const admin = getSupabaseAdmin();
  const [{ data: profile, error: profileError }, { data: request, error: requestError }, { data: protectedRow, error: protectedError }] = await Promise.all([
    admin.from("profiles").select("account_lifecycle_state,account_lifecycle_updated_at").eq("id", profileId).eq("user_id", authUserId).maybeSingle(),
    admin.from("account_deletion_requests").select("id,status,export_choice,export_job_id,requested_at,recovery_deadline,reactivated_at").eq("auth_user_id", authUserId).order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("account_deletion_protected_subjects").select("auth_user_id").eq("auth_user_id", authUserId).maybeSingle(),
  ]);
  if (profileError || requestError || protectedError || !profile) throw new AccountDataRightsError("ACCOUNT_DATA_RIGHTS_UNAVAILABLE", 503);
  return {
    accountLifecycleState: profile.account_lifecycle_state as string,
    accountLifecycleUpdatedAt: profile.account_lifecycle_updated_at as string,
    protectedAccount: Boolean(protectedRow),
    request: request ? {
      id: request.id as string,
      status: request.status as string,
      exportChoice: request.export_choice as string,
      exportJobId: request.export_job_id as string | null,
      requestedAt: request.requested_at as string,
      recoveryDeadline: request.recovery_deadline as string,
      reactivatedAt: request.reactivated_at as string | null,
    } : null,
  };
}

export async function requestVoluntaryAccountDeletion(input: {
  authUserId: string;
  profileId: string;
  exportChoice: "export_before_deletion" | "skip_export";
  exportJobId: string | null;
  confirmationPhrase: string;
}) {
  if (input.confirmationPhrase !== ACCOUNT_DELETION_CONFIRMATION_PHRASE) {
    throw new AccountDataRightsError("ACCOUNT_DELETION_CONFIRMATION_INVALID", 400);
  }
  if (input.exportJobId !== null && !UUID_RE.test(input.exportJobId)) {
    throw new AccountDataRightsError("ACCOUNT_DELETION_EXPORT_NOT_READY", 409);
  }
  const admin = getSupabaseAdmin();
  const actionId = randomUUID();
  const { data, error } = await admin.rpc("request_voluntary_account_deletion", {
    p_auth_user_id: input.authUserId,
    p_profile_id: input.profileId,
    p_export_choice: input.exportChoice,
    p_export_job_id: input.exportJobId,
    p_confirmation_version: ACCOUNT_DELETION_CONFIRMATION_VERSION,
    p_request_action_id: actionId,
  });
  if (error) throw mapDbError(error.message);
  const row = firstRow<any>(data);
  if (!row?.request_id) throw new AccountDataRightsError("ACCOUNT_DATA_RIGHTS_UNAVAILABLE", 503);
  return { id: row.request_id as string, status: row.request_status as string, recoveryDeadline: row.recovery_deadline as string, actionId };
}

export async function reactivateVoluntaryAccountDeletion(authUserId: string, profileId: string) {
  const admin = getSupabaseAdmin();
  const actionId = randomUUID();
  const { data, error } = await admin.rpc("reactivate_voluntary_account_deletion", {
    p_auth_user_id: authUserId,
    p_profile_id: profileId,
    p_reactivation_action_id: actionId,
  });
  if (error) throw mapDbError(error.message);
  const row = firstRow<any>(data);
  if (!row?.request_id) throw new AccountDataRightsError("ACCOUNT_DATA_RIGHTS_UNAVAILABLE", 503);
  return { id: row.request_id as string, status: row.request_status as string, accountLifecycleState: row.account_lifecycle_state as string, actionId };
}
