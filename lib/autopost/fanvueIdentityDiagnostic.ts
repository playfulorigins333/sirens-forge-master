import { decryptAutopostToken } from "./tokenCryptoCore"

export const FANVUE_IDENTITY_DIAGNOSTIC_GATE = "FV-40CO" as const
export const FANVUE_IDENTITY_DIAGNOSTIC_MODE = "fanvue_identity_only_diagnostic" as const

export type FanvueIdentityCandidateSource =
  | "top_level_uuid"
  | "top_level_userUuid"
  | "top_level_id"
  | "creator_uuid"
  | "creator_userUuid"
  | "creator_id"
  | null

export type FanvueIdentityDiagnosticAccount = {
  user_id: string
  platform: string
  connection_status?: string | null
  provider_account_id?: string | null
  provider_username?: string | null
  scopes?: string[] | string | null
  encrypted_access_token?: string | null
  token_expires_at?: string | null
  token_type?: string | null
  token_key_version?: number | null
  metadata?: Record<string, unknown> | null
}

export type FanvueIdentityFetchResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type FanvueIdentityFetch = (
  url: string,
  init: { method: "GET"; headers: Record<string, string> },
) => Promise<FanvueIdentityFetchResponse>

export type FanvueIdentityDiagnosticDependencies = {
  loadAccount: (userId: string) => Promise<FanvueIdentityDiagnosticAccount | null>
  fetchIdentity: FanvueIdentityFetch
  apiBaseUrl: string
  apiVersion: string
  decryptAccessToken?: (encryptedToken: string) => string
  now?: () => Date
}

export type FanvueIdentityDiagnosticInput = {
  userId: string
}

export type FanvueIdentityDiagnosticResult = {
  ok: boolean
  gate: typeof FANVUE_IDENTITY_DIAGNOSTIC_GATE
  mode: typeof FANVUE_IDENTITY_DIAGNOSTIC_MODE
  identity_layer_reached: boolean
  provider_calls_attempted: boolean
  identity_response_present: boolean | null
  provider_status_class: "2xx" | "4xx" | "5xx" | null
  has_top_level_uuid: boolean | null
  has_top_level_id: boolean | null
  has_top_level_userUuid: boolean | null
  has_creator_object: boolean | null
  has_creator_uuid: boolean | null
  has_creator_id: boolean | null
  has_creator_userUuid: boolean | null
  has_isCreator: boolean | null
  has_account: boolean | null
  has_creator: boolean | null
  candidate_creator_user_uuid_source: FanvueIdentityCandidateSource
  candidate_creator_user_uuid_present: boolean
  candidate_creator_user_uuid_format_valid: boolean | null
  safe_code: string
  safe_error_message?: string
  requires_oauth_reconnect: boolean
  upload_attempted: false
  signed_upload_url_attempted: false
  byte_upload_attempted: false
  media_finalize_attempted: false
  media_lookup_attempted: false
  post_attempted: false
  dispatch_attempted: false
  scheduled: false
  platform_post_id: null
  posted_proof: false
}

type IdentityShape = Pick<
  FanvueIdentityDiagnosticResult,
  | "has_top_level_uuid"
  | "has_top_level_id"
  | "has_top_level_userUuid"
  | "has_creator_object"
  | "has_creator_uuid"
  | "has_creator_id"
  | "has_creator_userUuid"
  | "has_isCreator"
  | "has_account"
  | "has_creator"
  | "candidate_creator_user_uuid_source"
  | "candidate_creator_user_uuid_present"
  | "candidate_creator_user_uuid_format_valid"
>

const negativeFlags = {
  upload_attempted: false,
  signed_upload_url_attempted: false,
  byte_upload_attempted: false,
  media_finalize_attempted: false,
  media_lookup_attempted: false,
  post_attempted: false,
  dispatch_attempted: false,
  scheduled: false,
  platform_post_id: null,
  posted_proof: false,
} as const

const emptyShape: IdentityShape = {
  has_top_level_uuid: null,
  has_top_level_id: null,
  has_top_level_userUuid: null,
  has_creator_object: null,
  has_creator_uuid: null,
  has_creator_id: null,
  has_creator_userUuid: null,
  has_isCreator: null,
  has_account: null,
  has_creator: null,
  candidate_creator_user_uuid_source: null,
  candidate_creator_user_uuid_present: false,
  candidate_creator_user_uuid_format_valid: null,
}

