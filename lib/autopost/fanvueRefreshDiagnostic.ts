import type { FanvueRefreshAccount, FanvueTokenRefreshResult } from "@/lib/autopost/fanvueTokenRefresh"

export const FANVUE_REFRESH_DIAGNOSTIC_GATE = "FV-40AR" as const
export const FANVUE_REFRESH_DIAGNOSTIC_MODE = "fanvue_refresh_only_diagnostic" as const

type FanvueRefreshDiagnosticBase = {
  gate: typeof FANVUE_REFRESH_DIAGNOSTIC_GATE
  mode: typeof FANVUE_REFRESH_DIAGNOSTIC_MODE
  posted_proof: false
  platform_post_id: null
  upload_attempted: false
  media_upload_create_attempted: false
  signed_upload_url_attempted: false
  byte_upload_attempted: false
  media_finalize_attempted: false
  media_lookup_attempted: false
  post_attempted: false
  dispatch_attempted: false
  scheduled: false
  stop_reason: string
}

export type FanvueRefreshDiagnosticAccount = {
  user_id: string
  platform: string
  connection_status?: string | null
  provider_account_id?: string | null
  metadata?: Record<string, unknown> | null
  encrypted_refresh_token: string | null
  token_expires_at?: string | null
  token_type?: string | null
  token_key_version?: number | null
  last_refresh_at?: string | null
  scopes?: string[] | string | null
}

export type FanvueRefreshDiagnosticResult = FanvueRefreshDiagnosticBase & {
  ok: boolean
  refresh_layer_reached: boolean
  refresh_ok: boolean
  safe_code: string
  safe_error_message?: string
  requires_oauth_reconnect: boolean
  provider_calls_attempted: boolean
  provider_response_present: boolean | null
  provider_status: number | null
  provider_status_class: string | null
  provider_error_code: string | null
}

export type FanvueRefreshDiagnosticDependencies = {
  loadAccount: (userId: string) => Promise<FanvueRefreshDiagnosticAccount | null>
  refreshAccessToken: (account: FanvueRefreshAccount) => Promise<FanvueTokenRefreshResult>
}

export type FanvueRefreshDiagnosticInput = {
  userId: string
}

const uploadNegativeFlags = {
  posted_proof: false,
  platform_post_id: null,
  upload_attempted: false,
  media_upload_create_attempted: false,
  signed_upload_url_attempted: false,
  byte_upload_attempted: false,
  media_finalize_attempted: false,
  media_lookup_attempted: false,
  post_attempted: false,
  dispatch_attempted: false,
  scheduled: false,
} as const

function diagnosticBase(stopReason: string): FanvueRefreshDiagnosticBase {
  return {
    gate: FANVUE_REFRESH_DIAGNOSTIC_GATE,
    mode: FANVUE_REFRESH_DIAGNOSTIC_MODE,
    ...uploadNegativeFlags,
    stop_reason: stopReason,
  }
}

function safeFailure(input: {
  safeCode: string
  safeErrorMessage: string
  refreshLayerReached: boolean
  stopReason: string
  requiresOauthReconnect?: boolean
  providerCallsAttempted?: boolean
  providerResponsePresent?: boolean | null
  providerStatus?: number | null
  providerStatusClass?: string | null
  providerErrorCode?: string | null
}): FanvueRefreshDiagnosticResult {
  return {
    ...diagnosticBase(input.stopReason),
    ok: false,
    refresh_layer_reached: input.refreshLayerReached,
    refresh_ok: false,
    safe_code: input.safeCode,
    safe_error_message: input.safeErrorMessage,
    requires_oauth_reconnect: input.requiresOauthReconnect ?? false,
    provider_calls_attempted: input.providerCallsAttempted ?? false,
    provider_response_present: input.providerResponsePresent ?? false,
    provider_status: input.providerStatus ?? null,
    provider_status_class: input.providerStatusClass ?? null,
    provider_error_code: input.providerErrorCode ?? null,
  }
}

function hasNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

function sanitizeDiagnosticMessage(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return "Fanvue refresh diagnostic failed safely."
  if (/access[_ -]?token|refresh[_ -]?token|encrypted|client[_ -]?secret|raw provider body|error_description|signed upload|authorization|bearer/i.test(trimmed)) {
    return "Fanvue refresh diagnostic failed safely."
  }
  return trimmed
}

