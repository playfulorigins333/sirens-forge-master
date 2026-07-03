import crypto from "crypto"

export const FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER = "x-fanvue-upload-diagnostic-secret" as const

export type FanvueUploadDiagnosticAuthErrorCode =
  | "FANVUE_UPLOAD_DIAGNOSTIC_SECRET_NOT_CONFIGURED"
  | "FANVUE_UPLOAD_DIAGNOSTIC_SECRET_REQUIRED"
  | "FANVUE_UPLOAD_DIAGNOSTIC_SECRET_INVALID"
  | "UNAUTHENTICATED"
  | "FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED"
  | "FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED"

export type FanvueUploadDiagnosticAuthInput = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: (request: Request) => Promise<string>
}

export type FanvueUploadDiagnosticAuthResult =
  | { ok: true; status: 200; adminUserId: string }
  | { ok: false; status: 401 | 403 | 500; error_code: FanvueUploadDiagnosticAuthErrorCode }

function denied(status: 401 | 403 | 500, errorCode: FanvueUploadDiagnosticAuthErrorCode): FanvueUploadDiagnosticAuthResult {
  return { ok: false, status, error_code: errorCode }
}

function normalize(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function normalizeAdminUserIds(value: FanvueUploadDiagnosticAuthInput["adminUserIds"]) {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  return rawValues.map((entry) => String(entry).trim()).filter(Boolean)
}

export async function authorizeFanvueUploadDiagnosticRequest(input: FanvueUploadDiagnosticAuthInput): Promise<FanvueUploadDiagnosticAuthResult> {
  const expectedSecret = normalize(input.expectedSecret)
  if (!expectedSecret) return denied(500, "FANVUE_UPLOAD_DIAGNOSTIC_SECRET_NOT_CONFIGURED")

  const requestSecret = normalize(input.request.headers.get(FANVUE_UPLOAD_DIAGNOSTIC_SECRET_HEADER))
  if (!requestSecret) return denied(401, "FANVUE_UPLOAD_DIAGNOSTIC_SECRET_REQUIRED")
  if (!safeEqual(requestSecret, expectedSecret)) return denied(403, "FANVUE_UPLOAD_DIAGNOSTIC_SECRET_INVALID")

  let authenticatedUserId = ""
  try {
    authenticatedUserId = normalize(await input.getAuthenticatedUserId(input.request))
  } catch {
    return denied(401, "UNAUTHENTICATED")
  }
  if (!authenticatedUserId) return denied(401, "UNAUTHENTICATED")

  const adminUserIds = normalizeAdminUserIds(input.adminUserIds)
  if (adminUserIds.length === 0) return denied(500, "FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED")
  if (!adminUserIds.includes(authenticatedUserId)) return denied(403, "FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_REQUIRED")

  return { ok: true, status: 200, adminUserId: authenticatedUserId }
}
