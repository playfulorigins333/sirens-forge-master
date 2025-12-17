import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import fs from "fs/promises"
import path from "path"

export async function POST(req: Request) {
  try {
    /* ─────────────────────────────
       AUTH
    ───────────────────────────── */
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
        { error: "Invalid session" },
        { status: 401 }
      )
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
       CREATE DB ROW (DRAFT)
       Do NOT queue yet.
    ───────────────────────────── */
    const { data: lora, error: insertError } = await supabaseAdmin
      .from("user_loras")
      .insert({
        user_id: user.id,
        name: identityName,
        description,
        image_count: images.length,
        status: "draft",
      })
      .select()
      .single()

    if (insertError || !lora) {
      console.error("LoRA insert error:", insertError)
      return NextResponse.json(
        { error: "Failed to create LoRA record" },
        { status: 500 }
      )
    }

    const loraId = lora.id

    /* ─────────────────────────────
       CREATE DATASET DIRECTORY
       (THIS IS THE CRITICAL FIX)
    ───────────────────────────── */
    const datasetDir = `/workspace/train_data/sf_${loraId}`

    try {
      await fs.mkdir(datasetDir, { recursive: true })
    } catch (err) {
      await supabaseAdmin
        .from("user_loras")
        .update({
          status: "failed",
          error_message: "Failed to create dataset directory",
        })
        .eq("id", loraId)

      return NextResponse.json(
        { error: "Failed to create dataset directory" },
        { status: 500 }
      )
    }

    /* ─────────────────────────────
       WRITE IMAGE FILES TO DISK
    ───────────────────────────── */
    let index = 1
    for (const image of images) {
      const buffer = Buffer.from(await image.arrayBuffer())
      const filename = `img_${String(index).padStart(2, "0")}.jpg`
      const filePath = path.join(datasetDir, filename)

      try {
        await fs.writeFile(filePath, buffer)
      } catch (err) {
        await supabaseAdmin
          .from("user_loras")
          .update({
            status: "failed",
            error_message: "Failed to write training images to disk",
          })
          .eq("id", loraId)

        return NextResponse.json(
          { error: "Failed to write image files" },
          { status: 500 }
        )
      }

      index++
    }

    /* ─────────────────────────────
       VERIFY DATASET EXISTS
    ───────────────────────────── */
    const writtenFiles = await fs.readdir(datasetDir)
    if (writtenFiles.length < 10) {
      await supabaseAdmin
        .from("user_loras")
        .update({
          status: "failed",
          error_message: "Dataset verification failed",
        })
        .eq("id", loraId)

      return NextResponse.json(
        { error: "Dataset verification failed" },
        { status: 500 }
      )
    }

    /* ─────────────────────────────
       MARK AS QUEUED (WORKER READY)
    ───────────────────────────── */
    await supabaseAdmin
      .from("user_loras")
      .update({
        status: "queued",
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
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    )
  }
}
