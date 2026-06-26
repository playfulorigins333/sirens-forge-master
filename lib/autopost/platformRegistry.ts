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
}

const COMING_SOON_MESSAGE = "Coming soon — not available for scheduled Autopost yet."
const NOT_CONFIGURED_MESSAGE = "Not configured — posting integration is not enabled."

const PLATFORM_REGISTRY_SEEDS: PlatformRegistrySeed[] = [
  {
    id: "fanvue",
    name: "Fanvue",
    external_url: "https://www.fanvue.com/",
    env_var: "AUTOPOST_WEBHOOK_FANVUE",
    supports_assisted_workflow: true,
    reason: "Real scheduled Fanvue posting is not proven in this repo yet.",
  },
  {
    id: "onlyfans",
    name: "OnlyFans",
    external_url: "https://onlyfans.com/",
    env_var: "AUTOPOST_WEBHOOK_ONLYFANS",
    supports_assisted_workflow: true,
    reason: "Real scheduled OnlyFans posting is not proven in this repo yet.",
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
    env_var: "AUTOPOST_WEBHOOK_X",
    supports_assisted_workflow: true,
    reason: "Real scheduled X posting is not proven in this repo yet.",
  },
  {
    id: "reddit",
    name: "Reddit",
    external_url: "https://www.reddit.com/",
    env_var: "AUTOPOST_WEBHOOK_REDDIT",
    supports_assisted_workflow: true,
    reason: "Real scheduled Reddit posting is not proven in this repo yet.",
  },
]

export function getAutopostPlatformRegistry(): AutopostPlatformRegistryEntry[] {
  return PLATFORM_REGISTRY_SEEDS.map((platform) => {
    const hasWebhookEnv = platform.env_var ? Boolean(process.env[platform.env_var]) : false

    return {
      ...platform,
      launch_status: hasWebhookEnv ? "coming_soon" : "not_configured",
      public_selectable: false,
      supports_real_posting: false,
      supports_async_dispatch: false,
      status_message: hasWebhookEnv ? COMING_SOON_MESSAGE : NOT_CONFIGURED_MESSAGE,
    }
  })
}

export function getPublicAutopostPlatforms() {
  return getAutopostPlatformRegistry().map((platform) => ({
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
