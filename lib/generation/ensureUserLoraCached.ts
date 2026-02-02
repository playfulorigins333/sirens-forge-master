import fs from "fs/promises";
import path from "path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// 🔒 R2 ENV (S3-compatible)
const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "identity-loras";

const CACHE_DIR = "/workspace/cache/loras";

// ------------------------------------------------------------
// R2 Client
// ------------------------------------------------------------
const r2 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ------------------------------------------------------------
// Ensure user LoRA is cached locally
// ------------------------------------------------------------
export async function ensureUserLoraCached(loraId: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase server env not configured");
  }

  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 env not configured");
  }

  const localPath = path.join(CACHE_DIR, `${loraId}.safetensors`);

  // 1️⃣ Already cached
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // continue
  }

  const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );

  // 2️⃣ Fetch artifact metadata
  const { data, error } = await supabase
    .from("user_loras")
    .select("artifact_r2_key")
    .eq("id", loraId)
    .eq("status", "completed")
    .single();

  if (error || !data?.artifact_r2_key) {
    throw new Error(`LoRA not found or not completed: ${loraId}`);
  }

  const key = data.artifact_r2_key;

  // 3️⃣ Download from R2
  const result = await r2.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    })
  );

  if (!result.Body) {
    throw new Error(`Empty R2 response for ${key}`);
  }

  // 4️⃣ Ensure cache dir
  await fs.mkdir(CACHE_DIR, { recursive: true });

  // 5️⃣ Write to disk
  const buffer = Buffer.from(await result.Body.transformToByteArray());
  await fs.writeFile(localPath, buffer);

  return localPath;
}
