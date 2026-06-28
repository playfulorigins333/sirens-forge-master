import { buildFanvueProofCandidateFromReadback, validateFanvueLivePostProof, type FanvueProofValidationResult } from "./fanvueProof"

export type FanvueFetch = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }) => Promise<FanvueFetchResponse>

export type FanvueFetchResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type FanvueApiClientConfig = {
  accessToken: string
  apiBaseUrl: string
  apiVersion: string
  fetch: FanvueFetch
}

export type FanvueCreateTextPostInput = {
  text: string
  audience: string
  publishAt?: string | null
}

export type FanvueReadPostInput = {
  uuid: string
  expectedText: string
  expectedAudience: string
  expectedContentHash?: string | null
  jobId?: string | null
  ruleId?: string | null
  userId?: string | null
  scheduledFor?: string | null
}

type NormalizedPost = {
  uuid: string
  text: string | null
  audience: string | null
  publishAt: string | null
  publishedAt: string | null
  createdAt: string | null
  mediaUuids: string[]
}

export type FanvueApiFailureKind = "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED" | "SERVER_ERROR" | "MALFORMED_JSON" | "FAILED"

export type FanvueApiFailure = {
  ok: false
  kind: FanvueApiFailureKind
  status: number | null
  error_code: string
  safe_error_message: string
}

export type FanvueCreatePostResult =
  | {
      ok: true
      result_kind: "SCHEDULED_CREATED"
      post: Pick<NormalizedPost, "uuid" | "publishAt" | "publishedAt">
      posted_proof: false
    }
  | FanvueApiFailure

export type FanvueReadPostResult =
  | {
      ok: true
      result_kind: "POSTED_READY_FOR_PROOF" | "SCHEDULED_CREATED"
      post: NormalizedPost
      proof_candidate: ReturnType<typeof buildFanvueProofCandidateFromReadback> | null
      proof_validation: FanvueProofValidationResult
    }
  | FanvueApiFailure

