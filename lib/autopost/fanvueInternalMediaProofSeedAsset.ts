import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { FANVUE_UPLOAD_DIAGNOSTIC_PNG } from "./fanvueUploadDiagnostic"
import { authorizeFanvueUploadDiagnosticRequest, FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER, type FanvueUploadDiagnosticAuthInput, type FanvueUploadDiagnosticAuthErrorCode } from "./fanvueUploadDiagnosticAuth"

export const FANVUE_INTERNAL_MEDIA_PROOF_SEED_OPERATION = "fanvue_internal_media_proof_seed_asset_r2_supabase_only" as const
export const FANVUE_INTERNAL_MEDIA_PROOF_SEED_CONFIRMATION = "CREATE_ONE_SERVER_OWNED_R2_BACKED_GENERATION_FOR_FANVUE_INTERNAL_MEDIA_PROOF_ONLY" as const
export const FANVUE_INTERNAL_MEDIA_PROOF_SEED_ROUTE = "/api/admin/autopost/fanvue/internal-media-proof-seed" as const
export const FANVUE_INTERNAL_MEDIA_PROOF_SEED_ASSET_PROFILE = "fanvue_internal_media_proof_seed_safe_static_png_v1" as const
export const FANVUE_INTERNAL_MEDIA_PROOF_SEED_FILENAME = "fanvue-internal-media-proof-seed-safe-static-v1.png" as const
export const FANVUE_INTERNAL_MEDIA_PROOF_SEED_CONTENT_TYPE = "image/png" as const
export const FANVUE_INTERNAL_MEDIA_PROOF_SEED_MODE = "fanvue_internal_media_proof_seed" as const
export const FANVUE_INTERNAL_MEDIA_PROOF_SEED_SECRET_HEADER = FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER

export type FanvueInternalMediaProofSeedSafeCode =
  | "OK"
  | "METHOD_NOT_ALLOWED"
  | "INVALID_BODY"
  | "INVALID_OPERATION"
  | "INVALID_CONFIRMATION"
  | "CALLER_SUPPLIED_FORBIDDEN_FIELD"
  | "R2_ENV_NOT_CONFIGURED"
  | "FANVUE_INTERNAL_MEDIA_PROOF_SEED_MULTIPLE_MATCHES"
  | "FANVUE_INTERNAL_MEDIA_PROOF_SEED_R2_OBJECT_REQUIRED"
  | "FANVUE_INTERNAL_MEDIA_PROOF_SEED_UPLOAD_FAILED"
  | "FANVUE_INTERNAL_MEDIA_PROOF_SEED_INSERT_FAILED"
  | FanvueUploadDiagnosticAuthErrorCode

export type FanvueInternalMediaProofSeedResult = {
  ok: boolean
  safe_code: FanvueInternalMediaProofSeedSafeCode
  generation_id_present: boolean
  generation_id: string | null
  r2_object_present: boolean
  r2_uploaded: boolean
  generation_inserted: boolean
  generation_reused: boolean
  fanvue_upload_attempted: false
  fanvue_post_attempted: false
  dispatch_attempted: false
  schedule_attempted: false
  platform_registry_changed: false
  public_ui_added: false
  autopost_run_wired: false
}

export type FanvueInternalMediaProofSeedGenerationRow = {
  id?: string | null
  user_id?: string | null
  status?: string | null
  job_type?: string | null
  mode?: string | null
  metadata?: unknown
  r2_bucket?: string | null
  r2_key?: string | null
}

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => any
    insert: (payload: Record<string, unknown>) => any
  }
}

