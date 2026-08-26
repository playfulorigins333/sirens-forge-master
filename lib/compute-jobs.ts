import { createHash, randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin";

export const isDurableComputeJobsEnabled = () =>
  process.env.DURABLE_COMPUTE_JOBS_ENABLED === "true";

export type ComputeWorkload = "trainer" | "image" | "video" | "stitch";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export async function submitComputeJob(args: {
  ownerId: string; workload: ComputeWorkload; request: Record<string, unknown>;
  idempotencyKey?: string | null; priorityClass: "og" | "standard";
}) {
  if (args.workload === "video" || args.workload === "stitch") throw new Error("WORKLOAD_SUBMISSION_REQUIRED");
  const canonicalRequest = canonicalize(args.request);
  const fingerprint = createHash("sha256").update(JSON.stringify(canonicalRequest)).digest("hex");
  const key = args.idempotencyKey?.trim() || randomUUID();
  if (key.length < 1 || key.length > 128) throw new Error("INVALID_IDEMPOTENCY_KEY");
  const { data, error } = await getSupabaseAdmin().rpc("submit_compute_job", {
    p_owner_id: args.ownerId, p_workload: args.workload, p_idempotency_key: key,
    p_request_fingerprint: fingerprint, p_request_payload: canonicalRequest,
    p_priority_class: args.priorityClass,
  });
  if (error) throw new Error(error.message.includes("IDEMPOTENCY_CONFLICT") ? "IDEMPOTENCY_CONFLICT" : "COMPUTE_SUBMISSION_FAILED");
  return Array.isArray(data) ? data[0] : data;
}

export const computePriorityForTier = (tierName?: string | null) =>
  tierName === "og_throne" ? "og" as const : "standard" as const;

function safeResultReference(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ["generation_id", "project_id", "result_id"] as const) {
    if (typeof source[key] === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source[key])) safe[key] = source[key];
  }
  if (Array.isArray(source.asset_ids) && source.asset_ids.every((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) safe.asset_ids = source.asset_ids;
  return Object.keys(safe).length ? safe : null;
}

export const toCreatorComputeStatus = (row: any) => ({
  job_id: row.job_id ?? row.id, workload: row.workload, status: row.creator_status ?? row.state,
  queued_at: row.queued_at, started_at: row.started_at, completed_at: row.completed_at ?? row.terminal_at,
  result_reference: safeResultReference(row.result_reference), safe_error_code: /^[A-Z][A-Z0-9_]{0,63}$/.test(row.safe_error_code ?? "") ? row.safe_error_code : null,
  can_cancel: row.can_cancel ?? ["queued", "running", "recovering", "cancelling"].includes(row.creator_status),
  ...(row.creator_status === "queued" ? { message: "Your job is safely queued. Demand is high right now, so it may take a little longer." } : {}),
});
