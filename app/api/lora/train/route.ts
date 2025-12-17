import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization")
    if (!authHeader) {
      return NextResponse.json(
        { error: "Missing Authorization header" },
        { status: 401 }
      )
    }

    const token = authHeader.replace("Bearer ", "")
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: "Invalid or expired session" },
        { status: 401 }
      )
    }

    const body = await req.json()
    const {
      identityName,
      description = null,
    } = body

    if (!identityName) {
      return NextResponse.json(
        { error: "Missing required field: identityName" },
        { status: 400 }
      )
    }

    // IMPORTANT:
    // This endpoint ONLY creates a draft LoRA record.
    // Images are handled separately by /api/lora/start-training

    const { data, error } = await supabaseAdmin
      .from("user_loras")
      .insert({
        user_id: user.id,
        name: identityName,
        description,
        status: "draft", // 🔒 NOT queued
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
