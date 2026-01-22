import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import fs from "fs"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TRAIN_ROOT = "/workspace/train_data"

export async function POST(req: Request) {
  console.log("🟢 [start-training] POST hit")

  const supabaseAdmin = getSupabaseAdmin()

  try {
    let lora_id: string | null = null
    let images: File[] = []

    const contentType = req.headers.get("content-type") || ""

    /* ──────────────────────────────────────────────
       1️⃣ ACCEPT BOTH JSON AND FORMDATA
    ────────────────────────────────────────────── */
    if (contentType.includes("application/json")) {
      const body = await req.json()
      lora_id = body.lora_id ?? null
    } else {
      const form = await req.formData()
      lora_id = form.get("lora_id") as string | null

      for (const [, value] of form.entries()) {
        if (value instanceof File && value.type.startsWith("image/")) {
          images.push(value)
        }
      }
    }

    if (!lora_id) {
      return NextResponse.json({ error: "Missing lora_id" }, { status: 400 })
    }

    /* ──────────────────────────────────────────────
       2️⃣ VERIFY LORA EXISTS
    ────────────────────────────────────────────── */
    const { data: lora, error } = await supabaseAdmin
      .from("user_loras")
      .select("id,status")
      .eq("id", lora_id)
      .single()

    if (error || !lora) {
      return NextResponse.json({ error: "LoRA not found" }, { status: 404 })
    }

    if (lora.status === "queued" || lora.status === "training") {
      return NextResponse.json({
        status: lora.status,
        message: "Already queued or training",
      })
    }

    /* ──────────────────────────────────────────────
       3️⃣ WRITE DATASET (ONLY IF IMAGES SENT)
    ────────────────────────────────────────────── */
    let imageCount = 0

    if (images.length > 0) {
      const datasetDir = path.join(
        TRAIN_ROOT,
        `sf_${lora_id}`,
        "10_class1"
      )

      fs.mkdirSync(datasetDir, { recursive: true })

      for (const file of images) {
        const buffer = Buffer.from(await file.arrayBuffer())
        const ext = file.name.split(".").pop() || "png"
        const filename = `${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}.${ext}`

        fs.writeFileSync(path.join(datasetDir, filename), buffer)
        imageCount++
      }

      if (imageCount < 10 || imageCount > 20) {
        return NextResponse.json(
          { error: `Invalid image count: ${imageCount} (10–20 required)` },
          { status: 400 }
        )
      }
    }

    /* ──────────────────────────────────────────────
       4️⃣ UPDATE STATUS → QUEUED
    ────────────────────────────────────────────── */
    await supabaseAdmin
      .from("user_loras")
      .update({
        status: "queued",
        image_count: imageCount || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora_id)

    console.log("✅ [start-training] Queued LoRA", lora_id)

    return NextResponse.json({
      status: "queued",
      images_written: imageCount,
    })
  } catch (err: any) {
    console.error("🔥 [start-training] Fatal error:", err)
    return NextResponse.json(
      { error: "Failed to start training" },
      { status: 500 }
    )
  }
}
