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
 * NEW CONTRACT (Dataset Doctor source of truth):
 *   Bucket: identity-loras
 *   Key:    dataset_doctor/<lora_id>/raw/<timestamp>_<index>.jpg
 *
 * Behavior:
 * - Verifies LoRA ownership
 * - Creates or reuses a Dataset Doctor job for this LoRA/user
 * - Clears existing objects under that raw prefix before returning URLs
 * - Returns dataset_doctor_job_id so the UI can continue the flow
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
      .select("id, user_id, dataset_doctor_job_id")
      .eq("id", lora_id)
      .single();

    if (loraErr || !lora) {
      return NextResponse.json({ error: "LoRA not found" }, { status: 404 });
    }

    if (lora.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    /* ────────────────────────────────────────── */
    /* Find or create Dataset Doctor job         */
    /* ────────────────────────────────────────── */

    let datasetDoctorJob:
      | {
          id: string;
          raw_r2_bucket: string;
          raw_r2_prefix: string;
        }
      | null = null;

    if (lora.dataset_doctor_job_id) {
      const { data: existingJob } = await supabaseAdmin
        .from("dataset_doctor_jobs")
        .select("id, raw_r2_bucket, raw_r2_prefix")
        .eq("id", lora.dataset_doctor_job_id)
        .eq("lora_id", lora_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (existingJob) {
        datasetDoctorJob = existingJob;
      }
    }

    if (!datasetDoctorJob) {
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
        console.error("[get-upload-urls] Failed to create Dataset Doctor job:", createJobErr);
        return NextResponse.json(
          { error: "Failed to create Dataset Doctor job" },
          { status: 500 }
        );
      }

      datasetDoctorJob = createdJob;

      const { error: patchLoraErr } = await supabaseAdmin
        .from("user_loras")
        .update({
          dataset_doctor_job_id: createdJob.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", lora_id);

      if (patchLoraErr) {
        console.error("[get-upload-urls] Failed to link Dataset Doctor job to LoRA:", patchLoraErr);
        return NextResponse.json(
          { error: "Failed to link Dataset Doctor job to LoRA" },
          { status: 500 }
        );
      }
    }

    const basePrefix = `${normalizePrefix(datasetDoctorJob.raw_r2_prefix)}/`;

    /* ────────────────────────────────────────── */
    /* Clear existing raw dataset objects        */
    /* ────────────────────────────────────────── */

    const listResp = await r2.send(
      new ListObjectsV2Command({
        Bucket: datasetDoctorJob.raw_r2_bucket,
        Prefix: basePrefix,
      })
    );

    if (listResp.Contents) {
      for (const obj of listResp.Contents) {
        if (obj.Key) {
          await r2.send(
            new DeleteObjectCommand({
              Bucket: datasetDoctorJob.raw_r2_bucket,
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

    for (let i = 0; i < image_count; i++) {
      const key = `${basePrefix}${Date.now()}_${i + 1}.jpg`;

      const command = new PutObjectCommand({
        Bucket: datasetDoctorJob.raw_r2_bucket,
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
      dataset_doctor_job_id: datasetDoctorJob.id,
      bucket: datasetDoctorJob.raw_r2_bucket,
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