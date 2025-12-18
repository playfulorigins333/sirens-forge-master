import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const userToken = authHeader.replace("Bearer ", "")
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(userToken)

    if (userErr || !user) {
      return NextResponse.json({ error: "Invalid user" }, { status: 401 })
    }

    const formData = await req.formData()
    const identityName = String(formData.get("identityName") || "").trim()
    const description = String(formData.get("description") || "")
    const images = formData.getAll("images") as File[]

    if (!identityName || images.length < 10 || images.length > 20) {
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      )
    }

    // 1️⃣ Create DB row FIRST
    const { data: loraRow, error: insertErr } = await supabase
      .from("user_loras")
      .insert({
        user_id: user.id,
        name: identityName,
        description,
        status: "queued",
      })
      .select()
      .single()

    if (insertErr || !loraRow) {
      throw insertErr
    }

    const loraId = loraRow.id
    const basePath = `lora_datasets/${loraId}`

    // 2️⃣ Upload images to storage
    for (let i = 0; i < images.length; i++) {
      const file = images[i]
      const arrayBuffer = await file.arrayBuffer()

      const { error: uploadErr } = await supabase.storage
        .from("lora-datasets")
        .upload(`${basePath}/img_${i + 1}.jpg`, arrayBuffer, {
          contentType: file.type,
          upsert: false,
        })

      if (uploadErr) {
        throw uploadErr
      }
    }

    return NextResponse.json({
      lora_id: loraId,
      status: "queued",
    })
  } catch (err) {
    console.error("LoRA train error:", err)
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}
