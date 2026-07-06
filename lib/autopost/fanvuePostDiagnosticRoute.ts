import crypto from "crypto"

export const FANVUE_POST_DIAGNOSTIC_SECRET_HEADER = "x-fanvue-post-diagnostic-secret" as const
export const FANVUE_POST_DIAGNOSTIC_OPERATION = "fanvue_post_creation_diagnostic_no_dispatch_no_schedule" as const
export const FANVUE_POST_DIAGNOSTIC_CONFIRMATION = "PREFLIGHT_FANVUE_POST_DIAGNOSTIC_ONLY_NO_DECRYPT_NO_FANVUE_CALLS_NO_POSTS" as const

export type FanvuePostDiagnosticAuthErrorCode =
  | "FANVUE_POST_DIAGNOSTIC_SECRET_NOT_CONFIGURED"
  | "FANVUE_POST_DIAGNOSTIC_SECRET_REQUIRED"
  | "FANVUE_POST_DIAGNOSTIC_SECRET_INVALID"
  | "UNAUTHENTICATED"
  | "FANVUE_POST_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED"
  | "FANVUE_POST_DIAGNOSTIC_ADMIN_REQUIRED"

export type FanvuePostDiagnosticValidationErrorCode =
  | "METHOD_NOT_ALLOWED"
  | "INVALID_BODY"
  | "INVALID_OPERATION"
  | "INVALID_CONFIRMATION"
  | "INVALID_TARGET_USER_ID"
  | "INVALID_PREFLIGHT"
  | "INVALID_POST_MODE"
  | "INVALID_CONTENT_PROFILE"
  | "LIVE_MODE_FORBIDDEN"
  | "CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN"
  | "CALLER_SUPPLIED_UPLOAD_ID_FORBIDDEN"
  | "CALLER_SUPPLIED_MEDIA_UUID_FORBIDDEN"
  | "CALLER_SUPPLIED_SIGNED_URL_FORBIDDEN"
  | "CALLER_SUPPLIED_MEDIA_CONTENT_FORBIDDEN"
  | "CALLER_SUPPLIED_POST_UUID_FORBIDDEN"
  | "CALLER_SUPPLIED_PROVIDER_POST_ID_FORBIDDEN"
  | "SCHEDULE_FIELD_FORBIDDEN"
  | "DISPATCH_FIELD_FORBIDDEN"
  | "PLATFORM_EXPOSURE_FIELD_FORBIDDEN"
  | "PRICE_PAYWALL_FIELD_FORBIDDEN"
  | "AUDIENCE_TARGETING_FIELD_FORBIDDEN"
  | "LINKS_HASHTAGS_FIELD_FORBIDDEN"
  | "PROVIDER_RESPONSE_FIELD_FORBIDDEN"
  | "POSTS_ROUTE_STRING_FORBIDDEN"
  | "CREATORS_ROUTE_STRING_FORBIDDEN"

export type FanvuePostDiagnosticResult = {
  ok: true
  operation: typeof FANVUE_POST_DIAGNOSTIC_OPERATION
  preflight: true
  safe_code: "FANVUE_POST_DIAGNOSTIC_PREFLIGHT_BLOCKED_LIVE_POST_NOT_APPROVED"
  will_decrypt_tokens: false
  will_retry_refresh: false
  will_call_fanvue: false
  will_use_posts_route: false
  will_use_creators_route: false
  will_upload: false
  will_finalize_media: false
  will_read_media: false
  will_create_post: false
  will_read_post: false
  will_dispatch: false
  will_schedule: false
  will_touch_platform_registry: false
  will_expose_public_ui: false
  will_mutate_supabase: false
  fanvue_internal_testing_only: true
  fanvue_public_selectable: false
  fanvue_dispatch_enabled: false
  fanvue_scheduling_enabled: false
  stored_scope_check_performed: false
  stored_scopes_include_read_post: null
  stored_scopes_include_write_post: null
  visibility_safe_for_live_post: false
  cleanup_supported_by_local_source: false
  draft_private_unpublished_mode_proven: false
  live_post_blocked: true
  blockers: string[]
  stop_reason: "STOPPED_AFTER_PREFLIGHT_NO_DECRYPT_NO_FANVUE_CALLS_NO_POSTS"
}

export type FanvuePostDiagnosticRouteBody = FanvuePostDiagnosticResult | { ok: false; error_code: FanvuePostDiagnosticAuthErrorCode | FanvuePostDiagnosticValidationErrorCode }
export type FanvuePostDiagnosticRouteResponse = { status: number; body: FanvuePostDiagnosticRouteBody }

export type FanvuePostDiagnosticRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: (request: Request) => Promise<string>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTENT_PROFILE = "plain_text_diagnostic_only"
const POST_MODE = "preflight_only"