export type FanvueInternalMediaProofSeedDependencies = {
  supabaseAdmin: SupabaseLike
  r2Bucket?: string | null
  r2PutObject?: (input: { bucket: string; key: string; body: Buffer; contentType: string }) => Promise<void>
  now?: () => Date
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FORBIDDEN_BODY_FIELDS = new Set([
  "file", "bytes", "fileBytes", "file_bytes", "url", "fileUrl", "file_url", "source_asset_urls", "externalUrl", "external_url", "browserPath", "browser_path", "providerUuid", "provider_uuid", "providerId", "provider_id", "uploadId", "upload_id", "mediaUuid", "media_uuid", "mediaUuids", "media_uuids", "fanvueMediaUuid", "fanvue_media_uuid", "fanvueMediaUuids", "fanvue_media_uuids", "price", "publishAt", "publish_at", "schedule", "scheduled", "dispatch", "platformRegistry", "platform_registry", "publicUi", "public_ui", "publicUI", "media", "upload",
])

export function buildFanvueInternalMediaProofSeedR2Key(userId: string) {
  return `fanvue/internal-media-proof-seeds/${userId}/safe-static-v1.png`
}

export function buildFanvueInternalMediaProofSeedMetadata() {
  return {
    engine: "server_seed",
    kind: "image",
    mode: FANVUE_INTERNAL_MEDIA_PROOF_SEED_MODE,
    placeholder: false,
    test: false,
    unsafe: false,
    asset_profile: FANVUE_INTERNAL_MEDIA_PROOF_SEED_ASSET_PROFILE,
    source: "server_bundled_safe_static_png",
    fanvue_upload_attempted: false,
    fanvue_post_attempted: false,
    dispatch_attempted: false,
    schedule_attempted: false,
  }
}

function baseResult(overrides: Partial<FanvueInternalMediaProofSeedResult> = {}): FanvueInternalMediaProofSeedResult {
  return {
    ok: false,
    safe_code: "OK",
    generation_id_present: false,
    generation_id: null,
    r2_object_present: false,
    r2_uploaded: false,
    generation_inserted: false,
    generation_reused: false,
    fanvue_upload_attempted: false,
    fanvue_post_attempted: false,
    dispatch_attempted: false,
    schedule_attempted: false,
    platform_registry_changed: false,
    public_ui_added: false,
    autopost_run_wired: false,
    ...overrides,
  }
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isMatchingSeed(row: FanvueInternalMediaProofSeedGenerationRow, userId: string, r2Key: string) {
  const metadata = asRecord(row.metadata)
  return row.user_id === userId && row.status === "completed" && (metadata?.asset_profile === FANVUE_INTERNAL_MEDIA_PROOF_SEED_ASSET_PROFILE || row.r2_key === r2Key)
}

function hasR2(row: FanvueInternalMediaProofSeedGenerationRow) {
  return Boolean(clean(row.r2_bucket) && clean(row.r2_key))
}

async function defaultR2PutObject(input: { bucket: string; key: string; body: Buffer; contentType: string }) {
  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) throw new Error("R2 env not configured")
  const client = new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "" },
  })
  await client.send(new PutObjectCommand({ Bucket: input.bucket, Key: input.key, Body: input.body, ContentType: input.contentType }))
}

async function findExistingSeedRows(dependencies: FanvueInternalMediaProofSeedDependencies, userId: string, r2Key: string): Promise<FanvueInternalMediaProofSeedGenerationRow[]> {
  const query = dependencies.supabaseAdmin
    .from("generations")
    .select("id,user_id,status,job_type,mode,metadata,r2_bucket,r2_key")
    .eq("user_id", userId)
    .eq("status", "completed")
    .or(`metadata->>asset_profile.eq.${FANVUE_INTERNAL_MEDIA_PROOF_SEED_ASSET_PROFILE},r2_key.eq.${r2Key}`)
  const { data, error } = await query
  if (error) throw error
  return (Array.isArray(data) ? data : []).filter((row) => isMatchingSeed(row, userId, r2Key))
}

