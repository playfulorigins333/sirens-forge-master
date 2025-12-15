import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client
 * - Used ONLY on the server
 * - Required to bypass RLS safely for system actions
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/lora/create
 *
 * Purpose:
 * - Create a NEW LoRA identity in DRAFT state
 * - Enforce ONE active draft per user
 * - NO training starts here
 *
 * Flow:
 * - draft → queued → training → completed
 */
export async function POST(req: NextRequest) {
  try {
    /**
     * 1️⃣ AUTHENTICATE USER
     */
    const authHeader = req.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Invalid session" },
        { status: 401 }
      );
    }

    /**
     * 2️⃣ PARSE & VALIDATE INPUT
     */
    const body = await req.json();
    const { identityName, description } = body;

    if (!identityName || typeof identityName !== "string") {
      return NextResponse.json(
        { error: "Identity name is required" },
        { status: 400 }
      );
    }

    /**
     * 3️⃣ ENFORCE SINGLE ACTIVE DRAFT
     * - draft
     * - queued
     * - training
     *
     * completed / failed are allowed to exist
     */
    const { data: existing, error: checkError } = await supabase
      .from("user_loras")
      .select("id, status")
      .eq("user_id", user.id)
      .in("status", ["draft", "queued", "training"])
      .limit(1);

    if (checkError) {
      console.error("LoRA draft check error:", checkError);
      return NextResponse.json(
        { error: "Failed to validate existing LoRA state" },
        { status: 500 }
      );
    }

    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          error: "You already have an active LoRA in progress",
          active_status: existing[0].status,
        },
        { status: 409 }
      );
    }

    /**
     * 4️⃣ CREATE NEW DRAFT LoRA
     */
    const { data, error } = await supabase
      .from("user_loras")
      .insert({
        user_id: user.id,
        name: identityName.trim(),
        description: description ?? null,
        image_count: 0,
        status: "draft",
      })
      .select("id, status")
      .single();

    if (error) {
      console.error("LoRA create error:", error);
      return NextResponse.json(
        { error: "Failed to create LoRA draft" },
        { status: 500 }
      );
    }

    /**
     * 5️⃣ SUCCESS
     */
    return NextResponse.json({
      lora_id: data.id,
      status: data.status, // always "draft"
    });

  } catch (err) {
    console.error("Unexpected LoRA create error:", err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
