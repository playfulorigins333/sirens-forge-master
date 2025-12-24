import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRAIN_ROOT = "/workspace/train_data";

export async function POST(req: Request) {
  try {
    // ✅ CREATE SUPABASE CLIENT AT RUNTIME ONLY
    const supabaseAdmin = getSupabaseAdmin();

    const form = await req.formData();
    const lora_id = form.get("lora_id") as string;

    if (!lora_id) {
      return NextResponse.json({ error: "Missing lora_id" }, { status: 400 });
    }

    // 1️⃣ Guard: block if job already active
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("user_loras")
      .select("id, status")
      .eq("id", lora_id)
      .single();

    if (existingErr || !existing) {
      return NextResponse.json({ error: "LoRA job not found" }, { status: 404 });
    }

    if (existing.status === "queued" || existing.status === "training") {
      return NextResponse.json({
        status: existing.status,
        message: "Job already active",
      });
    }

    // 2️⃣ Prepare dataset directory
    const datasetDir = path.join(TRAIN_ROOT, `sf_${lora_id}`, "10_class1");
    fs.mkdirSync(datasetDir, { recursive: true });

    let imageCount = 0;

    for (const [, value] of form.entries()) {
      if (!(value instanceof File)) continue;
      if (!value.type.startsWith("image/")) continue;

      const buffer = Buffer.from(await value.arrayBuffer());
      const ext = value.name.split(".").pop() || "png";
      const filename = `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;

      fs.writeFileSync(path.join(datasetDir, filename), buffer);
      imageCount++;
    }

    if (imageCount < 10 || imageCount > 20) {
      return NextResponse.json(
        { error: `Invalid image count: ${imageCount} (10–20 required)` },
        { status: 400 }
      );
    }

    // 3️⃣ Update DB → queued
    await supabaseAdmin
      .from("user_loras")
      .update({
        status: "queued",
        image_count: imageCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora_id);

    // 4️⃣ Spawn trainer
    const child = spawn("python", ["runpod/train_lora.py"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LORA_ID: lora_id,
      },
      detached: true,
      stdio: "ignore",
    });

    child.unref();

    return NextResponse.json({
      status: "queued",
      images_written: imageCount,
    });
  } catch (err: any) {
    console.error("[lora/train] Fatal error:", err);
    return NextResponse.json(
      { error: "Failed to start training" },
      { status: 500 }
    );
  }
}
