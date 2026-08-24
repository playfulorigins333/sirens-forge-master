import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { detectImageMime, MAX_PRIVATE_CREATOR_MEDIA_BYTES, PRIVATE_MEDIA_SIGNED_TTL_SECONDS, validateObjectKey } from "./core";

export type VerifiedPrivateObject = { bucket: string; key: string; mimeType: string; sizeBytes: number; sha256: string };

function config() {
  if (typeof window !== "undefined") throw new Error("PRIVATE_MEDIA_SERVER_ONLY");
  const endpointRaw = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.CREATOR_GENERATION_R2_BUCKET?.trim();
  if (!endpointRaw || !accessKeyId || !secretAccessKey || !bucket) throw new Error("PRIVATE_MEDIA_R2_NOT_CONFIGURED");
  const endpoint = new URL(endpointRaw);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("PRIVATE_MEDIA_R2_ENDPOINT_INVALID");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("PRIVATE_MEDIA_R2_BUCKET_INVALID");
  return { endpoint: endpoint.toString(), accessKeyId, secretAccessKey, bucket, region: process.env.R2_REGION || process.env.AWS_DEFAULT_REGION || "auto" };
}

function client(c: ReturnType<typeof config>) { return new S3Client({ region: c.region, endpoint: c.endpoint, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } }); }

export async function verifyPrivateGenerationObject(bucket: string, objectKey: string): Promise<VerifiedPrivateObject> {
  const c = config();
  if (bucket !== c.bucket) throw new Error("PRIVATE_MEDIA_BUCKET_NOT_ALLOWED");
  const key = validateObjectKey(objectKey);
  const r2 = client(c);
  const head = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const declared = Number(head.ContentLength);
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_PRIVATE_CREATOR_MEDIA_BYTES) throw new Error("PRIVATE_MEDIA_SIZE_INVALID");
  const response = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error("PRIVATE_MEDIA_OBJECT_UNAVAILABLE");
  const hash = createHash("sha256");
  const signature: Buffer[] = [];
  let signatureBytes = 0;
  let size = 0;
  for await (const raw of response.Body as AsyncIterable<Uint8Array>) {
    const chunk = Buffer.from(raw); size += chunk.length;
    if (size > MAX_PRIVATE_CREATOR_MEDIA_BYTES || size > declared) throw new Error("PRIVATE_MEDIA_SIZE_INVALID");
    hash.update(chunk);
    if (signatureBytes < 32) { const part = chunk.subarray(0, 32 - signatureBytes); signature.push(part); signatureBytes += part.length; }
  }
  if (size !== declared) throw new Error("PRIVATE_MEDIA_SIZE_MISMATCH");
  const detected = detectImageMime(Buffer.concat(signature));
  const claimed = String(response.ContentType || head.ContentType || "").split(";", 1)[0].trim().toLowerCase();
  if (!detected || detected !== claimed) throw new Error("PRIVATE_MEDIA_MIME_INVALID");
  return { bucket, key, mimeType: detected, sizeBytes: size, sha256: hash.digest("hex") };
}

export async function signPrivateGenerationObject(input: { bucket: string; key: string; filename?: string }): Promise<string> {
  const c = config();
  if (input.bucket !== c.bucket) throw new Error("PRIVATE_MEDIA_BUCKET_NOT_ALLOWED");
  const command = new GetObjectCommand({ Bucket: input.bucket, Key: validateObjectKey(input.key), ...(input.filename ? { ResponseContentDisposition: `attachment; filename="${input.filename}"` } : {}) });
  return getSignedUrl(client(c), command, { expiresIn: PRIVATE_MEDIA_SIGNED_TTL_SECONDS });
}
