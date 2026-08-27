import { NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { canonicalUuid } from "@/lib/trainer-application-contract";
import { DATASET_DOCTOR_TRAINING_DECISION_VERSION, TRAIN_ANYWAY_DECISION, canonicalSelectedImageIds, canonicalWarningSnapshot, classifyTrainingDecision, sha256Fingerprint } from "@/lib/dataset-doctor/training-decision-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await ensureActiveSubscription();
  if (!auth.ok) return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const loraId = canonicalUuid(body?.lora_id);
  const jobId = canonicalUuid(body?.dataset_doctor_job_id);
  if (!loraId || !jobId || body?.decision !== TRAIN_ANYWAY_DECISION || Object.keys(body).some((key) => !["lora_id", "dataset_doctor_job_id", "decision"].includes(key)))
    return NextResponse.json({ error: "DATASET_TRAINING_DECISION_INVALID" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: job, error } = await admin.from("dataset_doctor_jobs").select("id,lora_id,user_id,status,final_r2_bucket,final_r2_prefix,summary").eq("id", jobId).maybeSingle();
  if (error) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_LOOKUP_FAILED" }, { status: 500 });
  if (!job || job.user_id !== auth.user.id || job.lora_id !== loraId) return NextResponse.json({ error: "DATASET_JOB_AUTHORITY_MISMATCH" }, { status: 403 });
  if (job.status !== "exported" || !job.final_r2_bucket || !job.final_r2_prefix) return NextResponse.json({ error: "DATASET_NOT_EXPORTED" }, { status: 409 });
  const { data: rows, error: selectionError } = await admin.from("dataset_doctor_selections").select("image_id").eq("job_id", jobId).eq("selection_type", "final");
  if (selectionError) return NextResponse.json({ error: "DATASET_SELECTION_LOOKUP_FAILED" }, { status: 500 });
  const selectedIds = canonicalSelectedImageIds(rows || []);
  if (!selectedIds) return NextResponse.json({ error: "DATASET_TRAINING_PROHIBITED" }, { status: 409 });
  if (job.summary?.dataset_ready === true) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_NOT_REQUIRED" }, { status: 409 });
  const classification = classifyTrainingDecision(job.summary, selectedIds.length, true);
  if (!classification.overridable) return NextResponse.json({ error: "DATASET_TRAINING_PROHIBITED" }, { status: 409 });

  const warnings = canonicalWarningSnapshot(job.summary);
  const datasetFingerprint = sha256Fingerprint(job.summary);
  const warningFingerprint = sha256Fingerprint(warnings);
  const now = new Date().toISOString();
  const receipt = { user_id: auth.user.id, lora_id: loraId, dataset_doctor_job_id: jobId, decision_contract_version: DATASET_DOCTOR_TRAINING_DECISION_VERSION, decision: TRAIN_ANYWAY_DECISION, warning_snapshot: warnings, warning_fingerprint: warningFingerprint, dataset_snapshot: job.summary, dataset_snapshot_fingerprint: datasetFingerprint, selected_image_ids: selectedIds, selected_image_count: selectedIds.length, shown_at: now, decided_at: now };
  const { data: inserted, error: insertError } = await admin.from("dataset_doctor_training_decision_receipts").upsert(receipt, { onConflict: "user_id,lora_id,dataset_doctor_job_id,decision_contract_version,dataset_snapshot_fingerprint,warning_fingerprint,selected_image_ids", ignoreDuplicates: true }).select("id,decision,decision_contract_version,decided_at").maybeSingle();
  if (insertError) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_RECORD_FAILED" }, { status: 500 });
  let result = inserted;
  if (!result) {
    const existing = await admin.from("dataset_doctor_training_decision_receipts").select("id,decision,decision_contract_version,decided_at").eq("user_id", auth.user.id).eq("lora_id", loraId).eq("dataset_doctor_job_id", jobId).eq("decision_contract_version", DATASET_DOCTOR_TRAINING_DECISION_VERSION).eq("dataset_snapshot_fingerprint", datasetFingerprint).eq("warning_fingerprint", warningFingerprint).contains("selected_image_ids", selectedIds).maybeSingle();
    result = existing.data;
  }
  if (!result) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_RECORD_FAILED" }, { status: 500 });
  return NextResponse.json({ receipt_id: result.id, decision: result.decision, decision_contract_version: result.decision_contract_version, decided_at: result.decided_at });
}
