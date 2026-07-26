export type XStoredPostureAccount = {
  connection_status: string | null
  provider_account_id: string | null
  provider_username: string | null
  encrypted_access_token?: string | null
  encrypted_refresh_token?: string | null
  token_expires_at?: string | null
  token_key_version?: number | null
  metadata?: Record<string, unknown> | null
  last_error: string | null
}

export type XStoredPostureBlocker =
  | "X_ACCOUNT_NOT_CONNECTED"
  | "X_ACCOUNT_STATUS_DISCONNECTED"
  | "X_ACCOUNT_STATUS_EXPIRED"
  | "X_ACCOUNT_STATUS_REVOKED"
  | "X_ACCOUNT_STATUS_ERROR"
  | "X_ACCOUNT_STATUS_UNKNOWN"
  | "X_PROVIDER_ACCOUNT_ID_MISSING"
  | "X_PROVIDER_USERNAME_MISSING"
  | "X_ENCRYPTED_ACCESS_TOKEN_MISSING"
  | "X_ENCRYPTED_REFRESH_TOKEN_MISSING"
  | "X_TOKEN_EXPIRY_INVALID"
  | "X_TOKEN_KEY_VERSION_INVALID"
  | "X_PROVIDER_METADATA_MISSING"
  | "X_IDENTITY_NOT_CONFIRMED"
  | "X_ACCOUNT_ERROR_PRESENT"
  | null

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

function inspectXProviderMetadata(value: unknown) {
  if (value === null || typeof value !== "object") return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const metadata = value as Record<string, unknown>
    if (metadata.provider !== "x") return null
    return { identityFetched: metadata.identity_fetched }
  } catch {
    return null
  }
}

export function getXStoredPostureBlocker(account: XStoredPostureAccount | null): XStoredPostureBlocker {
  if (!account) return "X_ACCOUNT_NOT_CONNECTED"
  if (account.connection_status !== "CONNECTED") {
    if (account.connection_status === "DISCONNECTED") return "X_ACCOUNT_STATUS_DISCONNECTED"
    if (account.connection_status === "EXPIRED") return "X_ACCOUNT_STATUS_EXPIRED"
    if (account.connection_status === "REVOKED") return "X_ACCOUNT_STATUS_REVOKED"
    if (account.connection_status === "ERROR") return "X_ACCOUNT_STATUS_ERROR"
    return "X_ACCOUNT_STATUS_UNKNOWN"
  }
  if (!nonEmptyString(account.provider_account_id)) return "X_PROVIDER_ACCOUNT_ID_MISSING"
  if (!nonEmptyString(account.provider_username)) return "X_PROVIDER_USERNAME_MISSING"
  if (!nonEmptyString(account.encrypted_access_token)) return "X_ENCRYPTED_ACCESS_TOKEN_MISSING"
  if (!nonEmptyString(account.encrypted_refresh_token)) return "X_ENCRYPTED_REFRESH_TOKEN_MISSING"
  if (!nonEmptyString(account.token_expires_at) || !Number.isFinite(new Date(account.token_expires_at as string).getTime())) return "X_TOKEN_EXPIRY_INVALID"
  if (!Number.isFinite(account.token_key_version) || !Number.isInteger(account.token_key_version) || (account.token_key_version as number) <= 0) return "X_TOKEN_KEY_VERSION_INVALID"
  const metadataInspection = inspectXProviderMetadata(account.metadata)
  if (!metadataInspection) return "X_PROVIDER_METADATA_MISSING"
  if (metadataInspection.identityFetched !== true) return "X_IDENTITY_NOT_CONFIRMED"
  if (account.last_error !== null && account.last_error !== undefined) return "X_ACCOUNT_ERROR_PRESENT"
  return null
}
