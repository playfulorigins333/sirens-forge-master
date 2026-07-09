import { authorizeFanvueUploadDiagnosticRequest, FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER, type FanvueUploadDiagnosticAuthInput, type FanvueUploadDiagnosticAuthErrorCode } from "./fanvueUploadDiagnosticAuth"
import { FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_ENV } from "./fanvueInternalControlledDispatchRoute"
import {
  FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION,
  FANVUE_INTERNAL_SINGLE_POST_OPERATION,
  postFanvueInternalSinglePost,
  redactFanvueInternalPostResult,
  type FanvueInternalAccount,
  type FanvueInternalApprovedContent,
  type FanvueInternalPostInput,
} from "./fanvueInternalAdapter"
import type { FanvueApprovedMediaLoaderResult } from "./fanvueApprovedMediaLoader"

export const FANVUE_INTERNAL_SINGLE_POST_SECRET_HEADER = FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER

export type FanvueInternalSinglePostJob = {
  id: string
  user_id: string
  rule_id: string | null
  platform?: string | null
  payload?: unknown
  state?: string | null
  result?: unknown
  error?: unknown
}

export type FanvueInternalSinglePostRule = {
  id: string
  user_id: string
  approval_state: string | null
  enabled: boolean | null
  selected_platforms?: unknown
  content_payload?: unknown
  paused_at?: string | null
  revoked_at?: string | null
}

type PersistProofInput = {
  autopostJobId: string
  providerPostUuid: string
  result: Record<string, unknown>
  now: Date
}

export type FanvueInternalSinglePostBody =
  | (ReturnType<typeof baseRouteResult> & { error_code?: never })
  | { ok: false; error_code: FanvueUploadDiagnosticAuthErrorCode | "METHOD_NOT_ALLOWED" | "INVALID_BODY" | "INVALID_OPERATION" | "INVALID_CONFIRMATION" | "CALLER_SUPPLIED_FORBIDDEN_FIELD" | "AUTOPOST_JOB_ID_REQUIRED" | "AUTOPOST_JOB_NOT_FOUND" | "APPROVED_RULE_NOT_FOUND" | "APPROVED_CONTENT_UNSUPPORTED" }

export type FanvueInternalSinglePostRouteResponse = { status: number; body: FanvueInternalSinglePostBody }

export type FanvueInternalSinglePostRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: FanvueUploadDiagnosticAuthInput["getAuthenticatedUserId"]
  env?: Record<string, string | undefined>
  loadJob: (jobId: string) => Promise<FanvueInternalSinglePostJob | null>
  loadRule: (ruleId: string, userId: string) => Promise<FanvueInternalSinglePostRule | null>
  loadAccount: (userId: string) => Promise<FanvueInternalAccount | null>
  loadApprovedMedia?: (input: { userId: string; sourceAssetIds: string[] }) => Promise<FanvueApprovedMediaLoaderResult>
  persistProof: (input: PersistProofInput) => Promise<{ ok: boolean; job_proof_persisted: boolean; audit_log_persisted: boolean }>
  adapter?: typeof postFanvueInternalSinglePost
  adapterDependencies?: Pick<FanvueInternalPostInput, "apiBaseUrl" | "apiVersion" | "fanvueFetch" | "fetchIdentity" | "signedPartUploader" | "decryptAccessToken" | "refreshAccessToken" | "waitForMediaReady" | "now">
  now?: () => Date
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FORBIDDEN_FIELDS = new Set([
  "text", "caption", "audience", "mediaUuid", "mediaUuids", "media_uuid", "media_uuids", "uploadId", "upload_id", "postUuid", "post_uuid", "providerPostUuid", "provider_post_uuid", "creatorUserUuid", "creator_user_uuid", "providerAccountId", "provider_account_id", "providerUsername", "provider_username", "fanvueHandle", "handle", "username", "email", "price", "amount", "currency", "paywall", "publishAt", "publish_at", "expiresAt", "expires_at", "collectionUuids", "collection_uuids", "schedule", "scheduled", "dispatch", "platformRegistry", "platform_registry", "publicUi", "public_ui", "publicUI", "file", "fileBytes", "file_bytes", "bytes", "fileUrl", "file_url", "url", "media", "upload",
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

function baseRouteResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: false,
    safe_code: "FANVUE_INTERNAL_SINGLE_POST_PREFLIGHT_NO_PROVIDER_CALL",
    live_attempted: false,
    dry_run: true,
    content_reference_present: false,
    approved_content_loaded: false,
    content_type: null,
    text_present: false,
    media_asset_present: false,
    token_refresh_attempted: false,
    token_refresh_status_class: "not_attempted",
    upload_attempted: false,
    readiness_checked: false,
    readiness_ready: false,
    create_attempted: false,
    create_status_class: "not_attempted",
    provider_post_uuid_present: false,
    proof_persisted: false,
    audit_log_persisted: false,
    upload_cleanup_supported: false,
    uploaded_media_may_remain_in_creator_media_library: false,
    price_used: false,
    publishAt_used: false,
    dispatch_attempted: false,
    schedule_attempted: false,
    platform_registry_changed: false,
    public_ui_added: false,
    supabase_mutated: false,
    ...overrides,
  }
}

function validateBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, error_code: "INVALID_BODY" as const }
  for (const key of Object.keys(body)) if (FORBIDDEN_FIELDS.has(key)) return { ok: false as const, error_code: "CALLER_SUPPLIED_FORBIDDEN_FIELD" as const }
  if (body.operation !== FANVUE_INTERNAL_SINGLE_POST_OPERATION) return { ok: false as const, error_code: "INVALID_OPERATION" as const }
  const autopostJobId = clean(body.autopost_job_id)
  if (!autopostJobId || !UUID_RE.test(autopostJobId)) return { ok: false as const, error_code: "AUTOPOST_JOB_ID_REQUIRED" as const }
  const dryRun = body.dry_run !== false && body.preflight !== false
  if (!dryRun && body.confirm !== FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION) return { ok: false as const, error_code: "INVALID_CONFIRMATION" as const }
  return { ok: true as const, autopostJobId, dryRun }
}

async function payloadToApprovedContent(payload: unknown, input: { userId: string; loadApprovedMedia?: FanvueInternalSinglePostRouteDependencies["loadApprovedMedia"] }): Promise<{ ok: true; content: FanvueInternalApprovedContent } | { ok: false; reason: string }> {
  if (!isRecord(payload)) return { ok: false, reason: "CONTENT_PAYLOAD_INVALID" }
  if (payload.platform !== "fanvue") return { ok: false, reason: "CONTENT_PLATFORM_MISMATCH" }
  const rawType = clean(payload.content_type)
  const assetIds = stringArray(payload.source_asset_ids)
  const assetUrls = stringArray(payload.source_asset_urls)
  const contentType = rawType === "media" || rawType === "text_media" || assetIds.length > 0 || assetUrls.length > 0 ? "media" : rawType === "text" ? "text" : null
  if (!contentType) return { ok: false, reason: "CONTENT_TYPE_UNSUPPORTED" }
  const text = clean(payload.text)
  if (contentType === "text") return { ok: true, content: { platform: "fanvue", content_type: "text", text } }

  if (assetIds.length === 0) return { ok: false, reason: "FANVUE_SERVER_OWNED_MEDIA_ASSET_ID_REQUIRED" }
  if (assetIds.length !== 1) return { ok: false, reason: "FANVUE_SERVER_OWNED_MEDIA_SINGLE_ASSET_ONLY" }
  if (!input.loadApprovedMedia) return { ok: false, reason: "FANVUE_SERVER_OWNED_MEDIA_BYTES_REQUIRED" }

  // source_asset_urls are retained only as inert metadata. They are never fetched
  // or treated as proof of server ownership by this internal route.
  void assetUrls
  const media = await input.loadApprovedMedia({ userId: input.userId, sourceAssetIds: assetIds })
  if (media.ok === false) return { ok: false, reason: media.safe_code }
  return { ok: true, content: { platform: "fanvue", content_type: "media", text, media: media.media } }
}

