import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { authorizeFanvueUploadDiagnosticRequest, FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER, type FanvueUploadDiagnosticAuthInput, type FanvueUploadDiagnosticAuthErrorCode } from "./fanvueUploadDiagnosticAuth"

export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_OPERATION = "fanvue_internal_video_proof_seed_asset_r2_supabase_only" as const
export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_CONFIRMATION = "CREATE_ONE_SERVER_OWNED_R2_BACKED_VIDEO_GENERATION_FOR_FANVUE_INTERNAL_VIDEO_PROOF_ONLY" as const
export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_ROUTE = "/api/admin/autopost/fanvue/internal-video-proof-seed" as const
export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_ASSET_PROFILE = "fanvue_internal_video_proof_seed_safe_tiny_mp4_v1" as const
export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_FILENAME = "fanvue-internal-video-proof-seed-safe-tiny-v1.mp4" as const
export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_CONTENT_TYPE = "video/mp4" as const
export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_MODE = "fanvue_internal_video_proof_seed" as const
export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_SECRET_HEADER = FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER
export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_CAPTION = "Fanvue internal controlled video proof: safe tiny non-human test video." as const

// Deterministic tiny MP4 container fixture used only as a harmless server-owned proof asset.
export const FANVUE_INTERNAL_VIDEO_PROOF_SEED_MP4 = Buffer.from(
  "AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthABAAADAAABhqBtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAJWdHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAABAAAAAAQAAAAAAJG1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAH0AAAAABVxAAAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAbdtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAF7c3RibAAAAL9zdHNkAAAAAAAAAAEAAACvYXZjMQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAQABABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAM2F2Y0MBZAAK/+EAGmdkAAqzZQFAFuhAAAADAAEAAAMAPB4kSAAAFWgM4gAAABhzdHRzAAAAAAAAAAEAAAABAAAH0AAAABRzdHNzAAAAAAAAAAEAAAABAAAAHGN0dHMAAAAAAAAAAQAAAAEAAAACAAAAFHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAGHN0c3oAAAAAAAAADQAAAAEAAAABAAAAGHN0Y28AAAAAAAAAAQAAAChtZGF0AAAAGHVkdGEAAAAQbWV0YQAAAAAAAAAA",
  "base64",
)

export type FanvueInternalVideoProofSeedSafeCode =
  | "OK"
  | "METHOD_NOT_ALLOWED"
  | "INVALID_BODY"
  | "INVALID_OPERATION"
  | "INVALID_CONFIRMATION"
  | "CALLER_SUPPLIED_FORBIDDEN_FIELD"
  | "R2_ENV_NOT_CONFIGURED"
  | "FANVUE_INTERNAL_VIDEO_PROOF_SEED_MULTIPLE_GENERATIONS"
  | "FANVUE_INTERNAL_VIDEO_PROOF_SEED_R2_OBJECT_REQUIRED"
  | "FANVUE_INTERNAL_VIDEO_PROOF_SEED_UPLOAD_FAILED"
  | "FANVUE_INTERNAL_VIDEO_PROOF_SEED_INSERT_FAILED"
  | FanvueUploadDiagnosticAuthErrorCode

export type FanvueInternalVideoProofSeedResult = {
  ok: boolean
  safe_code: FanvueInternalVideoProofSeedSafeCode
  generation_id_present: boolean
  generation_id: string | null
  rule_id_present: boolean
  rule_id: string | null
  autopost_job_id_present: boolean
  autopost_job_id: string | null
  r2_object_present: boolean
  r2_uploaded: boolean
  generation_inserted: boolean
  generation_reused: boolean
  rule_inserted: boolean
  rule_reused: boolean
  job_inserted: boolean
  job_reused: boolean
  fanvue_upload_attempted: false
  fanvue_post_attempted: false
  dispatch_attempted: false
  schedule_attempted: false
  platform_registry_changed: false
  public_ui_added: false
  autopost_run_wired: false
}

