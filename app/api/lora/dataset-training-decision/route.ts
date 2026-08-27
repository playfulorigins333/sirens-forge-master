import { NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isDurableComputeJobsEnabled } from "@/lib/compute-jobs";
import { canonicalUuid } from "@/lib/trainer-application-contract";
import { TRAIN_ANYWAY_DECISION, canonicalSelectedImageIds } from "@/lib/dataset-doctor/training-decision-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SAFE_CODES = ["DATASET_TRAINING_DECISION_INVALID", "DATASET_TRAINING_DECISION_STALE", "DATASET_TRAINING_PROHIBITED", "DATASET_TRAINING_DECISION_NOT_REQUIRED", "IDEMPOTENCY_CONFLICT"];
function failure(error: unknown) {
  const message = String((error as { message?: unknown })?.message || error);
  const code = SAFE_CODES.find((candidate) => message.includes(candidate)) || "DATASET_TRAINING_DECISION_RECORD_FAILED";
  return NextResponse.json({ error: code }, { status: code === "DATASET_TRAINING_DECISION_RECORD_FAILED" ? 500 : 409 });
}

export async function POST(req: Request) {
  const auth = await ensureActiveSubscription();
  if (!auth.ok) return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status });
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || key.length > 128) return NextResponse.json({ error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const loraId = canonicalUuid(body?.lora_id);
  const jobId = canonicalUuid(body?.dataset_doctor_job_id);
  if (!loraId || !jobId) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_INVALID" }, { status: 400 });
  const admin = getSupabaseAdmin();

  if (body.action === "prepare") {
    if (!isDurableComputeJobsEnabled()) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_EXECUTION_UNAVAILABLE", message: "Train Anyway is not available in the current Trainer execution mode. Improve the dataset before training." }, { status: 409 });
    if (Object.keys(body).some((field) => !["action", "lora_id", "dataset_doctor_job_id", "selected_image_ids"].includes(field)) || !Array.isArray(body.selected_image_ids)) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_INVALID" }, { status: 400 });
    const selectedIds = canonicalSelectedImageIds(body.selected_image_ids, 3);
    if (!selectedIds) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_INVALID" }, { status: 400 });
    const { data, error } = await admin.rpc("prepare_dataset_training_decision_prompt", { p_user_id: auth.user.id, p_lora_id: loraId, p_dataset_doctor_job_id: jobId, p_decision_idempotency_key: key, p_selected_image_ids: selectedIds });
    if (error) return failure(error);
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ prompt_id: row.prompt_id, decision_contract_version: row.decision_contract_version, shown_at: row.shown_at, warning_snapshot: row.warning_snapshot });
  }
  if (body.action === "confirm") {
    if (Object.keys(body).some((field) => !["action", "lora_id", "dataset_doctor_job_id", "decision"].includes(field)) || body.decision !== TRAIN_ANYWAY_DECISION) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_INVALID" }, { status: 400 });
    const { data, error } = await admin.rpc("record_dataset_training_decision_receipt", { p_user_id: auth.user.id, p_lora_id: loraId, p_dataset_doctor_job_id: jobId, p_decision_idempotency_key: key });
    if (error) return failure(error);
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ receipt_id: row.receipt_id, decision: row.decision, decision_contract_version: row.decision_contract_version, decided_at: row.decided_at });
  }
  return NextResponse.json({ error: "DATASET_TRAINING_DECISION_INVALID" }, { status: 400 });
}
