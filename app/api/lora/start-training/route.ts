import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Starts LoRA training for a queued draft.
 * Rules:
 * - User must be authenticated
 * - LoRA must exist
 * - LoRA must belong to the user
 * - Status must be 'queued'
 * - Only ONE active training per user at a time
 */
export async function POST(req: NextRequest) {
  try {
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

    const body = await req.json();
    const { lora_id } = body;

    if (!lora_id) {
      return NextResponse.json(
        { error: "Missing lora_id" },
        { status: 400 }
      );
    }

    /**
     * 1️⃣ Verify LoRA belongs to user and is queued
     */
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

    /**
     * 2️⃣ Ensure no other active training for this user
     */
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

    /**
     * 3️⃣ Move LoRA into training state
     */
    const { error: updateError } = await supabaseAdmin
      .from("user_loras")
      .update({
        status: "training",
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora_id);

    if (updateError) {
      console.error("Failed to start training:", updateError);
      return NextResponse.json(
        { error: "Failed to start training" },
        { status: 500 }
      );
    }

    /**
     * 4️⃣ (NEXT PHASE)
     * This is where the job dispatch will happen:
     * - RunPod
     * - Queue
     * - Background worker
     *
     * For launch: status transition is correct and stable.
     */

    return NextResponse.json({
      lora_id,
      status: "training",
    });
  } catch (err) {
    console.error("Start training error:", err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
