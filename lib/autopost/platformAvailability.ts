import type { PlatformId } from "./types"
import type { AutopostPlatformRegistryEntry } from "./platformRegistry"
import { getFanvueOAuthConfigStatus } from "./fanvueOAuth"

export type AutopostAccountStatus = {
  platform: PlatformId
  provider_account_id: string | null
  provider_username: string | null
  connection_status: string | null
  connected_at: string | null
  last_refresh_at: string | null
  last_error: string | null
  encrypted_access_token?: string | null
  encrypted_refresh_token?: string | null
  metadata?: Record<string, unknown> | null
}

export type UserAutopostPlatformStatus = ReturnType<typeof buildUserPlatformStatus>

const X_SCHEDULING_BLOCKERS = [
  "X_ENVIRONMENT_VERIFICATION_REQUIRED",
  "X_INITIAL_OAUTH_TOKEN_VALIDATION_REQUIRED",
  "X_WEIGHTED_TEXT_VALIDATION_REQUIRED",
  "X_OAUTH_PROOF_REQUIRED",
  "X_CONNECTED_ACCOUNT_POSTURE_REQUIRED",
  "X_PROVIDER_REVOCATION_REQUIRED",
  "X_LIVE_TEXT_POST_CANARY_REQUIRED",
  "X_PUBLIC_ENABLEMENT_NOT_APPROVED",
]

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim())
}

function getXConfigStatus() {
  const missing = [
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
    "X_REDIRECT_URI",
    "AUTOPOST_TOKEN_ENCRYPTION_KEY",
    "AUTOPOST_OAUTH_STATE_SECRET",
  ].filter((name) => !hasEnv(name))

  return {
    app_configured: missing.length === 0,
    oauth_configured: missing.length === 0,
    config_error: missing.length > 0 ? "X_OAUTH_CONFIG_INCOMPLETE" : null,
  }
}

function getAccountForPlatform(
  accountsByPlatform: Map<PlatformId, AutopostAccountStatus>,
  platformId: PlatformId
) {
  return accountsByPlatform.get(platformId) ?? null
}

