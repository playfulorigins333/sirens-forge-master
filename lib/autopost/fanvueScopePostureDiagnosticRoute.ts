import crypto from "crypto"

export const FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_HEADER = "x-fanvue-scope-posture-diagnostic-secret" as const
export const FANVUE_SCOPE_POSTURE_DIAGNOSTIC_OPERATION = "fanvue_scope_posture_diagnostic_no_decrypt_no_refresh_no_provider_call" as const
export const FANVUE_SCOPE_POSTURE_DIAGNOSTIC_CONFIRMATION = "PREFLIGHT_FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ONLY_NO_DECRYPT_NO_REFRESH_NO_FANVUE_CALLS" as const
export const FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ROUTE = "/api/admin/autopost/fanvue/scope-posture-diagnostic" as const

const TARGET_USER_ID = "879c8a17-f9e8-473d-8de1-1fd1a77c080e" as const
const SCOPE_CHECK_PROFILE = "read_post_write_post_only" as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type FanvueScopePostureAccount = { user_id?: unknown; platform?: unknown; status?: unknown; connection_status?: unknown; scopes?: unknown }
export type FanvueScopePostureBlocker =
  | "FANVUE_STORED_SCOPES_MISSING" | "FANVUE_STORED_SCOPES_UNREADABLE_WITHOUT_TOKEN_DECRYPT" | "FANVUE_STORED_SCOPES_UNREADABLE_WITHOUT_PROVIDER_CALL" | "FANVUE_STORED_SCOPES_UNREADABLE_WITHOUT_PRODUCTION_DATA_READ" | "FANVUE_READ_POST_SCOPE_MISSING" | "FANVUE_WRITE_POST_SCOPE_MISSING" | "FANVUE_SCOPE_CHECK_NOT_PERFORMED" | "FANVUE_STORED_SCOPES_UNEXPECTED_SHAPE" | "FANVUE_MULTIPLE_CONNECTION_ROWS_BLOCKED" | "FANVUE_CONNECTED_ROW_NOT_FOUND" | "FANVUE_CONNECTION_STATUS_NOT_CONNECTED" | "FANVUE_TARGET_USER_MISMATCH" | "METHOD_NOT_ALLOWED" | "INVALID_BODY" | "INVALID_OPERATION" | "INVALID_CONFIRMATION" | "INVALID_PREFLIGHT" | "INVALID_TARGET_USER_ID" | "INVALID_SCOPE_CHECK_PROFILE" | "DANGEROUS_FIELD_FORBIDDEN" | "POSTS_ROUTE_STRING_FORBIDDEN" | "CREATORS_ROUTE_STRING_FORBIDDEN" | "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_NOT_CONFIGURED" | "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_REQUIRED" | "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_INVALID" | "UNAUTHENTICATED" | "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED" | "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_ALLOWLIST_INVALID" | "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_REQUIRED" | "FANVUE_SCOPE_POSTURE_ACCOUNT_LOOKUP_FAILED"

export type FanvueScopePostureDiagnosticRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: (request: Request) => Promise<string>
  loadAccounts: (userId: string) => Promise<FanvueScopePostureAccount[]>
}

const DANGEROUS_FIELDS = new Set(["token", "accessToken", "access_token", "refreshToken", "refresh_token", "secret", "authHeader", "auth_header", "authorization", "headers", "cookies", "providerResponse", "provider_response", "rawProviderResponse", "raw_provider_response", "providerBody", "provider_body", "creatorUserUuid", "creator_user_uuid", "creatorUuid", "creator_uuid", "uploadId", "upload_id", "uploadUuid", "upload_uuid", "mediaUuid", "media_uuid", "mediaUuids", "media_uuids", "signedUrl", "signed_url", "byteUploadOutput", "byte_upload_output", "postUuid", "post_uuid", "providerPostId", "provider_post_id", "dispatch", "schedule", "publishAt", "publish_at", "scheduleAt", "scheduledAt", "platformRegistry", "publicUI", "public_ui", "launchFacing", "launch_facing", "text", "caption"])
const POSTS_ROUTE_FRAGMENT = "/" + "posts"
const CREATORS_ROUTE_FRAGMENT = "/" + "creators"
const noLiveActionFlags = { will_decrypt_tokens: false, will_retry_refresh: false, will_call_fanvue: false, will_use_posts_route: false, will_use_creators_route: false, will_upload: false, will_create_post: false, will_read_post: false, will_dispatch: false, will_schedule: false, will_mutate_supabase: false, will_expose_public_ui: false, will_touch_platformRegistry: false, will_expose_launch_facing_fanvue: false, live_post_still_blocked: true } as const

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
function normalize(value: string | null | undefined) { return typeof value === "string" ? value.trim() : "" }
function safeEqual(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && crypto.timingSafeEqual(left, right) }
function normalizeAdminUserIds(value: FanvueScopePostureDiagnosticRouteDependencies["adminUserIds"]) { return (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []).map((entry) => String(entry).trim()).filter(Boolean) }

