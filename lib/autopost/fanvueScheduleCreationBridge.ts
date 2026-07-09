import type { FanvueLaunchReadyContentType } from "./fanvueLaunchReadiness"

export const FANVUE_SCHEDULE_CREATION_BRIDGE_GATE = "FANVUE_INTERNAL_SCHEDULE_RULE_CREATION_BRIDGE_ENABLED" as const

export type FanvueScheduleCreationContentPayload = {
  platform: "fanvue"
  content_type: FanvueLaunchReadyContentType
  text?: string
  asset_id?: string
  media_type?: "image" | "video"
  filename?: string
  mime_type?: string
  size?: number
}

export type FanvueScheduleCreationInput = {
  id?: string
  user_id: string
  scheduled_for: string
  selected_platforms: unknown
  content_payload: unknown
  timezone?: string
  start_date?: string | null
  end_date?: string | null
  posts_per_day?: number
  time_slots?: unknown[]
  env?: Record<string, string | undefined>
}

export type FanvueScheduleCreationRow = {
  id: string
  user_id: string
  approval_state: "APPROVED"
  enabled: true
  paused_at: null
  revoked_at: null
  selected_platforms: ["fanvue"]
  next_run_at: string
  timezone: string
  start_date: string | null
  end_date: string | null
  posts_per_day: number
  time_slots: unknown[]
  content_payload: FanvueScheduleCreationContentPayload
}

export type FanvueScheduleCreationResult =
  | { ok: true; row: FanvueScheduleCreationRow }
  | { ok: false; error_code: string; safe_error_message: string }

const FORBIDDEN_FIELDS = [
  "provider_post_id",
  "fanvue_media_uuid",
  "raw_provider_response",
  "signed_url",
  "r2_key",
  "bytes",
  "access_token",
  "refresh_token",
  "token",
  "cookie",
  "header",
  "secret",
  "price",
  "paywall",
  "publishAt",
  "publish_at",
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

export function isFanvueScheduleCreationBridgeEnabled(env: Record<string, string | undefined> = process.env) {
  return env[FANVUE_SCHEDULE_CREATION_BRIDGE_GATE] === "true"
}

type FanvueScheduleContentValidationResult =
  | { ok: true; payload: FanvueScheduleCreationContentPayload }
  | { ok: false; error_code: string; safe_error_message: string }

function validateFanvueScheduleContentPayload(contentPayload: unknown): FanvueScheduleContentValidationResult {
  const payload = asRecord(contentPayload)
  if (!payload) return { ok: false, error_code: "FANVUE_SCHEDULE_CONTENT_PAYLOAD_INVALID", safe_error_message: "Fanvue schedule content payload is invalid." }
  if (payload.platform !== "fanvue") return { ok: false, error_code: "FANVUE_SCHEDULE_PLATFORM_MISMATCH", safe_error_message: "Fanvue schedule content payload must target fanvue." }

  for (const field of FORBIDDEN_FIELDS) {
    if (payload[field] !== undefined && payload[field] !== null) {
      return { ok: false, error_code: "FANVUE_SCHEDULE_FORBIDDEN_FIELD", safe_error_message: "Fanvue schedule creation payload contains a forbidden provider or launch field." }
    }
  }

  const contentType = cleanString(payload.content_type)
  if (contentType !== "text" && contentType !== "image" && contentType !== "video") {
    return { ok: false, error_code: "FANVUE_SCHEDULE_CONTENT_TYPE_UNSUPPORTED", safe_error_message: "Fanvue schedule creation supports text, image, and video only." }
  }

  const text = cleanString(payload.text) ?? undefined
  if (contentType === "text" && !text) return { ok: false, error_code: "FANVUE_SCHEDULE_TEXT_REQUIRED", safe_error_message: "Fanvue text schedule creation requires text." }

  const sanitized: FanvueScheduleCreationContentPayload = { platform: "fanvue", content_type: contentType }
  if (text) sanitized.text = text

  if (contentType === "image" || contentType === "video") {
    const assetId = cleanString(payload.asset_id)
    const mediaType = cleanString(payload.media_type)
    if (!assetId) return { ok: false, error_code: "FANVUE_SCHEDULE_ASSET_REQUIRED", safe_error_message: "Fanvue media schedule creation requires an asset reference." }
    if (mediaType !== contentType) return { ok: false, error_code: "FANVUE_SCHEDULE_MEDIA_TYPE_MISMATCH", safe_error_message: "Fanvue media type must match content type." }
    sanitized.asset_id = assetId
    sanitized.media_type = contentType
    const filename = cleanString(payload.filename)
    const mimeType = cleanString(payload.mime_type)
    const size = safeNumber(payload.size)
    if (filename) sanitized.filename = filename
    if (mimeType) sanitized.mime_type = mimeType
    if (size) sanitized.size = size
  }

  return { ok: true, payload: sanitized }
}

export function buildFanvueScheduleCreationBridgeRow(input: FanvueScheduleCreationInput): FanvueScheduleCreationResult {
  if (!isFanvueScheduleCreationBridgeEnabled(input.env)) {
    return { ok: false, error_code: "FANVUE_SCHEDULE_CREATION_BRIDGE_DISABLED", safe_error_message: "Fanvue internal schedule creation bridge is disabled." }
  }

  if (!Array.isArray(input.selected_platforms) || input.selected_platforms.length !== 1 || input.selected_platforms[0] !== "fanvue") {
    return { ok: false, error_code: "FANVUE_SCHEDULE_PLATFORM_NOT_SELECTED", safe_error_message: "Fanvue must be the only selected platform for this internal bridge." }
  }

  const scheduledFor = cleanString(input.scheduled_for)
  if (!scheduledFor || Number.isNaN(new Date(scheduledFor).getTime())) {
    return { ok: false, error_code: "FANVUE_SCHEDULED_FOR_INVALID", safe_error_message: "Fanvue scheduled time is invalid." }
  }

  const userId = cleanString(input.user_id)
  if (!userId) return { ok: false, error_code: "FANVUE_SCHEDULE_USER_REQUIRED", safe_error_message: "Fanvue schedule creation requires a user." }

  const payload = validateFanvueScheduleContentPayload(input.content_payload)
  if (payload.ok === false) return payload

  return {
    ok: true,
    row: {
      id: cleanString(input.id) ?? `fanvue-schedule-bridge-${payload.payload.content_type}`,
      user_id: userId,
      approval_state: "APPROVED",
      enabled: true,
      paused_at: null,
      revoked_at: null,
      selected_platforms: ["fanvue"],
      next_run_at: new Date(scheduledFor).toISOString(),
      timezone: cleanString(input.timezone) ?? "UTC",
      start_date: cleanString(input.start_date) ?? null,
      end_date: cleanString(input.end_date) ?? null,
      posts_per_day: safeNumber(input.posts_per_day) ?? 1,
      time_slots: Array.isArray(input.time_slots) ? input.time_slots : [],
      content_payload: payload.payload,
    },
  }
}
