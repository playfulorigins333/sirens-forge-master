// app/api/lora/train/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUserId } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId({ request: req });
    const supabaseAdmin = getSupabaseAdmin();

    const body = await req.json().catch(() => ({}));
    const { lora_id } = body || {};

    if (!lora_id) {
      return NextResponse.json(
        { error: "Missing lora_id" },
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

    // ✅ Dataset Doctor is now the source of truth for training datasets.
    // Find the latest exported/approved job that has a final dataset location.
    const { data: datasetJob, error: datasetJobErr } = await supabaseAdmin
      .from("dataset_doctor_jobs")
      .select(
        "id, lora_id, user_id, status, final_r2_bucket, final_r2_prefix, approved_at, exported_at, updated_at, created_at"
      )
      .eq("lora_id", lora_id)
      .eq("user_id", userId)
      .in("status", ["approved", "exported"])
      .not("final_r2_bucket", "is", null)
      .not("final_r2_prefix", "is", null)
      .order("exported_at", { ascending: false, nullsFirst: false })
      .order("approved_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1)
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
            "No approved Dataset Doctor dataset found. Please analyze and approve a dataset before starting training.",
        },
        { status: 400 }
      );
    }

    const dataset_r2_bucket = datasetJob.final_r2_bucket;
    const dataset_r2_prefix = datasetJob.final_r2_prefix;

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

    console.error("[lora/train] Fatal:", err);
    return NextResponse.json(
      { error: "Failed to start training" },
      { status: 500 }
    );
  }
}