function baseBlocked(blockers: FanvueScopePostureBlocker[]) { return { ok: false as const, preflight: true as const, operation: FANVUE_SCOPE_POSTURE_DIAGNOSTIC_OPERATION, scope_check_performed: false as const, account_row_present: null, single_fanvue_connection: null, connection_status_connected: null, target_user_match: null, stored_scopes_present: null, stored_scopes_shape: null, stored_scopes_include_read_post: null, stored_scopes_include_write_post: null, stored_scopes_include_read_media: null, stored_scopes_include_write_media: null, stored_scopes_include_write_creator: null, ...noLiveActionFlags, safe_code: "FANVUE_SCOPE_POSTURE_CHECK_BLOCKED" as const, blockers } }
function success(flags: Record<string, boolean>) { return { ok: true as const, preflight: true as const, operation: FANVUE_SCOPE_POSTURE_DIAGNOSTIC_OPERATION, scope_check_performed: true as const, account_row_present: true as const, single_fanvue_connection: true as const, connection_status_connected: true as const, target_user_match: true as const, stored_scopes_present: true as const, stored_scopes_shape: "array_or_space_delimited_string" as const, stored_scopes_include_read_post: flags["read:post"], stored_scopes_include_write_post: flags["write:post"], stored_scopes_include_read_media: flags["read:media"], stored_scopes_include_write_media: flags["write:media"], stored_scopes_include_write_creator: flags["write:creator"], ...noLiveActionFlags, safe_code: "FANVUE_SCOPE_POSTURE_PREFLIGHT_OK_NO_DECRYPT_NO_PROVIDER_CALL" as const, blockers: [] as FanvueScopePostureBlocker[] } }

async function authorize(input: FanvueScopePostureDiagnosticRouteDependencies) {
  const expectedSecret = normalize(input.expectedSecret)
  if (!expectedSecret) return { ok: false as const, status: 500, blocker: "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_NOT_CONFIGURED" as const }
  const requestSecret = normalize(input.request.headers.get(FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_HEADER))
  if (!requestSecret) return { ok: false as const, status: 401, blocker: "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_REQUIRED" as const }
  if (requestSecret.includes(",") || !safeEqual(requestSecret, expectedSecret)) return { ok: false as const, status: 403, blocker: "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_SECRET_INVALID" as const }
  let authenticatedUserId = ""
  try { authenticatedUserId = normalize(await input.getAuthenticatedUserId(input.request)) } catch { return { ok: false as const, status: 401, blocker: "UNAUTHENTICATED" as const } }
  if (!authenticatedUserId) return { ok: false as const, status: 401, blocker: "UNAUTHENTICATED" as const }
  const adminUserIds = normalizeAdminUserIds(input.adminUserIds)
  if (adminUserIds.length === 0) return { ok: false as const, status: 500, blocker: "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED" as const }
  if (adminUserIds.some((id) => !UUID_RE.test(id))) return { ok: false as const, status: 500, blocker: "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_ALLOWLIST_INVALID" as const }
  if (!adminUserIds.includes(authenticatedUserId)) return { ok: false as const, status: 403, blocker: "FANVUE_SCOPE_POSTURE_DIAGNOSTIC_ADMIN_REQUIRED" as const }
  return { ok: true as const }
}

