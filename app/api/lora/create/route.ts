import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await req.json();
    const { identityName, description, imageCount } = body;

    if (!identityName || typeof identityName !== "string") {
      return NextResponse.json(
        { error: "Identity name is required" },
        { status: 400 }
      );
    }

    if (!imageCount || imageCount < 10) {
      return NextResponse.json(
        { error: "At least 10 images are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("user_loras")
      .insert({
        user_id: user.id,
        name: identityName.trim(),
        description: description || null,
        image_count: imageCount,
        status: "queued",
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "You already have an active LoRA training" },
          { status: 409 }
        );
      }

      console.error("LoRA create error:", error);
      return NextResponse.json(
        { error: "Failed to create LoRA identity" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      lora_id: data.id,
      status: "queued",
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
