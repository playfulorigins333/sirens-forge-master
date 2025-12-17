import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"

export async function POST(req: Request) {
  try {
    /* ─────────────────────────────
       AUTH
    ───────────────────────────── */
    const authHeader = req.headers.get("authorization")
    if (!authHeader) {
      return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 })
    }

    const token = authHeader.replace("Bearer ", "")
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 })
    }

    /* ─────────────────────────────
       BODY (multipart/form-data)
    ───────────────────────────── */
    const formData = await req.formData()

    const identityName = formData.get("identityName")?.toString()
    const description = formData.get("description")?.toString() ?? null
    const images = formData.getAll("images") as File[]

    if (!identityName || images.length < 10 || images.length > 20) {
      return NextResponse.json(
        { error: "You must upload 10–20 images and provide an identity name" },
        { status: 400 }
      )
    }

    /* ─────────────────────────────
       CREATE DB ROW (QUEUED)
    ───────────────────────────── */
    const { data: lora, error: insertError } = await supabaseAdmin
      .from("user_loras")
      .insert({
        user_id: user.id,
        name: identityName,
        description,
        image_count: images.length,
        status: "queued",
        progress: 0,
      })
      .select()
      .single()

    if (insertError || !lora) {
      console.error("LoRA insert error:", insertError)
      return NextResponse.json({ error: "Failed to create LoRA record" }, { status: 500 })
    }

    const loraId = lora.id

    /* ─────────────────────────────
       UPLOAD IMAGES TO STORAGE (FIXED)
    ───────────────────────────── */
    const uploadedPaths: string[] = []

    let index = 1
    for (const image of images) {
      const arrayBuffer = await image.arrayBuffer()
      const fileBytes = new Uint8Array(arrayBuffer)

      const filePath = `lora_datasets/${loraId}/img_${String(index).padStart(2, "0")}.jpg`

      const { error: uploadError } = await supabaseAdmin.storage
        .from("lora-datasets")
        .upload(filePath, fileBytes, {
          contentType: image.type || "image/jpeg",
          upsert: false,
        })

      if (uploadError) {
        console.error("Storage upload failed:", uploadError)

        await supabaseAdmin
          .from("user_loras")
          .update({
            status: "failed",
            error_message: `Storage upload failed: ${uploadError.message}`,
          })
          .eq("id", loraId)

        return NextResponse.json({ error: "Image upload failed" }, { status: 500 })
      }

      uploadedPaths.push(filePath)
      index++
    }

    /* ─────────────────────────────
       SAVE STORAGE PATHS
    ───────────────────────────── */
    await supabaseAdmin
      .from("user_loras")
      .update({
        dataset_paths: uploadedPaths,
      })
      .eq("id", loraId)

    /* ─────────────────────────────
       DONE
    ───────────────────────────── */
    return NextResponse.json({
      lora_id: loraId,
      status: "queued",
    })
  } catch (err) {
    console.error("LoRA train fatal error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
