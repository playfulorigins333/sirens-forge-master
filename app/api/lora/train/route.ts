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
       ⚠️ NOT QUEUED YET
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
    const datasetDir = `/workspace/train_data/sf_${loraId}`

    /* ─────────────────────────────
       CREATE DATASET DIRECTORY
    ───────────────────────────── */
    await fs.mkdir(datasetDir, { recursive: true })

    /* ─────────────────────────────
       WRITE IMAGES
    ───────────────────────────── */
    let index = 1
    for (const image of images) {
      const buffer = Buffer.from(await image.arrayBuffer())
      const filename = `img_${String(index).padStart(2, "0")}.jpg`
      await fs.writeFile(path.join(datasetDir, filename), buffer)
      index++
    }

    /* ─────────────────────────────
       VERIFY DATASET
    ───────────────────────────── */
    const files = await fs.readdir(datasetDir)
    if (files.length < 10) {
      await supabaseAdmin
        .from("user_loras")
        .update({
          status: "failed",
          error_message: "Dataset write failed",
        })
        .eq("id", loraId)

      return NextResponse.json(
        { error: "Dataset creation failed" },
        { status: 500 }
      )
    }

    /* ─────────────────────────────
       MARK QUEUED (SAFE)
    ───────────────────────────── */
    await supabaseAdmin
      .from("user_loras")
      .update({ status: "queued" })
      .eq("id", loraId)

    /* ─────────────────────────────
       DONE — WORKER WILL PICK IT UP
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
