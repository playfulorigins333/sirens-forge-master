import crypto from "crypto"

export const FANVUE_POST_RISK_DIAGNOSTIC_SECRET_HEADER = "x-fanvue-post-risk-diagnostic-secret" as const
export const FANVUE_POST_RISK_DIAGNOSTIC_OPERATION = "fanvue_manual_public_risk_post_diagnostic_no_dispatch_no_schedule" as const
export const FANVUE_POST_RISK_DIAGNOSTIC_PREFLIGHT_CONFIRMATION = "PREFLIGHT_FANVUE_MANUAL_PUBLIC_RISK_POST_DIAGNOSTIC_ONLY_NO_POST_NO_FANVUE_CALLS" as const
export const FANVUE_POST_RISK_DIAGNOSTIC_DISABLED_LIVE_CONFIRMATION = "RUN_FANVUE_MANUAL_PUBLIC_RISK_POST_DIAGNOSTIC_CREATE_ONE_TEXT_POST_ONLY_NO_MEDIA_NO_DISPATCH_NO_SCHEDULE_I_ACCEPT_PUBLIC_AND_NO_CLEANUP_RISK" as const
export const FANVUE_POST_RISK_DIAGNOSTIC_TEXT = "API diagnostic test. Plain text only. No media. No links. No paid content." as const
export const FANVUE_POST_RISK_DIAGNOSTIC_ROUTE = "/api/admin/autopost/fanvue/post-risk-diagnostic" as const

export type FanvuePostRiskDiagnosticAuthErrorCode =
  | "FANVUE_POST_RISK_DIAGNOSTIC_SECRET_NOT_CONFIGURED"
  | "FANVUE_POST_RISK_DIAGNOSTIC_SECRET_REQUIRED"
  | "FANVUE_POST_RISK_DIAGNOSTIC_SECRET_INVALID"
  | "UNAUTHENTICATED"
  | "FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED"
  | "FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_ALLOWLIST_INVALID"
  | "FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_REQUIRED"

export type FanvuePostRiskDiagnosticValidationErrorCode =
  | "METHOD_NOT_ALLOWED" | "INVALID_BODY" | "INVALID_OPERATION" | "INVALID_CONFIRMATION" | "INVALID_PREFLIGHT" | "INVALID_TARGET_USER_ID" | "INVALID_CONTENT_PROFILE" | "INVALID_POST_MODE" | "INVALID_ACKNOWLEDGEMENT" | "DANGEROUS_FIELD_FORBIDDEN" | "POSTS_ROUTE_STRING_FORBIDDEN" | "CREATORS_ROUTE_STRING_FORBIDDEN"

export type FanvuePostRiskDiagnosticErrorBody = { ok: false; error_code: FanvuePostRiskDiagnosticAuthErrorCode | FanvuePostRiskDiagnosticValidationErrorCode }
export type FanvuePostRiskDiagnosticRouteResponse = { status: number; body: FanvuePostRiskDiagnosticPreflightResult | FanvuePostRiskDiagnosticDisabledLiveResult | FanvuePostRiskDiagnosticErrorBody }

export type FanvuePostRiskDiagnosticRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: (request: Request) => Promise<string>
}

export type FanvuePostRiskDiagnosticPreflightResult = ReturnType<typeof buildPreflightResult>
export type FanvuePostRiskDiagnosticDisabledLiveResult = ReturnType<typeof buildDisabledLiveResult>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TARGET_USER_ID = "879c8a17-f9e8-473d-8de1-1fd1a77c080e" as const
const CONTENT_PROFILE = "plain_text_diagnostic_only" as const
const POST_MODE = "single_controlled_text_post_public_risk_accepted" as const
const ACKNOWLEDGEMENTS = ["acknowledge_post_may_be_public", "acknowledge_cleanup_may_be_unavailable", "acknowledge_no_draft_private_unpublished_mode_proven", "acknowledge_publishAt_is_not_used_as_safety_control", "acknowledge_no_media_upload_or_media_reuse", "acknowledge_no_dispatch_no_schedule_no_public_ui", "acknowledge_live_post_creation_is_not_launch_approval"] as const
const DANGEROUS_FIELDS = new Set(["mediaUuid", "mediaUuids", "mediaPreviewUuid", "uploadId", "uploadUuid", "creatorUserUuid", "creatorUuid", "creator_user_uuid", "creator_uuid", "postUuid", "post_uuid", "providerPostId", "provider_post_id", "signedUrl", "signed_url", "byteUploadOutput", "byte_upload_output", "etag", "eTag", "ETag", "publishAt", "publish_at", "scheduleAt", "scheduledAt", "dispatch", "schedule", "platformRegistry", "publicUI", "public_ui", "launchFacing", "launch_facing", "rawProviderResponse", "providerResponse", "raw_provider_response", "provider_response", "providerBody", "provider_body", "headers", "cookies", "authorization", "authHeader", "auth_header", "accessToken", "access_token", "refreshToken", "refresh_token", "token", "secret", "handle", "username", "email", "link", "links", "hashtag", "hashtags", "price", "paywall", "collectionUuids", "expiresAt", "text", "caption"])

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
function normalize(value: string | null | undefined) { return typeof value === "string" ? value.trim() : "" }
function safeEqual(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && crypto.timingSafeEqual(left, right) }
function normalizeAdminUserIds(value: FanvuePostRiskDiagnosticRouteDependencies["adminUserIds"]) { return (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []).map((entry) => String(entry).trim()).filter(Boolean) }