export async function handleFanvueInternalSinglePostRoute(dependencies: FanvueInternalSinglePostRouteDependencies): Promise<FanvueInternalSinglePostRouteResponse> {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: { ok: false, error_code: "METHOD_NOT_ALLOWED" } }
  const auth = await authorizeFanvueUploadDiagnosticRequest({ request: dependencies.request, expectedSecret: dependencies.expectedSecret, adminUserIds: dependencies.adminUserIds, getAuthenticatedUserId: dependencies.getAuthenticatedUserId })
  if (auth.ok === false) return { status: auth.status, body: { ok: false, error_code: auth.error_code } }

  const validation = validateBody(await dependencies.request.json().catch(() => null))
  if (!validation.ok) return { status: 400, body: { ok: false, error_code: validation.error_code } }

  const contentReference = { content_reference_present: true }
  if (validation.dryRun) return { status: 200, body: baseRouteResult(contentReference) }
  if ((dependencies.env ?? process.env)[FANVUE_ADMIN_CONTROLLED_LIVE_DISPATCH_ENV] !== "true") {
    return {
      status: 200,
      body: baseRouteResult({
        ...contentReference,
        dry_run: false,
        safe_code: "FANVUE_INTERNAL_SINGLE_POST_LIVE_GATE_DISABLED",
      }),
    }
  }

  const job = await dependencies.loadJob(validation.autopostJobId)
  if (!job || job.id !== validation.autopostJobId || !job.user_id || !job.rule_id) return { status: 200, body: baseRouteResult({ ...contentReference, dry_run: false, safe_code: "AUTOPOST_JOB_NOT_FOUND" }) }
  const rule = await dependencies.loadRule(job.rule_id, job.user_id)
  if (!rule || rule.id !== job.rule_id || rule.user_id !== job.user_id || rule.approval_state !== "APPROVED" || rule.enabled !== true || rule.paused_at || rule.revoked_at) {
    return { status: 200, body: baseRouteResult({ ...contentReference, dry_run: false, safe_code: "APPROVED_RULE_NOT_FOUND" }) }
  }

  const content = await payloadToApprovedContent(job.payload && isRecord(job.payload) && isRecord(job.payload.content_payload) ? job.payload.content_payload : rule.content_payload, { userId: job.user_id, loadApprovedMedia: dependencies.loadApprovedMedia })
  if (content.ok === false) {
    return { status: 200, body: baseRouteResult({ ...contentReference, dry_run: false, approved_content_loaded: false, safe_code: content.reason }) }
  }

  const account = await dependencies.loadAccount(job.user_id)
  const adapter = dependencies.adapter ?? postFanvueInternalSinglePost
  const adapterDeps = dependencies.adapterDependencies
  if (!adapterDeps) throw new Error("FANVUE_INTERNAL_ADAPTER_DEPENDENCIES_REQUIRED")
  const adapterResult = await adapter({
    ...adapterDeps,
    userId: job.user_id,
    account,
    content: content.content,
    reloadAccountAfterRefresh: dependencies.loadAccount,
    now: adapterDeps.now ?? dependencies.now,
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

  return {
    status: 200,
    body: baseRouteResult({
      ...contentReference,
      ...safeAdapter,
      dry_run: false,
      approved_content_loaded: true,
      ok: proofResultOk === null ? safeAdapter.ok : Boolean(safeAdapter.ok && proofResultOk),
      proof_persisted: proofPersisted,
      audit_log_persisted: auditLogPersisted,
      supabase_mutated: Boolean(adapterResult.supabase_mutated || proofMutation),
    }),
  }
}
