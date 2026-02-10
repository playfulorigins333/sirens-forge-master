// app/api/lora/status/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUserId } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();

  try {
    const userId = await requireUserId({ request: req });

    const { searchParams } = new URL(req.url);
    const lora_id = searchParams.get("lora_id");

    if (!lora_id) {
      return NextResponse.json({ error: "Missing lora_id" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("user_loras")
      .select(
        "id, user_id, name, status, progress, error_message, created_at, updated_at, started_at, completed_at, artifact_r2_bucket, artifact_r2_key, dataset_r2_bucket, dataset_r2_prefix"
      )
      .eq("id", lora_id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "LoRA not found" }, { status: 404 });
    }

    if (data.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
