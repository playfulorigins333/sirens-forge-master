/**
 * Autopost Phase 3 — selectCaption
 * Deterministic caption selector (pure function).
 *
 * NO Supabase
 * NO side effects
 * NO mutations
 */

export type CaptionRecord = {
  caption_id: string
  caption_text: string
  approved: boolean
  active: boolean
  platform: string
  explicitness_level: number
  tone?: string[]
  job_id?: string
  times_used: number
  last_used_at: string | null
}

export type SelectCaptionInput = {
  captions: CaptionRecord[]
  platform: string
  comfort_explicitness_max: number
  cooldown_seconds: number
  tone_allowlist?: string[]
  current_time_iso: string
}

export type SelectCaptionSuccess = {
  status: 'success'
  caption: CaptionRecord
  diagnostics: Record<string, unknown>
}

export type SelectCaptionFailure = {
  status: 'failure'
  code: 'NO_ELIGIBLE_CAPTIONS' | 'DETERMINISM_VIOLATION'
}

export type SelectCaptionResult =
  | SelectCaptionSuccess
  | SelectCaptionFailure

export function selectCaption(
  input: SelectCaptionInput
): SelectCaptionResult {
  const {
    captions,
    platform,
    comfort_explicitness_max,
    cooldown_seconds,
    tone_allowlist,
    current_time_iso,
  } = input

  const now = Date.parse(current_time_iso)
  if (Number.isNaN(now)) {
    return { status: 'failure', code: 'DETERMINISM_VIOLATION' }
  }

  const diagnostics = {
    candidate_count: captions.length,
    rejected: {
      not_approved: 0,
      not_active: 0,
      platform_mismatch: 0,
      explicitness_too_high: 0,
      cooldown_not_met: 0,
      tone_mismatch: 0,
    },
  }

  /* 1️⃣ Approved / Active / Platform */
  let pool = captions.filter(c => {
    if (!c.approved) {
      diagnostics.rejected.not_approved++
      return false
    }
    if (!c.active) {
      diagnostics.rejected.not_active++
      return false
    }
    if (c.platform !== platform) {
      diagnostics.rejected.platform_mismatch++
      return false
    }
    return true
  })

  if (pool.length === 0) {
    return { status: 'failure', code: 'NO_ELIGIBLE_CAPTIONS' }
  }

  /* 2️⃣ Explicitness */
  pool = pool.filter(c => {
    if (c.explicitness_level > comfort_explicitness_max) {
      diagnostics.rejected.explicitness_too_high++
      return false
    }
    return true
  })

  if (pool.length === 0) {
    return { status: 'failure', code: 'NO_ELIGIBLE_CAPTIONS' }
  }

  /* 3️⃣ Cooldown */
  pool = pool.filter(c => {
    if (!c.last_used_at) return true
    const last = Date.parse(c.last_used_at)
    if (Number.isNaN(last)) {
      diagnostics.rejected.cooldown_not_met++
      return false
    }
    const delta = (now - last) / 1000
    if (delta < cooldown_seconds) {
      diagnostics.rejected.cooldown_not_met++
      return false
    }
    return true
  })

  if (pool.length === 0) {
    return { status: 'failure', code: 'NO_ELIGIBLE_CAPTIONS' }
  }

  /* 4️⃣ Tone (optional) */
  if (tone_allowlist && tone_allowlist.length > 0) {
    pool = pool.filter(c => {
      if (!c.tone || c.tone.length === 0) {
        diagnostics.rejected.tone_mismatch++
        return false
      }
      const match = c.tone.some(t => tone_allowlist.includes(t))
      if (!match) {
        diagnostics.rejected.tone_mismatch++
        return false
      }
      return true
    })

    if (pool.length === 0) {
      return { status: 'failure', code: 'NO_ELIGIBLE_CAPTIONS' }
    }
  }

  /* 5️⃣ Deterministic sort */
  const sorted = [...pool].sort((a, b) => {
    if (a.times_used !== b.times_used) {
      return a.times_used - b.times_used
    }

    if (a.last_used_at === null && b.last_used_at !== null) return -1
    if (a.last_used_at !== null && b.last_used_at === null) return 1

    if (a.last_used_at && b.last_used_at) {
      const ta = Date.parse(a.last_used_at)
      const tb = Date.parse(b.last_used_at)
      if (ta !== tb) return ta - tb
    }

    return a.caption_id.localeCompare(b.caption_id)
  })

  const selected = sorted[0]
  if (!selected) {
    return { status: 'failure', code: 'DETERMINISM_VIOLATION' }
  }

  return {
    status: 'success',
    caption: selected,
    diagnostics: {
      ...diagnostics,
      eligible_count: pool.length,
    },
  }
}
