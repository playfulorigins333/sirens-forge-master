import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const {
      user_id,
      name,
      description = null,
      image_count = 20,
    } = body

    if (!user_id || !name) {
      return NextResponse.json(
        { error: "Missing required fields: user_id, name" },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from("user_loras")
      .insert({
        user_id,
        name,
        description,
        image_count,
        status: "queued",
      })
      .select()
      .single()

    if (error) {
      console.error("LoRA create error:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      lora_id: data.id,
      status: data.status,
    })
  } catch (err) {
    console.error("LoRA train POST fatal error:", err)
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}
