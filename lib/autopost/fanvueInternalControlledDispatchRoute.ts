import { authorizeFanvueUploadDiagnosticRequest, FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER, type FanvueUploadDiagnosticAuthInput, type FanvueUploadDiagnosticAuthErrorCode } from "./fanvueUploadDiagnosticAuth"
import type { FanvueApprovedMediaLoaderResult } from "./fanvueApprovedMediaLoader"
import {
  postFanvueInternalSinglePost,
  redactFanvueInternalPostResult,
  type FanvueInternalApprovedContent,
  type FanvueInternalPostInput,
} from "./fanvueInternalAdapter"

export const FANVUE_INTERNAL_CONTROLLED_DISPATCH_OPERATION = "fanvue_internal_controlled_dispatch_dry_run" as const
export const FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_OPERATION = "fanvue_internal_controlled_video_dispatch_dry_run" as const
export const FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_CONFIRMATION = "REQUEST_FANVUE_CONTROLLED_VIDEO_DRY_RUN_ONE_APPROVED_JOB_ONE_SERVER_OWNED_VIDEO_NO_UPLOAD_NO_POST_NO_PRICE_NO_SCHEDULE_NO_RETRY_NO_PUBLIC_EXPOSURE" as const
export const FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_LIVE_OPERATION = "fanvue_internal_controlled_video_dispatch_live_single_post_no_price_no_schedule_no_retry" as const
export const FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_LIVE_CONFIRMATION = "REQUEST_FANVUE_CONTROLLED_VIDEO_LIVE_DISPATCH_ONE_APPROVED_JOB_ONE_SERVER_OWNED_VIDEO_UPLOAD_AND_POST" as const
export const FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_OPERATION = "fanvue_internal_controlled_dispatch_live_single_post_no_price_no_schedule_no_retry" as const
export const FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_CONFIRMATION = "REQUEST_FANVUE_CONTROLLED_LIVE_DISPATCH_ONE_APPROVED_JOB_ONE_SERVER_OWNED_IMAGE_NO_PRICE_NO_SCHEDULE_NO_RETRY_NO_PUBLIC_EXPOSURE" as const
export const FANVUE_INTERNAL_CONTROLLED_DISPATCH_SECRET_HEADER = FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER
export const FANVUE_ADMIN_CONTROLLED_DISPATCH_ENV = "FANVUE_ADMIN_CONTROLLED_DISPATCH_ENABLED" as const
export const FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_ENV = "FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_ENABLED" as const

export type FanvueControlledDispatchJob = {
  id: string
  user_id: string
  rule_id: string | null
  platform?: string | null
  payload?: unknown
  state?: string | null
  result?: unknown
  error?: unknown
}

export type FanvueControlledDispatchRule = {
  id: string
  user_id: string
  approval_state: string | null
  enabled: boolean | null
  selected_platforms?: unknown
  content_payload?: unknown
  paused_at?: string | null
  revoked_at?: string | null
}

export type FanvueControlledDispatchAccount = {
  user_id?: string | null
  platform?: string | null
  connection_status?: string | null
  encrypted_access_token?: string | null
  encrypted_refresh_token?: string | null
  token_expires_at?: string | null
  token_type?: string | null
  token_key_version?: number | null
  scopes?: string[] | string | null
}

export type FanvueControlledDispatchBody = ReturnType<typeof baseResult> & { error_code?: string }

export type FanvueInternalControlledDispatchRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  env?: Record<string, string | undefined>
  getAuthenticatedUserId: FanvueUploadDiagnosticAuthInput["getAuthenticatedUserId"]
  loadJob: (jobId: string) => Promise<FanvueControlledDispatchJob | null>
  loadRule: (ruleId: string, userId: string) => Promise<FanvueControlledDispatchRule | null>
  loadAccount: (userId: string) => Promise<FanvueControlledDispatchAccount | null>
  loadApprovedMedia?: (input: { userId: string; sourceAssetIds: string[] }) => Promise<FanvueApprovedMediaLoaderResult>
  persistProof?: (input: { autopostJobId: string; providerPostUuid: string; result: Record<string, unknown>; now: Date }) => Promise<{ ok: boolean; job_proof_persisted: boolean; audit_log_persisted: boolean }>
  adapter?: typeof postFanvueInternalSinglePost
  adapterDependencies?: Pick<FanvueInternalPostInput, "apiBaseUrl" | "apiVersion" | "fanvueFetch" | "fetchIdentity" | "signedPartUploader" | "decryptAccessToken" | "refreshAccessToken" | "waitForMediaReady" | "now">
  getAdapterDependencies?: () => Pick<FanvueInternalPostInput, "apiBaseUrl" | "apiVersion" | "fanvueFetch" | "fetchIdentity" | "signedPartUploader" | "decryptAccessToken" | "refreshAccessToken" | "waitForMediaReady" | "now">
  now?: () => Date
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TEXT_MAX = 5000
const ALLOWED_BODY_FIELDS = new Set(["operation", "autopost_job_id", "dry_run", "confirm"])
const FORBIDDEN_FIELDS = new Set([
  "text", "caption", "media", "file", "bytes", "fileBytes", "file_bytes", "file_url", "fileUrl", "url", "source_asset_urls", "sourceAssetUrls", "providerId", "provider_id", "providerPostId", "provider_post_id", "providerPostUuid", "provider_post_uuid", "providerAccountId", "provider_account_id", "mediaUuid", "mediaUuids", "media_uuid", "media_uuids", "fanvueMediaUuid", "fanvue_media_uuid", "uploadId", "upload_id", "postId", "post_id", "postUuid", "post_uuid", "creatorUserUuid", "creator_user_uuid", "audience", "price", "amount", "currency", "paywall", "publishAt", "publish_at", "schedule", "scheduled", "dispatch", "platformRegistry", "platform_registry", "publicUi", "public_ui", "publicUI", "dryRun", "providerPayload", "provider_payload",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

function scopeList(value: unknown) {
  if (Array.isArray(value)) return value.filter((scope): scope is string => typeof scope === "string")
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean)
  return []
}

function resultIndicatesPosted(result: unknown) {
  if (!isRecord(result)) return false
  return result.result_status === "POSTED" || result.status === "POSTED" || result.state === "SUCCEEDED" || result.posted === true || result.provider_post_uuid_present === true || result.providerPostUuidPresent === true
}

function baseResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: false,
    safe_code: "FANVUE_CONTROLLED_DISPATCH_DRY_RUN_BLOCKED",
    dry_run: true,
    would_dispatch: false,
    autopost_job_id_present: false,
    platform: "fanvue",
    job_state: null,
    rule_approved: false,
    rule_enabled: false,
    rule_not_paused: false,
    rule_not_revoked: false,
    content_reference_present: false,
    content_type: null,
    text_present: false,
    media_asset_present: false,
    media_source_asset_count: 0,
    server_owned_media_validated: false,
    media_type: null,
    account_connected: false,
    required_scopes_present: false,
    fanvue_upload_attempted: false,
    fanvue_post_attempted: false,
    supabase_mutated: false,
    r2_mutated: false,
    schedule_advanced: false,
    dispatch_attempted: false,
    platform_registry_changed: false,
    public_ui_added: false,
    autopost_run_wired: false,
    provider_post_uuid_present: false,
    proof_persisted: false,
    audit_log_persisted: false,
    live_attempted: false,
    token_refresh_attempted: false,
    token_refresh_status_class: "not_attempted",
    upload_attempted: false,
    readiness_checked: false,
    readiness_ready: false,
    create_attempted: false,
    create_status_class: "not_attempted",
    price_used: false,
    publishAt_used: false,
    schedule_attempted: false,
    ...overrides,
  }
}

function parseBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, status: 400, error_code: "INVALID_BODY" }
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_FIELDS.has(key)) return { ok: false as const, status: 400, error_code: "CALLER_SUPPLIED_FORBIDDEN_FIELD" }
    if (!ALLOWED_BODY_FIELDS.has(key)) return { ok: false as const, status: 400, error_code: "CALLER_SUPPLIED_UNKNOWN_FIELD" }
  }
  const videoDryRun = body.operation === FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_OPERATION
  const videoLive = body.operation === FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_LIVE_OPERATION
  const live = body.dry_run === false || (videoLive && body.dry_run === undefined)
  if (videoDryRun) {
    if (body.dry_run !== undefined && body.dry_run !== true) return { ok: false as const, status: 400, error_code: "INVALID_DRY_RUN" }
    if (body.confirm !== FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_CONFIRMATION) return { ok: false as const, status: 400, error_code: "INVALID_CONFIRMATION" }
  } else
  if (live) {
    if (videoLive) {
      if (body.confirm !== FANVUE_INTERNAL_CONTROLLED_VIDEO_DISPATCH_LIVE_CONFIRMATION) return { ok: false as const, status: 400, error_code: "INVALID_CONFIRMATION" }
    } else {
      if (body.operation !== FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_OPERATION) return { ok: false as const, status: 400, error_code: "INVALID_OPERATION" }
      if (body.confirm !== FANVUE_INTERNAL_CONTROLLED_DISPATCH_LIVE_CONFIRMATION) return { ok: false as const, status: 400, error_code: "INVALID_CONFIRMATION" }
    }
  } else {
    if (body.operation !== FANVUE_INTERNAL_CONTROLLED_DISPATCH_OPERATION) return { ok: false as const, status: 400, error_code: "INVALID_OPERATION" }
    if (body.dry_run !== undefined && body.dry_run !== true) return { ok: false as const, status: 400, error_code: "INVALID_DRY_RUN" }
  }
  const autopostJobId = clean(body.autopost_job_id)
  if (!autopostJobId) return { ok: false as const, status: 400, error_code: "AUTOPOST_JOB_ID_REQUIRED" }
  if (!UUID_RE.test(autopostJobId)) return { ok: false as const, status: 400, error_code: "AUTOPOST_JOB_ID_INVALID" }
  return { ok: true as const, autopostJobId, dryRun: !live, videoDryRun, videoLive }
}

function contentFromJobOrRule(job: FanvueControlledDispatchJob, rule: FanvueControlledDispatchRule) {
  if (isRecord(job.payload) && isRecord(job.payload.content_payload)) return job.payload.content_payload
  return rule.content_payload
}

