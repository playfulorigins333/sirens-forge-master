/**
 * Autopost Phase 3 — Job Runner
 *
 * Infra boundary only.
 * Calls the pure executor and reacts to its state.
 */

import { runAutopost } from '../executor/autopostExecutor'

export type AutopostJobInput = {
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

  revenue_split: {
    creator_pct: number
    platform_pct: number
  }
}

export async function runAutopostJob(
  input: AutopostJobInput
): Promise<void> {
  const nowIso = new Date().toISOString()

  const result = runAutopost({
    captions: input.captions,
    ctas: input.ctas,
    hashtag_sets: input.hashtag_sets,

    platform: input.platform,
    comfort_explicitness_max: input.comfort_explicitness_max,
    cooldown_seconds: input.cooldown_seconds,
    tone_allowlist: input.tone_allowlist,

    platform_limits: input.platform_limits,
    current_time_iso: nowIso,

    revenue_split: input.revenue_split,
  })

  if (result.state === 'READY') {
    console.log('[AUTOP0ST] READY', result.payload)
    return
  }

  if (result.state === 'PARTIAL_READY') {
    console.log('[AUTOP0ST] PARTIAL_READY', result.payload)
    return
  }

  if (result.state === 'BLOCKED') {
    console.warn(
      '[AUTOP0ST] BLOCKED',
      result.reason,
      result.diagnostics
    )
    return
  }

  if (result.state === 'ERROR') {
    console.error(
      '[AUTOP0ST] ERROR',
      result.reason,
      result.diagnostics
    )
    return
  }
}
