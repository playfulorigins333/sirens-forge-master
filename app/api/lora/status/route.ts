// app/api/lora/status/route.ts
import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export async function GET(req: Request) {
  const supabaseAdmin = getSupabaseAdmin()

  try {
    const { searchParams } = new URL(req.url)
    const lora_id = searchParams.get("lora_id")

    if (!lora_id) {
      return NextResponse.json(
        { error: "Missing lora_id" },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from("user_loras")
      .select(
        "id, user_id, name, status, error_message, created_at, updated_at"
      )
      .eq("id", lora_id)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: "LoRA not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ok: true,
      lora: data,
    })
  } catch (err) {
    console.error("[LoRA Status] error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