function baseResult(args: {
  ok: boolean
  identityLayerReached: boolean
  providerCallsAttempted: boolean
  identityResponsePresent: boolean | null
  providerStatusClass: "2xx" | "4xx" | "5xx" | null
  safeCode: string
  safeErrorMessage?: string
  requiresOauthReconnect?: boolean
  shape?: IdentityShape
}): FanvueIdentityDiagnosticResult {
  return {
    ok: args.ok,
    gate: FANVUE_IDENTITY_DIAGNOSTIC_GATE,
    mode: FANVUE_IDENTITY_DIAGNOSTIC_MODE,
    identity_layer_reached: args.identityLayerReached,
    provider_calls_attempted: args.providerCallsAttempted,
    identity_response_present: args.identityResponsePresent,
    provider_status_class: args.providerStatusClass,
    ...(args.shape ?? emptyShape),
    safe_code: args.safeCode,
    ...(args.safeErrorMessage ? { safe_error_message: sanitizeMessage(args.safeErrorMessage) } : {}),
    requires_oauth_reconnect: args.requiresOauthReconnect ?? false,
    ...negativeFlags,
  }
}

function sanitizeMessage(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return "Fanvue identity diagnostic failed safely."
  if (/access[_ -]?token|refresh[_ -]?token|encrypted|client[_ -]?secret|raw[_ -]?provider|error_description|signed upload|authorization|bearer|email|username|handle/i.test(trimmed)) {
    return "Fanvue identity diagnostic failed safely."
  }
  return trimmed
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim())
}

function statusClass(status: number): "2xx" | "4xx" | "5xx" | null {
  if (status >= 200 && status < 300) return "2xx"
  if (status >= 400 && status < 500) return "4xx"
  if (status >= 500 && status < 600) return "5xx"
  return null
}

function providerFailureCode(status: number) {
  if (status === 401) return "FANVUE_IDENTITY_PROVIDER_UNAUTHORIZED"
  if (status === 403) return "FANVUE_IDENTITY_PROVIDER_FORBIDDEN"
  if (status === 429) return "FANVUE_IDENTITY_PROVIDER_RATE_LIMITED"
  if (status >= 500) return "FANVUE_IDENTITY_PROVIDER_SERVER_ERROR"
  return "FANVUE_IDENTITY_PROVIDER_REQUEST_FAILED"
}

function candidateValue(identity: Record<string, unknown>, source: Exclude<FanvueIdentityCandidateSource, null>) {
  const creator = isRecord(identity.creator) ? identity.creator : null
  switch (source) {
    case "creator_userUuid":
      return creator?.userUuid
    case "creator_uuid":
      return creator?.uuid
    case "creator_id":
      return creator?.id
    case "top_level_userUuid":
      return identity.userUuid
    case "top_level_uuid":
      return identity.uuid
    case "top_level_id":
      return identity.id
  }
}

export function inspectFanvueIdentityShape(data: unknown): IdentityShape | null {
  if (!isRecord(data)) return null
  const creator = isRecord(data.creator) ? data.creator : null
  const candidateSources: Exclude<FanvueIdentityCandidateSource, null>[] = [
    "creator_userUuid",
    "creator_uuid",
    "creator_id",
    "top_level_userUuid",
    "top_level_uuid",
    "top_level_id",
  ]
  const selectedSource = candidateSources.find((source) => hasNonEmptyString(candidateValue(data, source))) ?? null
  const selectedValue = selectedSource ? candidateValue(data, selectedSource) : null

  return {
    has_top_level_uuid: hasNonEmptyString(data.uuid),
    has_top_level_id: hasNonEmptyString(data.id),
    has_top_level_userUuid: hasNonEmptyString(data.userUuid),
    has_creator_object: Boolean(creator),
    has_creator_uuid: creator ? hasNonEmptyString(creator.uuid) : false,
    has_creator_id: creator ? hasNonEmptyString(creator.id) : false,
    has_creator_userUuid: creator ? hasNonEmptyString(creator.userUuid) : false,
    has_isCreator: typeof data.isCreator === "boolean",
    has_account: data.account !== undefined && data.account !== null,
    has_creator: data.creator !== undefined && data.creator !== null,
    candidate_creator_user_uuid_source: selectedSource,
    candidate_creator_user_uuid_present: selectedSource !== null,
    candidate_creator_user_uuid_format_valid: selectedSource ? isUuid(selectedValue) : null,
  }
}

function isExpired(value: string, now: Date) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp <= now.getTime()
}

