export type PrivateR2Config = { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string; region: string };

/** Resolves private R2 authority lazily; generic/shared credentials are intentionally ignored. */
export function resolvePrivateR2Config(env: NodeJS.ProcessEnv = process.env): PrivateR2Config {
  if (typeof window !== "undefined") throw new Error("PRIVATE_MEDIA_SERVER_ONLY");
  const endpointRaw = env.R2_ENDPOINT?.trim();
  const accessKeyId = env.CREATOR_GENERATION_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.CREATOR_GENERATION_R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.CREATOR_GENERATION_R2_BUCKET?.trim();
  if (!endpointRaw || !accessKeyId || !secretAccessKey || !bucket) throw new Error("PRIVATE_MEDIA_R2_NOT_CONFIGURED");
  const endpoint = new URL(endpointRaw);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("PRIVATE_MEDIA_R2_ENDPOINT_INVALID");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("PRIVATE_MEDIA_R2_BUCKET_INVALID");
  return { endpoint: endpoint.toString(), accessKeyId, secretAccessKey, bucket, region: env.R2_REGION || env.AWS_DEFAULT_REGION || "auto" };
}

export function isPrivateCreatorMediaDeliveryReady(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PRIVATE_CREATOR_MEDIA_ENABLED !== "true") return false;
  try {
    resolvePrivateR2Config(env);
    return true;
  } catch {
    return false;
  }
}