function isConnectedStatus(status: string | null | undefined) {
  return status === "CONNECTED"
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

function getFanvueConnectionBlocker(args: {
  account: AutopostAccountStatus | null
  configConfigured: boolean
}) {
  const { account, configConfigured } = args
  if (!configConfigured) return "FANVUE_CONNECT_CONFIG_UNAVAILABLE"
  if (!account) return "FANVUE_ACCOUNT_NOT_CONNECTED"
  if (account.connection_status !== "CONNECTED") return `FANVUE_ACCOUNT_${account.connection_status ?? "DISCONNECTED"}`
  if (!nonEmptyString(account.provider_account_id)) return "FANVUE_PROVIDER_IDENTITY_MISSING"
  if (!nonEmptyString(account.encrypted_access_token)) return "FANVUE_ENCRYPTED_ACCESS_TOKEN_MISSING"
  if (account.metadata?.provider !== "fanvue") return "FANVUE_PROVIDER_METADATA_MISSING"
  if (account.metadata?.identity_fetched !== true) return "FANVUE_IDENTITY_NOT_CONFIRMED"
  return null
}

export function buildUserPlatformStatus(
  platform: AutopostPlatformRegistryEntry,
  accountsByPlatform: Map<PlatformId, AutopostAccountStatus>
) {
  const account = getAccountForPlatform(accountsByPlatform, platform.id)
  const userConnected = isConnectedStatus(account?.connection_status)

  if (platform.id === "fanvue") {
    const fanvueConfig = getFanvueOAuthConfigStatus()
    const connectionBlocker = getFanvueConnectionBlocker({
      account,
      configConfigured: fanvueConfig.configured,
    })
    const userConnected = connectionBlocker === null
    const nativePostingBlocker = "FANVUE_NATIVE_POSTING_NOT_ENABLED"
    const disabledReason = userConnected
      ? "Fanvue OAuth is connected for internal validation. Native posting and scheduling are not enabled."
      : fanvueConfig.configured
        ? "Fanvue OAuth connect is available for internal validation. Native posting and scheduling are not enabled."
        : fanvueConfig.config_error === "FANVUE_CONNECT_DISABLED"
          ? "Fanvue OAuth connect is disabled for this environment."
          : "Fanvue OAuth is not fully configured for this environment."

    return {
      id: platform.id,
      name: platform.name,
      label: platform.name,
      external_url: platform.external_url,
      launch_status: fanvueConfig.configured ? platform.launch_status : "not_configured",
      app_configured: fanvueConfig.configured,
      oauth_configured: fanvueConfig.configured,
      config_error: fanvueConfig.config_error,
      can_connect: fanvueConfig.configured,
      user_connected: userConnected,
      connection_status: account?.connection_status ?? "DISCONNECTED",
      connection_blocker: connectionBlocker,
      provider_username: account?.provider_username ?? null,
      provider_account_id: account?.provider_account_id ?? null,
      connected_at: userConnected ? account?.connected_at ?? null : null,
      last_refresh_at: account?.last_refresh_at ?? null,
      has_error: Boolean(account?.last_error) || Boolean(account && connectionBlocker && account.connection_status === "CONNECTED"),
      public_selectable: false,
      can_schedule: false,
      supports_real_posting: false,
      supports_text_posting: false,
      supports_media_posting: false,
      supports_async_dispatch: false,
      supports_assisted_workflow: platform.supports_assisted_workflow,
      assisted_available: platform.supports_assisted_workflow,
      native_posting_available: false,
      native_posting_blocker: nativePostingBlocker,
      status_message: userConnected
        ? "Fanvue OAuth is connected for internal validation. Native posting is not enabled."
        : platform.status_message,
      disabled_reason: disabledReason,
      blockers: [nativePostingBlocker, "FANVUE_SCHEDULED_POSTING_NOT_ENABLED"],
    }
  }

  if (platform.id === "x") {
    const xConfig = getXConfigStatus()
    const disabledReason = userConnected
      ? "X has a stored connection for controlled validation. Connected-account posture and live posting remain unverified. Public scheduling remains disabled."
      : xConfig.oauth_configured
        ? "Text-only X posting is implemented for controlled validation. Environment verification, initial OAuth/token validation, weighted text enforcement, OAuth proof, connected-account verification, provider revocation, live canary proof, and public enablement remain incomplete."
        : "Text-only X posting is implemented for controlled validation, but X OAuth is not fully configured for this environment. Public scheduling remains disabled."

    return {
      id: platform.id,
      name: platform.name,
      label: platform.name,
      external_url: platform.external_url,
      launch_status: xConfig.oauth_configured ? platform.launch_status : "not_configured",
      app_configured: xConfig.app_configured,
      oauth_configured: xConfig.oauth_configured,
      config_error: xConfig.config_error,
      can_connect: xConfig.oauth_configured,
      user_connected: userConnected,
      connection_status: account?.connection_status ?? "DISCONNECTED",
      provider_username: account?.provider_username ?? null,
      provider_account_id: account?.provider_account_id ?? null,
      connected_at: account?.connected_at ?? null,
      last_refresh_at: account?.last_refresh_at ?? null,
      has_error: Boolean(account?.last_error),
      public_selectable: false,
      can_schedule: false,
      supports_real_posting: platform.supports_real_posting,
      supports_text_posting: true,
      supports_media_posting: false,
      supports_async_dispatch: platform.supports_async_dispatch,
      supports_assisted_workflow: platform.supports_assisted_workflow,
      status_message: userConnected
        ? "X has a stored connection for controlled validation. Connected-account posture and live posting remain unverified."
        : platform.status_message,
      disabled_reason: disabledReason,
      blockers: X_SCHEDULING_BLOCKERS,
    }
  }

  return {
    id: platform.id,
    name: platform.name,
    label: platform.name,
    external_url: platform.external_url,
    launch_status: platform.launch_status,
    app_configured: platform.env_var ? hasEnv(platform.env_var) : false,
    oauth_configured: false,
    config_error: null,
    can_connect: false,
    user_connected: userConnected,
    connection_status: account?.connection_status ?? "DISCONNECTED",
    provider_username: account?.provider_username ?? null,
    provider_account_id: account?.provider_account_id ?? null,
    connected_at: account?.connected_at ?? null,
    last_refresh_at: account?.last_refresh_at ?? null,
    has_error: Boolean(account?.last_error),
    public_selectable: false,
    can_schedule: false,
    supports_real_posting: false,
    supports_text_posting: false,
    supports_media_posting: false,
    supports_async_dispatch: platform.supports_async_dispatch,
    supports_assisted_workflow: platform.supports_assisted_workflow,
    status_message: platform.status_message,
    disabled_reason: platform.status_message,
    blockers: ["PLATFORM_NOT_ENABLED_FOR_SCHEDULED_AUTOPOST"],
  }
}
