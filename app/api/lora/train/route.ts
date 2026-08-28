// app/api/lora/train/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { computePriorityForTier, isDurableComputeJobsEnabled, toCreatorComputeStatus } from "@/lib/compute-jobs";
import { buildRecommendedTrainerRecipe, canonicalUuid, trainerRequestFingerprint } from "@/lib/trainer-application-contract";
import { canonicalSelectedImageIds } from "@/lib/dataset-doctor/training-decision-contract";
import { selectedQualityState, sameSelectedIds, validateReviewSelection } from "@/lib/dataset-doctor/quality-contract";
import { trainerSelectionCapacityError, TRAINER_EXECUTION_SELECTION_LIMIT_MESSAGE } from "@/lib/dataset-doctor/trainer-execution-capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await ensureActiveSubscription();
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, message: auth.message, ...(auth.error === "POLICY_ACCEPTANCE_REQUIRED" ? { acceptancePath: "/account/policy-consent" } : {}) },
        { status: auth.status },
      );
    }
    const userId = auth.user.id;
    const supabaseAdmin = getSupabaseAdmin();

    const body = await req.json().catch(() => ({}));
    const lora_id = canonicalUuid(body?.lora_id);
    const dataset_doctor_job_id = canonicalUuid(body?.dataset_doctor_job_id);
    const training_decision_receipt_id = body?.training_decision_receipt_id === undefined ? null : canonicalUuid(body.training_decision_receipt_id);

    if (!lora_id || !dataset_doctor_job_id || (body?.training_decision_receipt_id !== undefined && !training_decision_receipt_id) || Object.keys(body || {}).some((key) => !["lora_id", "dataset_doctor_job_id", "training_decision_receipt_id"].includes(key))) {
      return NextResponse.json(
        { error: "INVALID_TRAINER_IDENTIFIERS" },
        { status: 400 }
      );
    }

    // 🔐 Verify ownership
    const { data: lora, error: fetchErr } = await supabaseAdmin
      .from("user_loras")
      .select("id, user_id, status")
      .eq("id", lora_id)
      .single();

    if (fetchErr || !lora) {
      return NextResponse.json(
        { error: "LoRA not found" },
        { status: 404 }
      );
    }

    if (lora.user_id !== userId) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    // The supplied exported Dataset Doctor job is the sole dataset authority.
    const { data: datasetJob, error: datasetJobErr } = await supabaseAdmin
      .from("dataset_doctor_jobs")
      .select(
        "id, lora_id, user_id, status, final_r2_bucket, final_r2_prefix, summary"
      )
      .eq("id", dataset_doctor_job_id)
      .eq("lora_id", lora_id)
      .eq("user_id", userId)
      .eq("status", "exported")
      .not("final_r2_bucket", "is", null)
      .not("final_r2_prefix", "is", null)
      .maybeSingle();

    if (datasetJobErr) {
      console.error("[lora/train] Dataset Doctor lookup failed:", datasetJobErr);
      return NextResponse.json(
        { error: "Failed to find approved dataset" },
        { status: 500 }
      );
    }

    if (
      !datasetJob ||
      !datasetJob.final_r2_bucket ||
      !datasetJob.final_r2_prefix
    ) {
      return NextResponse.json(
        {
          error:
            "DATASET_EXPORT_NOT_FOUND",
        },
        { status: 400 }
      );
    }

    const dataset_r2_bucket = datasetJob.final_r2_bucket;
    const dataset_r2_prefix = datasetJob.final_r2_prefix;
    const { data: selections, error: selectionsError } = await supabaseAdmin.from("dataset_doctor_selections")
      .select("image_id").eq("job_id", datasetJob.id).eq("selection_type", "final");
    if (selectionsError) return NextResponse.json({ error: "DATASET_SELECTION_LOOKUP_FAILED" }, { status: 500 });
    const imageIds = canonicalSelectedImageIds(selections || []);
    if (!imageIds)
      return NextResponse.json({ error: "DATASET_SELECTION_INVALID" }, { status: 400 });
    const selectedAuthority = validateReviewSelection(datasetJob.summary);
    if (!selectedAuthority || !sameSelectedIds(imageIds, selectedAuthority)) return NextResponse.json({ error: "DATASET_TRAINING_PROHIBITED" }, { status: 409 });
    const qualityState = selectedQualityState(selectedAuthority);
    if (qualityState === "prohibited") return NextResponse.json({ error: "DATASET_TRAINING_PROHIBITED" }, { status: 409 });
    let datasetTrainingDecision: null | Record<string, string> = null;
    if (qualityState === "overridable") {
      if (!training_decision_receipt_id) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_REQUIRED" }, { status: 409 });
      if (!isDurableComputeJobsEnabled()) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_EXECUTION_UNAVAILABLE", message: "Train Anyway is not available in the current Trainer execution mode. Improve the dataset before training." }, { status: 409 });
      const { data: validated, error: validationError } = await supabaseAdmin.rpc("validate_dataset_training_decision_receipt", { p_receipt_id: training_decision_receipt_id, p_user_id: userId, p_lora_id: lora_id, p_dataset_doctor_job_id: datasetJob.id });
      if (validationError) {
        const safeCode = ["DATASET_TRAINING_DECISION_REQUIRED", "DATASET_TRAINING_DECISION_STALE", "DATASET_TRAINING_DECISION_INVALID", "DATASET_TRAINING_PROHIBITED"].find((code) => validationError.message.includes(code)) || "DATASET_TRAINING_DECISION_INVALID";
        return NextResponse.json({ error: safeCode }, { status: 409 });
      }
      const decision = Array.isArray(validated) ? validated[0] : validated;
      if (!decision) return NextResponse.json({ error: "DATASET_TRAINING_DECISION_INVALID" }, { status: 409 });
      datasetTrainingDecision = { receipt_id: decision.receipt_id, decision: decision.decision, contract_version: decision.contract_version, warning_fingerprint: decision.warning_fingerprint, dataset_snapshot_fingerprint: decision.dataset_snapshot_fingerprint };
    }
    const requestPayload = {
      identity_id: lora_id, dataset_doctor_job_id: datasetJob.id,
      dataset_reference: { bucket: dataset_r2_bucket, prefix: dataset_r2_prefix },
      dataset_snapshot: selectedAuthority,
      dataset_selection: { image_ids: imageIds, image_count: imageIds.length },
      dataset_training_decision: datasetTrainingDecision,
      trainer_recipe: buildRecommendedTrainerRecipe(),
    };

    if (isDurableComputeJobsEnabled()) {
      const idempotencyKey = req.headers.get("idempotency-key")?.trim();
      if (!idempotencyKey || idempotencyKey.length > 128) return NextResponse.json({ error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
      const fingerprint = trainerRequestFingerprint(requestPayload);
      const { data: rows, error: submitError } = await supabaseAdmin.rpc("submit_trainer_compute_job", {
        p_owner_id: userId, p_lora_id: lora_id, p_idempotency_key: idempotencyKey,
        p_request_fingerprint: fingerprint, p_request_payload: requestPayload,
        p_priority_class: computePriorityForTier(auth.subscription?.tier_name),
        p_dataset_r2_bucket: dataset_r2_bucket, p_dataset_r2_prefix: dataset_r2_prefix,
      });
      if (submitError) {
        if (submitError.message.includes("IDEMPOTENCY_CONFLICT")) throw new Error("IDEMPOTENCY_CONFLICT");
        if (submitError.message.includes("TRAINER_ALREADY_ACTIVE")) throw new Error("TRAINER_ALREADY_ACTIVE");
        const decisionCode = ["DATASET_TRAINING_DECISION_REQUIRED", "DATASET_TRAINING_DECISION_STALE", "DATASET_TRAINING_DECISION_INVALID", "DATASET_TRAINING_PROHIBITED"].find((code) => submitError.message.includes(code));
        if (decisionCode) throw new Error(decisionCode);
        throw new Error("TRAINER_SUBMISSION_FAILED");
      }
      const job = Array.isArray(rows) ? rows[0] : rows;
      return NextResponse.json({ ok: true, lora_id, ...toCreatorComputeStatus(job) }, { status: 202 });
    }

    const executionLimit = trainerSelectionCapacityError(imageIds.length, false);
    if (executionLimit) return NextResponse.json({ error: executionLimit, message: TRAINER_EXECUTION_SELECTION_LIMIT_MESSAGE }, { status: 409 });
    const now = new Date().toISOString();
    const { error: updateErr } = await supabaseAdmin
      .from("user_loras")
      .update({
        status: "queued",
        dataset_r2_bucket,
        dataset_r2_prefix,
        updated_at: now,
      })
      .eq("id", lora_id);

    if (updateErr) {
      console.error("[lora/train] Update failed:", updateErr);
      return NextResponse.json(
        { error: "Failed to queue training job" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      lora_id,
      status: "queued",
      dataset_r2_bucket,
      dataset_r2_prefix,
      dataset_doctor_job_id: datasetJob.id,
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes("unauthorized")) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (msg.includes("IDEMPOTENCY_CONFLICT")) return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    if (msg.includes("TRAINER_ALREADY_ACTIVE")) return NextResponse.json({ error: "TRAINER_ALREADY_ACTIVE", message: "Training is already active for this Twin." }, { status: 409 });
    const decisionCode = ["DATASET_TRAINING_DECISION_REQUIRED", "DATASET_TRAINING_DECISION_STALE", "DATASET_TRAINING_DECISION_INVALID", "DATASET_TRAINING_PROHIBITED", "DATASET_TRAINING_DECISION_EXECUTION_UNAVAILABLE"].find((code) => msg.includes(code));
    if (decisionCode) return NextResponse.json({ error: decisionCode }, { status: 409 });

    console.error("[lora/train] Fatal:", err);
    return NextResponse.json(
      { error: "Failed to start training" },
      { status: 500 }
    );
  }
}