async function validateContent(payload: unknown, input: { userId: string; loadApprovedMedia?: FanvueInternalControlledDispatchRouteDependencies["loadApprovedMedia"]; allowVideo?: boolean }) {
  if (!isRecord(payload)) return { ok: false as const, safe_code: "CONTENT_PAYLOAD_INVALID" }
  if (payload.platform !== "fanvue") return { ok: false as const, safe_code: "CONTENT_PLATFORM_MISMATCH" }
  const rawType = clean(payload.content_type)
  const assetIds = stringArray(payload.source_asset_ids)
  const assetUrls = stringArray(payload.source_asset_urls)
  if (assetUrls.length > 0 && assetIds.length === 0) return { ok: false as const, safe_code: "FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED", content_type: rawType, media_source_asset_count: 0 }
  if (assetUrls.length > 0) return { ok: false as const, safe_code: "FANVUE_SOURCE_ASSET_URLS_NOT_EXECUTABLE", content_type: rawType, media_source_asset_count: assetIds.length }
  const contentType = rawType === "text" ? "text" : rawType === "media" || rawType === "text_media" || rawType === "video" || rawType === "media_video" || assetIds.length > 0 ? "media" : null
  if (!contentType) return { ok: false as const, safe_code: "CONTENT_TYPE_UNSUPPORTED" }
  const text = clean(payload.text)
  if (contentType === "text") {
    if (!text) return { ok: false as const, safe_code: "FANVUE_INTERNAL_TEXT_REQUIRED", content_type: contentType, media_source_asset_count: 0 }
    if (Array.from(text).length > TEXT_MAX) return { ok: false as const, safe_code: "FANVUE_INTERNAL_TEXT_TOO_LONG", content_type: contentType, text_present: true, media_source_asset_count: 0 }
    return { ok: true as const, content_type: contentType, text_present: true, media_asset_present: false, media_source_asset_count: 0, server_owned_media_validated: false, approvedContent: { platform: "fanvue", content_type: "text", text } satisfies FanvueInternalApprovedContent }
  }
  if (assetIds.length === 0) return { ok: false as const, safe_code: "FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED", content_type: contentType, text_present: Boolean(text), media_source_asset_count: 0 }
  if (assetIds.length !== 1) return { ok: false as const, safe_code: "FANVUE_SERVER_OWNED_MEDIA_SINGLE_ASSET_ONLY", content_type: contentType, text_present: Boolean(text), media_source_asset_count: assetIds.length }
  if (!input.loadApprovedMedia) return { ok: false as const, safe_code: "FANVUE_SERVER_OWNED_MEDIA_BYTES_REQUIRED", content_type: contentType, text_present: Boolean(text), media_source_asset_count: assetIds.length }
  const media = await input.loadApprovedMedia({ userId: input.userId, sourceAssetIds: assetIds })
  if (media.ok === false) return { ok: false as const, safe_code: media.safe_code, content_type: contentType, text_present: Boolean(text), media_source_asset_count: assetIds.length }
  const expectedMediaType = input.allowVideo ? "video" : "image"
  if (media.media.mediaType !== expectedMediaType) return { ok: false as const, safe_code: "FANVUE_SERVER_OWNED_MEDIA_UNSUPPORTED_TYPE", content_type: contentType, text_present: Boolean(text), media_source_asset_count: assetIds.length, media_type: media.media.mediaType }
  return { ok: true as const, content_type: contentType, text_present: Boolean(text), media_asset_present: true, media_source_asset_count: assetIds.length, server_owned_media_validated: true, media_type: media.media.mediaType, approvedContent: { platform: "fanvue", content_type: "media", text, media: media.media } satisfies FanvueInternalApprovedContent }
}


function redactedContentFlags<T extends Record<string, unknown>>(content: T) {
  const { approvedContent: _approvedContent, ...safeContent } = content
  return safeContent
}

function validateAccount(account: FanvueControlledDispatchAccount | null, userId: string, contentType: "text" | "media") {
  if (!account || account.user_id !== userId || account.platform !== "fanvue" || account.connection_status !== "CONNECTED") return { account_connected: false, required_scopes_present: false }
  const scopes = scopeList(account.scopes)
  const required = contentType === "media" ? ["read:media", "write:media", "write:creator"] : []
  return { account_connected: true, required_scopes_present: required.every((scope) => scopes.includes(scope)) }
}