export type FanvueInternalVideoProofSeedGenerationRow = { id?: string | null; user_id?: string | null; status?: string | null; job_type?: string | null; mode?: string | null; metadata?: unknown; r2_bucket?: string | null; r2_key?: string | null }
export type FanvueInternalVideoProofSeedRuleRow = { id?: string | null; user_id?: string | null; approval_state?: string | null; enabled?: boolean | null; content_payload?: unknown; paused_at?: string | null; revoked_at?: string | null }
export type FanvueInternalVideoProofSeedJobRow = { id?: string | null; user_id?: string | null; rule_id?: string | null; platform?: string | null; state?: string | null; payload?: unknown; result?: unknown; error?: unknown }

type SupabaseLike = { from: (table: string) => { select: (columns: string) => any; insert: (payload: Record<string, unknown>) => any } }

export type FanvueInternalVideoProofSeedDependencies = { supabaseAdmin: SupabaseLike; r2Bucket?: string | null; r2PutObject?: (input: { bucket: string; key: string; body: Buffer; contentType: string }) => Promise<void>; now?: () => Date }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FORBIDDEN_BODY_FIELDS = new Set(["file", "bytes", "fileBytes", "file_bytes", "url", "fileUrl", "file_url", "source_asset_urls", "externalUrl", "external_url", "browserPath", "browser_path", "providerUuid", "provider_uuid", "providerId", "provider_id", "uploadId", "upload_id", "mediaUuid", "media_uuid", "mediaUuids", "media_uuids", "fanvueMediaUuid", "fanvue_media_uuid", "fanvueMediaUuids", "fanvue_media_uuids", "price", "amount", "currency", "paywall", "publishAt", "publish_at", "schedule", "scheduled", "dispatch", "platformRegistry", "platform_registry", "publicUi", "public_ui", "publicUI", "media", "upload", "providerPayload", "provider_payload"])

export function buildFanvueInternalVideoProofSeedR2Key(userId: string) { return `fanvue/internal-video-proof-seeds/${userId}/safe-tiny-v1.mp4` }
export function buildFanvueInternalVideoProofSeedMetadata() { return { engine: "server_seed", kind: "video", mode: FANVUE_INTERNAL_VIDEO_PROOF_SEED_MODE, placeholder: false, test: false, unsafe: false, asset_profile: FANVUE_INTERNAL_VIDEO_PROOF_SEED_ASSET_PROFILE, source: "server_bundled_safe_tiny_video_mp4", fanvue_upload_attempted: false, fanvue_post_attempted: false, dispatch_attempted: false, schedule_attempted: false } }
export function buildFanvueInternalVideoProofSeedContentPayload(generationId: string) { return { platform: "fanvue", content_type: "media_video", text: FANVUE_INTERNAL_VIDEO_PROOF_SEED_CAPTION, source_asset_ids: [generationId] } }

function baseResult(overrides: Partial<FanvueInternalVideoProofSeedResult> = {}): FanvueInternalVideoProofSeedResult { return { ok: false, safe_code: "OK", generation_id_present: false, generation_id: null, rule_id_present: false, rule_id: null, autopost_job_id_present: false, autopost_job_id: null, r2_object_present: false, r2_uploaded: false, generation_inserted: false, generation_reused: false, rule_inserted: false, rule_reused: false, job_inserted: false, job_reused: false, fanvue_upload_attempted: false, fanvue_post_attempted: false, dispatch_attempted: false, schedule_attempted: false, platform_registry_changed: false, public_ui_added: false, autopost_run_wired: false, ...overrides } }
function clean(value: unknown) { return typeof value === "string" && value.trim().length > 0 ? value.trim() : null }
function asRecord(value: unknown): Record<string, unknown> | null { return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null }
function isMatchingGeneration(row: FanvueInternalVideoProofSeedGenerationRow, userId: string, r2Key: string) { const metadata = asRecord(row.metadata); return row.user_id === userId && row.status === "completed" && (metadata?.asset_profile === FANVUE_INTERNAL_VIDEO_PROOF_SEED_ASSET_PROFILE || row.r2_key === r2Key) }
function hasR2(row: FanvueInternalVideoProofSeedGenerationRow) { return Boolean(clean(row.r2_bucket) && clean(row.r2_key)) }
function contentMatches(row: FanvueInternalVideoProofSeedRuleRow, generationId: string) { const payload = asRecord(row.content_payload); const ids = Array.isArray(payload?.source_asset_ids) ? payload.source_asset_ids : []; return row.approval_state === "APPROVED" && row.enabled === true && !row.paused_at && !row.revoked_at && payload?.platform === "fanvue" && payload?.content_type === "media_video" && ids.length === 1 && ids[0] === generationId }
function jobMatches(row: FanvueInternalVideoProofSeedJobRow, userId: string, ruleId: string) { return row.user_id === userId && row.rule_id === ruleId && row.platform === "fanvue" && row.state === "QUEUED" && !row.result && !row.error }