const fieldBlocks: Array<[Set<string>, FanvuePostDiagnosticValidationErrorCode]> = [
  [new Set(["creatorUserUuid", "creator_user_uuid"]), "CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN"],
  [new Set(["uploadId", "upload_id"]), "CALLER_SUPPLIED_UPLOAD_ID_FORBIDDEN"],
  [new Set(["mediaUuid", "mediaUuids", "media_uuid", "media_uuids"]), "CALLER_SUPPLIED_MEDIA_UUID_FORBIDDEN"],
  [new Set(["signedUrl", "signedUrls", "signed_url", "signed_urls", "signedUploadUrl", "signed_upload_url", "url"]), "CALLER_SUPPLIED_SIGNED_URL_FORBIDDEN"],
  [new Set(["bytes", "byteLength", "body", "file", "files", "image", "media", "mediaContent", "media_content", "base64", "dataUri", "data_uri", "blob", "buffer"]), "CALLER_SUPPLIED_MEDIA_CONTENT_FORBIDDEN"],
  [new Set(["postUuid", "post_uuid"]), "CALLER_SUPPLIED_POST_UUID_FORBIDDEN"],
  [new Set(["providerPostId", "provider_post_id", "providerPostUuid", "provider_post_uuid", "platform_post_id"]), "CALLER_SUPPLIED_PROVIDER_POST_ID_FORBIDDEN"],
  [new Set(["schedule", "scheduled", "scheduledAt", "scheduled_at", "publishAt", "publish_at", "expiresAt", "expires_at"]), "SCHEDULE_FIELD_FORBIDDEN"],
  [new Set(["dispatch", "dispatchAt", "dispatch_at", "queue", "job", "jobId", "job_id"]), "DISPATCH_FIELD_FORBIDDEN"],
  [new Set(["public_exposure", "publicExposure", "platform_registry", "platformRegistry", "public_selectable", "supports_real_posting", "supports_async_dispatch", "exposePublicly"]), "PLATFORM_EXPOSURE_FIELD_FORBIDDEN"],
  [new Set(["price", "amount", "currency", "paywall", "paywalled", "paid", "subscriptionTier", "subscription_tier"]), "PRICE_PAYWALL_FIELD_FORBIDDEN"],
  [new Set(["audience", "audiences", "targeting", "collectionUuids", "collection_uuids", "subscriberTier", "subscriber_tier"]), "AUDIENCE_TARGETING_FIELD_FORBIDDEN"],
  [new Set(["links", "link", "hashtags", "hashtag", "tags", "caption", "text"]), "LINKS_HASHTAGS_FIELD_FORBIDDEN"],
  [new Set(["providerResponse", "provider_response", "rawProviderResponse", "raw_provider_response", "rawBody", "raw_body", "response", "providerBody", "provider_body"]), "PROVIDER_RESPONSE_FIELD_FORBIDDEN"],
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
function normalize(value: string | null | undefined) { return typeof value === "string" ? value.trim() : "" }
function safeEqual(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && crypto.timingSafeEqual(left, right) }
function normalizeAdminUserIds(value: FanvuePostDiagnosticRouteDependencies["adminUserIds"]) { return (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []).map((entry) => String(entry).trim()).filter(Boolean) }

async function authorize(input: FanvuePostDiagnosticRouteDependencies) {
  const expectedSecret = normalize(input.expectedSecret)
  if (!expectedSecret) return { ok: false as const, status: 500 as const, error_code: "FANVUE_POST_DIAGNOSTIC_SECRET_NOT_CONFIGURED" as const }
  const requestSecret = normalize(input.request.headers.get(FANVUE_POST_DIAGNOSTIC_SECRET_HEADER))
  if (!requestSecret) return { ok: false as const, status: 401 as const, error_code: "FANVUE_POST_DIAGNOSTIC_SECRET_REQUIRED" as const }
  if (!safeEqual(requestSecret, expectedSecret)) return { ok: false as const, status: 403 as const, error_code: "FANVUE_POST_DIAGNOSTIC_SECRET_INVALID" as const }
  let authenticatedUserId = ""
  try { authenticatedUserId = normalize(await input.getAuthenticatedUserId(input.request)) } catch { return { ok: false as const, status: 401 as const, error_code: "UNAUTHENTICATED" as const } }
  if (!authenticatedUserId) return { ok: false as const, status: 401 as const, error_code: "UNAUTHENTICATED" as const }
  const adminUserIds = normalizeAdminUserIds(input.adminUserIds)
  if (adminUserIds.length === 0) return { ok: false as const, status: 500 as const, error_code: "FANVUE_POST_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED" as const }
  if (!adminUserIds.includes(authenticatedUserId)) return { ok: false as const, status: 403 as const, error_code: "FANVUE_POST_DIAGNOSTIC_ADMIN_REQUIRED" as const }
  return { ok: true as const, status: 200 as const, adminUserId: authenticatedUserId }
}

function validateStringValues(value: unknown): FanvuePostDiagnosticValidationErrorCode | null {
  if (typeof value === "string") {
    if (/\/posts(?:\/|$)/i.test(value)) return "POSTS_ROUTE_STRING_FORBIDDEN"
    if (/\/creators(?:\/|$)/i.test(value)) return "CREATORS_ROUTE_STRING_FORBIDDEN"
  }
  if (Array.isArray(value)) {
    for (const item of value) { const result = validateStringValues(item); if (result) return result }
  } else if (isRecord(value)) {
    for (const nested of Object.values(value)) { const result = validateStringValues(nested); if (result) return result }
  }
  return null
}

function validateBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, error_code: "INVALID_BODY" as const }
  for (const [key, value] of Object.entries(body)) {
    for (const [fields, code] of fieldBlocks) if (fields.has(key)) return { ok: false as const, error_code: code }
    const stringBlock = validateStringValues(value)
    if (stringBlock) return { ok: false as const, error_code: stringBlock }
  }
  if (body.operation !== FANVUE_POST_DIAGNOSTIC_OPERATION) return { ok: false as const, error_code: "INVALID_OPERATION" as const }
  if (body.confirm !== FANVUE_POST_DIAGNOSTIC_CONFIRMATION) return { ok: false as const, error_code: "INVALID_CONFIRMATION" as const }
  if (body.preflight !== true) return { ok: false as const, error_code: "INVALID_PREFLIGHT" as const }
  if (body.post_mode !== POST_MODE) return { ok: false as const, error_code: body.post_mode === "live" || body.post_mode === "live_post" ? "LIVE_MODE_FORBIDDEN" as const : "INVALID_POST_MODE" as const }
  if (body.content_profile !== CONTENT_PROFILE) return { ok: false as const, error_code: "INVALID_CONTENT_PROFILE" as const }
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : ""
  if (!UUID_RE.test(userId)) return { ok: false as const, error_code: "INVALID_TARGET_USER_ID" as const }
  return { ok: true as const, userId }
}