function validateDangerousInput(value: unknown): FanvueScopePostureBlocker | null {
  if (typeof value === "string") { if (value.includes(POSTS_ROUTE_FRAGMENT)) return "POSTS_ROUTE_STRING_FORBIDDEN"; if (value.includes(CREATORS_ROUTE_FRAGMENT)) return "CREATORS_ROUTE_STRING_FORBIDDEN" }
  if (Array.isArray(value)) for (const item of value) { const result = validateDangerousInput(item); if (result) return result }
  else if (isRecord(value)) for (const [key, nested] of Object.entries(value)) { if (DANGEROUS_FIELDS.has(key)) return "DANGEROUS_FIELD_FORBIDDEN"; const result = validateDangerousInput(nested); if (result) return result }
  return null
}
function validateBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, blocker: "INVALID_BODY" as const }
  const dangerous = validateDangerousInput(body); if (dangerous) return { ok: false as const, blocker: dangerous }
  if (body.operation !== FANVUE_SCOPE_POSTURE_DIAGNOSTIC_OPERATION) return { ok: false as const, blocker: "INVALID_OPERATION" as const }
  if (body.confirm !== FANVUE_SCOPE_POSTURE_DIAGNOSTIC_CONFIRMATION) return { ok: false as const, blocker: "INVALID_CONFIRMATION" as const }
  if (body.preflight !== true) return { ok: false as const, blocker: "INVALID_PREFLIGHT" as const }
  if (typeof body.user_id !== "string" || !UUID_RE.test(body.user_id.trim()) || body.user_id.trim() !== TARGET_USER_ID) return { ok: false as const, blocker: "INVALID_TARGET_USER_ID" as const }
  if (body.scope_check_profile !== SCOPE_CHECK_PROFILE) return { ok: false as const, blocker: "INVALID_SCOPE_CHECK_PROFILE" as const }
  return { ok: true as const, userId: body.user_id.trim() }
}
function parseScopes(scopes: unknown): { ok: true; scopes: Set<string> } | { ok: false; blocker: FanvueScopePostureBlocker } {
  if (scopes === null || scopes === undefined) return { ok: false, blocker: "FANVUE_STORED_SCOPES_MISSING" }
  if (typeof scopes === "string") { const parts = scopes.split(/\s+/).map((s) => s.trim()).filter(Boolean); return parts.length ? { ok: true, scopes: new Set(parts) } : { ok: false, blocker: "FANVUE_STORED_SCOPES_MISSING" } }
  if (Array.isArray(scopes)) { if (scopes.length === 0) return { ok: false, blocker: "FANVUE_STORED_SCOPES_MISSING" }; if (scopes.some((scope) => typeof scope !== "string" || !scope.trim())) return { ok: false, blocker: "FANVUE_STORED_SCOPES_UNEXPECTED_SHAPE" }; return { ok: true, scopes: new Set(scopes.map((scope) => scope.trim())) } }
  return { ok: false, blocker: "FANVUE_STORED_SCOPES_UNEXPECTED_SHAPE" }
}
function statusOf(account: FanvueScopePostureAccount) { return (typeof account.connection_status === "string" ? account.connection_status : typeof account.status === "string" ? account.status : "").trim().toLowerCase() }

export async function handleFanvueScopePostureDiagnosticRoute(dependencies: FanvueScopePostureDiagnosticRouteDependencies) {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: baseBlocked(["METHOD_NOT_ALLOWED"]) }
  const auth = await authorize(dependencies); if (!auth.ok) return { status: auth.status, body: baseBlocked([auth.blocker]) }
  const parsedBody = await dependencies.request.json().catch(() => null)
  const validation = validateBody(parsedBody); if (!validation.ok) return { status: 400, body: baseBlocked([validation.blocker]) }
  let rows: FanvueScopePostureAccount[]
  try { rows = await dependencies.loadAccounts(validation.userId) } catch { return { status: 500, body: baseBlocked(["FANVUE_SCOPE_POSTURE_ACCOUNT_LOOKUP_FAILED"]) } }
  if (rows.length === 0) return { status: 200, body: baseBlocked(["FANVUE_CONNECTED_ROW_NOT_FOUND"]) }
  if (rows.length > 1) return { status: 200, body: baseBlocked(["FANVUE_MULTIPLE_CONNECTION_ROWS_BLOCKED"]) }
  const account = rows[0]
  if (account.user_id !== validation.userId || account.platform !== "fanvue") return { status: 200, body: baseBlocked(["FANVUE_TARGET_USER_MISMATCH"]) }
  if (statusOf(account) !== "connected") return { status: 200, body: baseBlocked(["FANVUE_CONNECTION_STATUS_NOT_CONNECTED"]) }
  const parsed = parseScopes(account.scopes); if (parsed.ok === false) return { status: 200, body: baseBlocked([parsed.blocker]) }
  const flags = Object.fromEntries(["read:post", "write:post", "read:media", "write:media", "write:creator"].map((scope) => [scope, parsed.scopes.has(scope)])) as Record<string, boolean>
  const blockers: FanvueScopePostureBlocker[] = []
  if (!flags["read:post"]) blockers.push("FANVUE_READ_POST_SCOPE_MISSING")
  if (!flags["write:post"]) blockers.push("FANVUE_WRITE_POST_SCOPE_MISSING")
  if (blockers.length) return { status: 200, body: baseBlocked(blockers) }
  return { status: 200, body: success(flags) }
}
