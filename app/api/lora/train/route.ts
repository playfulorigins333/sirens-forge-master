import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    /* ──────────────────────────────────────────────
       1️⃣ AUTHENTICATE USER (NOT SERVICE ROLE)
    ────────────────────────────────────────────── */
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

    /* ──────────────────────────────────────────────
       2️⃣ PARSE JSON BODY (NO FORM DATA)
    ────────────────────────────────────────────── */
    const body = await req.json()

    const {
      lora_id,
      identityName,
      description,
      image_count,
      storage_bucket,
      storage_prefix,
    } = body ?? {}

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
        { error: "Invalid training payload" },
        { status: 400 }
      )
    }

    /* ──────────────────────────────────────────────
       3️⃣ VERIFY DB ROW OWNERSHIP
    ────────────────────────────────────────────── */
    const { data: loraRow, error: fetchErr } = await supabase
      .from("user_loras")
      .select("id, user_id, status")
      .eq("id", lora_id)
      .single()

    if (fetchErr || !loraRow) {
      return NextResponse.json(
        { error: "LoRA job not found" },
        { status: 404 }
      )
    }

    if (loraRow.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    /* ──────────────────────────────────────────────
       4️⃣ CONFIRM STORAGE DATA EXISTS
    ────────────────────────────────────────────── */
    const { data: files, error: listErr } = await supabase.storage
      .from(storage_bucket)
      .list(storage_prefix)

    if (listErr || !files || files.length < image_count) {
      return NextResponse.json(
        { error: "Training images not found in storage" },
        { status: 400 }
      )
    }

    /* ──────────────────────────────────────────────
       5️⃣ MARK JOB AS QUEUED
    ────────────────────────────────────────────── */
    const { error: updateErr } = await supabase
      .from("user_loras")
      .update({
        status: "queued",
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora_id)

    if (updateErr) {
      throw updateErr
    }

    /* ──────────────────────────────────────────────
       6️⃣ DONE — WORKER PICKS THIS UP
    ────────────────────────────────────────────── */
    return NextResponse.json({
      lora_id,
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
