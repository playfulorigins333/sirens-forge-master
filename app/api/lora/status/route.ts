// app/api/lora/status/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { isDurableComputeJobsEnabled } from "@/lib/compute-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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

    const { searchParams } = new URL(req.url);
    const lora_id = searchParams.get("lora_id");

    if (!lora_id) {
      return NextResponse.json({ error: "Missing lora_id" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("user_loras")
      .select(
        "id, user_id, name, status, progress, error_message, created_at, updated_at, started_at, completed_at, artifact_r2_bucket, artifact_r2_key, dataset_r2_bucket, dataset_r2_prefix, training_job_id"
      )
      .eq("id", lora_id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "LoRA not found" }, { status: 404 });
    }

    if (data.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (isDurableComputeJobsEnabled() && data.training_job_id) {
      const { data: computeRows, error: computeError } = await supabaseAdmin.rpc("creator_compute_status", {
        p_owner_id: userId,
        p_job_id: data.training_job_id,
      });
      if (computeError) return NextResponse.json({ error: "Trainer status unavailable" }, { status: 503 });
      const compute = Array.isArray(computeRows) ? computeRows[0] : computeRows;
      if (compute) {
        const status = compute.creator_status === "running" ? "training"
          : compute.creator_status === "recovering" || compute.creator_status === "cancelling" ? "training"
          : compute.creator_status === "cancelled" || compute.creator_status === "failed" ? "failed"
          : compute.creator_status === "completed" && data.artifact_r2_bucket && data.artifact_r2_key ? "completed"
          : "queued";
        return NextResponse.json({ ok: true, lora: { ...data, status, compute_status: compute.creator_status } });
      }
    }

    return NextResponse.json({
      ok: true,
      lora: data,
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes("unauthorized")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    console.error("[LoRA Status] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
