import "server-only"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { decryptAutopostToken } from "@/lib/autopost/tokenCrypto"
import { refreshXAccessToken } from "@/lib/autopost/xTokenRefresh"

type XAdapterRequestPayload = {
  text?: unknown
  media?: unknown
  media_ids?: unknown
  media_urls?: unknown
  asset_ids?: unknown
  asset_urls?: unknown
}

export type XAdapterRequest = {
  run_mode?: unknown
  user_id?: unknown
  rule_id?: unknown
  job_id?: unknown
  payload?: XAdapterRequestPayload | null
}

type XAccountRow = {
  encrypted_access_token: string | null
  encrypted_refresh_token: string | null
  token_expires_at: string | null
  token_type: string | null
  token_key_version: number | null
  provider_username: string | null
  provider_account_id: string | null
}

type XCreatePostResponse = {
  data?: {
    id?: unknown
  }
}

type XCreatePostResult =
  | { ok: true; platform_post_id: string }
  | { ok: false; error_code: string; error_message: string }

export type XAdapterDeps = {
  supabaseAdmin?: ReturnType<typeof getSupabaseAdmin>
  fetchImpl?: typeof fetch
  decryptToken?: typeof decryptAutopostToken
  refreshAccessToken?: typeof refreshXAccessToken
  getApiBaseUrl?: () => string
  now?: () => Date
}

export type XAdapterResponse =
  | {
      ok: true
      status: "POSTED"
      platform: "x"
      platform_post_id: string
      posted_at: string
    }
  | {
      ok: false
      status: "FAILED" | "NOT_CONFIGURED" | "UNSUPPORTED"
      platform: "x"
      error_code: string
      error_message?: string
    }

function failure(
  status: "FAILED" | "NOT_CONFIGURED" | "UNSUPPORTED",
  errorCode: string,
  errorMessage?: string
): XAdapterResponse {
  return {
    ok: false,
    status,
    platform: "x",
    error_code: errorCode,
    ...(errorMessage ? { error_message: errorMessage } : {}),
  }
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim()
}

function hasMediaPayload(payload: XAdapterRequestPayload) {
  return [payload.media, payload.media_ids, payload.media_urls, payload.asset_ids, payload.asset_urls].some((value) => {
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== null
  })
}

function getXApiBaseUrl() {
  return (process.env.X_API_BASE_URL || "https://api.x.com").replace(/\/+$/, "")
}

const TOKEN_EXPIRY_REFRESH_BUFFER_MS = 60 * 1000
const X_POST_OUTCOME_UNKNOWN_MESSAGE = "X post outcome could not be verified"

function isExpiredOrExpiringSoon(expiresAt: string | null, now: Date) {
  if (!expiresAt) return true
  const expiresMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresMs)) return true
  return expiresMs <= now.getTime() + TOKEN_EXPIRY_REFRESH_BUFFER_MS
}

async function loadConnectedXAccount(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  userId: string
): Promise<XAccountRow | null> {
  const { data, error } = await supabaseAdmin
    .from("autopost_accounts")
    .select(
      "encrypted_access_token, encrypted_refresh_token, token_expires_at, token_type, token_key_version, provider_username, provider_account_id"
    )
    .eq("user_id", userId)
    .eq("platform", "x")
    .eq("connection_status", "CONNECTED")
    .maybeSingle()

  if (error) {
    throw new Error("X_ACCOUNT_LOOKUP_FAILED")
  }

  return (data as XAccountRow | null) ?? null
}

function unknownPostOutcome() {
  return {
    ok: false as const,
    error_code: "X_POST_OUTCOME_UNKNOWN",
    error_message: X_POST_OUTCOME_UNKNOWN_MESSAGE,
  }
}

async function createXTextPost(args: {
  accessToken: string
  text: string
  fetchImpl: typeof fetch
  getApiBaseUrl: () => string
}): Promise<XCreatePostResult> {
  let response: Response
  try {
    response = await args.fetchImpl(`${args.getApiBaseUrl().replace(/\/+$/, "")}/2/tweets`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: args.text }),
    })
  } catch {
    return unknownPostOutcome()
  }

  if (response.status === 429) {
    return {
      ok: false as const,
      error_code: "X_API_RATE_LIMITED",
      error_message: "X API rate limit reached",
    }
  }

  if (response.status >= 500 && response.status <= 599) {
    return unknownPostOutcome()
  }

  if (response.status === 401) {
    return {
      ok: false as const,
      error_code: "X_API_UNAUTHORIZED",
      error_message: "X API rejected the request as unauthorized",
    }
  }

  if (response.status === 403) {
    return {
      ok: false as const,
      error_code: "X_API_FORBIDDEN",
      error_message: "X API rejected the request as forbidden",
    }
  }

  if (response.status === 400 || response.status === 422) {
    return {
      ok: false as const,
      error_code: "X_API_INVALID_REQUEST",
      error_message: "X API rejected the request as invalid",
    }
  }

  if (response.status >= 400 && response.status <= 499) {
    return {
      ok: false as const,
      error_code: "X_API_REJECTED",
      error_message: "X API rejected the request",
    }
  }

  if (!response.ok) {
    return unknownPostOutcome()
  }

  let body: XCreatePostResponse | null
  try {
    body = (await response.json()) as XCreatePostResponse | null
  } catch {
    return unknownPostOutcome()
  }

  if (!body || typeof body !== "object") {
    return unknownPostOutcome()
  }

  const platformPostId = typeof body.data?.id === "string" ? body.data.id.trim() : ""
  if (!platformPostId) {
    return unknownPostOutcome()
  }

  return {
    ok: true as const,
    platform_post_id: platformPostId,
  }
}

