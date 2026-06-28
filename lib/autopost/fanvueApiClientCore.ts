import {
  buildFanvueProofCandidateFromReadback,
  buildFanvueReadPostPath,
  type FanvueOfficialPostReadback,
  type FanvueProofValidationInput,
} from "./fanvueProof"

export type FanvueFetchResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

export type FanvueFetch = (url: string, init: {
  method: "GET" | "POST"
  headers: Record<string, string>
  body?: string
}) => Promise<FanvueFetchResponse>

export type FanvueApiClientConfig = {
  apiBaseUrl: string
  apiVersion: string
  accessToken: string
  fetchFn: FanvueFetch
}

export type FanvueApiFailureKind = "NOT_CONFIGURED" | "UNAUTHORIZED" | "RATE_LIMITED" | "TEMPORARY" | "FAILED"

export type FanvueApiFailure = {
  ok: false
  kind: FanvueApiFailureKind
  status: number | null
  error_code: string
  safe_error_message: string
}

export type FanvueCreateTextPostSuccess = {
  ok: true
  status: 201
  posted: false
  kind: "SCHEDULED_CREATED" | "POSTED_READY_FOR_PROOF"
  post: {
    uuid: string
    createdAt: string | null
    text: string | null
    audience: string | null
    publishAt: string | null
    publishedAt: string | null
  }
  proof_candidate: null
}

export type FanvueReadTextPostSuccess = {
  ok: true
  status: number
  posted: false
  kind: "SCHEDULED_CREATED" | "POSTED_READY_FOR_PROOF"
  post: {
    uuid: string
    createdAt: string | null
    text: string
    audience: string
    publishAt: string | null
    publishedAt: string | null
  }
  proof_candidate: FanvueProofValidationInput | null
}

export type FanvueCreateTextPostResult = FanvueCreateTextPostSuccess | FanvueApiFailure
export type FanvueReadTextPostResult = FanvueReadTextPostSuccess | FanvueApiFailure

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FANVUE_TEXT_MAX_LENGTH = 5000

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > 0 ? text : null
}

