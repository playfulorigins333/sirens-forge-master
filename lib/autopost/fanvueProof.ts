export type FanvueProofValidationInput = {
  platform?: unknown
  result_kind?: unknown
  provider_post_uuid?: unknown
  provider_publish_at?: unknown
  provider_published_at?: unknown
  provider_account_id?: unknown
  provider_creator_id?: unknown
  provider_media_uuids?: unknown
  content_hash?: unknown
  api_version?: unknown
  verification_needed?: unknown
}

export type FanvueLivePostProof = {
  posted: true
  platform: "fanvue"
  platform_post_id: string
  posted_at: string
  provider_post_uuid: string
  provider_publish_at: string | null
  provider_published_at: string
  provider_account_id: string | null
  provider_creator_id: string | null
  content_hash: string
  api_version: string
  verification_needed: true
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

  const publishedAt = validIso(optionalString(input.provider_published_at))
  if (!publishedAt) {
    return failure("FANVUE_PUBLISHED_AT_REQUIRED", "Fanvue live posted proof requires provider_published_at.")
  }

  const providerAccountId = optionalString(input.provider_account_id)
  const providerCreatorId = optionalString(input.provider_creator_id)
  if (!providerAccountId && !providerCreatorId) {
    return failure("FANVUE_PROVIDER_IDENTITY_REQUIRED", "Fanvue proof requires provider account or creator identity.")
  }

  const contentHash = optionalString(input.content_hash)
  if (!contentHash) {
    return failure("FANVUE_CONTENT_HASH_REQUIRED", "Fanvue proof requires content/job correlation hash.")
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
      provider_publish_at: validIso(optionalString(input.provider_publish_at)),
      provider_published_at: publishedAt,
      provider_account_id: providerAccountId,
      provider_creator_id: providerCreatorId,
      content_hash: contentHash,
      api_version: apiVersion,
      verification_needed: true,
    },
    error_code: null,
    safe_error_message: null,
  }
}