async function authorize(input: FanvuePostRiskDiagnosticRouteDependencies) {
  const expectedSecret = normalize(input.expectedSecret)
  if (!expectedSecret) return { ok: false as const, status: 500 as const, error_code: "FANVUE_POST_RISK_DIAGNOSTIC_SECRET_NOT_CONFIGURED" as const }
  const rawRequestSecret = input.request.headers.get(FANVUE_POST_RISK_DIAGNOSTIC_SECRET_HEADER)
  const requestSecret = normalize(rawRequestSecret)
  if (!requestSecret) return { ok: false as const, status: 401 as const, error_code: "FANVUE_POST_RISK_DIAGNOSTIC_SECRET_REQUIRED" as const }
  if (requestSecret.includes(",") || !safeEqual(requestSecret, expectedSecret)) return { ok: false as const, status: 403 as const, error_code: "FANVUE_POST_RISK_DIAGNOSTIC_SECRET_INVALID" as const }
  let authenticatedUserId = ""
  try { authenticatedUserId = normalize(await input.getAuthenticatedUserId(input.request)) } catch { return { ok: false as const, status: 401 as const, error_code: "UNAUTHENTICATED" as const } }
  if (!authenticatedUserId) return { ok: false as const, status: 401 as const, error_code: "UNAUTHENTICATED" as const }
  const adminUserIds = normalizeAdminUserIds(input.adminUserIds)
  if (adminUserIds.length === 0) return { ok: false as const, status: 500 as const, error_code: "FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED" as const }
  if (adminUserIds.some((id) => !UUID_RE.test(id))) return { ok: false as const, status: 500 as const, error_code: "FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_ALLOWLIST_INVALID" as const }
  if (!adminUserIds.includes(authenticatedUserId)) return { ok: false as const, status: 403 as const, error_code: "FANVUE_POST_RISK_DIAGNOSTIC_ADMIN_REQUIRED" as const }
  return { ok: true as const }
}

function validateDangerousInput(value: unknown): FanvuePostRiskDiagnosticValidationErrorCode | null {
  if (typeof value === "string") {
    if (/\/posts(?:\/|$)/i.test(value)) return "POSTS_ROUTE_STRING_FORBIDDEN"
    if (/\/creators(?:\/|$)/i.test(value)) return "CREATORS_ROUTE_STRING_FORBIDDEN"
  }
  if (Array.isArray(value)) for (const item of value) { const result = validateDangerousInput(item); if (result) return result }
  else if (isRecord(value)) for (const [key, nested] of Object.entries(value)) { if (DANGEROUS_FIELDS.has(key)) return "DANGEROUS_FIELD_FORBIDDEN"; const result = validateDangerousInput(nested); if (result) return result }
  return null
}

function validateBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, error_code: "INVALID_BODY" as const }
  const dangerous = validateDangerousInput(body)
  if (dangerous) return { ok: false as const, error_code: dangerous }
  if (body.operation !== FANVUE_POST_RISK_DIAGNOSTIC_OPERATION) return { ok: false as const, error_code: "INVALID_OPERATION" as const }
  if (typeof body.preflight !== "boolean") return { ok: false as const, error_code: "INVALID_PREFLIGHT" as const }
  const expectedConfirmation = body.preflight ? FANVUE_POST_RISK_DIAGNOSTIC_PREFLIGHT_CONFIRMATION : FANVUE_POST_RISK_DIAGNOSTIC_DISABLED_LIVE_CONFIRMATION
  if (body.confirm !== expectedConfirmation) return { ok: false as const, error_code: "INVALID_CONFIRMATION" as const }
  if (body.content_profile !== CONTENT_PROFILE) return { ok: false as const, error_code: "INVALID_CONTENT_PROFILE" as const }
  if (body.post_mode !== POST_MODE) return { ok: false as const, error_code: "INVALID_POST_MODE" as const }
  if (typeof body.user_id !== "string" || !UUID_RE.test(body.user_id.trim()) || body.user_id.trim() !== TARGET_USER_ID) return { ok: false as const, error_code: "INVALID_TARGET_USER_ID" as const }
  for (const acknowledgement of ACKNOWLEDGEMENTS) if (body[acknowledgement] !== true) return { ok: false as const, error_code: "INVALID_ACKNOWLEDGEMENT" as const }
  return { ok: true as const, preflight: body.preflight }
}

const noLiveActionFlags = {
  will_decrypt_tokens: false, will_retry_refresh: false, will_call_fanvue: false, will_use_posts_route: false, will_use_creators_route: false, will_upload: false, will_create_post: false, will_read_post: false, will_dispatch: false, will_schedule: false, will_mutate_supabase: false, will_touch_platformRegistry: false, will_expose_public_ui: false, will_expose_launch_facing_fanvue: false,
} as const

function buildPreflightResult() {
  return { ok: true as const, preflight: true as const, route: FANVUE_POST_RISK_DIAGNOSTIC_ROUTE, operation: FANVUE_POST_RISK_DIAGNOSTIC_OPERATION, safe_code: "FANVUE_POST_RISK_PREFLIGHT_LIVE_PATH_DISABLED" as const, live_post_blocked: true as const, live_path_enabled: false as const, ...noLiveActionFlags, plain_text_only: true as const, diagnostic_text: FANVUE_POST_RISK_DIAGNOSTIC_TEXT, media_blocked: true as const, caller_supplied_media_blocked: true as const, caller_supplied_creator_ids_blocked: true as const, caller_supplied_upload_ids_blocked: true as const, caller_supplied_post_ids_blocked: true as const, publishAt_used: false as const, audience_strategy: "blocked_pending_supported_value" as const, cleanup_proven: false as const, safe_visibility_proven: false as const, draft_private_unpublished_proven: false as const, readback_can_prove_safe_visibility: false as const, manual_risk_acknowledgements_present: true as const, blockers: ["live_path_disabled_pending_later_gate", "post_visibility_not_proven_safe", "cleanup_not_proven", "draft_private_unpublished_not_proven", "publishAt_not_safety_control", "readback_cannot_prove_safe_visibility", "audience_value_not_selected_for_live_execution"], stop_reason: "STOPPED_AFTER_RISK_PREFLIGHT_NO_POST_NO_FANVUE_CALLS" as const }
}

function buildDisabledLiveResult() {
  return { ok: false as const, preflight: false as const, route: FANVUE_POST_RISK_DIAGNOSTIC_ROUTE, operation: FANVUE_POST_RISK_DIAGNOSTIC_OPERATION, safe_code: "FANVUE_POST_RISK_LIVE_PATH_DISABLED_PENDING_LATER_GATE" as const, live_post_blocked: true as const, live_path_enabled: false as const, blocked_reason: "live_risk_path_disabled_pending_later_gate" as const, ...noLiveActionFlags, stop_reason: "STOPPED_DISABLED_LIVE_PATH_NO_POST_NO_FANVUE_CALLS" as const }
}

export async function handleFanvuePostRiskDiagnosticRoute(dependencies: FanvuePostRiskDiagnosticRouteDependencies): Promise<FanvuePostRiskDiagnosticRouteResponse> {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: { ok: false, error_code: "METHOD_NOT_ALLOWED" } }
  const auth = await authorize(dependencies)
  if (!auth.ok) return { status: auth.status, body: { ok: false, error_code: auth.error_code } }
  const parsedBody = await dependencies.request.json().catch(() => null)
  const validation = validateBody(parsedBody)
  if (!validation.ok) return { status: 400, body: { ok: false, error_code: validation.error_code } }
  if (validation.preflight === false) return { status: 200, body: buildDisabledLiveResult() }
  return { status: 200, body: buildPreflightResult() }
}
