/**
 * Autopost Phase 3 — Core Executor
 *
 * Pure orchestration logic.
 * Called by jobs/runAutopostJob.ts
 *
 * NO Supabase calls
 * NO writes
 * NO scheduling
 */

import { selectCaption } from '../selectCaption'
import { selectCTA } from '../selectCTA'
import { selectHashtags } from '../selectHashtags'

/* =========================
   Types
========================= */

export type AutopostState =
  | 'READY'
  | 'PARTIAL_READY'
  | 'BLOCKED'
  | 'ERROR'

export type AutopostFailureCode =
  | 'NO_ELIGIBLE_CAPTIONS'
  | 'DETERMINISM_VIOLATION'
  | 'UNKNOWN_ERROR'

export type AutopostInput = {
  captions: any[]
  ctas: any[]
  hashtag_sets: any[]

  platform: string
  comfort_explicitness_max: number
  cooldown_seconds: number
  tone_allowlist?: string[]
  platform_limits: {
    max_hashtags: number
  }

  current_time_iso: string

  revenue_split: {
    creator_pct: number
    platform_pct: number
  }
}

export type AutopostPayload = {
  caption_text: string
  cta_text: string | null
  hashtags: string[] | null
  platform: string
  revenue: {
    creator_pct: number
    platform_pct: number
  }
}

export type AutopostResult =
  | {
      state: 'READY' | 'PARTIAL_READY'
      payload: AutopostPayload
      diagnostics: Record<string, unknown>
    }
  | {
      state: 'BLOCKED'
      reason: AutopostFailureCode
      diagnostics: Record<string, unknown>
    }
  | {
      state: 'ERROR'
      reason: AutopostFailureCode
      diagnostics?: Record<string, unknown>
    }

/* =========================
   Executor
========================= */

export function runAutopost(input: AutopostInput): AutopostResult {
  const diagnostics: Record<string, unknown> = {
    platform: input.platform,
    timestamp: input.current_time_iso,
  }

  /* 1️⃣ Caption (REQUIRED) */
  const captionResult = selectCaption({
    captions: input.captions,
    platform: input.platform,
    comfort_explicitness_max: input.comfort_explicitness_max,
    cooldown_seconds: input.cooldown_seconds,
    tone_allowlist: input.tone_allowlist,
    current_time_iso: input.current_time_iso,
  })

  diagnostics.caption = captionResult

  if (captionResult.status === 'failure') {
    return {
      state: 'BLOCKED',
      reason: captionResult.code,
      diagnostics,
    }
  }

  /* 2️⃣ CTA (OPTIONAL) */
  const ctaResult = selectCTA({
    ctas: input.ctas,
    platform: input.platform,
    tone_allowlist: input.tone_allowlist,
    explicitness_level: captionResult.caption.explicitness_level,
    current_time_iso: input.current_time_iso,
  })

  diagnostics.cta = ctaResult

  /* 3️⃣ Hashtags (OPTIONAL) */
  const hashtagsResult = selectHashtags({
    hashtag_sets: input.hashtag_sets,
    platform: input.platform,
    platform_limits: input.platform_limits,
    tone_allowlist: input.tone_allowlist,
    explicitness_level: captionResult.caption.explicitness_level,
    current_time_iso: input.current_time_iso,
  })

  diagnostics.hashtags = hashtagsResult

  /* 4️⃣ Assemble payload */
  const payload: AutopostPayload = {
    caption_text: captionResult.caption.caption_text,
    cta_text:
      ctaResult.status === 'success'
        ? ctaResult.cta.cta_text
        : null,
    hashtags:
      hashtagsResult.status === 'success'
        ? hashtagsResult.hashtags
        : null,
    platform: input.platform,
    revenue: input.revenue_split,
  }

  /* 5️⃣ Resolve state */
  if (
    ctaResult.status === 'success' &&
    hashtagsResult.status === 'success'
  ) {
    return { state: 'READY', payload, diagnostics }
  }

  return { state: 'PARTIAL_READY', payload, diagnostics }
}
