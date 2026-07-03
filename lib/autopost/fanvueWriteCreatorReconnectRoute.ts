import {
  authorizeFanvueWriteCreatorReconnectRequest,
  type FanvueWriteCreatorReconnectAuthErrorCode,
  type FanvueWriteCreatorReconnectAuthInput,
} from "@/lib/autopost/fanvueWriteCreatorReconnectAuth"

export const FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION = "REQUEST_FANVUE_WRITE_CREATOR_RECONNECT_ONLY_NO_UPLOAD_NO_POST" as const
export const FANVUE_WRITE_CREATOR_RECONNECT_OPERATION = "fanvue_write_creator_reconnect" as const
export const FANVUE_ADMIN_WRITE_CREATOR_RECONNECT_INITIATOR = "admin_write_creator_reconnect_start" as const
export const FANVUE_WRITE_CREATOR_SCOPE = "write:creator" as const
export const FANVUE_WRITE_CREATOR_RECONNECT_JSON_REDIRECT_MODE = "json_redirect" as const
export const FANVUE_WRITE_CREATOR_RECONNECT_REDIRECT_TYPE = "fanvue_write_creator_reconnect_redirect" as const
export const FANVUE_WRITE_CREATOR_RECONNECT_NEXT_STEP = "window.location.assign(redirect_url)" as const

export type FanvueWriteCreatorReconnectConfigStatus = {
  connect_enabled: boolean
  configured: boolean
  scopes: string[]
}

export type FanvueWriteCreatorReconnectSafeResponse = {
  operation: typeof FANVUE_WRITE_CREATOR_RECONNECT_OPERATION
  fanvue_connect_enabled: boolean
  oauth_config_valid: boolean
  requested_scopes_present: boolean
  requested_scopes_include_write_creator: boolean
  default_scopes_include_write_creator: boolean
  required_connection_scopes_include_write_creator: boolean
  fanvue_public_selectable: false
  fanvue_dispatch_enabled: false
  fanvue_scheduling_enabled: false
  confirmation_required: true
  operation_allowed_for_admin: boolean
  will_call_fanvue_before_redirect: false
  will_upload: false
  will_post: false
  will_dispatch: false
  will_schedule: false
}

export type FanvueWriteCreatorReconnectJsonRedirectResponse = FanvueWriteCreatorReconnectSafeResponse & {
  type: typeof FANVUE_WRITE_CREATOR_RECONNECT_REDIRECT_TYPE
  redirect_url: string
  next_step: typeof FANVUE_WRITE_CREATOR_RECONNECT_NEXT_STEP
}

type RouteErrorCode =
  | FanvueWriteCreatorReconnectAuthErrorCode
  | "FANVUE_WRITE_CREATOR_RECONNECT_OPERATION_INVALID"
  | "FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION_REQUIRED"
  | "FANVUE_WRITE_CREATOR_RECONNECT_SCOPE_NOT_REQUESTED"
  | "FANVUE_CONNECT_DISABLED"
  | "FANVUE_OAUTH_CONFIG_INCOMPLETE"

export type FanvueWriteCreatorReconnectRouteResponse =
  | { type: "json"; status: number; body: FanvueWriteCreatorReconnectSafeResponse }
  | { type: "json_redirect"; status: 200; body: FanvueWriteCreatorReconnectJsonRedirectResponse; cookieValue: string }
  | { type: "redirect"; status: 302; redirectUrl: URL; cookieValue: string }

export type FanvueWriteCreatorReconnectRouteDependencies = {
  request: Request
  expectedSecret: string | null | undefined
  adminUserIds: string[] | string | null | undefined
  getAuthenticatedUserId: FanvueWriteCreatorReconnectAuthInput["getAuthenticatedUserId"]
  authorizeRequest?: typeof authorizeFanvueWriteCreatorReconnectRequest
  createOAuthState: (userId: string, options: { operation: typeof FANVUE_WRITE_CREATOR_RECONNECT_OPERATION; initiatedFrom: typeof FANVUE_ADMIN_WRITE_CREATOR_RECONNECT_INITIATOR; adminReconnectAuthorized: true }) => { state: string; codeChallenge: string; cookieValue: string }
  buildAuthorizeUrl: (input: { state: string; codeChallenge: string }) => URL
  getConfigStatus: () => FanvueWriteCreatorReconnectConfigStatus
  defaultScopes: readonly string[]
  requiredConnectionScopes: readonly string[]
}

