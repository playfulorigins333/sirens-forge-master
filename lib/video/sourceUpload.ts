import "server-only";
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { MAX_PRIVATE_CREATOR_MEDIA_BYTES } from "@/lib/private-creator-media/core";
import { verifyPrivateGenerationObject } from "@/lib/private-creator-media/r2";
import { isVideoSourceUploadOperational, resolveVideoSourceUploadConfig, type VideoSourceUploadConfig } from "./sourceUploadConfig";
export { isVideoSourceUploadOperational, resolveVideoSourceUploadConfig } from "./sourceUploadConfig";

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp"]);
export const VIDEO_SOURCE_SIGNED_PUT_TTL_SECONDS = 600;
export const VIDEO_SOURCE_FINALIZATION_TTL_SECONDS = 1800;
const r2 = (c: VideoSourceUploadConfig) => new S3Client({ region: c.region, endpoint: c.endpoint, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });
export function validateSourceMetadata(mime: string, size: number) { if (!SUPPORTED.has(mime) || !Number.isSafeInteger(size) || size < 1 || size > MAX_PRIVATE_CREATOR_MEDIA_BYTES) throw new Error("INVALID_VIDEO_SOURCE_UPLOAD"); }

export async function signStagingUpload(input: { ownerId: string; mime: string; size: number }) {
  validateSourceMetadata(input.mime, input.size);
  const c = resolveVideoSourceUploadConfig(), uploadId = randomUUID(), ext = input.mime === "image/png" ? "png" : input.mime === "image/webp" ? "webp" : "jpg";
  const stagingKey = `creator-video-source-staging/${input.ownerId}/${uploadId}.${ext}`;
  const uploadUrl = await getSignedUrl(r2(c), new PutObjectCommand({ Bucket: c.bucket, Key: stagingKey, ContentType: input.mime, ContentLength: input.size }), { expiresIn: VIDEO_SOURCE_SIGNED_PUT_TTL_SECONDS });
  return { uploadId, uploadUrl, bucket: c.bucket, stagingKey };
}

/** Promotion is called only after the database has granted an exclusive live claim token. */
export async function promoteClaimedSource(input: { bucket: string; ownerId: string; uploadId: string; claimToken: string; stagingKey: string; mime: string; size: number }) {
  const c = resolveVideoSourceUploadConfig();
  if (c.bucket !== input.bucket) throw new Error("VIDEO_SOURCE_UPLOAD_BUCKET_DRIFT");
  const staging = await verifyPrivateGenerationObject(input.bucket, input.stagingKey);
  if (staging.mimeType !== input.mime || staging.sizeBytes !== input.size) throw new Error("INVALID_VIDEO_SOURCE_UPLOAD");
  const ext = input.mime === "image/png" ? "png" : input.mime === "image/webp" ? "webp" : "jpg";
  const finalKey = `creator-video-sources/${input.ownerId}/${input.uploadId}/${staging.sha256}-${input.claimToken}.${ext}`;
  await r2(c).send(new CopyObjectCommand({ Bucket: input.bucket, Key: finalKey, CopySource: `${input.bucket}/${encodeURIComponent(input.stagingKey).replaceAll("%2F", "/")}`, ContentType: input.mime, MetadataDirective: "REPLACE" }));
  const final = await verifyPrivateGenerationObject(input.bucket, finalKey);
  if (final.sha256 !== staging.sha256) throw new Error("VIDEO_SOURCE_PROMOTION_MISMATCH");
  return { bucket: input.bucket, objectKey: finalKey, ...final, cleanup: () => r2(c).send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.stagingKey })) };
}
