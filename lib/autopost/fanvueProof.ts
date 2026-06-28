import crypto from "crypto"

export const FANVUE_CREATE_POST_PATH = "/posts" as const
export const FANVUE_READ_POST_PATH_TEMPLATE = "/posts/{uuid}" as const

export type FanvueProofValidationInput = {
  platform?: unknown
  result_kind?: unknown
  provider_post_uuid?: unknown
  provider_publish_at?: unknown
  provider_published_at?: unknown
  provider_created_at?: unknown
  provider_text?: unknown
  expected_text?: unknown
  provider_audience?: unknown
  expected_audience?: unknown
  provider_media_uuids?: unknown
  provider_account_id?: unknown
  provider_creator_id?: unknown
  content_hash?: unknown
  expected_content_hash?: unknown
  api_version?: unknown
  verification_needed?: unknown
  job_id?: unknown
  rule_id?: unknown
  user_id?: unknown
  scheduled_for?: unknown
}

export type FanvueOfficialPostReadback = {
  uuid?: unknown
  createdAt?: unknown
  text?: unknown
  price?: unknown
  mediaPreviewUuid?: unknown
  audience?: unknown
  publishAt?: unknown
  publishedAt?: unknown
  expiresAt?: unknown
  mediaUuids?: unknown
  isPinned?: unknown
  likesCount?: unknown
  commentsCount?: unknown
  tips?: unknown
  collections?: unknown
}

export type FanvueLivePostProof = {
  posted: true
  platform: "fanvue"
  platform_post_id: string
  posted_at: string
  provider_post_uuid: string
  provider_publish_at: string | null
  provider_published_at: string
  provider_created_at: string | null
  provider_text: string
  provider_audience: string
  provider_account_id: string | null
  provider_creator_id: string | null
  content_hash: string
  api_version: string
  verification_needed: true
  job_id?: string | null
  rule_id?: string | null
  user_id?: string | null
  scheduled_for?: string | null
}

export type FanvueProofValidationResult =
  | {
      posted: true
      result_status: "POSTED_READY_FOR_PROOF"
      proof: FanvueLivePostProof
      error_code: null
      safe_error_message: null
    }
  | {
      posted: false
      result_status: "FAILED" | "SCHEDULED_CREATED"
      proof: null
      error_code: string
      safe_error_message: string
    }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function validIso(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

function failure(
  error_code: string,
  safe_error_message: string,
  result_status: "FAILED" | "SCHEDULED_CREATED" = "FAILED"
): FanvueProofValidationResult {
  return { posted: false, result_status, proof: null, error_code, safe_error_message }
}

function hashReadbackContent(input: { text: string; audience: string; publishAt: string | null }) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex")
}

export function isFanvuePostVerifyEnabled() {
  return process.env.FANVUE_POST_VERIFY_ENABLED === "true"
}

export function buildFanvueReadPostPath(uuid: string) {
  return `/posts/${encodeURIComponent(uuid)}`
}

export function buildFanvueProofCandidateFromReadback(input: {
  post: FanvueOfficialPostReadback
  expected_text: string
  expected_audience: string
  expected_content_hash?: string | null
  api_version: string
  job_id?: string | null
  rule_id?: string | null
  user_id?: string | null
  scheduled_for?: string | null
}): FanvueProofValidationInput {
  return {
    platform: "fanvue",
    result_kind: "POSTED_READY_FOR_PROOF",
    verification_needed: true,
    provider_post_uuid: input.post.uuid,
    provider_created_at: input.post.createdAt,
    provider_text: input.post.text,
    expected_text: input.expected_text,
    provider_audience: input.post.audience,
    expected_audience: input.expected_audience,
    provider_publish_at: input.post.publishAt,
    provider_published_at: input.post.publishedAt,
    provider_media_uuids: input.post.mediaUuids,
    content_hash: hashReadbackContent({
      text: input.expected_text,
      audience: input.expected_audience,
      publishAt: validIso(optionalString(input.post.publishAt)),
    }),
    expected_content_hash: input.expected_content_hash ?? null,
    api_version: input.api_version,
    job_id: input.job_id ?? null,
    rule_id: input.rule_id ?? null,
    user_id: input.user_id ?? null,
    scheduled_for: input.scheduled_for ?? null,
  }
}