function normalizeIso(value: unknown) {
  const text = normalizeText(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function failure(kind: FanvueApiFailureKind, status: number | null, error_code: string, safe_error_message: string): FanvueApiFailure {
  return { ok: false, kind, status, error_code, safe_error_message }
}

function classifyHttpFailure(status: number): FanvueApiFailure {
  if (status === 401) return failure("UNAUTHORIZED", status, "FANVUE_HTTP_UNAUTHORIZED", "Fanvue API rejected the access token.")
  if (status === 403) return failure("UNAUTHORIZED", status, "FANVUE_HTTP_FORBIDDEN", "Fanvue API denied the requested action.")
  if (status === 429) return failure("RATE_LIMITED", status, "FANVUE_HTTP_RATE_LIMITED", "Fanvue API rate limited the request.")
  if (status >= 500) return failure("TEMPORARY", status, "FANVUE_HTTP_SERVER_ERROR", "Fanvue API returned a temporary server error.")
  return failure("FAILED", status, "FANVUE_HTTP_REQUEST_FAILED", "Fanvue API request failed.")
}

function normalizeConfig(config: FanvueApiClientConfig): FanvueApiClientConfig | FanvueApiFailure {
  const apiBaseUrl = normalizeText(config.apiBaseUrl)?.replace(/\/$/, "")
  if (!apiBaseUrl) return failure("NOT_CONFIGURED", null, "FANVUE_API_BASE_URL_REQUIRED", "Fanvue API base URL is required.")

  const apiVersion = normalizeText(config.apiVersion)
  if (!apiVersion) return failure("NOT_CONFIGURED", null, "FANVUE_API_VERSION_REQUIRED", "Fanvue API version is required.")

  const accessToken = normalizeText(config.accessToken)
  if (!accessToken) return failure("NOT_CONFIGURED", null, "FANVUE_ACCESS_TOKEN_REQUIRED", "Fanvue access token is required in memory.")

  if (typeof config.fetchFn !== "function") {
    return failure("NOT_CONFIGURED", null, "FANVUE_FETCH_FN_REQUIRED", "Fanvue API client requires an injected fetch function.")
  }

  return { ...config, apiBaseUrl, apiVersion, accessToken }
}

async function parseJsonResponse(response: FanvueFetchResponse): Promise<{ ok: true; body: Record<string, unknown> } | FanvueApiFailure> {
  const raw = await response.text().catch(() => null)
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return failure("FAILED", response.status, "FANVUE_RESPONSE_BODY_INVALID", "Fanvue API response body was empty or unreadable.")
  }

  const parsed = JSON.parse(raw) as unknown
  const body = asRecord(parsed)
  if (!body) {
    return failure("FAILED", response.status, "FANVUE_RESPONSE_JSON_INVALID", "Fanvue API response JSON was not an object.")
  }

  return { ok: true, body }
}

async function safeJsonResponse(response: FanvueFetchResponse): Promise<{ ok: true; body: Record<string, unknown> } | FanvueApiFailure> {
  try {
    return await parseJsonResponse(response)
  } catch {
    return failure("FAILED", response.status, "FANVUE_RESPONSE_JSON_INVALID", "Fanvue API response JSON could not be parsed safely.")
  }
}

function isFailure(value: FanvueApiClientConfig | FanvueApiFailure): value is FanvueApiFailure {
  return "ok" in value && value.ok === false
}

function commonHeaders(config: FanvueApiClientConfig) {
  return {
    authorization: `Bearer ${config.accessToken}`,
    "content-type": "application/json",
    "X-Fanvue-API-Version": config.apiVersion,
  }
}

function normalizeCreateKind(publishAt: string | null, publishedAt: string | null) {
  return publishAt && !publishedAt ? "SCHEDULED_CREATED" as const : "POSTED_READY_FOR_PROOF" as const
}

function validateTextAudience(input: { text?: unknown; audience?: unknown }): { ok: true; text: string; audience: string } | FanvueApiFailure {
  const text = normalizeText(input.text)
  if (!text) return failure("FAILED", null, "EMPTY_FANVUE_TEXT", "Fanvue text content is required.")
  if (Array.from(text).length > FANVUE_TEXT_MAX_LENGTH) {
    return failure("FAILED", null, "FANVUE_TEXT_TOO_LONG", "Fanvue text content exceeds the local limit.")
  }

  const audience = normalizeText(input.audience)
  if (!audience) return failure("FAILED", null, "FANVUE_AUDIENCE_REQUIRED", "Fanvue audience is required.")

  return { ok: true, text, audience }
}

export function createFanvueApiClient(configInput: FanvueApiClientConfig) {
  const config = normalizeConfig(configInput)

  async function createTextPost(input: { text?: unknown; audience?: unknown; publishAt?: unknown }): Promise<FanvueCreateTextPostResult> {
    if (isFailure(config)) return config

    const textAudience = validateTextAudience(input)
    if ("error_code" in textAudience) return textAudience

    const publishAt = normalizeIso(input.publishAt)
    const body: Record<string, unknown> = {
      text: textAudience.text,
      audience: textAudience.audience,
    }
    if (publishAt) body.publishAt = publishAt

    const response = await config.fetchFn(`${config.apiBaseUrl}/posts`, {
      method: "POST",
      headers: commonHeaders(config),
      body: JSON.stringify(body),
    }).catch(() => null)

    if (!response) return failure("TEMPORARY", null, "FANVUE_NETWORK_ERROR", "Fanvue API request failed before a response was received.")
    if (!response.ok) return classifyHttpFailure(response.status)

    const parsed = await safeJsonResponse(response)
    if ("error_code" in parsed) return parsed

    const uuid = normalizeText(parsed.body.uuid)
    if (!uuid || !UUID_RE.test(uuid)) {
      return failure("FAILED", response.status, "FANVUE_POST_UUID_MISSING", "Fanvue create-post response did not include an official post UUID.")
    }

    const createdAt = normalizeIso(parsed.body.createdAt)
    const responseText = normalizeText(parsed.body.text)
    const responseAudience = normalizeText(parsed.body.audience)
    const responsePublishAt = normalizeIso(parsed.body.publishAt)
    const responsePublishedAt = normalizeIso(parsed.body.publishedAt)

    return {
      ok: true,
      status: 201,
      posted: false,
      kind: normalizeCreateKind(responsePublishAt, responsePublishedAt),
      post: {
        uuid,
        createdAt,
        text: responseText,
        audience: responseAudience,
        publishAt: responsePublishAt,
        publishedAt: responsePublishedAt,
      },
      proof_candidate: null,
    }
  }

  async function readTextPost(input: {
    uuid?: unknown
    expectedText?: unknown
    expectedAudience?: unknown
    expectedContentHash?: string | null
    jobId?: string | null
    ruleId?: string | null
    userId?: string | null
    scheduledFor?: string | null
  }): Promise<FanvueReadTextPostResult> {
    if (isFailure(config)) return config

    const uuid = normalizeText(input.uuid)
    if (!uuid || !UUID_RE.test(uuid)) {
      return failure("FAILED", null, "FANVUE_POST_UUID_INVALID", "Fanvue read-back requires an official post UUID.")
    }

    const expected = validateTextAudience({ text: input.expectedText, audience: input.expectedAudience })
    if ("error_code" in expected) return expected

    const response = await config.fetchFn(`${config.apiBaseUrl}${buildFanvueReadPostPath(uuid)}`, {
      method: "GET",
      headers: commonHeaders(config),
    }).catch(() => null)

    if (!response) return failure("TEMPORARY", null, "FANVUE_NETWORK_ERROR", "Fanvue API request failed before a response was received.")
    if (!response.ok) return classifyHttpFailure(response.status)

    const parsed = await safeJsonResponse(response)
    if ("error_code" in parsed) return parsed

    const responseUuid = normalizeText(parsed.body.uuid)
    if (!responseUuid || !UUID_RE.test(responseUuid) || responseUuid !== uuid) {
      return failure("FAILED", response.status, "FANVUE_READBACK_UUID_MISMATCH", "Fanvue read-back UUID did not match the requested post.")
    }

    const responseText = normalizeText(parsed.body.text)
    if (!responseText || responseText !== expected.text) {
      return failure("FAILED", response.status, "FANVUE_READBACK_TEXT_MISMATCH", "Fanvue read-back text did not match the expected text.")
    }

    const responseAudience = normalizeText(parsed.body.audience)
    if (!responseAudience || responseAudience !== expected.audience) {
      return failure("FAILED", response.status, "FANVUE_READBACK_AUDIENCE_MISMATCH", "Fanvue read-back audience did not match the expected audience.")
    }

    const createdAt = normalizeIso(parsed.body.createdAt)
    const publishAt = normalizeIso(parsed.body.publishAt)
    const publishedAt = normalizeIso(parsed.body.publishedAt)
    const kind = normalizeCreateKind(publishAt, publishedAt)
    const proofCandidate = publishedAt
      ? buildFanvueProofCandidateFromReadback({
          post: parsed.body as FanvueOfficialPostReadback,
          expected_text: expected.text,
          expected_audience: expected.audience,
          expected_content_hash: input.expectedContentHash ?? null,
          api_version: config.apiVersion,
          job_id: input.jobId ?? null,
          rule_id: input.ruleId ?? null,
          user_id: input.userId ?? null,
          scheduled_for: input.scheduledFor ?? null,
        })
      : null

    return {
      ok: true,
      status: response.status,
      posted: false,
      kind,
      post: {
        uuid: responseUuid,
        createdAt,
        text: responseText,
        audience: responseAudience,
        publishAt,
        publishedAt,
      },
      proof_candidate: proofCandidate,
    }
  }

  return { createTextPost, readTextPost }
}