export async function postXTextOnlyAutopost(
  input: XAdapterRequest,
  deps: XAdapterDeps = {}
): Promise<XAdapterResponse> {
  if (input.run_mode !== "autopost") {
    return failure("FAILED", "INVALID_RUN_MODE", "run_mode must be autopost")
  }

  if (typeof input.user_id !== "string" || !input.user_id.trim()) {
    return failure("FAILED", "MISSING_USER_ID", "user_id is required")
  }

  if (typeof input.rule_id !== "string" || !input.rule_id.trim()) {
    return failure("FAILED", "MISSING_RULE_ID", "rule_id is required")
  }

  const payload = input.payload
  if (!payload || typeof payload !== "object") {
    return failure("FAILED", "MISSING_PAYLOAD", "payload is required")
  }

  if (hasMediaPayload(payload)) {
    return failure("UNSUPPORTED", "X_TEXT_ONLY_MVP", "Media posting is not supported by this adapter")
  }

  const text = normalizeText(payload.text)
  if (!text) {
    return failure("FAILED", "EMPTY_X_TEXT", "X text is required")
  }

  if (Array.from(text).length > 280) {
    return failure("FAILED", "X_TEXT_TOO_LONG", "X text must be 280 characters or fewer")
  }

  const supabaseAdmin = deps.supabaseAdmin ?? getSupabaseAdmin()
  const fetchImpl = deps.fetchImpl ?? fetch
  const decryptToken = deps.decryptToken ?? decryptAutopostToken
  const refreshAccessToken = deps.refreshAccessToken ?? refreshXAccessToken
  const getApiBaseUrl = deps.getApiBaseUrl ?? getXApiBaseUrl
  const now = deps.now ?? (() => new Date())

  const userId = input.user_id.trim()
  let account: XAccountRow | null
  try {
    account = await loadConnectedXAccount(supabaseAdmin, userId)
  } catch {
    return failure("FAILED", "X_ACCOUNT_LOOKUP_FAILED", "Unable to load X account")
  }

  if (!account) {
    return failure("NOT_CONFIGURED", "X_ACCOUNT_NOT_CONNECTED", "Connected X account not found")
  }

  if (isExpiredOrExpiringSoon(account.token_expires_at, now())) {
    if (!account.encrypted_refresh_token) {
      return failure("NOT_CONFIGURED", "X_REFRESH_TOKEN_MISSING", "Connected X account is missing a refresh token")
    }

    const refreshResult = await refreshAccessToken({
      userId,
      encryptedRefreshToken: account.encrypted_refresh_token,
    })

    if (refreshResult.ok === false) {
      return failure("NOT_CONFIGURED", refreshResult.error_code, refreshResult.error_message)
    }

    account = {
      ...account,
      encrypted_access_token: refreshResult.encrypted_access_token,
      encrypted_refresh_token: refreshResult.encrypted_refresh_token,
      token_expires_at: refreshResult.token_expires_at,
      token_type: refreshResult.token_type,
    }
  }

  if (!account.encrypted_access_token) {
    return failure("NOT_CONFIGURED", "X_ACCESS_TOKEN_MISSING", "Connected X account is missing an access token")
  }

  let accessToken: string
  try {
    accessToken = decryptToken(account.encrypted_access_token)
  } catch {
    return failure("NOT_CONFIGURED", "X_TOKEN_DECRYPT_FAILED", "Unable to decrypt X access token")
  }

  const postResult = await createXTextPost({ accessToken, text, fetchImpl, getApiBaseUrl })
  if (postResult.ok === false) {
    return failure("FAILED", postResult.error_code, postResult.error_message)
  }

  return {
    ok: true,
    status: "POSTED",
    platform: "x",
    platform_post_id: postResult.platform_post_id,
    posted_at: now().toISOString(),
  }
}