export function validateFanvueLivePostProof(input: FanvueProofValidationInput): FanvueProofValidationResult {
  if (input.platform !== "fanvue") {
    return failure("FANVUE_PROOF_PLATFORM_INVALID", "Fanvue proof platform must be fanvue.")
  }

  if (input.verification_needed !== true) {
    return failure("FANVUE_PROOF_VERIFICATION_FLAG_MISSING", "Fanvue proof candidate must require verification.")
  }

  if (input.result_kind === "SCHEDULED_CREATED") {
    return failure(
      "FANVUE_SCHEDULED_CREATED_NOT_POSTED",
      "Fanvue scheduled-created proof is not live posted proof.",
      "SCHEDULED_CREATED"
    )
  }

  if (input.result_kind !== "POSTED_READY_FOR_PROOF") {
    return failure("FANVUE_PROOF_RESULT_KIND_INVALID", "Fanvue proof result kind is not live-post proof-ready.")
  }

  const providerPostUuid = optionalString(input.provider_post_uuid)
  if (!providerPostUuid || !UUID_RE.test(providerPostUuid)) {
    return failure("FANVUE_POST_UUID_INVALID", "Fanvue proof requires an official post UUID.")
  }

  const mediaUuids = stringArray(input.provider_media_uuids)
  if (mediaUuids.includes(providerPostUuid)) {
    return failure("FANVUE_MEDIA_UUID_NOT_POST_ID", "Fanvue media UUID must not be used as post proof id.")
  }

  const publishAt = validIso(optionalString(input.provider_publish_at))
  const publishedAt = validIso(optionalString(input.provider_published_at))
  if (!publishedAt) {
    if (publishAt) {
      return failure(
        "FANVUE_SCHEDULED_CREATED_NOT_POSTED",
        "Fanvue publishAt without publishedAt is scheduled-created, not posted proof.",
        "SCHEDULED_CREATED"
      )
    }
    return failure("FANVUE_PUBLISHED_AT_REQUIRED", "Fanvue live posted proof requires provider_published_at.")
  }

  const providerText = optionalString(input.provider_text)
  const expectedText = optionalString(input.expected_text)
  if (!providerText || !expectedText || providerText !== expectedText) {
    return failure("FANVUE_TEXT_PROOF_MISMATCH", "Fanvue proof requires read-back text to match expected text.")
  }

  const providerAudience = optionalString(input.provider_audience)
  const expectedAudience = optionalString(input.expected_audience)
  if (!providerAudience || !expectedAudience || providerAudience !== expectedAudience) {
    return failure("FANVUE_AUDIENCE_PROOF_MISMATCH", "Fanvue proof requires read-back audience to match expected audience.")
  }

  const contentHash = optionalString(input.content_hash)
  if (!contentHash) {
    return failure("FANVUE_CONTENT_HASH_REQUIRED", "Fanvue proof requires content/job correlation hash.")
  }

  const expectedContentHash = optionalString(input.expected_content_hash)
  if (expectedContentHash && expectedContentHash !== contentHash) {
    return failure("FANVUE_CONTENT_HASH_MISMATCH", "Fanvue proof content hash does not match the expected job hash.")
  }

  const apiVersion = optionalString(input.api_version)
  if (!apiVersion) {
    return failure("FANVUE_API_VERSION_REQUIRED", "Fanvue proof requires API version metadata.")
  }

  return {
    posted: true,
    result_status: "POSTED_READY_FOR_PROOF",
    proof: {
      posted: true,
      platform: "fanvue",
      platform_post_id: providerPostUuid,
      posted_at: publishedAt,
      provider_post_uuid: providerPostUuid,
      provider_publish_at: publishAt,
      provider_published_at: publishedAt,
      provider_created_at: validIso(optionalString(input.provider_created_at)),
      provider_text: providerText,
      provider_audience: providerAudience,
      provider_account_id: optionalString(input.provider_account_id),
      provider_creator_id: optionalString(input.provider_creator_id),
      content_hash: contentHash,
      api_version: apiVersion,
      verification_needed: true,
      job_id: optionalString(input.job_id),
      rule_id: optionalString(input.rule_id),
      user_id: optionalString(input.user_id),
      scheduled_for: validIso(optionalString(input.scheduled_for)),
    },
    error_code: null,
    safe_error_message: null,
  }
}
