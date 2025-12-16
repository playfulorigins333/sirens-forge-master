import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { startLoraTrainingPod } from "@/lib/runpod";

/**
 * Starts LoRA training for a queued draft.
 * LAUNCH-SAFE FLOW:
 * - Auth required
 * - LoRA must belong to user
 * - Status must be queued
 * - Enforces ONE active training per user
 * - Spins up ONE RunPod training pod
 */
export async function POST(req: NextRequest) {
  try {
    /* ────────────────────────────────
       1️⃣ AUTH
    ──────────────────────────────── */
    const authHeader = req.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    /* ────────────────────────────────
       2️⃣ INPUT
    ──────────────────────────────── */
    const body = await req.json();
    const { lora_id } = body;

    if (!lora_id) {
      return NextResponse.json(
        { error: "Missing lora_id" },
        { status: 400 }
      );
    }

    /* ────────────────────────────────
       3️⃣ VERIFY LORA
    ──────────────────────────────── */
    const { data: lora, error: loraError } = await supabaseAdmin
      .from("user_loras")
      .select("id, status")
      .eq("id", lora_id)
      .eq("user_id", user.id)
      .single();

    if (loraError || !lora) {
      return NextResponse.json(
        { error: "LoRA not found" },
        { status: 404 }
      );
    }

    if (lora.status !== "queued") {
      return NextResponse.json(
        { error: "LoRA is not ready to start training" },
        { status: 409 }
      );
    }

    /* ────────────────────────────────
       4️⃣ SINGLE ACTIVE TRAINING ENFORCEMENT
    ──────────────────────────────── */
    const { data: activeTraining } = await supabaseAdmin
      .from("user_loras")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["training"])
      .maybeSingle();

    if (activeTraining) {
      return NextResponse.json(
        { error: "Another LoRA is already training" },
        { status: 409 }
      );
    }

    /* ────────────────────────────────
       5️⃣ FLIP STATUS → TRAINING
    ──────────────────────────────── */
    const { error: updateError } = await supabaseAdmin
      .from("user_loras")
      .update({
        status: "training",
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora_id);

    if (updateError) {
      console.error("Failed to update LoRA status:", updateError);
      return NextResponse.json(
        { error: "Failed to start training" },
        { status: 500 }
      );
    }

    /* ────────────────────────────────
       6️⃣ START RUNPOD TRAINING POD
    ──────────────────────────────── */
    const pod = await startLoraTrainingPod({
      loraId: lora_id,
      userId: user.id,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    });

    /* ────────────────────────────────
       7️⃣ RESPONSE
    ──────────────────────────────── */
    return NextResponse.json({
      ok: true,
      lora_id,
      status: "training",
      pod_id: pod.id,
    });
  } catch (err) {
    console.error("Start training error:", err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
