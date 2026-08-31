const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
export type VideoSourceUploadConfig = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string };
export function resolveVideoSourceUploadConfig(env: NodeJS.ProcessEnv = process.env): VideoSourceUploadConfig {
  const endpointRaw = env.R2_ENDPOINT?.trim(), bucket = env.CREATOR_GENERATION_R2_BUCKET?.trim(), accessKeyId = env.CREATOR_GENERATION_R2_UPLOAD_ACCESS_KEY_ID?.trim(), secretAccessKey = env.CREATOR_GENERATION_R2_UPLOAD_SECRET_ACCESS_KEY?.trim();
  if (!endpointRaw || !bucket || !accessKeyId || !secretAccessKey) throw new Error("VIDEO_SOURCE_UPLOAD_NOT_CONFIGURED");
  const endpoint = new URL(endpointRaw); if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("VIDEO_SOURCE_UPLOAD_ENDPOINT_INVALID"); if (!BUCKET_RE.test(bucket)) throw new Error("VIDEO_SOURCE_UPLOAD_BUCKET_INVALID");
  return { endpoint: endpoint.toString(), bucket, accessKeyId, secretAccessKey, region: env.R2_REGION || env.AWS_DEFAULT_REGION || "auto" };
}
export function isVideoSourceUploadReady(env: NodeJS.ProcessEnv = process.env): boolean { try { resolveVideoSourceUploadConfig(env); return true; } catch { return false; } }
export const isVideoSourceUploadInfraReady = (env: NodeJS.ProcessEnv = process.env) => env.VIDEO_SOURCE_UPLOAD_INFRA_READY === "true";
export const isVideoSourceUploadOperational = (env: NodeJS.ProcessEnv = process.env) => isVideoSourceUploadInfraReady(env) && isVideoSourceUploadReady(env);
