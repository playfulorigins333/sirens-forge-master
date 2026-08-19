import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const CACHE_DIR = "/tmp/loras";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY_UNAVAILABLE = "IDENTITY_LORA_UNAVAILABLE";

export type OwnedLoraMetadata = {
  artifact_r2_bucket: string | null;
  artifact_r2_key: string;
  trigger_token: string | null;
};

export type LoraCacheDependencies = {
  loadOwnedCompletedLora(loraId: string, userId: string): Promise<OwnedLoraMetadata | null>;
  fileExists(filePath: string): Promise<boolean>;
  download(bucket: string, key: string): Promise<Uint8Array>;
  write(filePath: string, bytes: Uint8Array): Promise<void>;
  publish(source: string, destination: string): Promise<void>;
  remove(filePath: string): Promise<void>;
};

function serverDependencies(): LoraCacheDependencies {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const endpoint = process.env.R2_ENDPOINT || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
  if (!url || !key) throw new Error("Supabase server env not configured");
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error("R2 env not configured");
  const supabase = createClient(url, key);
  const r2 = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
  return {
    async loadOwnedCompletedLora(loraId, userId) {
      const { data, error } = await supabase.from("user_loras")
        .select("artifact_r2_bucket,artifact_r2_key,trigger_token")
        .eq("id", loraId).eq("user_id", userId).eq("status", "completed").maybeSingle();
      return error || !data?.artifact_r2_key ? null : data as OwnedLoraMetadata;
    },
    async fileExists(filePath) { try { await fs.access(filePath); return true; } catch { return false; } },
    async download(bucket, objectKey) {
      const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
      if (!result.Body) throw new Error("IDENTITY_LORA_DOWNLOAD_FAILED");
      return result.Body.transformToByteArray();
    },
    async write(filePath, bytes) { await fs.mkdir(CACHE_DIR, { recursive: true }); await fs.writeFile(filePath, bytes, { flag: "wx" }); },
    async publish(source, destination) { await fs.link(source, destination); },
    async remove(filePath) { await fs.rm(filePath, { force: true }); },
  };
}

/** Ownership is verified before even consulting the process-local cache. */
export async function ensureUserLoraCached(
  loraId: string,
  userId: string,
  deps: LoraCacheDependencies = serverDependencies(),
): Promise<{ localPath: string; metadata: OwnedLoraMetadata }> {
  if (!UUID.test(loraId) || !UUID.test(userId)) throw new Error(IDENTITY_UNAVAILABLE);
  const metadata = await deps.loadOwnedCompletedLora(loraId, userId);
  if (!metadata) throw new Error(IDENTITY_UNAVAILABLE);
  const localPath = path.join(CACHE_DIR, `${loraId}.safetensors`);
  if (await deps.fileExists(localPath)) return { localPath, metadata };
  const bucket = metadata.artifact_r2_bucket?.trim() || process.env.R2_BUCKET || "identity-loras";
  const bytes = await deps.download(bucket, metadata.artifact_r2_key);
  if (bytes.byteLength === 0) throw new Error(IDENTITY_UNAVAILABLE);
  const temporaryPath = `${localPath}.${crypto.randomUUID()}.tmp`;
  try {
    await deps.write(temporaryPath, bytes);
    if (await deps.fileExists(localPath)) return { localPath, metadata };
    await deps.publish(temporaryPath, localPath);
  } catch {
    if (!(await deps.fileExists(localPath))) throw new Error(IDENTITY_UNAVAILABLE);
  } finally {
    await deps.remove(temporaryPath).catch(() => undefined);
  }
  return { localPath, metadata };
}
