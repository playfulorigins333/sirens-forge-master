// app/api/lora/create/route.ts
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
    const { identityName, description } = body || {};

    // 1️⃣ Check for existing active draft FOR THIS USER
    const { data: existingDraft, error: draftErr } = await supabaseAdmin
      .from("user_loras")
      .select("id, status")
      .eq("status", "draft")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draftErr) {
      console.error("[lora/create] Draft lookup failed:", draftErr);
    }

    if (existingDraft) {
      return NextResponse.json({
        lora_id: existingDraft.id,
        reused: true,
        status: "draft",
      });
    }

    // 2️⃣ Create new draft WITH user_id
    const now = new Date().toISOString();
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("user_loras")
      .insert({
        user_id: userId,
        status: "draft",
        image_count: 0,
        identity_name: identityName ?? null,
        description: description ?? null,
        created_at: now,
        updated_at: now,
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
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes("unauthorized")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    console.error("[lora/create] Fatal:", err);
    return NextResponse.json(
      { error: "Failed to create LoRA draft" },
      { status: 500 }
    );
  }
}