async function defaultR2PutObject(input: { bucket: string; key: string; body: Buffer; contentType: string }) { if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) throw new Error("R2 env not configured"); const client = new S3Client({ region: process.env.R2_REGION || "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "" } }); await client.send(new PutObjectCommand({ Bucket: input.bucket, Key: input.key, Body: input.body, ContentType: input.contentType })) }
async function findExistingGenerations(dependencies: FanvueInternalVideoProofSeedDependencies, userId: string, r2Key: string) { const query = dependencies.supabaseAdmin.from("generations").select("id,user_id,status,job_type,mode,metadata,r2_bucket,r2_key").eq("user_id", userId).eq("status", "completed").or(`metadata->>asset_profile.eq.${FANVUE_INTERNAL_VIDEO_PROOF_SEED_ASSET_PROFILE},r2_key.eq.${r2Key}`); const { data, error } = await query; if (error) throw error; return (Array.isArray(data) ? data : []).filter((row) => isMatchingGeneration(row, userId, r2Key)) }
async function findExistingRules(dependencies: FanvueInternalVideoProofSeedDependencies, userId: string, generationId: string) { const query = dependencies.supabaseAdmin.from("autopost_rules").select("id,user_id,approval_state,enabled,content_payload,paused_at,revoked_at").eq("user_id", userId).eq("approval_state", "APPROVED"); const { data, error } = await query; if (error) throw error; return (Array.isArray(data) ? data : []).filter((row) => contentMatches(row, generationId)) }
async function findExistingJobs(dependencies: FanvueInternalVideoProofSeedDependencies, userId: string, ruleId: string) { const query = dependencies.supabaseAdmin.from("autopost_jobs").select("id,user_id,rule_id,platform,state,payload,result,error").eq("user_id", userId).eq("rule_id", ruleId).eq("platform", "fanvue").eq("state", "QUEUED"); const { data, error } = await query; if (error) throw error; return (Array.isArray(data) ? data : []).filter((row) => jobMatches(row, userId, ruleId)) }

export async function createOrReuseFanvueInternalVideoProofSeedAsset(input: { userId: string }, dependencies: FanvueInternalVideoProofSeedDependencies): Promise<FanvueInternalVideoProofSeedResult> {
  const userId = clean(input.userId)
  if (!userId || !UUID_RE.test(userId)) return baseResult({ safe_code: "UNAUTHENTICATED" })
  const bucket = clean(dependencies.r2Bucket ?? process.env.R2_BUCKET)
  if (!bucket) return baseResult({ safe_code: "R2_ENV_NOT_CONFIGURED" })
  const now = (dependencies.now ?? (() => new Date()))().toISOString()
  const r2Key = buildFanvueInternalVideoProofSeedR2Key(userId)
  let generation: FanvueInternalVideoProofSeedGenerationRow | null = null
  let generationInserted = false
  let r2Uploaded = false
  try {
    const existing = await findExistingGenerations(dependencies, userId, r2Key)
    if (existing.length > 1) return baseResult({ safe_code: "FANVUE_INTERNAL_VIDEO_PROOF_SEED_MULTIPLE_GENERATIONS" })
    if (existing.length === 1) {
      if (!hasR2(existing[0])) return baseResult({ safe_code: "FANVUE_INTERNAL_VIDEO_PROOF_SEED_R2_OBJECT_REQUIRED", generation_id_present: Boolean(clean(existing[0].id)), generation_id: clean(existing[0].id) })
      generation = existing[0]
    }
  } catch { return baseResult({ safe_code: "FANVUE_INTERNAL_VIDEO_PROOF_SEED_INSERT_FAILED" }) }
  if (!generation) {
    try { await (dependencies.r2PutObject ?? defaultR2PutObject)({ bucket, key: r2Key, body: FANVUE_INTERNAL_VIDEO_PROOF_SEED_MP4, contentType: FANVUE_INTERNAL_VIDEO_PROOF_SEED_CONTENT_TYPE }); r2Uploaded = true } catch { return baseResult({ safe_code: "FANVUE_INTERNAL_VIDEO_PROOF_SEED_UPLOAD_FAILED" }) }
    const payload = { user_id: userId, prompt: "Fanvue internal video proof seed: harmless tiny MP4", image_url: null, job_type: "video", body_type: "none", mode: FANVUE_INTERNAL_VIDEO_PROOF_SEED_MODE, status: "completed", completed_at: now, metadata: buildFanvueInternalVideoProofSeedMetadata(), r2_bucket: bucket, r2_key: r2Key, updated_at: now }
    try { const { data, error } = await dependencies.supabaseAdmin.from("generations").insert(payload).select("id").single(); if (error) throw error; generation = { id: clean(data?.id), user_id: userId, status: "completed", job_type: "video", mode: FANVUE_INTERNAL_VIDEO_PROOF_SEED_MODE, metadata: payload.metadata, r2_bucket: bucket, r2_key: r2Key }; generationInserted = true } catch { return baseResult({ safe_code: "FANVUE_INTERNAL_VIDEO_PROOF_SEED_INSERT_FAILED", r2_object_present: true, r2_uploaded: r2Uploaded }) }
  }
  const generationId = clean(generation.id)
  if (!generationId) return baseResult({ safe_code: "FANVUE_INTERNAL_VIDEO_PROOF_SEED_INSERT_FAILED", r2_object_present: true, r2_uploaded: r2Uploaded })
  let rule: FanvueInternalVideoProofSeedRuleRow | null = null
  let ruleInserted = false
  try {
    const existingRules = await findExistingRules(dependencies, userId, generationId)
    if (existingRules.length > 0) rule = existingRules[0]
    else { const { data, error } = await dependencies.supabaseAdmin.from("autopost_rules").insert({ user_id: userId, selected_platforms: ["fanvue"], approval_state: "APPROVED", enabled: true, content_payload: buildFanvueInternalVideoProofSeedContentPayload(generationId), created_at: now, updated_at: now }).select("id").single(); if (error) throw error; rule = { id: clean(data?.id), user_id: userId, approval_state: "APPROVED", enabled: true, content_payload: buildFanvueInternalVideoProofSeedContentPayload(generationId), paused_at: null, revoked_at: null }; ruleInserted = true }
  } catch { return baseResult({ safe_code: "FANVUE_INTERNAL_VIDEO_PROOF_SEED_INSERT_FAILED", generation_id_present: true, generation_id: generationId, r2_object_present: true, r2_uploaded: r2Uploaded, generation_inserted: generationInserted, generation_reused: !generationInserted }) }
  const ruleId = clean(rule?.id)
  if (!ruleId) return baseResult({ safe_code: "FANVUE_INTERNAL_VIDEO_PROOF_SEED_INSERT_FAILED", generation_id_present: true, generation_id: generationId, r2_object_present: true, r2_uploaded: r2Uploaded, generation_inserted: generationInserted, generation_reused: !generationInserted })
  let job: FanvueInternalVideoProofSeedJobRow | null = null
  let jobInserted = false
  try {
    const existingJobs = await findExistingJobs(dependencies, userId, ruleId)
    if (existingJobs.length > 0) job = existingJobs[0]
    else { const { data, error } = await dependencies.supabaseAdmin.from("autopost_jobs").insert({ user_id: userId, rule_id: ruleId, platform: "fanvue", state: "QUEUED", payload: { source: "fanvue_internal_video_proof_seed", content_payload: buildFanvueInternalVideoProofSeedContentPayload(generationId) }, result: null, error: null, scheduled_for: now, created_at: now, updated_at: now }).select("id").single(); if (error) throw error; job = { id: clean(data?.id), user_id: userId, rule_id: ruleId, platform: "fanvue", state: "QUEUED", result: null, error: null }; jobInserted = true }
  } catch { return baseResult({ safe_code: "FANVUE_INTERNAL_VIDEO_PROOF_SEED_INSERT_FAILED", generation_id_present: true, generation_id: generationId, rule_id_present: true, rule_id: ruleId, r2_object_present: true, r2_uploaded: r2Uploaded, generation_inserted: generationInserted, generation_reused: !generationInserted, rule_inserted: ruleInserted, rule_reused: !ruleInserted }) }
  const jobId = clean(job?.id)
  return baseResult({ ok: Boolean(jobId), safe_code: jobId ? "OK" : "FANVUE_INTERNAL_VIDEO_PROOF_SEED_INSERT_FAILED", generation_id_present: true, generation_id: generationId, rule_id_present: true, rule_id: ruleId, autopost_job_id_present: Boolean(jobId), autopost_job_id: jobId, r2_object_present: true, r2_uploaded: r2Uploaded, generation_inserted: generationInserted, generation_reused: !generationInserted, rule_inserted: ruleInserted, rule_reused: !ruleInserted, job_inserted: jobInserted, job_reused: !jobInserted })
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
function validateBody(body: unknown) { if (!isRecord(body)) return { ok: false as const, safe_code: "INVALID_BODY" as const }; for (const key of Object.keys(body)) if (FORBIDDEN_BODY_FIELDS.has(key)) return { ok: false as const, safe_code: "CALLER_SUPPLIED_FORBIDDEN_FIELD" as const }; if (body.operation !== FANVUE_INTERNAL_VIDEO_PROOF_SEED_OPERATION) return { ok: false as const, safe_code: "INVALID_OPERATION" as const }; if (body.confirm !== FANVUE_INTERNAL_VIDEO_PROOF_SEED_CONFIRMATION) return { ok: false as const, safe_code: "INVALID_CONFIRMATION" as const }; return { ok: true as const } }

export type FanvueInternalVideoProofSeedRouteDependencies = { request: Request; expectedSecret: FanvueUploadDiagnosticAuthInput["expectedSecret"]; adminUserIds: FanvueUploadDiagnosticAuthInput["adminUserIds"]; getAuthenticatedUserId: FanvueUploadDiagnosticAuthInput["getAuthenticatedUserId"]; createSeedAsset: (input: { userId: string }) => Promise<FanvueInternalVideoProofSeedResult> }
export async function handleFanvueInternalVideoProofSeedRoute(dependencies: FanvueInternalVideoProofSeedRouteDependencies): Promise<{ status: number; body: FanvueInternalVideoProofSeedResult }> { if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: baseResult({ safe_code: "METHOD_NOT_ALLOWED" }) }; const auth = await authorizeFanvueUploadDiagnosticRequest({ request: dependencies.request, expectedSecret: dependencies.expectedSecret, adminUserIds: dependencies.adminUserIds, getAuthenticatedUserId: dependencies.getAuthenticatedUserId }); if (auth.ok === false) return { status: auth.status, body: baseResult({ safe_code: auth.error_code }) }; const validation = validateBody(await dependencies.request.json().catch(() => null)); if (!validation.ok) return { status: 400, body: baseResult({ safe_code: validation.safe_code }) }; const result = await dependencies.createSeedAsset({ userId: auth.adminUserId }); return { status: 200, body: result } }
