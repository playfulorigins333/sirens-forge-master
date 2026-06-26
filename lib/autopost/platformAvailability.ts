import type { PlatformId } from "./types"
import type { AutopostPlatformRegistryEntry } from "./platformRegistry"

export type AutopostAccountStatus = {
  platform: PlatformId
  provider_account_id: string | null
  provider_username: string | null
  connection_status: string | null
  connected_at: string | null
  last_refresh_at: string | null
  last_error: string | null
}

export type UserAutopostPlatformStatus = ReturnType<typeof buildUserPlatformStatus>

const X_SCHEDULING_BLOCKERS = [
  "CONTENT_PERSISTENCE_NOT_READY",
  "X_POSTING_ADAPTER_NOT_READY",
  "RUN_RESULT_PERSISTENCE_NOT_READY",
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

export function buildUserPlatformStatus(
  platform: AutopostPlatformRegistryEntry,
  accountsByPlatform: Map<PlatformId, AutopostAccountStatus>
) {
  const account = getAccountForPlatform(accountsByPlatform, platform.id)
  const userConnected = isConnectedStatus(account?.connection_status)

  if (platform.id === "x") {
    const xConfig = getXConfigStatus()
    const disabledReason = userConnected
      ? "Scheduled posting requires content persistence, X adapter proof handling, and run/result persistence before X can be enabled."
      : xConfig.oauth_configured
        ? "Connect X to prepare for the text-only Autopost MVP. Scheduled posting is not enabled yet."
        : "X OAuth is not fully configured for this environment."

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
      supports_real_posting: false,
      supports_text_posting: false,
      supports_media_posting: false,
      supports_async_dispatch: platform.supports_async_dispatch,
      supports_assisted_workflow: platform.supports_assisted_workflow,
      status_message: userConnected
        ? "X is connected, but scheduled posting is not enabled yet."
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
