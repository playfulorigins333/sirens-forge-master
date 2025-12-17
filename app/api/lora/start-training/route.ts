import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import fs from "fs"
import path from "path"
import { spawn } from "child_process"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/lora/start-training
 *
 * Multipart form-data:
 * - lora_id (string)
 * - images[] (File, 10–20)
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData()

    const loraId = formData.get("lora_id")?.toString()
    if (!loraId) {
      return NextResponse.json(
        { error: "Missing lora_id" },
        { status: 400 }
      )
    }

    // ----------------------------------------
    // 1. Load LoRA record + guard active job
    // ----------------------------------------
    const { data: lora, error: fetchErr } = await supabaseAdmin
      .from("user_loras")
      .select("id, status")
      .eq("id", loraId)
      .single()

    if (fetchErr || !lora) {
      return NextResponse.json(
        { error: "LoRA not found" },
        { status: 404 }
      )
    }

    if (lora.status === "queued" || lora.status === "training") {
      console.log("[start-training] Job already active — exiting")
      return NextResponse.json(
        { status: lora.status },
        { status: 200 }
      )
    }

    // ----------------------------------------
    // 2. Extract images
    // ----------------------------------------
    const files = formData.getAll("images") as File[]

    if (files.length < 10 || files.length > 20) {
      return NextResponse.json(
        { error: "You must upload between 10 and 20 images" },
        { status: 400 }
      )
    }

    // ----------------------------------------
    // 3. Create dataset directory
    // ----------------------------------------
    const datasetDir = `/workspace/train_data/sf_${loraId}`
    fs.mkdirSync(datasetDir, { recursive: true })

    // ----------------------------------------
    // 4. Write images to disk
    // ----------------------------------------
    let index = 0
    for (const file of files) {
      if (!(file instanceof File)) continue

      const buffer = Buffer.from(await file.arrayBuffer())
      const ext =
        path.extname(file.name) ||
        (file.type.includes("png") ? ".png" : ".jpg")

      const filename = `img_${String(index).padStart(3, "0")}${ext}`
      const outPath = path.join(datasetDir, filename)

      fs.writeFileSync(outPath, buffer)
      index++
    }

    // ----------------------------------------
    // 5. Mark job as queued
    // ----------------------------------------
    await supabaseAdmin
      .from("user_loras")
      .update({
        status: "queued",
        updated_at: new Date().toISOString(),
      })
      .eq("id", loraId)

    // ----------------------------------------
    // 6. Launch trainer (ALWAYS-ON POD)
    // ----------------------------------------
    const child = spawn(
      "python",
      ["runpod/train_lora.py"],
      {
        env: {
          ...process.env,
          LORA_ID: loraId,
        },
        stdio: "inherit",
        detached: true,
      }
    )

    child.unref()

    return NextResponse.json({
      status: "queued",
    })
  } catch (err) {
    console.error("[start-training] Fatal error:", err)
    return NextResponse.json(
      { error: "Failed to start training" },
      { status: 500 }
    )
  }
}