function clean(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function isoOrNull(value: unknown) {
  const text = clean(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function failure(kind: FanvueApiFailureKind, status: number | null, error_code: string, safe_error_message: string): FanvueApiFailure {
  return { ok: false, kind, status, error_code, safe_error_message }
}

function classifyStatus(status: number): FanvueApiFailure {
  if (status === 401) return failure("UNAUTHORIZED", status, "FANVUE_UNAUTHORIZED", "Fanvue rejected the request authorization.")
  if (status === 403) return failure("FORBIDDEN", status, "FANVUE_FORBIDDEN", "Fanvue refused the request permissions.")
  if (status === 429) return failure("RATE_LIMITED", status, "FANVUE_RATE_LIMITED", "Fanvue rate limited the request.")
  if (status >= 500) return failure("SERVER_ERROR", status, "FANVUE_SERVER_ERROR", "Fanvue returned a server error.")
  return failure("FAILED", status, "FANVUE_REQUEST_FAILED", "Fanvue request failed.")
}

async function safeJson(response: FanvueFetchResponse) {
  try {
    return { ok: true as const, data: await response.json() }
  } catch {
    return { ok: false as const, error: failure("MALFORMED_JSON", response.status, "FANVUE_MALFORMED_JSON", "Fanvue returned malformed JSON.") }
  }
}

function requireConfig(config: FanvueApiClientConfig): FanvueApiFailure | null {
  if (!clean(config.accessToken)) return failure("FAILED", null, "FANVUE_ACCESS_TOKEN_REQUIRED", "Fanvue access token is required in memory.")
  if (!clean(config.apiBaseUrl)) return failure("FAILED", null, "FANVUE_API_BASE_URL_REQUIRED", "Fanvue API base URL is required.")
  if (!clean(config.apiVersion)) return failure("FAILED", null, "FANVUE_API_VERSION_REQUIRED", "Fanvue API version is required.")
  if (typeof config.fetch !== "function") return failure("FAILED", null, "FANVUE_FETCH_REQUIRED", "Fanvue fetch implementation is required.")
  return null
}

function headers(config: FanvueApiClientConfig) {
  return {
    Authorization: `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
    "X-Fanvue-API-Version": config.apiVersion,
  }
}

function endpoint(config: FanvueApiClientConfig, path: string) {
  return `${config.apiBaseUrl.replace(/\/+$/, "")}${path}`
}

function normalizePost(data: unknown): NormalizedPost | null {
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  const uuid = clean(record.uuid)
  if (!uuid) return null
  const mediaUuids = Array.isArray(record.mediaUuids) ? record.mediaUuids.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []
  return {
    uuid,
    text: clean(record.text),
    audience: clean(record.audience),
    publishAt: isoOrNull(record.publishAt),
    publishedAt: isoOrNull(record.publishedAt),
    createdAt: isoOrNull(record.createdAt),
    mediaUuids,
  }
}

export async function createFanvueTextPost(config: FanvueApiClientConfig, input: FanvueCreateTextPostInput): Promise<FanvueCreatePostResult> {
  const configError = requireConfig(config)
  if (configError) return configError
  const text = clean(input.text)
  if (!text) return failure("FAILED", null, "FANVUE_TEXT_REQUIRED", "Fanvue text is required.")
  const audience = clean(input.audience)
  if (!audience) return failure("FAILED", null, "FANVUE_AUDIENCE_REQUIRED", "Fanvue audience is required.")

  const body: Record<string, string> = { text, audience }
  const publishAt = isoOrNull(input.publishAt)
  if (publishAt) body.publishAt = publishAt

  let response: FanvueFetchResponse
  try {
    response = await config.fetch(endpoint(config, "/posts"), { method: "POST", headers: headers(config), body: JSON.stringify(body) })
  } catch {
    return failure("FAILED", null, "FANVUE_NETWORK_FAILED", "Fanvue request failed.")
  }
  if (!response.ok) return classifyStatus(response.status)
  const parsed = await safeJson(response)
  if (!parsed.ok) return parsed.error
  const post = normalizePost(parsed.data)
  if (!post) return failure("MALFORMED_JSON", response.status, "FANVUE_POST_UUID_MISSING", "Fanvue response did not include a post UUID.")
  return { ok: true, result_kind: "SCHEDULED_CREATED", post: { uuid: post.uuid, publishAt: post.publishAt, publishedAt: post.publishedAt }, posted_proof: false }
}

export async function readFanvuePost(config: FanvueApiClientConfig, input: FanvueReadPostInput): Promise<FanvueReadPostResult> {
  const configError = requireConfig(config)
  if (configError) return configError
  const uuid = clean(input.uuid)
  if (!uuid) return failure("FAILED", null, "FANVUE_POST_UUID_REQUIRED", "Fanvue post UUID is required.")
  let response: FanvueFetchResponse
  try {
    response = await config.fetch(endpoint(config, `/posts/${encodeURIComponent(uuid)}`), { method: "GET", headers: headers(config) })
  } catch {
    return failure("FAILED", null, "FANVUE_NETWORK_FAILED", "Fanvue request failed.")
  }
  if (!response.ok) return classifyStatus(response.status)
  const parsed = await safeJson(response)
  if (!parsed.ok) return parsed.error
  const post = normalizePost(parsed.data)
  if (!post) return failure("MALFORMED_JSON", response.status, "FANVUE_POST_UUID_MISSING", "Fanvue response did not include a post UUID.")
  if (post.uuid !== uuid) return failure("FAILED", response.status, "FANVUE_POST_UUID_MISMATCH", "Fanvue read-back UUID did not match.")

  const proofCandidate = post.publishedAt
    ? buildFanvueProofCandidateFromReadback({ post, expected_text: input.expectedText, expected_audience: input.expectedAudience, expected_content_hash: input.expectedContentHash, api_version: config.apiVersion, job_id: input.jobId, rule_id: input.ruleId, user_id: input.userId, scheduled_for: input.scheduledFor })
    : null
  const proofValidation = proofCandidate
    ? validateFanvueLivePostProof(proofCandidate)
    : validateFanvueLivePostProof({ platform: "fanvue", verification_needed: true, result_kind: "SCHEDULED_CREATED", provider_post_uuid: post.uuid, provider_publish_at: post.publishAt, provider_published_at: post.publishedAt, provider_text: post.text, expected_text: input.expectedText, provider_audience: post.audience, expected_audience: input.expectedAudience, api_version: config.apiVersion })
  if (proofCandidate && !proofValidation.posted) return failure("FAILED", response.status, proofValidation.error_code, proofValidation.safe_error_message)
  return { ok: true, result_kind: proofCandidate ? "POSTED_READY_FOR_PROOF" : "SCHEDULED_CREATED", post, proof_candidate: proofCandidate, proof_validation: proofValidation }
}
