import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// R2 client (S3-compatible)
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

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const lora_id = form.get("lora_id") as string | null;
    if (!lora_id) {
      return NextResponse.json({ error: "Missing lora_id" }, { status: 400 });
    }

    const files = form.getAll("images").filter(
      (f): f is File => f instanceof File
    );

    if (files.length < 10 || files.length > 20) {
      return NextResponse.json(
        { error: "Image count must be between 10 and 20" },
        { status: 400 }
      );
    }

    const basePrefix = `${DATASET_PREFIX_ROOT}/${lora_id}`;

    // 🔥 PRODUCTION: clear existing dataset in R2
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

    // Upload fresh images
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());

      const key = `${basePrefix}/${Date.now()}_${i + 1}.jpg`;

      await r2.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buffer,
          ContentType: file.type || "image/jpeg",
        })
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[upload-dataset] Fatal:", err);
    return NextResponse.json(
      { error: "Server upload failed" },
      { status: 500 }
    );
  }
}
