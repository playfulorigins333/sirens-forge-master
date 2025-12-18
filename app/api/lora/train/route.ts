import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    // 🔐 Auth
    const authHeader = req.headers.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const userToken = authHeader.replace("Bearer ", "")
    const { data: { user }, error: userErr } =
      await supabase.auth.getUser(userToken)

    if (userErr || !user) {
      return NextResponse.json({ error: "Invalid user" }, { status: 401 })
    }

    // 📦 JSON body (NOT multipart)
    const body = await req.json()

    const {
      lora_id,
      identityName,
      description,
      image_count,
      storage_bucket,
      storage_prefix,
    } = body

    if (
      !lora_id ||
      !identityName ||
      !storage_bucket ||
      !storage_prefix ||
      typeof image_count !== "number" ||
      image_count < 10 ||
      image_count > 20
    ) {
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      )
    }

    // ✅ Confirm storage path exists (lightweight check)
    const { data: files, error: listErr } = await supabase.storage
      .from(storage_bucket)
      .list(storage_prefix, { limit: 1 })

    if (listErr || !files || files.length === 0) {
      return NextResponse.json(
        { error: "Training images not found in storage" },
        { status: 400 }
      )
    }

    // 🚦 Mark job queued (worker will pick it up)
    const { error: updateErr } = await supabase
      .from("user_loras")
      .update({
        status: "queued",
        image_count,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora_id)
      .eq("user_id", user.id)

    if (updateErr) {
      throw updateErr
    }

    return NextResponse.json({
      status: "queued",
      lora_id,
    })
  } catch (err) {
    console.error("LoRA train error:", err)
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}
