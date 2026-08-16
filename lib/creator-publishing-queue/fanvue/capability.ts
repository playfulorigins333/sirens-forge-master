import type { FanvueProviderAccount, FanvueProviderContentType } from "../../autopost/fanvueProviderExecutorCore"
export const FANVUE_TEXT_PUBLICATION_SCOPES = ["write:post"] as const
export const FANVUE_MEDIA_PUBLICATION_SCOPES = ["write:post", "read:media", "write:media", "write:creator"] as const
const scopeList = (scopes: unknown): string[] => Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string") : typeof scopes === "string" ? scopes.split(/\s+/).filter(Boolean) : []

export type FanvueCapabilityCode = "FANVUE_CAPABILITY_ACCOUNT_REQUIRED" | "FANVUE_CAPABILITY_OWNER_MISMATCH" | "FANVUE_CAPABILITY_PLATFORM_INVALID" | "FANVUE_CAPABILITY_NOT_CONNECTED" | "FANVUE_CAPABILITY_ACCESS_CREDENTIAL_MISSING" | "FANVUE_CAPABILITY_WRITE_POST_MISSING" | "FANVUE_CAPABILITY_READ_MEDIA_MISSING" | "FANVUE_CAPABILITY_WRITE_MEDIA_MISSING" | "FANVUE_CAPABILITY_WRITE_CREATOR_MISSING"
export type FanvuePublicationCapability = Readonly<{ connected: boolean; textReady: boolean; mediaReady: boolean; refreshCapable: boolean; missingText: FanvueCapabilityCode[]; missingMedia: FanvueCapabilityCode[] }>
const present = (value: unknown) => typeof value === "string" && value.trim().length > 0

export function classifyFanvuePublicationCapability(account: FanvueProviderAccount | null, creatorId: string): FanvuePublicationCapability {
  const base: FanvueCapabilityCode[] = []
  if (!account) base.push("FANVUE_CAPABILITY_ACCOUNT_REQUIRED")
  else {
    if (account.user_id !== creatorId) base.push("FANVUE_CAPABILITY_OWNER_MISMATCH")
    if (account.platform !== "fanvue") base.push("FANVUE_CAPABILITY_PLATFORM_INVALID")
    if (account.connection_status !== "CONNECTED") base.push("FANVUE_CAPABILITY_NOT_CONNECTED")
    if (!present(account.encrypted_access_token)) base.push("FANVUE_CAPABILITY_ACCESS_CREDENTIAL_MISSING")
  }
  const scopes = new Set(scopeList(account?.scopes))
  const codes: Record<string, FanvueCapabilityCode> = { "write:post": "FANVUE_CAPABILITY_WRITE_POST_MISSING", "read:media": "FANVUE_CAPABILITY_READ_MEDIA_MISSING", "write:media": "FANVUE_CAPABILITY_WRITE_MEDIA_MISSING", "write:creator": "FANVUE_CAPABILITY_WRITE_CREATOR_MISSING" }
  const missing = (required: readonly string[]) => required.filter(scope => !scopes.has(scope)).map(scope => codes[scope])
  const missingText = [...base, ...missing(FANVUE_TEXT_PUBLICATION_SCOPES)]
  const missingMedia = [...base, ...missing(FANVUE_MEDIA_PUBLICATION_SCOPES)]
  return { connected: base.length === 0, textReady: missingText.length === 0, mediaReady: missingMedia.length === 0, refreshCapable: present(account?.encrypted_refresh_token), missingText, missingMedia }
}

export function fanvueCapabilityError(account: FanvueProviderAccount | null, creatorId: string, type: FanvueProviderContentType) {
  const result = classifyFanvuePublicationCapability(account, creatorId)
  return (type === "text" ? result.missingText : result.missingMedia)[0] ?? null
}