function mapRefreshFailure(result: Extract<FanvueTokenRefreshResult, { ok: false }>): FanvueRefreshDiagnosticResult {
  const invalidGrant = result.error_code === "FANVUE_REFRESH_INVALID_GRANT_REAUTH_REQUIRED"
  return safeFailure({
    safeCode: result.error_code,
    safeErrorMessage: sanitizeDiagnosticMessage(result.safe_error_message),
    refreshLayerReached: result.provider_calls_attempted,
    stopReason: invalidGrant
      ? "STOPPED_AFTER_REFRESH_INVALID_GRANT_UPLOAD_NOT_ATTEMPTED"
      : result.provider_calls_attempted
        ? "STOPPED_AFTER_REFRESH_FAILURE_UPLOAD_NOT_ATTEMPTED"
        : "STOPPED_BEFORE_REFRESH_FAILURE_UPLOAD_NOT_ATTEMPTED",
    requiresOauthReconnect: invalidGrant ? true : result.requires_oauth_reconnect === true,
    providerCallsAttempted: result.provider_calls_attempted,
    providerResponsePresent: result.provider_response_present ?? (result.provider_calls_attempted ? null : false),
    providerStatus: result.provider_status ?? null,
    providerStatusClass: result.provider_status_class ?? null,
    providerErrorCode: result.provider_error_code ?? null,
  })
}

export async function runFanvueRefreshOnlyDiagnostic(
  input: FanvueRefreshDiagnosticInput,
  dependencies: FanvueRefreshDiagnosticDependencies,
): Promise<FanvueRefreshDiagnosticResult> {
  let account: FanvueRefreshDiagnosticAccount | null
  try {
    account = await dependencies.loadAccount(input.userId)
  } catch {
    return safeFailure({
      safeCode: "FANVUE_CONNECTION_LOOKUP_FAILED",
      safeErrorMessage: "Fanvue account lookup failed safely.",
      refreshLayerReached: false,
      stopReason: "STOPPED_BEFORE_REFRESH_CONNECTION_LOOKUP_FAILED",
    })
  }

  if (!account) {
    return safeFailure({
      safeCode: "FANVUE_CONNECTION_NOT_FOUND",
      safeErrorMessage: "Fanvue account row was not found.",
      refreshLayerReached: false,
      stopReason: "STOPPED_BEFORE_REFRESH_NO_CONNECTION",
    })
  }

  if (account.platform !== "fanvue") {
    return safeFailure({
      safeCode: "FANVUE_ACCOUNT_PLATFORM_INVALID",
      safeErrorMessage: "Fanvue refresh diagnostic requires a Fanvue account.",
      refreshLayerReached: false,
      stopReason: "STOPPED_BEFORE_REFRESH_PLATFORM_INVALID",
    })
  }

  if (account.connection_status && account.connection_status !== "CONNECTED") {
    return safeFailure({
      safeCode: "FANVUE_ACCOUNT_NOT_CONNECTED",
      safeErrorMessage: "Fanvue account must be connected before refresh diagnostic.",
      refreshLayerReached: false,
      stopReason: "STOPPED_BEFORE_REFRESH_ACCOUNT_NOT_CONNECTED",
    })
  }

  if (!hasNonEmptyString(account.encrypted_refresh_token)) {
    return safeFailure({
      safeCode: "FANVUE_REFRESH_TOKEN_MISSING",
      safeErrorMessage: "Fanvue refresh credential is missing.",
      refreshLayerReached: false,
      stopReason: "STOPPED_BEFORE_REFRESH_TOKEN_MISSING",
    })
  }

  const refreshAccount: FanvueRefreshAccount = {
    user_id: account.user_id,
    platform: account.platform,
    encrypted_refresh_token: account.encrypted_refresh_token,
    token_expires_at: account.token_expires_at ?? null,
    token_type: account.token_type ?? null,
    token_key_version: account.token_key_version ?? null,
    scopes: account.scopes ?? null,
  }

  const refreshResult = await dependencies.refreshAccessToken(refreshAccount)
  if (refreshResult.ok) {
    return {
      ...diagnosticBase("STOPPED_AFTER_REFRESH_SUCCESS_UPLOAD_NOT_ATTEMPTED"),
      ok: true,
      refresh_layer_reached: true,
      refresh_ok: true,
      safe_code: "FANVUE_REFRESH_OK",
      requires_oauth_reconnect: false,
      provider_calls_attempted: true,
      provider_response_present: null,
      provider_status: null,
      provider_status_class: null,
      provider_error_code: null,
    }
  }

  return mapRefreshFailure(refreshResult as Extract<FanvueTokenRefreshResult, { ok: false }>)
}
