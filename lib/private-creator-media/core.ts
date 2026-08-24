import { createHash } from "node:crypto";

export const PRIVATE_MEDIA_SIGNED_TTL_SECONDS = 300;
export const MAX_PRIVATE_CREATOR_MEDIA_BYTES = 50 * 1024 * 1024;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPrivateCreatorMediaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PRIVATE_CREATOR_MEDIA_ENABLED === "true";
}

export function validateObjectKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 1024 || key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => part === "" || part === "." || part === "..") || /[\x00-\x1f\x7f]/.test(key)) throw new Error("PRIVATE_MEDIA_INVALID_KEY");
  return key;
}

export function detectImageMime(header: Uint8Array): string | null {
  const bytes = Buffer.from(header);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

export function hashBytes(chunks: Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex");
}

export function sanitizeDownloadFilename(name: string, mime: string): string {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const stem = name.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "sirens-forge-asset";
  return `${stem}.${ext}`;
}
