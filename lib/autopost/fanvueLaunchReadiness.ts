import type { PlatformId } from "./types"

export type FanvueLaunchReadyContentType = "text" | "image" | "video"

export type FanvueLaunchReadyJobPayload = {
  platform: "fanvue"
  rule_id: string
  user_id: string
  scheduled_for: string
  content_type: FanvueLaunchReadyContentType
  text: string | null
  media: null | {
    asset_id: string
    media_type: "image" | "video"
    filename: string | null
    content_type: string | null
    size: number | null
  }
  internal_launch_readiness_only: true
  dispatch_enabled: false
  live_gate_required: "FANVUE_RUN_DISPATCH_ENABLED"
  price: null
  paywall: null
  publish_at: null
}

export type FanvueLaunchReadyValidationResult =
  | { valid: true; payload: FanvueLaunchReadyJobPayload }
  | { valid: false; error_code: string; safe_error_message: string }

const TEXT_MAX = 5000
const SAFE_MEDIA_TYPES = new Set(["image", "video"])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function safeSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

function validateNoForbiddenLaunchFields(payload: Record<string, unknown>) {
  for (const field of ["price", "paywall", "publishAt", "publish_at", "fanvue_media_uuid", "mediaUuid", "mediaUuids", "provider_post_id", "providerPostId", "raw_provider_response", "provider_response", "signed_url", "signedUrl", "r2_key", "bytes", "headers", "cookies", "access_token", "refresh_token", "token"]) {
    if (field in payload && payload[field] !== null && payload[field] !== undefined) {
      return field
    }
  }
  return null
}

export function isFanvueInternalLaunchReadinessEnabled(env: Record<string, string | undefined> = process.env) {
  return env.FANVUE_INTERNAL_LAUNCH_READINESS_ENABLED === "true"
}

export function validateFanvueLaunchReadyContentPayload(args: {
  rule_id: string
  user_id: string
  scheduled_for: string
  content_payload: unknown
  selected_platforms?: unknown
  env?: Record<string, string | undefined>
}): FanvueLaunchReadyValidationResult {
  if (!isFanvueInternalLaunchReadinessEnabled(args.env)) {
    return { valid: false, error_code: "FANVUE_INTERNAL_LAUNCH_READINESS_DISABLED", safe_error_message: "Fanvue launch-readiness payload bridging is disabled." }
  }

  if (Array.isArray(args.selected_platforms) && !args.selected_platforms.includes("fanvue" satisfies PlatformId)) {
    return { valid: false, error_code: "FANVUE_PLATFORM_NOT_SELECTED", safe_error_message: "Fanvue must be selected on the rule." }
  }

  const payload = asRecord(args.content_payload)
  if (!payload) return { valid: false, error_code: "CONTENT_PAYLOAD_INVALID", safe_error_message: "Content payload is invalid." }
  if (payload.platform !== "fanvue") return { valid: false, error_code: "CONTENT_PLATFORM_MISMATCH", safe_error_message: "Content payload platform must be fanvue." }

  const forbidden = validateNoForbiddenLaunchFields(payload)
  if (forbidden) return { valid: false, error_code: "FANVUE_FORBIDDEN_PROVIDER_FIELD", safe_error_message: `Fanvue launch-readiness payload cannot include ${forbidden}.` }

  const rawType = clean(payload.content_type) ?? "text"
  const contentType = rawType === "image" || rawType === "video" ? rawType : rawType === "media" ? clean(payload.media_type) : rawType
  if (contentType !== "text" && contentType !== "image" && contentType !== "video") {
    return { valid: false, error_code: "CONTENT_TYPE_UNSUPPORTED", safe_error_message: "Fanvue launch-readiness supports text, image, and video payload shapes only." }
  }

  const text = clean(payload.text)
  if (contentType === "text" && !text) return { valid: false, error_code: "FANVUE_TEXT_REQUIRED", safe_error_message: "Fanvue text content is required." }
  if (text && Array.from(text).length > TEXT_MAX) return { valid: false, error_code: "FANVUE_TEXT_TOO_LONG", safe_error_message: "Fanvue text content exceeds 5000 characters." }

  let media: FanvueLaunchReadyJobPayload["media"] = null
  if (contentType === "image" || contentType === "video") {
    const assetId = clean(payload.asset_id) ?? clean(payload.media_asset_id)
    if (!assetId) return { valid: false, error_code: "FANVUE_MEDIA_ASSET_REQUIRED", safe_error_message: "Fanvue media jobs require a server-owned media asset reference." }
    const mediaType = clean(payload.media_type) ?? contentType
    if (!SAFE_MEDIA_TYPES.has(mediaType) || mediaType !== contentType) return { valid: false, error_code: "FANVUE_MEDIA_TYPE_MISMATCH", safe_error_message: "Fanvue media type must match the content type." }
    media = {
      asset_id: assetId,
      media_type: contentType,
      filename: clean(payload.filename),
      content_type: clean(payload.mime_type) ?? clean(payload.contentType),
      size: safeSize(payload.size),
    }
  }

  return {
    valid: true,
    payload: {
      platform: "fanvue",
      rule_id: args.rule_id,
      user_id: args.user_id,
      scheduled_for: args.scheduled_for,
      content_type: contentType,
      text,
      media,
      internal_launch_readiness_only: true,
      dispatch_enabled: false,
      live_gate_required: "FANVUE_RUN_DISPATCH_ENABLED",
      price: null,
      paywall: null,
      publish_at: null,
    },
  }
}
