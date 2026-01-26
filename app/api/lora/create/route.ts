import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const body = await req.json();

    const { identityName, description } = body || {};

    // 1️⃣ Check for existing active draft
    const { data: existingDraft } = await supabaseAdmin
      .from("user_loras")
      .select("id, status")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingDraft) {
      return NextResponse.json({
        lora_id: existingDraft.id,
        reused: true,
        status: "draft",
      });
    }

    // 2️⃣ Create new draft
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("user_loras")
      .insert({
        status: "draft",
        image_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("[lora/create] Insert failed:", insertErr);
      return NextResponse.json(
        { error: "Failed to create LoRA draft" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      lora_id: inserted.id,
      reused: false,
      status: "draft",
    });
  } catch (err) {
    console.error("[lora/create] Fatal:", err);
    return NextResponse.json(
      { error: "Failed to create LoRA draft" },
      { status: 500 }
    );
  }
}
