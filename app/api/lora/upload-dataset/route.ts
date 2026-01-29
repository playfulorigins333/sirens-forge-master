import { NextResponse } from "next/server";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

/**
 * HARDENED LoRA dataset uploader (R2 only)
 *
 * Contract (MUST MATCH WORKER):
 *   s3://identity-loras/lora_datasets/<lora_id>/...
 *
 * Key protections:
 * - Strip ALL ASCII control characters from lora_id
 * - Canonicalize UUID before using it in R2 keys
 * - Always use trailing slash in prefix
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ────────────────────────────────────────────── */
/* UUID hardening                                 */
/* ────────────────────────────────────────────── */

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function sanitizeUUID(raw: string): string {
  const noCtl = raw.replace(CONTROL_CHARS, "").trim();

  if (!UUID_RE.test(noCtl)) {
    throw new Error(`Invalid lora_id UUID: ${JSON.stringify({
      raw,
      noCtl,
    })}`);
  }

  return noCtl.toLowerCase();
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
const DATASET_PREFIX_ROOT = "lora_datasets";

/* ────────────────────────────────────────────── */
/* POST                                          */
/* ────────────────────────────────────────────── */

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const rawId = form.get("lora_id");
    if (typeof rawId !== "string") {
      return NextResponse.json(
        { error: "Missing lora_id" },
        { status: 400 }
      );
    }

    // 🔒 HARD FIX — sanitize UUID
    const lora_id = sanitizeUUID(rawId);

    const files = form
      .getAll("images")
      .filter((f): f is File => f instanceof File);

    if (files.length < 10 || files.length > 20) {
      return NextResponse.json(
        { error: "Image count must be between 10 and 20" },
        { status: 400 }
      );
    }

    // 🔒 MUST MATCH WORKER EXACTLY
    const basePrefix = `${DATASET_PREFIX_ROOT}/${lora_id}/`;

    /* ────────────────────────────────────────── */
    /* Clear existing dataset                    */
    /* ────────────────────────────────────────── */

    const listResp = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: basePrefix,
      })
    );

    if (listResp.Contents) {
      for (const obj of listResp.Contents) {
        if (obj.Key) {
          await r2.send(
            new DeleteObjectCommand({
              Bucket: BUCKET,
              Key: obj.Key,
            })
          );
        }
      }
    }

    /* ────────────────────────────────────────── */
    /* Upload images                             */
    /* ────────────────────────────────────────── */

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());

      const key = `${basePrefix}${Date.now()}_${i + 1}.jpg`;

      await r2.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buffer,
          ContentType: file.type || "image/jpeg",
        })
      );
    }

    return NextResponse.json({
      success: true,
      lora_id,
      r2_prefix: basePrefix,
    });
  } catch (err) {
    console.error("[upload-dataset] Fatal:", err);
    return NextResponse.json(
      { error: "Server upload failed" },
      { status: 500 }
    );
  }
}
