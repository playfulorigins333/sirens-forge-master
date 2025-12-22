/**
 * Autopost Phase 3 — selectCTA
 * Optional CTA selector (pure function).
 *
 * NO Supabase
 * NO side effects
 * NO mutations
 */

export type CTARecord = {
  cta_id: string
  cta_text: string
  approved: boolean
  active: boolean
  platform: string
  tone?: string[]
  max_explicitness?: number
  times_used: number
  last_used_at: string | null
}

export type SelectCTAInput = {
  ctas: CTARecord[]
  platform: string
  tone_allowlist?: string[]
  explicitness_level?: number
  current_time_iso: string
}

export type SelectCTASuccess = {
  status: 'success'
  cta: CTARecord
  diagnostics: Record<string, unknown>
}

export type SelectCTANone = {
  status: 'none'
  cta: null
  diagnostics: Record<string, unknown>
}

export type SelectCTAResult = SelectCTASuccess | SelectCTANone

export function selectCTA(
  input: SelectCTAInput
): SelectCTAResult {
  const {
    ctas,
    platform,
    tone_allowlist,
    explicitness_level,
    current_time_iso,
  } = input

  const now = Date.parse(current_time_iso)
  if (Number.isNaN(now)) {
    return { status: 'none', cta: null, diagnostics: {} }
  }

  const diagnostics = {
    candidate_count: ctas.length,
    rejected: {
      not_approved: 0,
      not_active: 0,
      platform_mismatch: 0,
      explicitness_mismatch: 0,
      tone_mismatch: 0,
    },
  }

  /* 1️⃣ Approved / Active / Platform */
  let pool = ctas.filter(c => {
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
    return { status: 'none', cta: null, diagnostics }
  }

  /* 2️⃣ Explicitness (optional) */
  if (typeof explicitness_level === 'number') {
    pool = pool.filter(c => {
      if (
        typeof c.max_explicitness === 'number' &&
        c.max_explicitness < explicitness_level
      ) {
        diagnostics.rejected.explicitness_mismatch++
        return false
      }
      return true
    })

    if (pool.length === 0) {
      return { status: 'none', cta: null, diagnostics }
    }
  }

  /* 3️⃣ Tone (optional) */
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
      return { status: 'none', cta: null, diagnostics }
    }
  }

  /* 4️⃣ Deterministic sort */
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

    return a.cta_id.localeCompare(b.cta_id)
  })

  const selected = sorted[0]
  if (!selected) {
    return { status: 'none', cta: null, diagnostics }
  }

  return {
    status: 'success',
    cta: selected,
    diagnostics: {
      ...diagnostics,
      eligible_count: pool.length,
    },
  }
}
