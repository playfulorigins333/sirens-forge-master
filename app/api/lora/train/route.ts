import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  POST /api/lora/train

  JSON-only route.
  Expects metadata for a dataset that already exists in storage.
  Does NOT handle files.
  Does NOT spawn training locally.
  RunPod worker is responsible for picking up queued jobs.
*/

export async function POST(req: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 🔒 Expect JSON only
    const body = await req.json();

    const {
      lora_id,
      image_count,
      storage_bucket,
      storage_prefix,
    } = body || {};

    if (!lora_id) {
      return NextResponse.json(
        { error: "Missing lora_id" },
        { status: 400 }
      );
    }

    if (
      typeof image_count !== "number" ||
      image_count < 10 ||
      image_count > 20
    ) {
      return NextResponse.json(
        { error: "Invalid image_count (10–20 required)" },
        { status: 400 }
      );
    }

    if (!storage_bucket || !storage_prefix) {
      return NextResponse.json(
        { error: "Missing storage location (bucket/prefix)" },
        { status: 400 }
      );
    }

    // 1️⃣ Verify LoRA exists and is not already active
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("user_loras")
      .select("id, status")
      .eq("id", lora_id)
      .single();

    if (existingErr || !existing) {
      return NextResponse.json(
        { error: "LoRA job not found" },
        { status: 404 }
      );
    }

    if (existing.status === "queued" || existing.status === "training") {
      return NextResponse.json({
        status: existing.status,
        message: "Job already active",
      });
    }

    // 2️⃣ Update DB → queued (this is the ONLY responsibility here)
    const { error: updateErr } = await supabaseAdmin
      .from("user_loras")
      .update({
        status: "queued",
        image_count,
        storage_bucket,
        storage_prefix,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora_id);

    if (updateErr) {
      console.error("[lora/train] DB update failed:", updateErr);
      return NextResponse.json(
        { error: "Failed to queue training job" },
        { status: 500 }
      );
    }

    // 3️⃣ Done. RunPod worker will pick this up.
    return NextResponse.json({
      status: "queued",
      lora_id,
      image_count,
    });
  } catch (err: any) {
    console.error("[lora/train] Fatal error:", err);
    return NextResponse.json(
      { error: "Failed to start training" },
      { status: 500 }
    );
  }
}
