import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const POD_TRAIN_ENDPOINT = process.env.POD_TRAIN_ENDPOINT!
// example: http://127.0.0.1:8000/train

export async function POST(req: Request) {
  try {
    const { lora_id } = await req.json()

    if (!lora_id) {
      return NextResponse.json(
        { error: "Missing lora_id" },
        { status: 400 }
      )
    }

    // 1️⃣ Mark as training immediately
    const { error: updateError } = await supabaseAdmin
      .from("user_loras")
      .update({ status: "training" })
      .eq("id", lora_id)

    if (updateError) {
      console.error("Status update failed:", updateError)
      return NextResponse.json(
        { error: "Failed to update status" },
        { status: 500 }
      )
    }

    // 2️⃣ Notify the pod
    const podRes = await fetch(POD_TRAIN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lora_id }),
    })

    if (!podRes.ok) {
      const text = await podRes.text()
      console.error("Pod rejected job:", text)

      await supabaseAdmin
        .from("user_loras")
        .update({ status: "failed" })
        .eq("id", lora_id)

      return NextResponse.json(
        { error: "Pod rejected training job" },
        { status: 500 }
      )
    }

    return NextResponse.json({ status: "training" })

  } catch (err) {
    console.error("start-training fatal error:", err)
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}
