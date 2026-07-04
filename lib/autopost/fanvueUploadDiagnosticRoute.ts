import { authorizeFanvueUploadDiagnosticRequest, type FanvueUploadDiagnosticAuthErrorCode, type FanvueUploadDiagnosticAuthInput } from "./fanvueUploadDiagnosticAuth"
import {
  FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION,
  FANVUE_UPLOAD_DIAGNOSTIC_OPERATION,
  FANVUE_UPLOAD_DIAGNOSTIC_PREFLIGHT_CONFIRMATION,
  runFanvueUploadDiagnostic,
  runFanvueUploadDiagnosticPreflight,
  type FanvueUploadDiagnosticAccount,
  type FanvueUploadDiagnosticDependencies,
  type FanvueUploadDiagnosticPreflightResult,
  type FanvueUploadDiagnosticResult,
} from "./fanvueUploadDiagnostic"

export type FanvueUploadDiagnosticRouteBody =
  | FanvueUploadDiagnosticResult
  | FanvueUploadDiagnosticPreflightResult
  | { ok: false; error_code: FanvueUploadDiagnosticAuthErrorCode }
  | { ok: false; error_code: "METHOD_NOT_ALLOWED" | "INVALID_BODY" | "INVALID_OPERATION" | "INVALID_CONFIRMATION" | "INVALID_TARGET_USER_ID" | "CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN" | "POST_RELATED_FIELD_FORBIDDEN" }

export type FanvueUploadDiagnosticRouteResponse = { status: number; body: FanvueUploadDiagnosticRouteBody }

export type FanvueUploadDiagnosticRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: FanvueUploadDiagnosticAuthInput["getAuthenticatedUserId"]
  createLoadAccount: () => (userId: string) => Promise<FanvueUploadDiagnosticAccount | null>
  fetchIdentity: FanvueUploadDiagnosticDependencies["fetchIdentity"]
  fanvueFetch: FanvueUploadDiagnosticDependencies["fanvueFetch"]
  signedPartUploader: FanvueUploadDiagnosticDependencies["signedPartUploader"]
  apiBaseUrl: string
  apiVersion: string
  decryptAccessToken?: FanvueUploadDiagnosticDependencies["decryptAccessToken"]
  now?: FanvueUploadDiagnosticDependencies["now"]
  waitForMediaReady?: FanvueUploadDiagnosticDependencies["waitForMediaReady"]
  authorizeRequest?: typeof authorizeFanvueUploadDiagnosticRequest
  runDiagnostic?: typeof runFanvueUploadDiagnostic
  runPreflight?: typeof runFanvueUploadDiagnosticPreflight
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FORBIDDEN_FIELDS = new Set(["creatorUserUuid", "creator_user_uuid", "caption", "text", "audience", "publishAt", "expiresAt", "collectionUuids", "mediaPreviewUuid", "post", "postUuid", "platform_post_id", "dispatch", "schedule", "scheduled", "public_exposure", "platform_registry"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validateBody(body: unknown) {
  if (!isRecord(body)) return { ok: false as const, error_code: "INVALID_BODY" as const }
  for (const [key, value] of Object.entries(body)) {
    if (FORBIDDEN_FIELDS.has(key)) return { ok: false as const, error_code: key === "creatorUserUuid" || key === "creator_user_uuid" ? "CALLER_SUPPLIED_CREATOR_UUID_FORBIDDEN" as const : "POST_RELATED_FIELD_FORBIDDEN" as const }
    if (typeof value === "string" && /\/posts(?:\/|$)/i.test(value)) return { ok: false as const, error_code: "POST_RELATED_FIELD_FORBIDDEN" as const }
  }
  if (body.operation !== FANVUE_UPLOAD_DIAGNOSTIC_OPERATION) return { ok: false as const, error_code: "INVALID_OPERATION" as const }
  const preflight = body.preflight === true
  const expectedConfirmation = preflight ? FANVUE_UPLOAD_DIAGNOSTIC_PREFLIGHT_CONFIRMATION : FANVUE_UPLOAD_DIAGNOSTIC_CONFIRMATION
  if (body.confirm !== expectedConfirmation) return { ok: false as const, error_code: "INVALID_CONFIRMATION" as const }
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : ""
  if (!UUID_RE.test(userId)) return { ok: false as const, error_code: "INVALID_TARGET_USER_ID" as const }
  return { ok: true as const, userId, preflight }
}

export async function handleFanvueUploadDiagnosticRoute(dependencies: FanvueUploadDiagnosticRouteDependencies): Promise<FanvueUploadDiagnosticRouteResponse> {
  if (dependencies.request.method.toUpperCase() !== "POST") return { status: 405, body: { ok: false, error_code: "METHOD_NOT_ALLOWED" } }

  const authorizeRequest = dependencies.authorizeRequest ?? authorizeFanvueUploadDiagnosticRequest
  const auth = await authorizeRequest({ request: dependencies.request, expectedSecret: dependencies.expectedSecret, adminUserIds: dependencies.adminUserIds, getAuthenticatedUserId: dependencies.getAuthenticatedUserId })
  if (auth.ok === false) return { status: auth.status, body: { ok: false, error_code: auth.error_code } }

  const parsedBody = await dependencies.request.json().catch(() => null)
  const validation = validateBody(parsedBody)
  if (!validation.ok) return { status: 400, body: { ok: false, error_code: validation.error_code } }

  if (validation.preflight) {
    const runPreflight = dependencies.runPreflight ?? runFanvueUploadDiagnosticPreflight
    const result = await runPreflight({ userId: validation.userId }, { loadAccount: dependencies.createLoadAccount(), now: dependencies.now })
    return { status: 200, body: result }
  }

  const runDiagnostic = dependencies.runDiagnostic ?? runFanvueUploadDiagnostic
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
      waitForMediaReady: dependencies.waitForMediaReady,
    },
  )
  return { status: 200, body: result }
}
