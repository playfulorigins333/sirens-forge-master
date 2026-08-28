// app/api/lora/create/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { canonicalUuid } from "@/lib/trainer-application-contract";

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
    const control = /[\u0000-\u001f\u007f]/;
    const identityName = typeof body.identityName === "string" ? body.identityName.trim() : "";
    const description = body.description == null ? "" : typeof body.description === "string" ? body.description.trim() : null;
    const requestedLoraId = body.lora_id === undefined ? null : canonicalUuid(body.lora_id);
    if (Object.keys(body).some((key) => !["identityName", "description", "lora_id"].includes(key)) || (body.lora_id !== undefined && !requestedLoraId) || !identityName || identityName.length > 120 || description === null || description.length > 1000 || control.test(identityName) || control.test(description)) {
      return NextResponse.json({ error: "INVALID_LORA_METADATA" }, { status: 400 });
    }


    if (requestedLoraId) {
      const { data: exactDraft } = await supabaseAdmin.from("user_loras").select("id,status,user_id").eq("id", requestedLoraId).eq("user_id", userId).maybeSingle();
      if (!exactDraft) return NextResponse.json({ error: "LORA_NOT_FOUND" }, { status: 404 });
      if (exactDraft.status !== "draft") return NextResponse.json({ error: "LORA_NOT_DRAFT" }, { status: 409 });
      const { data: updatedDraft, error } = await supabaseAdmin.from("user_loras").update({ name: identityName, description, updated_at: new Date().toISOString() }).eq("id", requestedLoraId).eq("user_id", userId).eq("status", "draft").select("id,status").maybeSingle();
      if (error) return NextResponse.json({ error: "Failed to update LoRA draft" }, { status: 500 });
      if (!updatedDraft || updatedDraft.id !== requestedLoraId || updatedDraft.status !== "draft") return NextResponse.json({ error: "LORA_NOT_DRAFT" }, { status: 409 });
      return NextResponse.json({ lora_id: requestedLoraId, reused: true, status: "draft" });
    }
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
      const { error: updateError } = await supabaseAdmin.from("user_loras")
        .update({ name: identityName, description, updated_at: new Date().toISOString() })
        .eq("id", existingDraft.id).eq("user_id", userId);
      if (updateError) return NextResponse.json({ error: "Failed to update LoRA draft" }, { status: 500 });
      return NextResponse.json({
        lora_id: existingDraft.id,
        reused: true,
        status: "draft",
      });
    }

    // 2️⃣ Create new draft (ONLY valid columns)
    const now = new Date().toISOString();
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("user_loras")
      .insert({
        user_id: userId,
        status: "draft",
        image_count: 0,
        name: identityName,
        description,
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