function buildPreflightResult(): FanvuePostDiagnosticResult {
  return {
    ok: true,
    operation: FANVUE_POST_DIAGNOSTIC_OPERATION,
    preflight: true,
    safe_code: "FANVUE_POST_DIAGNOSTIC_PREFLIGHT_BLOCKED_LIVE_POST_NOT_APPROVED",
    will_decrypt_tokens: false,
    will_retry_refresh: false,
    will_call_fanvue: false,
    will_use_posts_route: false,
    will_use_creators_route: false,
    will_upload: false,
    will_finalize_media: false,
    will_read_media: false,
    will_create_post: false,
    will_read_post: false,
    will_dispatch: false,
    will_schedule: false,
    will_touch_platform_registry: false,
    will_expose_public_ui: false,
    will_mutate_supabase: false,
    fanvue_internal_testing_only: true,
    fanvue_public_selectable: false,
    fanvue_dispatch_enabled: false,
    fanvue_scheduling_enabled: false,
    stored_scope_check_performed: false,
    stored_scopes_include_read_post: null,
    stored_scopes_include_write_post: null,
    visibility_safe_for_live_post: false,
    cleanup_supported_by_local_source: false,
    draft_private_unpublished_mode_proven: false,
    live_post_blocked: true,
    blockers: ["FANVUE_POST_VISIBILITY_UNKNOWN", "FANVUE_POST_CLEANUP_UNKNOWN", "FANVUE_DRAFT_PRIVATE_UNPUBLISHED_MODE_NOT_PROVEN", "FANVUE_LIVE_POST_CREATION_NOT_APPROVED", "FANVUE_POST_SCOPE_CHECK_NOT_PERFORMED"],
    stop_reason: "STOPPED_AFTER_PREFLIGHT_NO_DECRYPT_NO_FANVUE_CALLS_NO_POSTS",
  }
}

export async function handleFanvuePostDiagnosticRoute(dependencies: FanvuePostDiagnosticRouteDependencies): Promise<FanvuePostDiagnosticRouteResponse> {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: { ok: false, error_code: "METHOD_NOT_ALLOWED" } }
  const auth = await authorize(dependencies)
  if (auth.ok === false) return { status: auth.status, body: { ok: false, error_code: auth.error_code } }
  const parsedBody = await dependencies.request.json().catch(() => null)
  const validation = validateBody(parsedBody)
  if (!validation.ok) return { status: 400, body: { ok: false, error_code: validation.error_code } }
  return { status: 200, body: buildPreflightResult() }
}