export async function createOrReuseFanvueInternalMediaProofSeedAsset(input: { userId: string }, dependencies: FanvueInternalMediaProofSeedDependencies): Promise<FanvueInternalMediaProofSeedResult> {
  const userId = clean(input.userId)
  if (!userId || !UUID_RE.test(userId)) return baseResult({ safe_code: "UNAUTHENTICATED" })

  const bucket = clean(dependencies.r2Bucket ?? process.env.R2_BUCKET)
  if (!bucket) return baseResult({ safe_code: "R2_ENV_NOT_CONFIGURED" })

  const r2Key = buildFanvueInternalMediaProofSeedR2Key(userId)
  let existingRows: FanvueInternalMediaProofSeedGenerationRow[]
  try {
    existingRows = await findExistingSeedRows(dependencies, userId, r2Key)
  } catch {
    return baseResult({ safe_code: "FANVUE_INTERNAL_MEDIA_PROOF_SEED_INSERT_FAILED" })
  }

  if (existingRows.length > 1) return baseResult({ safe_code: "FANVUE_INTERNAL_MEDIA_PROOF_SEED_MULTIPLE_MATCHES" })
  if (existingRows.length === 1) {
    const row = existingRows[0]
    if (!hasR2(row)) return baseResult({ safe_code: "FANVUE_INTERNAL_MEDIA_PROOF_SEED_R2_OBJECT_REQUIRED", generation_id_present: Boolean(clean(row.id)), generation_id: clean(row.id) })
    return baseResult({ ok: true, safe_code: "OK", generation_id_present: true, generation_id: clean(row.id), r2_object_present: true, generation_reused: true })
  }

  try {
    await (dependencies.r2PutObject ?? defaultR2PutObject)({ bucket, key: r2Key, body: FANVUE_UPLOAD_DIAGNOSTIC_PNG, contentType: FANVUE_INTERNAL_MEDIA_PROOF_SEED_CONTENT_TYPE })
  } catch {
    return baseResult({ safe_code: "FANVUE_INTERNAL_MEDIA_PROOF_SEED_UPLOAD_FAILED" })
  }

  const now = (dependencies.now ?? (() => new Date()))().toISOString()
  const payload = {
    user_id: userId,
    prompt: "Fanvue internal media proof seed: harmless static PNG",
    image_url: null,
    job_type: "image",
    body_type: "none",
    mode: FANVUE_INTERNAL_MEDIA_PROOF_SEED_MODE,
    status: "completed",
    completed_at: now,
    metadata: buildFanvueInternalMediaProofSeedMetadata(),
    r2_bucket: bucket,
    r2_key: r2Key,
    updated_at: now,
  }

  try {
    const { data, error } = await dependencies.supabaseAdmin.from("generations").insert(payload).select("id").single()
    if (error) throw error
    return baseResult({ ok: true, safe_code: "OK", generation_id_present: Boolean(clean(data?.id)), generation_id: clean(data?.id), r2_object_present: true, r2_uploaded: true, generation_inserted: true })
  } catch {
    return baseResult({ safe_code: "FANVUE_INTERNAL_MEDIA_PROOF_SEED_INSERT_FAILED", r2_object_present: true, r2_uploaded: true })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validateBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, safe_code: "INVALID_BODY" as const }
  for (const key of Object.keys(body)) if (FORBIDDEN_BODY_FIELDS.has(key)) return { ok: false as const, safe_code: "CALLER_SUPPLIED_FORBIDDEN_FIELD" as const }
  if (body.operation !== FANVUE_INTERNAL_MEDIA_PROOF_SEED_OPERATION) return { ok: false as const, safe_code: "INVALID_OPERATION" as const }
  if (body.confirm !== FANVUE_INTERNAL_MEDIA_PROOF_SEED_CONFIRMATION) return { ok: false as const, safe_code: "INVALID_CONFIRMATION" as const }
  return { ok: true as const }
}

export type FanvueInternalMediaProofSeedRouteDependencies = {
  request: Request
  expectedSecret: FanvueUploadDiagnosticAuthInput["expectedSecret"]
  adminUserIds: FanvueUploadDiagnosticAuthInput["adminUserIds"]
  getAuthenticatedUserId: FanvueUploadDiagnosticAuthInput["getAuthenticatedUserId"]
  createSeedAsset: (input: { userId: string }) => Promise<FanvueInternalMediaProofSeedResult>
}

export async function handleFanvueInternalMediaProofSeedRoute(dependencies: FanvueInternalMediaProofSeedRouteDependencies): Promise<{ status: number; body: FanvueInternalMediaProofSeedResult }> {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: baseResult({ safe_code: "METHOD_NOT_ALLOWED" }) }
  const auth = await authorizeFanvueUploadDiagnosticRequest({ request: dependencies.request, expectedSecret: dependencies.expectedSecret, adminUserIds: dependencies.adminUserIds, getAuthenticatedUserId: dependencies.getAuthenticatedUserId })
  if (auth.ok === false) return { status: auth.status, body: baseResult({ safe_code: auth.error_code }) }
  const validation = validateBody(await dependencies.request.json().catch(() => null))
  if (!validation.ok) return { status: 400, body: baseResult({ safe_code: validation.safe_code }) }
  const result = await dependencies.createSeedAsset({ userId: auth.adminUserId })
  return { status: result.ok ? 200 : 200, body: result }
}
