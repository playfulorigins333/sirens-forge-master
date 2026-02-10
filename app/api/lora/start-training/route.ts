// app/api/lora/start-training/route.ts

import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/* ──────────────────────────────────────────────
   R2 CONFIG
────────────────────────────────────────────── */
const R2 = new S3Client({
  region: process.env.R2_REGION || "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const R2_BUCKET = process.env.R2_BUCKET!
const DATASET_PREFIX = "lora_datasets"

/* ──────────────────────────────────────────────
   POST /api/lora/start-training
────────────────────────────────────────────── */
export async function POST(req: Request) {
  console.log("🟢 [start-training] POST hit")

  const supabase = getSupabaseAdmin()

  try {
    const form = await req.formData()

    const lora_id = form.get("lora_id") as string | null
    if (!lora_id) {
      return NextResponse.json({ error: "Missing lora_id" }, { status: 400 })
    }

    const images: File[] = []
    for (const [, v] of form.entries()) {
      if (v instanceof File && v.type.startsWith("image/")) {
        images.push(v)
      }
    }

    if (images.length < 10 || images.length > 20) {
      return NextResponse.json(
        { error: `Invalid image count: ${images.length} (10–20 required)` },
        { status: 400 }
      )
    }

    /* ──────────────────────────────────────────────
       VERIFY LORA
    ────────────────────────────────────────────── */
    const { data: lora } = await supabase
      .from("user_loras")
      .select("id,status")
      .eq("id", lora_id)
      .single()

    if (!lora) {
      return NextResponse.json({ error: "LoRA not found" }, { status: 404 })
    }

    if (["queued", "training"].includes(lora.status)) {
      return NextResponse.json({ status: lora.status })
    }

    /* ──────────────────────────────────────────────
       UPLOAD IMAGES → R2
    ────────────────────────────────────────────── */
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const buffer = Buffer.from(await img.arrayBuffer())

      const ext = img.name.split(".").pop() || "jpg"
      const key = `${DATASET_PREFIX}/${lora_id}/img_${i + 1}.${ext}`

      await R2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: img.type || "image/jpeg",
        })
      )
    }

    /* ──────────────────────────────────────────────
       UPDATE DB → QUEUED
    ────────────────────────────────────────────── */
    await supabase
      .from("user_loras")
      .update({
        status: "queued",
        image_count: images.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora_id)

    console.log("✅ [start-training] Images uploaded to R2, queued", lora_id)

    return NextResponse.json({
      status: "queued",
      image_count: images.length,
    })
  } catch (err) {
    console.error("🔥 [start-training] Fatal:", err)
    return NextResponse.json(
      { error: "Failed to start training" },
      { status: 500 }
    )
  }
}