type RequestBody = {
  operation?: unknown
  confirm?: unknown
  start?: unknown
  response_mode?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function safeBody(body: unknown): RequestBody {
  return isRecord(body) ? body : {}
}

function hasWriteCreator(scopes: readonly string[]) {
  return scopes.includes(FANVUE_WRITE_CREATOR_SCOPE)
}

export function buildFanvueWriteCreatorReconnectPreflight(input: {
  adminAllowed: boolean
  getConfigStatus: () => FanvueWriteCreatorReconnectConfigStatus
  defaultScopes: readonly string[]
  requiredConnectionScopes: readonly string[]
}): FanvueWriteCreatorReconnectSafeResponse {
  const status = input.getConfigStatus()
  return {
    operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION,
    fanvue_connect_enabled: status.connect_enabled,
    oauth_config_valid: status.configured,
    requested_scopes_present: status.scopes.length > 0,
    requested_scopes_include_write_creator: hasWriteCreator(status.scopes),
    default_scopes_include_write_creator: hasWriteCreator(input.defaultScopes),
    required_connection_scopes_include_write_creator: hasWriteCreator(input.requiredConnectionScopes),
    fanvue_public_selectable: false,
    fanvue_dispatch_enabled: false,
    fanvue_scheduling_enabled: false,
    confirmation_required: true,
    operation_allowed_for_admin: input.adminAllowed,
    will_call_fanvue_before_redirect: false,
    will_upload: false,
    will_post: false,
    will_dispatch: false,
    will_schedule: false,
  }
}

function blocked(status: number, _error_code: RouteErrorCode, preflight: FanvueWriteCreatorReconnectSafeResponse): FanvueWriteCreatorReconnectRouteResponse {
  return { type: "json", status, body: preflight }
}

export async function handleFanvueWriteCreatorReconnectRoute(
  dependencies: FanvueWriteCreatorReconnectRouteDependencies,
): Promise<FanvueWriteCreatorReconnectRouteResponse> {
  const authorizeRequest = dependencies.authorizeRequest ?? authorizeFanvueWriteCreatorReconnectRequest
  const auth = await authorizeRequest({
    request: dependencies.request,
    expectedSecret: dependencies.expectedSecret,
    adminUserIds: dependencies.adminUserIds,
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
  })

  const preAuthPreflight = buildFanvueWriteCreatorReconnectPreflight({
    adminAllowed: false,
    getConfigStatus: dependencies.getConfigStatus,
    defaultScopes: dependencies.defaultScopes,
    requiredConnectionScopes: dependencies.requiredConnectionScopes,
  })
  if (auth.ok === false) return blocked(auth.status, auth.error_code, preAuthPreflight)

  const body = safeBody(await dependencies.request.json().catch(() => null))
  const preflight = buildFanvueWriteCreatorReconnectPreflight({
    adminAllowed: true,
    getConfigStatus: dependencies.getConfigStatus,
    defaultScopes: dependencies.defaultScopes,
    requiredConnectionScopes: dependencies.requiredConnectionScopes,
  })

  if (body.operation !== FANVUE_WRITE_CREATOR_RECONNECT_OPERATION) return blocked(400, "FANVUE_WRITE_CREATOR_RECONNECT_OPERATION_INVALID", preflight)
  if (body.confirm !== FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION) return blocked(400, "FANVUE_WRITE_CREATOR_RECONNECT_CONFIRMATION_REQUIRED", preflight)
  if (!preflight.fanvue_connect_enabled) return blocked(403, "FANVUE_CONNECT_DISABLED", preflight)
  if (!preflight.oauth_config_valid) return blocked(500, "FANVUE_OAUTH_CONFIG_INCOMPLETE", preflight)
  if (!preflight.requested_scopes_include_write_creator) return blocked(400, "FANVUE_WRITE_CREATOR_RECONNECT_SCOPE_NOT_REQUESTED", preflight)

  if (body.start !== true) return { type: "json", status: 200, body: preflight }

  const oauthState = dependencies.createOAuthState(auth.adminUserId, {
    operation: FANVUE_WRITE_CREATOR_RECONNECT_OPERATION,
    initiatedFrom: FANVUE_ADMIN_WRITE_CREATOR_RECONNECT_INITIATOR,
    adminReconnectAuthorized: true,
  })
  const redirectUrl = dependencies.buildAuthorizeUrl({ state: oauthState.state, codeChallenge: oauthState.codeChallenge })

  if (body.response_mode === FANVUE_WRITE_CREATOR_RECONNECT_JSON_REDIRECT_MODE) {
    return {
      type: "json_redirect",
      status: 200,
      cookieValue: oauthState.cookieValue,
      body: {
        ...preflight,
        type: FANVUE_WRITE_CREATOR_RECONNECT_REDIRECT_TYPE,
        redirect_url: redirectUrl.toString(),
        next_step: FANVUE_WRITE_CREATOR_RECONNECT_NEXT_STEP,
      },
    }
  }

  return { type: "redirect", status: 302, redirectUrl, cookieValue: oauthState.cookieValue }
}
