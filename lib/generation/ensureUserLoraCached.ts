import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const CACHE_DIR = "/workspace/cache/loras";

export async function ensureUserLoraCached(loraId: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase server env not configured");
  }

  const localPath = path.join(CACHE_DIR, `${loraId}.safetensors`);

  // 1️⃣ Already cached → done
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

  // 2️⃣ Fetch artifact info
  const { data, error } = await supabase
    .from("user_loras")
    .select("artifact_r2_bucket, artifact_r2_key")
    .eq("id", loraId)
    .eq("status", "completed")
    .single();

  if (error || !data) {
    throw new Error(`LoRA not found or not completed: ${loraId}`);
  }

  const { artifact_r2_bucket, artifact_r2_key } = data;

  if (!artifact_r2_bucket || !artifact_r2_key) {
    throw new Error(`LoRA artifact missing for ${loraId}`);
  }

  // 3️⃣ Download from R2
  const { data: file, error: downloadErr } = await supabase.storage
    .from(artifact_r2_bucket)
    .download(artifact_r2_key);

  if (downloadErr || !file) {
    throw new Error(`Failed to download LoRA: ${artifact_r2_key}`);
  }

  // 4️⃣ Ensure cache dir
  await fs.mkdir(CACHE_DIR, { recursive: true });

  // 5️⃣ Write to disk
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(localPath, buffer);

  return localPath;
}
