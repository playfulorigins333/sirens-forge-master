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
    const {
      lora_id,
      dataset_bucket,
      dataset_prefix,
    } = body || {};

    // 🔴 HARD VALIDATION — THIS WAS MISSING
    if (!lora_id) {
      return NextResponse.json(
        { error: "Missing lora_id" },
        { status: 400 }
      );
    }

    if (!dataset_bucket || !dataset_prefix) {
      return NextResponse.json(
        { error: "Missing storage location (bucket/prefix)" },
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

    // ✅ Persist dataset location + queue job
    const now = new Date().toISOString();
    const { error: updateErr } = await supabaseAdmin
      .from("user_loras")
      .update({
        status: "queued",
        dataset_bucket,
        dataset_prefix,
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
      dataset_bucket,
      dataset_prefix,
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