export async function handleFanvueInternalControlledDispatchRoute(dependencies: FanvueInternalControlledDispatchRouteDependencies): Promise<{ status: number; body: FanvueControlledDispatchBody }> {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: { ...baseResult({ safe_code: "METHOD_NOT_ALLOWED" }), error_code: "METHOD_NOT_ALLOWED" } }
  const auth = await authorizeFanvueUploadDiagnosticRequest({ request: dependencies.request, expectedSecret: dependencies.expectedSecret, adminUserIds: dependencies.adminUserIds, getAuthenticatedUserId: dependencies.getAuthenticatedUserId })
  if (auth.ok === false) return { status: auth.status, body: { ...baseResult({ safe_code: auth.error_code }), error_code: auth.error_code as FanvueUploadDiagnosticAuthErrorCode } }
  if ((dependencies.env ?? process.env)[FANVUE_ADMIN_CONTROLLED_DISPATCH_ENV] !== "true") return { status: 200, body: { ...baseResult({ safe_code: "FANVUE_ADMIN_CONTROLLED_DISPATCH_GATE_DISABLED" }), error_code: "FANVUE_ADMIN_CONTROLLED_DISPATCH_GATE_DISABLED" } }

  const parsed = parseBody(await dependencies.request.json().catch(() => null))
  if (!parsed.ok) return { status: parsed.status, body: { ...baseResult({ safe_code: parsed.error_code, autopost_job_id_present: parsed.error_code !== "AUTOPOST_JOB_ID_REQUIRED" }), error_code: parsed.error_code } }
  if (!parsed.dryRun && (dependencies.env ?? process.env)[FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_ENV] !== "true") return { status: 200, body: { ...baseResult({ safe_code: "FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_GATE_DISABLED", autopost_job_id_present: true, dry_run: false }), error_code: "FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_GATE_DISABLED" } }

  const job = await dependencies.loadJob(parsed.autopostJobId)
  if (!job || job.id !== parsed.autopostJobId || !job.user_id || !job.rule_id) return { status: 200, body: { ...baseResult({ safe_code: "AUTOPOST_JOB_NOT_FOUND", autopost_job_id_present: true }), error_code: "AUTOPOST_JOB_NOT_FOUND" } }
  if (job.platform !== "fanvue") return { status: 200, body: { ...baseResult({ safe_code: "FANVUE_JOB_PLATFORM_INVALID", autopost_job_id_present: true, job_state: job.state ?? null }), error_code: "FANVUE_JOB_PLATFORM_INVALID" } }
  if (job.state !== "QUEUED") return { status: 200, body: { ...baseResult({ safe_code: "FANVUE_JOB_STATE_NOT_QUEUED", autopost_job_id_present: true, job_state: job.state ?? null }), error_code: "FANVUE_JOB_STATE_NOT_QUEUED" } }
  if (resultIndicatesPosted(job.result)) return { status: 200, body: { ...baseResult({ safe_code: "FANVUE_JOB_ALREADY_POSTED", autopost_job_id_present: true, job_state: job.state ?? null }), error_code: "FANVUE_JOB_ALREADY_POSTED" } }

  const rule = await dependencies.loadRule(job.rule_id, job.user_id)
  if (!rule || rule.id !== job.rule_id || rule.user_id !== job.user_id) return { status: 200, body: { ...baseResult({ safe_code: "APPROVED_RULE_NOT_FOUND", autopost_job_id_present: true, job_state: job.state ?? null }), error_code: "APPROVED_RULE_NOT_FOUND" } }
  const ruleFlags = { rule_approved: rule.approval_state === "APPROVED", rule_enabled: rule.enabled === true, rule_not_paused: !rule.paused_at, rule_not_revoked: !rule.revoked_at }
  if (!ruleFlags.rule_approved) return { status: 200, body: { ...baseResult({ ...ruleFlags, safe_code: "FANVUE_RULE_NOT_APPROVED", autopost_job_id_present: true, job_state: job.state ?? null }), error_code: "FANVUE_RULE_NOT_APPROVED" } }
  if (!ruleFlags.rule_enabled) return { status: 200, body: { ...baseResult({ ...ruleFlags, safe_code: "FANVUE_RULE_DISABLED", autopost_job_id_present: true, job_state: job.state ?? null }), error_code: "FANVUE_RULE_DISABLED" } }
  if (!ruleFlags.rule_not_paused) return { status: 200, body: { ...baseResult({ ...ruleFlags, safe_code: "FANVUE_RULE_PAUSED", autopost_job_id_present: true, job_state: job.state ?? null }), error_code: "FANVUE_RULE_PAUSED" } }
  if (!ruleFlags.rule_not_revoked) return { status: 200, body: { ...baseResult({ ...ruleFlags, safe_code: "FANVUE_RULE_REVOKED", autopost_job_id_present: true, job_state: job.state ?? null }), error_code: "FANVUE_RULE_REVOKED" } }

  const content = await validateContent(contentFromJobOrRule(job, rule), { userId: job.user_id, loadApprovedMedia: dependencies.loadApprovedMedia, allowVideo: parsed.videoDryRun || parsed.videoLive })
  if (!content.ok) return { status: 200, body: { ...baseResult({ ...ruleFlags, safe_code: content.safe_code, autopost_job_id_present: true, job_state: job.state ?? null, content_reference_present: true, content_type: content.content_type ?? null, text_present: content.text_present ?? false, media_source_asset_count: content.media_source_asset_count ?? 0, media_type: content.media_type ?? null }), error_code: content.safe_code } }

  const safeContent = redactedContentFlags(content)
  const accountState = validateAccount(await dependencies.loadAccount(job.user_id), job.user_id, content.content_type as "text" | "media")
  if (!accountState.account_connected) return { status: 200, body: { ...baseResult({ ...ruleFlags, ...safeContent, ...accountState, safe_code: "FANVUE_ACCOUNT_NOT_CONNECTED", autopost_job_id_present: true, job_state: job.state ?? null, content_reference_present: true }), error_code: "FANVUE_ACCOUNT_NOT_CONNECTED" } }
  if (!accountState.required_scopes_present) return { status: 200, body: { ...baseResult({ ...ruleFlags, ...safeContent, ...accountState, safe_code: "FANVUE_REQUIRED_SCOPES_MISSING", autopost_job_id_present: true, job_state: job.state ?? null, content_reference_present: true }), error_code: "FANVUE_REQUIRED_SCOPES_MISSING" } }

  if (parsed.dryRun) return { status: 200, body: baseResult({ ...ruleFlags, ...safeContent, ...accountState, ok: true, safe_code: parsed.videoDryRun ? "FANVUE_CONTROLLED_VIDEO_DISPATCH_DRY_RUN_ELIGIBLE" : "FANVUE_CONTROLLED_DISPATCH_DRY_RUN_ELIGIBLE", would_dispatch: true, autopost_job_id_present: true, job_state: job.state, content_reference_present: true }) }

  const adapterDependencies = dependencies.adapterDependencies ?? dependencies.getAdapterDependencies?.()
  if (!adapterDependencies) throw new Error("FANVUE_CONTROLLED_DISPATCH_ADAPTER_DEPENDENCIES_REQUIRED")
  if (!dependencies.persistProof) throw new Error("FANVUE_CONTROLLED_DISPATCH_PERSIST_PROOF_REQUIRED")
  const adapter = dependencies.adapter ?? postFanvueInternalSinglePost
  const adapterResult = await adapter({
    ...adapterDependencies,
    userId: job.user_id,
    account: await dependencies.loadAccount(job.user_id),
    content: content.approvedContent,
    reloadAccountAfterRefresh: dependencies.loadAccount,
    now: adapterDependencies.now ?? dependencies.now,
  })
  const safeAdapter = redactFanvueInternalPostResult(adapterResult)
  let proofPersisted = false
  let auditLogPersisted = false
  let proofMutation = false
  let proofResultOk: boolean | null = null
  if (adapterResult.ok && adapterResult.provider_post_uuid) {
    const persisted = await dependencies.persistProof({
      autopostJobId: job.id,
      providerPostUuid: adapterResult.provider_post_uuid,
      result: { ...safeAdapter, provider_post_uuid_present: true },
      now: dependencies.now?.() ?? new Date(),
    })
    proofResultOk = persisted.ok
    proofPersisted = persisted.job_proof_persisted
    auditLogPersisted = persisted.audit_log_persisted
    proofMutation = persisted.job_proof_persisted || persisted.audit_log_persisted
  }

  return { status: 200, body: baseResult({ ...ruleFlags, ...safeContent, ...accountState, ...safeAdapter, ok: proofResultOk === null ? safeAdapter.ok : Boolean(safeAdapter.ok && proofResultOk), safe_code: safeAdapter.safe_code, dry_run: false, would_dispatch: false, autopost_job_id_present: true, job_state: job.state, content_reference_present: true, fanvue_upload_attempted: safeAdapter.upload_attempted, fanvue_post_attempted: safeAdapter.create_attempted, proof_persisted: proofPersisted, audit_log_persisted: auditLogPersisted, supabase_mutated: Boolean(adapterResult.supabase_mutated || proofMutation) }) }
}
