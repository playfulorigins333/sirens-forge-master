import { NextResponse } from "next/server";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Generates presigned PUT URLs for uploading LoRA datasets directly to R2.
 *
 * CONTRACT (matches worker exactly):
 *   Bucket: identity-loras
 *   Key:    lora_datasets/<lora_id>/<timestamp>_<index>.jpg
 *
 * SAFETY GUARANTEE:
 * - ALWAYS clears existing dataset prefix before issuing URLs
 * - Prevents duplicate / accumulated images across retries
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ────────────────────────────────────────────── */
/* UUID hardening (same rules as worker/uploader) */
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

    // 🔒 Canonicalize UUID
    const lora_id = sanitizeUUID(rawId);

    // 🔒 MUST MATCH TRAINER EXACTLY
    const basePrefix = `${DATASET_PREFIX_ROOT}/${lora_id}/`;

    /* ────────────────────────────────────────── */
    /* HARD RESET: clear existing dataset prefix */
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
    /* Generate presigned PUT URLs               */
    /* ────────────────────────────────────────── */

    const urls: { url: string; key: string }[] = [];

    for (let i = 0; i < image_count; i++) {
      const key = `${basePrefix}${Date.now()}_${i + 1}.jpg`;

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: "image/jpeg",
      });

      const url = await getSignedUrl(r2, command, {
        expiresIn: 60 * 10, // 10 minutes
      });

      urls.push({ url, key });
    }

    return NextResponse.json({
      lora_id,
      bucket: BUCKET,
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
