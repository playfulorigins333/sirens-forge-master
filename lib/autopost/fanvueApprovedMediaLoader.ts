import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import type { FanvueInternalApprovedMedia } from "./fanvueInternalAdapter"

export type FanvueApprovedMediaLoaderFailureCode =
  | "FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED"
  | "FANVUE_SERVER_OWNED_MEDIA_SINGLE_ASSET_ONLY"
  | "FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_FOUND"
  | "FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_COMPLETED"
  | "FANVUE_SERVER_OWNED_MEDIA_R2_OBJECT_REQUIRED"
  | "FANVUE_SERVER_OWNED_MEDIA_UNSUPPORTED_TYPE"
  | "FANVUE_SERVER_OWNED_MEDIA_LOAD_FAILED"

export type FanvueApprovedMediaGenerationRow = {
  id?: string | null
  user_id?: string | null
  status?: string | null
  job_type?: string | null
  kind?: string | null
  mode?: string | null
  metadata?: unknown
  r2_bucket?: string | null
  r2_key?: string | null
}

export type FanvueApprovedMediaLoaderResult =
  | { ok: true; media: FanvueInternalApprovedMedia }
  | { ok: false; safe_code: FanvueApprovedMediaLoaderFailureCode }

export type FanvueApprovedMediaLoaderInput = {
  userId: string
  sourceAssetIds: string[]
  loadGeneration: (input: { userId: string; assetId: string }) => Promise<FanvueApprovedMediaGenerationRow | null>
  getR2Object?: (input: { bucket: string; key: string }) => Promise<{ bytes: BodyInit; contentType?: string | null }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_FILENAME_CHARS_RE = /[^A-Za-z0-9._-]+/g
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"])
const VIDEO_EXTENSIONS = new Set([".mp4"])
const VIDEO_CONTENT_TYPES = new Set(["video/mp4"])

function clean(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isPlaceholderOrUnsafe(row: FanvueApprovedMediaGenerationRow) {
  const metadata = asRecord(row.metadata)
  return metadata?.placeholder === true || metadata?.test === true || metadata?.unsafe === true
}

function extensionFromKey(key: string) {
  const pathname = key.split("?")[0]?.split("#")[0] ?? key
  const last = pathname.split("/").pop() ?? ""
  const match = last.toLowerCase().match(/\.[a-z0-9]{2,5}$/)
  return match?.[0] ?? ""
}

function inferApprovedMediaType(row: FanvueApprovedMediaGenerationRow, contentType: string | null) {
  const metadata = asRecord(row.metadata)
  const metadataKind = clean(metadata?.kind)?.toLowerCase()
  const metadataMode = clean(metadata?.mode)?.toLowerCase()
  const rowKind = clean(row.kind)?.toLowerCase()
  const rowJobType = clean(row.job_type)?.toLowerCase()
  const rowMode = clean(row.mode)?.toLowerCase()
  const content = contentType?.toLowerCase() ?? ""
  const ext = extensionFromKey(clean(row.r2_key) ?? "")

  const declaresVideo = metadataKind === "video" || rowKind === "video" || rowJobType?.includes("video") || rowMode?.includes("video") || metadataMode?.includes("video")
  if (declaresVideo || content.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) {
    if (declaresVideo && VIDEO_CONTENT_TYPES.has(content) && VIDEO_EXTENSIONS.has(ext)) return "video" as const
    return null
  }

  if (content.startsWith("image/") || metadataKind === "image" || rowKind === "image" || rowJobType === "image" || IMAGE_EXTENSIONS.has(ext)) {
    return "image" as const
  }

  return null
}

function safeFilename(assetId: string, key: string) {
  const keyExt = extensionFromKey(key)
  const ext = IMAGE_EXTENSIONS.has(keyExt) || VIDEO_EXTENSIONS.has(keyExt) ? keyExt : ".png"
  const base = `fanvue-approved-${assetId}`.replace(SAFE_FILENAME_CHARS_RE, "-").slice(0, 96)
  return `${base}${ext}`
}

async function bodyToBodyInit(body: unknown): Promise<BodyInit> {
  if (body instanceof Blob) return body
  if (body instanceof ArrayBuffer) return new Blob([body])
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView
    return new Blob([view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer])
  }
  if (body && typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
    return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
  }
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function") {
    const chunks: ArrayBuffer[] = []
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer)
    return new Blob(chunks)
  }
  throw new Error("Unsupported R2 body")
}

function createR2Client() {
  return new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
  })
}

async function defaultGetR2Object(input: { bucket: string; key: string }) {
  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 env not configured")
  }
  const object = await createR2Client().send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }))
  return { bytes: await bodyToBodyInit(object.Body), contentType: object.ContentType ?? null }
}

export async function loadFanvueApprovedMedia(input: FanvueApprovedMediaLoaderInput): Promise<FanvueApprovedMediaLoaderResult> {
  const userId = clean(input.userId)
  const sourceAssetIds = Array.isArray(input.sourceAssetIds) ? input.sourceAssetIds.map(clean).filter((id): id is string => Boolean(id)) : []
  if (!userId || sourceAssetIds.length === 0) return { ok: false, safe_code: "FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED" }
  if (sourceAssetIds.length !== 1) return { ok: false, safe_code: "FANVUE_SERVER_OWNED_MEDIA_SINGLE_ASSET_ONLY" }

  const assetId = sourceAssetIds[0]
  if (!UUID_RE.test(assetId)) return { ok: false, safe_code: "FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_FOUND" }

  const row = await input.loadGeneration({ userId, assetId })
  if (!row || clean(row.id) !== assetId || clean(row.user_id) !== userId) return { ok: false, safe_code: "FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_FOUND" }
  if (clean(row.status)?.toLowerCase() !== "completed" || isPlaceholderOrUnsafe(row)) return { ok: false, safe_code: "FANVUE_SERVER_OWNED_MEDIA_GENERATION_NOT_COMPLETED" }

  const bucket = clean(row.r2_bucket)
  const key = clean(row.r2_key)
  if (!bucket || !key) return { ok: false, safe_code: "FANVUE_SERVER_OWNED_MEDIA_R2_OBJECT_REQUIRED" }

  let object: { bytes: BodyInit; contentType?: string | null }
  try {
    object = await (input.getR2Object ?? defaultGetR2Object)({ bucket, key })
  } catch {
    return { ok: false, safe_code: "FANVUE_SERVER_OWNED_MEDIA_LOAD_FAILED" }
  }

  const mediaType = inferApprovedMediaType(row, clean(object.contentType))
  if (!mediaType) return { ok: false, safe_code: "FANVUE_SERVER_OWNED_MEDIA_UNSUPPORTED_TYPE" }

  return { ok: true, media: { filename: safeFilename(assetId, key), mediaType, bytes: object.bytes } }
}
