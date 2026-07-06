import { authorizeFanvueMediaReadinessDiagnosticRequest, type FanvueMediaReadinessDiagnosticAuthErrorCode, type FanvueMediaReadinessDiagnosticAuthInput } from "./fanvueMediaReadinessDiagnosticAuth"
import {
  FANVUE_MEDIA_READINESS_DIAGNOSTIC_ASSET_PROFILE,
  FANVUE_MEDIA_READINESS_DIAGNOSTIC_CONFIRMATION,
  FANVUE_MEDIA_READINESS_DIAGNOSTIC_OPERATION,
  FANVUE_MEDIA_READINESS_DIAGNOSTIC_READINESS_PROFILE,
  runFanvueMediaReadinessDiagnostic,
  type FanvueMediaReadinessDiagnosticDependencies,
  type FanvueMediaReadinessDiagnosticResult,
} from "./fanvueMediaReadinessDiagnostic"
import type { FanvueUploadDiagnosticAccount } from "./fanvueUploadDiagnostic"

export type FanvueMediaReadinessDiagnosticRouteBody =
  | FanvueMediaReadinessDiagnosticResult
  | { ok: false; error_code: FanvueMediaReadinessDiagnosticAuthErrorCode }
  | { ok: false; error_code: "METHOD_NOT_ALLOWED" | "INVALID_BODY" | "INVALID_OPERATION" | "INVALID_CONFIRMATION" | "INVALID_TARGET_USER_ID" | "INVALID_ASSET_PROFILE" | "INVALID_READINESS_PROFILE" | "CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN" | "CALLER_SUPPLIED_UPLOAD_ID_FORBIDDEN" | "CALLER_SUPPLIED_MEDIA_UUID_FORBIDDEN" | "CALLER_SUPPLIED_SIGNED_URL_FORBIDDEN" | "CALLER_SUPPLIED_MEDIA_CONTENT_FORBIDDEN" | "POST_RELATED_FIELD_FORBIDDEN" }

export type FanvueMediaReadinessDiagnosticRouteResponse = { status: number; body: FanvueMediaReadinessDiagnosticRouteBody }

export type FanvueMediaReadinessDiagnosticRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: FanvueMediaReadinessDiagnosticAuthInput["getAuthenticatedUserId"]
  createLoadAccount: () => (userId: string) => Promise<FanvueUploadDiagnosticAccount | null>
  fetchIdentity: FanvueMediaReadinessDiagnosticDependencies["fetchIdentity"]
  fanvueFetch: FanvueMediaReadinessDiagnosticDependencies["fanvueFetch"]
  signedPartUploader: FanvueMediaReadinessDiagnosticDependencies["signedPartUploader"]
  apiBaseUrl: string
  apiVersion: string
  decryptAccessToken?: FanvueMediaReadinessDiagnosticDependencies["decryptAccessToken"]
  now?: FanvueMediaReadinessDiagnosticDependencies["now"]
  sleep?: FanvueMediaReadinessDiagnosticDependencies["sleep"]
  authorizeRequest?: typeof authorizeFanvueMediaReadinessDiagnosticRequest
  runDiagnostic?: typeof runFanvueMediaReadinessDiagnostic
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CREATOR_UUID_FIELDS = new Set(["creatorUserUuid", "creator_user_uuid"])
const UPLOAD_ID_FIELDS = new Set(["uploadId", "upload_id"])
const MEDIA_UUID_FIELDS = new Set(["mediaUuid", "media_uuid", "mediaUuids", "media_uuids"])
const SIGNED_URL_FIELDS = new Set(["signedUrl", "signed_url", "signedUploadUrl", "signed_upload_url"])
const MEDIA_CONTENT_FIELDS = new Set(["bytes", "body", "file", "files", "image", "media", "mediaContent", "media_content", "base64", "dataUri", "data_uri"])
const POST_RELATED_FIELDS = new Set(["caption", "text", "audience", "publishAt", "expiresAt", "collectionUuids", "mediaPreviewUuid", "post", "postUuid", "platform_post_id", "dispatch", "schedule", "scheduled", "public_exposure", "platform_registry"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validateBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, error_code: "INVALID_BODY" as const }
  for (const [key, value] of Object.entries(body)) {
    if (CREATOR_UUID_FIELDS.has(key)) return { ok: false as const, error_code: "CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN" as const }
    if (UPLOAD_ID_FIELDS.has(key)) return { ok: false as const, error_code: "CALLER_SUPPLIED_UPLOAD_ID_FORBIDDEN" as const }
    if (MEDIA_UUID_FIELDS.has(key)) return { ok: false as const, error_code: "CALLER_SUPPLIED_MEDIA_UUID_FORBIDDEN" as const }
    if (SIGNED_URL_FIELDS.has(key)) return { ok: false as const, error_code: "CALLER_SUPPLIED_SIGNED_URL_FORBIDDEN" as const }
    if (MEDIA_CONTENT_FIELDS.has(key)) return { ok: false as const, error_code: "CALLER_SUPPLIED_MEDIA_CONTENT_FORBIDDEN" as const }
    if (POST_RELATED_FIELDS.has(key)) return { ok: false as const, error_code: "POST_RELATED_FIELD_FORBIDDEN" as const }
    if (typeof value === "string" && /\/posts(?:\/|$)/i.test(value)) return { ok: false as const, error_code: "POST_RELATED_FIELD_FORBIDDEN" as const }
  }
  if (body.operation !== FANVUE_MEDIA_READINESS_DIAGNOSTIC_OPERATION) return { ok: false as const, error_code: "INVALID_OPERATION" as const }
  if (body.confirm !== FANVUE_MEDIA_READINESS_DIAGNOSTIC_CONFIRMATION) return { ok: false as const, error_code: "INVALID_CONFIRMATION" as const }
  if (body.asset_profile !== undefined && body.asset_profile !== FANVUE_MEDIA_READINESS_DIAGNOSTIC_ASSET_PROFILE) return { ok: false as const, error_code: "INVALID_ASSET_PROFILE" as const }
  if (body.readiness_profile !== undefined && body.readiness_profile !== FANVUE_MEDIA_READINESS_DIAGNOSTIC_READINESS_PROFILE) return { ok: false as const, error_code: "INVALID_READINESS_PROFILE" as const }
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : ""
  if (!UUID_RE.test(userId)) return { ok: false as const, error_code: "INVALID_TARGET_USER_ID" as const }
  return { ok: true as const, userId }
}

export async function handleFanvueMediaReadinessDiagnosticRoute(dependencies: FanvueMediaReadinessDiagnosticRouteDependencies): Promise<FanvueMediaReadinessDiagnosticRouteResponse> {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: { ok: false, error_code: "METHOD_NOT_ALLOWED" } }

  const authorizeRequest = dependencies.authorizeRequest ?? authorizeFanvueMediaReadinessDiagnosticRequest
  const auth = await authorizeRequest({ request: dependencies.request, expectedSecret: dependencies.expectedSecret, adminUserIds: dependencies.adminUserIds, getAuthenticatedUserId: dependencies.getAuthenticatedUserId })
  if (auth.ok === false) return { status: auth.status, body: { ok: false, error_code: auth.error_code } }

  const parsedBody = await dependencies.request.json().catch(() => null)
  const validation = validateBody(parsedBody)
  if (!validation.ok) return { status: 400, body: { ok: false, error_code: validation.error_code } }

  const runDiagnostic = dependencies.runDiagnostic ?? runFanvueMediaReadinessDiagnostic
  const result = await runDiagnostic(
    { userId: validation.userId },
    {
      loadAccount: dependencies.createLoadAccount(),
      fetchIdentity: dependencies.fetchIdentity,
      fanvueFetch: dependencies.fanvueFetch,
      signedPartUploader: dependencies.signedPartUploader,
      apiBaseUrl: dependencies.apiBaseUrl,
      apiVersion: dependencies.apiVersion,
      decryptAccessToken: dependencies.decryptAccessToken,
      now: dependencies.now,
      sleep: dependencies.sleep,
    },
  )
  return { status: 200, body: result }
}
