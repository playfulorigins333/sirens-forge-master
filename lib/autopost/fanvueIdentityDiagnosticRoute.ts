import crypto from "crypto"
import {
  FANVUE_IDENTITY_DIAGNOSTIC_MODE,
  runFanvueIdentityOnlyDiagnostic,
  type FanvueIdentityDiagnosticAccount,
  type FanvueIdentityDiagnosticDependencies,
  type FanvueIdentityDiagnosticResult,
} from "./fanvueIdentityDiagnostic"

export const FANVUE_IDENTITY_DIAGNOSTIC_SECRET_HEADER = "x-fanvue-identity-diagnostic-secret" as const

export type FanvueIdentityDiagnosticAuthErrorCode =
  | "FANVUE_IDENTITY_DIAGNOSTIC_SECRET_NOT_CONFIGURED"
  | "FANVUE_IDENTITY_DIAGNOSTIC_SECRET_REQUIRED"
  | "FANVUE_IDENTITY_DIAGNOSTIC_SECRET_INVALID"
  | "UNAUTHENTICATED"
  | "FANVUE_IDENTITY_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED"
  | "FANVUE_IDENTITY_DIAGNOSTIC_ADMIN_REQUIRED"

export type FanvueIdentityDiagnosticRouteBody =
  | FanvueIdentityDiagnosticResult
  | { ok: false; error_code: FanvueIdentityDiagnosticAuthErrorCode }
  | { ok: false; error_code: "INVALID_TARGET_USER_ID" }

export type FanvueIdentityDiagnosticRouteResponse = {
  status: number
  body: FanvueIdentityDiagnosticRouteBody
}

export type FanvueIdentityDiagnosticRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: (request: Request) => Promise<string>
  createLoadAccount: () => (userId: string) => Promise<FanvueIdentityDiagnosticAccount | null>
  fetchIdentity: FanvueIdentityDiagnosticDependencies["fetchIdentity"]
  apiBaseUrl: string
  apiVersion: string
  decryptAccessToken?: FanvueIdentityDiagnosticDependencies["decryptAccessToken"]
  now?: FanvueIdentityDiagnosticDependencies["now"]
  runDiagnostic?: typeof runFanvueIdentityOnlyDiagnostic
}

const TARGET_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalize(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function safeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue)
  const right = Buffer.from(rightValue)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function normalizeAdminUserIds(value: FanvueIdentityDiagnosticRouteDependencies["adminUserIds"]) {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  return rawValues.map((entry) => String(entry).trim()).filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function parseFanvueIdentityDiagnosticTargetUserId(body: unknown) {
  if (!isRecord(body)) return null
  const userId = body.user_id
  if (typeof userId !== "string") return null
  const trimmed = userId.trim()
  return TARGET_USER_ID_PATTERN.test(trimmed) ? trimmed : null
}

async function authorizeIdentityDiagnosticRequest(dependencies: Pick<FanvueIdentityDiagnosticRouteDependencies, "request" | "expectedSecret" | "adminUserIds" | "getAuthenticatedUserId">) {
  const expectedSecret = normalize(dependencies.expectedSecret)
  if (!expectedSecret) return { ok: false as const, status: 500 as const, error_code: "FANVUE_IDENTITY_DIAGNOSTIC_SECRET_NOT_CONFIGURED" as const }

  const requestSecret = normalize(dependencies.request.headers.get(FANVUE_IDENTITY_DIAGNOSTIC_SECRET_HEADER))
  if (!requestSecret) return { ok: false as const, status: 401 as const, error_code: "FANVUE_IDENTITY_DIAGNOSTIC_SECRET_REQUIRED" as const }
  if (!safeEqual(requestSecret, expectedSecret)) return { ok: false as const, status: 403 as const, error_code: "FANVUE_IDENTITY_DIAGNOSTIC_SECRET_INVALID" as const }

  let authenticatedUserId = ""
  try {
    authenticatedUserId = normalize(await dependencies.getAuthenticatedUserId(dependencies.request))
  } catch {
    return { ok: false as const, status: 401 as const, error_code: "UNAUTHENTICATED" as const }
  }
  if (!authenticatedUserId) return { ok: false as const, status: 401 as const, error_code: "UNAUTHENTICATED" as const }

  const adminUserIds = normalizeAdminUserIds(dependencies.adminUserIds)
  if (adminUserIds.length === 0) return { ok: false as const, status: 500 as const, error_code: "FANVUE_IDENTITY_DIAGNOSTIC_ADMIN_ALLOWLIST_NOT_CONFIGURED" as const }
  if (!adminUserIds.includes(authenticatedUserId)) return { ok: false as const, status: 403 as const, error_code: "FANVUE_IDENTITY_DIAGNOSTIC_ADMIN_REQUIRED" as const }

  return { ok: true as const, status: 200 as const, adminUserId: authenticatedUserId }
}

export async function handleFanvueIdentityDiagnosticRoute(
  dependencies: FanvueIdentityDiagnosticRouteDependencies,
): Promise<FanvueIdentityDiagnosticRouteResponse> {
  const auth = await authorizeIdentityDiagnosticRequest(dependencies)
  if (auth.ok === false) return { status: auth.status, body: { ok: false, error_code: auth.error_code } }

  const body = await dependencies.request.json().catch(() => null)
  const targetUserId = parseFanvueIdentityDiagnosticTargetUserId(body)
  if (!targetUserId) return { status: 400, body: { ok: false, error_code: "INVALID_TARGET_USER_ID" } }

  const runDiagnostic = dependencies.runDiagnostic ?? runFanvueIdentityOnlyDiagnostic
  const loadAccount = dependencies.createLoadAccount()
  const result = await runDiagnostic(
    { userId: targetUserId },
    {
      loadAccount,
      fetchIdentity: dependencies.fetchIdentity,
      apiBaseUrl: dependencies.apiBaseUrl,
      apiVersion: dependencies.apiVersion,
      decryptAccessToken: dependencies.decryptAccessToken,
      now: dependencies.now,
    },
  )

  return { status: 200, body: { ...result, mode: FANVUE_IDENTITY_DIAGNOSTIC_MODE } }
}
