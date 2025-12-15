import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const {
      user_id,
      name,
      description,
      image_count
    } = body

    if (!user_id || !name || !image_count) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from("user_loras")
      .insert({
        user_id,
        name,
        description: description ?? null,
        image_count,
        status: "queued"
      })
      .select()
      .single()

    if (error) {
      console.error("LoRA create error:", error)
      return NextResponse.json(
        { error: "Failed to create LoRA job" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      lora_id: data.id,
      status: data.status
    })

  } catch (err) {
    console.error("LoRA train POST error:", err)
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    )
  }
}
