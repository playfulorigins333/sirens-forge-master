// app/api/lora/get-upload-urls/route.ts
import { NextResponse } from "next/server";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUserId } from "@/lib/supabaseServer";

/**
 * Generates presigned PUT URLs for uploading Dataset Doctor raw images directly to R2.
 *
 * CONTRACT:
 *   Bucket: identity-loras
 *   Key:    dataset_doctor/<lora_id>/raw/<timestamp>_<index>.jpg
 *
 * IMPORTANT:
 * - Always creates a fresh Dataset Doctor job for each upload attempt
 * - Relinks user_loras.dataset_doctor_job_id to the fresh job
 * - Clears objects under the raw prefix before returning URLs
 *
 * Why:
 * - Reusing an old Dataset Doctor job can leave stale dataset_doctor_images rows
 * - Those stale rows can point at deleted raw R2 keys
 * - Approval must operate only on the current upload attempt
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ────────────────────────────────────────────── */
/* UUID hardening                                */
/* ────────────────────────────────────────────── */

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function sanitizeUUID(raw: string): string {
  const clean = raw.replace(CONTROL_CHARS, "").trim();
  if (!UUID_RE.test(clean)) {
    throw new Error(`Invalid lora_id UUID: ${clean}`);
  }
  return clean.toLowerCase();
}

function normalizePrefix(value: string): string {
  return (value || "").trim().replace(/^\/+|\/+$/g, "");
}

function buildDatasetDoctorRawPrefix(loraId: string): string {
  return `dataset_doctor/${loraId}/raw`;
}

/* ────────────────────────────────────────────── */
/* R2 client                                     */
/* ────────────────────────────────────────────── */

const r2 = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET!; // identity-loras

/* ────────────────────────────────────────────── */
/* POST                                          */
/* ────────────────────────────────────────────── */

export async function POST(req: Request) {
  try {
    const userId = await requireUserId({ request: req });
    const supabaseAdmin = getSupabaseAdmin();

    const body = await req.json();
    const { lora_id: rawId, image_count } = body ?? {};

    if (typeof rawId !== "string" || typeof image_count !== "number") {
      return NextResponse.json(
        { error: "Missing lora_id or image_count" },
        { status: 400 }
      );
    }

    if (image_count < 10 || image_count > 20) {
      return NextResponse.json(
        { error: "Image count must be between 10 and 20" },
        { status: 400 }
      );
    }

    const lora_id = sanitizeUUID(rawId);

    /* ────────────────────────────────────────── */
    /* Verify LoRA ownership                     */
    /* ────────────────────────────────────────── */

    const { data: lora, error: loraErr } = await supabaseAdmin
      .from("user_loras")
      .select("id, user_id")
      .eq("id", lora_id)
      .single();

    if (loraErr || !lora) {
      return NextResponse.json({ error: "LoRA not found" }, { status: 404 });
    }

    if (lora.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    /* ────────────────────────────────────────── */
    /* Always create a fresh Dataset Doctor job  */
    /* ────────────────────────────────────────── */

    const raw_r2_bucket = BUCKET;
    const raw_r2_prefix = buildDatasetDoctorRawPrefix(lora_id);

    const { data: createdJob, error: createJobErr } = await supabaseAdmin
      .from("dataset_doctor_jobs")
      .insert({
        lora_id,
        user_id: userId,
        status: "uploaded",
        raw_r2_bucket,
        raw_r2_prefix,
        auto_approve: false,
      })
      .select("id, raw_r2_bucket, raw_r2_prefix")
      .single();

    if (createJobErr || !createdJob) {
      console.error(
        "[get-upload-urls] Failed to create Dataset Doctor job:",
        createJobErr
      );
      return NextResponse.json(
        { error: "Failed to create Dataset Doctor job" },
        { status: 500 }
      );
    }

    const { error: patchLoraErr } = await supabaseAdmin
      .from("user_loras")
      .update({
        dataset_doctor_job_id: createdJob.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora_id);

    if (patchLoraErr) {
      console.error(
        "[get-upload-urls] Failed to link Dataset Doctor job to LoRA:",
        patchLoraErr
      );
      return NextResponse.json(
        { error: "Failed to link Dataset Doctor job to LoRA" },
        { status: 500 }
      );
    }

    const basePrefix = `${normalizePrefix(createdJob.raw_r2_prefix)}/`;

    /* ────────────────────────────────────────── */
    /* Clear existing raw dataset objects        */
    /* ────────────────────────────────────────── */

    const listResp = await r2.send(
      new ListObjectsV2Command({
        Bucket: createdJob.raw_r2_bucket,
        Prefix: basePrefix,
      })
    );

    if (listResp.Contents) {
      for (const obj of listResp.Contents) {
        if (obj.Key) {
          await r2.send(
            new DeleteObjectCommand({
              Bucket: createdJob.raw_r2_bucket,
              Key: obj.Key,
            })
          );
        }
      }
    }

    /* ────────────────────────────────────────── */
    /* Create signed PUT URLs                    */
    /* ────────────────────────────────────────── */

    const urls: { url: string; key: string }[] = [];
    const now = Date.now();

    for (let i = 0; i < image_count; i++) {
      const key = `${basePrefix}${now}_${i + 1}.jpg`;

      const command = new PutObjectCommand({
        Bucket: createdJob.raw_r2_bucket,
        Key: key,
        ContentType: "image/jpeg",
      });

      const url = await getSignedUrl(r2, command, {
        expiresIn: 60 * 10,
      });

      urls.push({ url, key });
    }

    return NextResponse.json({
      lora_id,
      dataset_doctor_job_id: createdJob.id,
      bucket: createdJob.raw_r2_bucket,
      prefix: basePrefix,
      urls,
    });
  } catch (err) {
    console.error("[get-upload-urls] Fatal:", err);
    return NextResponse.json(
      { error: "Failed to generate R2 upload URLs" },
      { status: 500 }
    );
  }
}