export async function runFanvueIdentityOnlyDiagnostic(
  input: FanvueIdentityDiagnosticInput,
  dependencies: FanvueIdentityDiagnosticDependencies,
): Promise<FanvueIdentityDiagnosticResult> {
  let account: FanvueIdentityDiagnosticAccount | null
  try {
    account = await dependencies.loadAccount(input.userId)
  } catch {
    return baseResult({
      ok: false,
      identityLayerReached: false,
      providerCallsAttempted: false,
      identityResponsePresent: null,
      providerStatusClass: null,
      safeCode: "FANVUE_IDENTITY_ACCOUNT_NOT_FOUND",
      safeErrorMessage: "Fanvue identity account lookup failed safely.",
    })
  }

  if (!account) {
    return baseResult({
      ok: false,
      identityLayerReached: false,
      providerCallsAttempted: false,
      identityResponsePresent: null,
      providerStatusClass: null,
      safeCode: "FANVUE_IDENTITY_ACCOUNT_NOT_FOUND",
      safeErrorMessage: "Fanvue account row was not found.",
    })
  }

  if (account.platform !== "fanvue") {
    return baseResult({
      ok: false,
      identityLayerReached: false,
      providerCallsAttempted: false,
      identityResponsePresent: null,
      providerStatusClass: null,
      safeCode: "FANVUE_IDENTITY_ACCOUNT_PLATFORM_INVALID",
      safeErrorMessage: "Fanvue identity diagnostic requires a Fanvue account.",
    })
  }

  if (account.connection_status && account.connection_status !== "CONNECTED") {
    return baseResult({
      ok: false,
      identityLayerReached: false,
      providerCallsAttempted: false,
      identityResponsePresent: null,
      providerStatusClass: null,
      safeCode: "FANVUE_IDENTITY_ACCOUNT_NOT_CONNECTED",
      safeErrorMessage: "Fanvue account must be connected before identity diagnostic.",
    })
  }

  if (!hasNonEmptyString(account.encrypted_access_token)) {
    return baseResult({
      ok: false,
      identityLayerReached: false,
      providerCallsAttempted: false,
      identityResponsePresent: null,
      providerStatusClass: null,
      safeCode: "FANVUE_IDENTITY_ACCESS_TOKEN_MISSING",
      safeErrorMessage: "Fanvue identity credential is missing.",
    })
  }

  if (hasNonEmptyString(account.token_expires_at) && isExpired(account.token_expires_at, dependencies.now?.() ?? new Date())) {
    return baseResult({
      ok: false,
      identityLayerReached: false,
      providerCallsAttempted: false,
      identityResponsePresent: null,
      providerStatusClass: null,
      safeCode: "FANVUE_IDENTITY_ACCESS_TOKEN_EXPIRED_REFRESH_NOT_ATTEMPTED",
      safeErrorMessage: "Fanvue identity access token is expired; refresh was not attempted.",
    })
  }

  let accessToken: string
  try {
    accessToken = (dependencies.decryptAccessToken ?? decryptAutopostToken)(account.encrypted_access_token)
  } catch {
    return baseResult({
      ok: false,
      identityLayerReached: false,
      providerCallsAttempted: false,
      identityResponsePresent: null,
      providerStatusClass: null,
      safeCode: "FANVUE_IDENTITY_ACCESS_TOKEN_DECRYPT_FAILED",
      safeErrorMessage: "Unable to decrypt Fanvue identity credential.",
    })
  }

  let response: FanvueIdentityFetchResponse
  try {
    response = await dependencies.fetchIdentity(`${dependencies.apiBaseUrl.replace(/\/$/, "")}/users/account`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "X-Fanvue-API-Version": dependencies.apiVersion,
      },
    })
  } catch {
    return baseResult({
      ok: false,
      identityLayerReached: true,
      providerCallsAttempted: true,
      identityResponsePresent: null,
      providerStatusClass: null,
      safeCode: "FANVUE_IDENTITY_PROVIDER_REQUEST_FAILED",
      safeErrorMessage: "Fanvue identity request failed safely.",
    })
  }

  if (!response.ok) {
    return baseResult({
      ok: false,
      identityLayerReached: true,
      providerCallsAttempted: true,
      identityResponsePresent: null,
      providerStatusClass: statusClass(response.status),
      safeCode: providerFailureCode(response.status),
      safeErrorMessage: "Fanvue identity provider returned a safe failure.",
    })
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    return baseResult({
      ok: false,
      identityLayerReached: true,
      providerCallsAttempted: true,
      identityResponsePresent: false,
      providerStatusClass: statusClass(response.status),
      safeCode: "FANVUE_IDENTITY_RESPONSE_MALFORMED",
      safeErrorMessage: "Fanvue identity response was malformed.",
    })
  }

  const shape = inspectFanvueIdentityShape(data)
  if (!shape) {
    return baseResult({
      ok: false,
      identityLayerReached: true,
      providerCallsAttempted: true,
      identityResponsePresent: Boolean(data),
      providerStatusClass: statusClass(response.status),
      safeCode: "FANVUE_IDENTITY_RESPONSE_MALFORMED",
      safeErrorMessage: "Fanvue identity response was malformed.",
    })
  }

  return baseResult({
    ok: true,
    identityLayerReached: true,
    providerCallsAttempted: true,
    identityResponsePresent: true,
    providerStatusClass: statusClass(response.status),
    safeCode: "FANVUE_IDENTITY_SHAPE_INSPECTED",
    shape,
  })
}
