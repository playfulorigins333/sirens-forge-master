import "server-only";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, randomUUID } from "node:crypto";
import { detectImageMime, MAX_PRIVATE_CREATOR_MEDIA_BYTES } from "@/lib/private-creator-media/core";
import { isVideoSourceUploadReady, resolveVideoSourceUploadConfig, type VideoSourceUploadConfig } from "./sourceUploadConfig";
export { isVideoSourceUploadReady, resolveVideoSourceUploadConfig } from "./sourceUploadConfig";

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp"]);
export const VIDEO_SOURCE_UPLOAD_TTL_SECONDS = 300;
const r2 = (c: VideoSourceUploadConfig) => new S3Client({ region: c.region, endpoint: c.endpoint, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });
export function validateSourceMetadata(mime: string, size: number) { if (!SUPPORTED.has(mime) || !Number.isSafeInteger(size) || size < 1 || size > MAX_PRIVATE_CREATOR_MEDIA_BYTES) throw new Error("INVALID_VIDEO_SOURCE_UPLOAD"); }

export async function signStagingUpload(input: { ownerId: string; mime: string; size: number }) {
  validateSourceMetadata(input.mime, input.size);
  const c = resolveVideoSourceUploadConfig(), uploadId = randomUUID(), ext = input.mime === "image/png" ? "png" : input.mime === "image/webp" ? "webp" : "jpg";
  const stagingKey = `creator-video-source-staging/${input.ownerId}/${uploadId}.${ext}`;
  const finalKey = `creator-video-sources/${input.ownerId}/${uploadId}/source.${ext}`;
  const uploadUrl = await getSignedUrl(r2(c), new PutObjectCommand({ Bucket: c.bucket, Key: stagingKey, ContentType: input.mime, ContentLength: input.size }), { expiresIn: VIDEO_SOURCE_UPLOAD_TTL_SECONDS });
  return { uploadId, uploadUrl, bucket: c.bucket, stagingKey, finalKey };
}

async function readVerified(c: VideoSourceUploadConfig, key: string, expectedMime: string, expectedSize: number) {
  const result = await r2(c).send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
  if (!result.Body) throw new Error("VIDEO_SOURCE_UPLOAD_MISSING");
  const hash = createHash("sha256"), signature: Buffer[] = []; let signatureBytes = 0, bytes = 0;
  for await (const raw of result.Body as AsyncIterable<Uint8Array>) { const chunk = Buffer.from(raw); bytes += chunk.length; if (bytes > MAX_PRIVATE_CREATOR_MEDIA_BYTES) throw new Error("INVALID_VIDEO_SOURCE_UPLOAD"); hash.update(chunk); if (signatureBytes < 32) { const part = chunk.subarray(0, 32 - signatureBytes); signature.push(part); signatureBytes += part.length; } }
  const mime = detectImageMime(Buffer.concat(signature));
  if (bytes !== expectedSize || mime !== expectedMime) throw new Error("INVALID_VIDEO_SOURCE_UPLOAD");
  return { mimeType: mime, sizeBytes: bytes, sha256: hash.digest("hex") };
}

/** Promotion is called only after the database has granted an exclusive live claim token. */
export async function promoteClaimedSource(input: { stagingKey: string; finalKey: string; mime: string; size: number }) {
  const c = resolveVideoSourceUploadConfig();
  const staging = await readVerified(c, input.stagingKey, input.mime, input.size);
  await r2(c).send(new CopyObjectCommand({ Bucket: c.bucket, Key: input.finalKey, CopySource: `${c.bucket}/${encodeURIComponent(input.stagingKey).replaceAll("%2F", "/")}`, ContentType: input.mime, MetadataDirective: "REPLACE" }));
  await r2(c).send(new HeadObjectCommand({ Bucket: c.bucket, Key: input.finalKey }));
  const final = await readVerified(c, input.finalKey, input.mime, input.size);
  if (final.sha256 !== staging.sha256) throw new Error("VIDEO_SOURCE_PROMOTION_MISMATCH");
  return { bucket: c.bucket, objectKey: input.finalKey, ...final, cleanup: () => r2(c).send(new DeleteObjectCommand({ Bucket: c.bucket, Key: input.stagingKey })) };
}
