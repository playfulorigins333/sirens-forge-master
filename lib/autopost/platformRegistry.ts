import type { PlatformId } from "./types"

export type PlatformLaunchStatus = "available" | "coming_soon" | "not_configured" | "unsupported"

export type AutopostPlatformRegistryEntry = {
  id: PlatformId
  name: string
  external_url: string
  launch_status: PlatformLaunchStatus
  public_selectable: boolean
  supports_real_posting: boolean
  supports_async_dispatch: boolean
  supports_assisted_workflow: boolean
  env_var?: string
  reason: string
  status_message: string
}

type PlatformRegistrySeed = Omit<
  AutopostPlatformRegistryEntry,
  "launch_status" | "public_selectable" | "supports_real_posting" | "supports_async_dispatch" | "status_message"
> & {
  env_var?: string
  launch_status?: PlatformLaunchStatus
  public_selectable?: boolean
  supports_real_posting?: boolean
  supports_async_dispatch?: boolean
  status_message?: string
}

const COMING_SOON_MESSAGE = "Assisted launch workflow only — scheduled Autopost is not enabled."
const NOT_CONFIGURED_MESSAGE = "Assisted launch workflow only — no direct posting integration is enabled."

const CREATOR_LAUNCH_PLATFORM_IDS = new Set<PlatformId>(["fanvue", "onlyfans", "x", "reddit"])

const PLATFORM_REGISTRY_SEEDS: PlatformRegistrySeed[] = [
  {
    id: "fanvue",
    name: "Fanvue",
    external_url: "https://www.fanvue.com/",
    launch_status: "coming_soon",
    public_selectable: false,
    supports_real_posting: true,
    supports_async_dispatch: true,
    supports_assisted_workflow: false,
    status_message: "Backend publishing capability is ready; public activation is gated off.",
    reason: "Fanvue direct scheduled publishing becomes selectable only after the final server activation gate is enabled.",
  },
  {
    id: "onlyfans",
    name: "OnlyFans",
    external_url: "https://onlyfans.com/",
    env_var: "AUTOPOST_WEBHOOK_ONLYFANS",
    supports_assisted_workflow: true,
    reason: "OnlyFans uses assisted/manual publishing through the internal queue; Sirens Forge does not post directly.",
  },
  {
    id: "fansly",
    name: "Fansly",
    external_url: "https://fansly.com/",
    env_var: "AUTOPOST_WEBHOOK_FANSLY",
    supports_assisted_workflow: true,
    reason: "Real scheduled Fansly posting is not proven in this repo yet.",
  },
  {
    id: "loyalfans",
    name: "LoyalFans",
    external_url: "https://www.loyalfans.com/",
    env_var: "AUTOPOST_WEBHOOK_LOYALFANS",
    supports_assisted_workflow: true,
    reason: "Real scheduled LoyalFans posting is not proven in this repo yet.",
  },
  {
    id: "justforfans",
    name: "JustForFans",
    external_url: "https://justfor.fans/",
    env_var: "AUTOPOST_WEBHOOK_JUSTFORFANS",
    supports_assisted_workflow: true,
    reason: "Real scheduled JustForFans posting is not proven in this repo yet.",
  },
  {
    id: "x",
    name: "X (Twitter)",
    external_url: "https://x.com/",
    supports_assisted_workflow: true,
    launch_status: "coming_soon",
    public_selectable: false,
    supports_real_posting: true,
    supports_async_dispatch: true,
    status_message:
      "Text-only X posting is implemented for controlled validation; media posting and live provider proof remain incomplete. Public scheduling remains disabled until the remaining launch gates are complete.",
    reason:
      "Text-only native X posting is implemented for controlled validation only. Media posting is not supported, live provider proof is incomplete, and public launch is not approved.",
  },
  {
    id: "reddit",
    name: "Reddit",
    external_url: "https://www.reddit.com/",
    launch_status: "not_configured",
    public_selectable: false,
    supports_real_posting: false,
    supports_async_dispatch: false,
    supports_assisted_workflow: true,
    status_message: "Manual Reddit handoff only. Native OAuth, API posting, scheduling, and dispatch are not enabled pending Reddit written approval.",
    reason: "Manual Reddit handoff only. Native OAuth, API posting, scheduling, and dispatch are not enabled pending Reddit written approval.",
  },
]

function isFanvuePublicActivationEnabled() {
  return process.env.FANVUE_PUBLIC_ACTIVATION_ENABLED === "true"
}

export function getAutopostPlatformRegistry(): AutopostPlatformRegistryEntry[] {
  const fanvuePublicActivationEnabled = isFanvuePublicActivationEnabled()

  return PLATFORM_REGISTRY_SEEDS.map((platform) => {
    const hasWebhookEnv = platform.env_var ? Boolean(process.env[platform.env_var]) : false

    if (platform.id === "fanvue") {
      return {
        ...platform,
        launch_status: fanvuePublicActivationEnabled ? "available" : "coming_soon",
        public_selectable: fanvuePublicActivationEnabled,
        supports_real_posting: true,
        supports_async_dispatch: true,
        status_message: fanvuePublicActivationEnabled
          ? "Direct Fanvue scheduled publishing is available for connected accounts with required permissions."
          : "Backend publishing capability is ready; public activation is gated off.",
        reason: fanvuePublicActivationEnabled
          ? "Direct scheduled Fanvue publishing uses the connected OAuth account and the Creator Publishing safety gates."
          : platform.reason,
      }
    }

    return {
      ...platform,
      launch_status: platform.launch_status ?? (hasWebhookEnv ? "coming_soon" : "not_configured"),
      public_selectable: platform.public_selectable ?? false,
      supports_real_posting: platform.supports_real_posting ?? false,
      supports_async_dispatch: platform.supports_async_dispatch ?? false,
      status_message: platform.status_message ?? (hasWebhookEnv ? COMING_SOON_MESSAGE : NOT_CONFIGURED_MESSAGE),
    }
  })
}

export function getPublicAutopostPlatforms() {
  return getAutopostPlatformRegistry().filter((platform) => CREATOR_LAUNCH_PLATFORM_IDS.has(platform.id)).map((platform) => ({
    id: platform.id,
    name: platform.name,
    label: platform.name,
    external_url: platform.external_url,
    launch_status: platform.launch_status,
    public_selectable: platform.public_selectable,
    supports_real_posting: platform.supports_real_posting,
    supports_assisted_workflow: platform.supports_assisted_workflow,
    env_var: platform.env_var,
    reason: platform.reason,
    status_message: platform.status_message,
  }))
}

export function normalizeKnownPlatformIds(value: unknown): PlatformId[] {
  if (!Array.isArray(value)) return []

  const knownPlatformIds = new Set(getAutopostPlatformRegistry().map((platform) => platform.id))

  return Array.from(
    new Set(
      value
        .map((platform) => String(platform).trim().toLowerCase())
        .filter((platform): platform is PlatformId => knownPlatformIds.has(platform as PlatformId))
    )
  )
}

export function getSelectableAutopostPlatformIds(): Set<PlatformId> {
  return new Set(
    getAutopostPlatformRegistry()
      .filter((platform) => platform.public_selectable && platform.supports_real_posting)
      .map((platform) => platform.id)
  )
}

export function filterSelectableAutopostPlatformIds(platformIds: PlatformId[]) {
  const selectablePlatformIds = getSelectableAutopostPlatformIds()
  return platformIds.filter((platformId) => selectablePlatformIds.has(platformId))
}
