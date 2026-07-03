import crypto from "crypto"

export const FANVUE_WRITE_CREATOR_RECONNECT_SECRET_HEADER = "x-fanvue-write-creator-reconnect-secret" as const

export type FanvueWriteCreatorReconnectAuthErrorCode =
  | "FANVUE_WRITE_CREATOR_RECONNECT_SECRET_NOT_CONFIGURED"
  | "FANVUE_WRITE_CREATOR_RECONNECT_SECRET_REQUIRED"
  | "FANVUE_WRITE_CREATOR_RECONNECT_SECRET_INVALID"
  | "UNAUTHENTICATED"
  | "FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_ALLOWLIST_NOT_CONFIGURED"
  | "FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_REQUIRED"

export type FanvueWriteCreatorReconnectAuthInput = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: (request: Request) => Promise<string>
}

export type FanvueWriteCreatorReconnectAuthResult =
  | { ok: true; status: 200; adminUserId: string }
  | { ok: false; status: 401 | 403 | 500; error_code: FanvueWriteCreatorReconnectAuthErrorCode }

function denied(status: 401 | 403 | 500, errorCode: FanvueWriteCreatorReconnectAuthErrorCode): FanvueWriteCreatorReconnectAuthResult {
  return { ok: false, status, error_code: errorCode }
}

function normalize(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function normalizeAdminUserIds(value: FanvueWriteCreatorReconnectAuthInput["adminUserIds"]) {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  return rawValues.map((entry) => String(entry).trim()).filter(Boolean)
}

export async function authorizeFanvueWriteCreatorReconnectRequest(
  input: FanvueWriteCreatorReconnectAuthInput,
): Promise<FanvueWriteCreatorReconnectAuthResult> {
  const expectedSecret = normalize(input.expectedSecret)
  if (!expectedSecret) return denied(500, "FANVUE_WRITE_CREATOR_RECONNECT_SECRET_NOT_CONFIGURED")

  const requestSecret = normalize(input.request.headers.get(FANVUE_WRITE_CREATOR_RECONNECT_SECRET_HEADER))
  if (!requestSecret) return denied(401, "FANVUE_WRITE_CREATOR_RECONNECT_SECRET_REQUIRED")
  if (!safeEqual(requestSecret, expectedSecret)) return denied(403, "FANVUE_WRITE_CREATOR_RECONNECT_SECRET_INVALID")

  let authenticatedUserId = ""
  try {
    authenticatedUserId = normalize(await input.getAuthenticatedUserId(input.request))
  } catch {
    return denied(401, "UNAUTHENTICATED")
  }
  if (!authenticatedUserId) return denied(401, "UNAUTHENTICATED")

  const adminUserIds = normalizeAdminUserIds(input.adminUserIds)
  if (adminUserIds.length === 0) return denied(500, "FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_ALLOWLIST_NOT_CONFIGURED")
  if (!adminUserIds.includes(authenticatedUserId)) return denied(403, "FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_REQUIRED")

  return { ok: true, status: 200, adminUserId: authenticatedUserId }
}
