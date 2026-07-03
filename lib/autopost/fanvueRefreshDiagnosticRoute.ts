import {
  authorizeFanvueRefreshDiagnosticRequest,
  type FanvueRefreshDiagnosticAuthErrorCode,
  type FanvueRefreshDiagnosticAuthInput,
} from "@/lib/autopost/fanvueRefreshDiagnosticAuth"
import {
  runFanvueRefreshOnlyDiagnostic,
  type FanvueRefreshDiagnosticAccount,
  type FanvueRefreshDiagnosticResult,
} from "@/lib/autopost/fanvueRefreshDiagnostic"
import type { FanvueRefreshAccount, FanvueTokenRefreshResult } from "@/lib/autopost/fanvueTokenRefresh"

export type FanvueRefreshDiagnosticRouteResponse = {
  status: number
  body: FanvueRefreshDiagnosticRouteBody
}

type FanvueRefreshDiagnosticRouteBody =
  | FanvueRefreshDiagnosticResult
  | {
      ok: false
      error_code: FanvueRefreshDiagnosticAuthErrorCode
    }
  | {
      ok: false
      error_code: "INVALID_TARGET_USER_ID"
    }

export type FanvueRefreshDiagnosticRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: FanvueRefreshDiagnosticAuthInput["getAuthenticatedUserId"]
  createLoadAccount: () => (userId: string) => Promise<FanvueRefreshDiagnosticAccount | null>
  getRefreshAccessToken: () => (account: FanvueRefreshAccount) => Promise<FanvueTokenRefreshResult>
  authorizeRequest?: typeof authorizeFanvueRefreshDiagnosticRequest
  runDiagnostic?: typeof runFanvueRefreshOnlyDiagnostic
}

const TARGET_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function parseFanvueRefreshDiagnosticTargetUserId(body: unknown) {
  if (!isRecord(body)) return null
  const userId = body.user_id
  if (typeof userId !== "string") return null
  const trimmed = userId.trim()
  return TARGET_USER_ID_PATTERN.test(trimmed) ? trimmed : null
}

export async function handleFanvueRefreshDiagnosticRoute(
  dependencies: FanvueRefreshDiagnosticRouteDependencies,
): Promise<FanvueRefreshDiagnosticRouteResponse> {
  const authorizeRequest = dependencies.authorizeRequest ?? authorizeFanvueRefreshDiagnosticRequest
  const auth = await authorizeRequest({
    request: dependencies.request,
    expectedSecret: dependencies.expectedSecret,
    adminUserIds: dependencies.adminUserIds,
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
  })

  if (auth.ok === false) {
    return {
      status: auth.status,
      body: { ok: false, error_code: auth.error_code },
    }
  }

  const body = await dependencies.request.json().catch(() => null)
  const targetUserId = parseFanvueRefreshDiagnosticTargetUserId(body)
  if (!targetUserId) {
    return {
      status: 400,
      body: { ok: false, error_code: "INVALID_TARGET_USER_ID" },
    }
  }

  const loadAccount = dependencies.createLoadAccount()
  const refreshAccessToken = dependencies.getRefreshAccessToken()
  const runDiagnostic = dependencies.runDiagnostic ?? runFanvueRefreshOnlyDiagnostic
  const result = await runDiagnostic(
    { userId: targetUserId },
    {
      loadAccount,
      refreshAccessToken,
    },
  )

  return { status: 200, body: result }
}
