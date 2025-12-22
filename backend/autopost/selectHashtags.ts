/**
 * Autopost Phase 3 — selectHashtags
 * Optional hashtag-set selector (pure function).
 *
 * NO Supabase
 * NO side effects
 * NO mutations
 */

export type HashtagSetRecord = {
  hashtag_set_id: string
  hashtags: string[]
  approved: boolean
  active: boolean
  platform: string
  tone?: string[]
  max_explicitness?: number
  times_used: number
  last_used_at: string | null
}

export type PlatformLimits = {
  max_hashtags: number
}

export type SelectHashtagsInput = {
  hashtag_sets: HashtagSetRecord[]
  platform: string
  platform_limits: PlatformLimits
  tone_allowlist?: string[]
  explicitness_level?: number
  current_time_iso: string
}

export type SelectHashtagsSuccess = {
  status: 'success'
  hashtags: string[]
  hashtag_set_id: string
  diagnostics: Record<string, unknown>
}

export type SelectHashtagsNone = {
  status: 'none'
  hashtags: null
  hashtag_set_id: null
  diagnostics: Record<string, unknown>
}

export type SelectHashtagsResult =
  | SelectHashtagsSuccess
  | SelectHashtagsNone

export function selectHashtags(
  input: SelectHashtagsInput
): SelectHashtagsResult {
  const {
    hashtag_sets,
    platform,
    platform_limits,
    tone_allowlist,
    explicitness_level,
    current_time_iso,
  } = input

  const now = Date.parse(current_time_iso)
  if (Number.isNaN(now)) {
    return {
      status: 'none',
      hashtags: null,
      hashtag_set_id: null,
      diagnostics: {},
    }
  }

  const diagnostics = {
    candidate_count: hashtag_sets.length,
    rejected: {
      not_approved: 0,
      not_active: 0,
      platform_mismatch: 0,
      explicitness_mismatch: 0,
      tone_mismatch: 0,
    },
  }

  /* 1️⃣ Approved / Active / Platform */
  let pool = hashtag_sets.filter(h => {
    if (!h.approved) {
      diagnostics.rejected.not_approved++
      return false
    }
    if (!h.active) {
      diagnostics.rejected.not_active++
      return false
    }
    if (h.platform !== platform) {
      diagnostics.rejected.platform_mismatch++
      return false
    }
    return true
  })

  if (pool.length === 0) {
    return {
      status: 'none',
      hashtags: null,
      hashtag_set_id: null,
      diagnostics,
    }
  }

  /* 2️⃣ Explicitness (optional) */
  if (typeof explicitness_level === 'number') {
    pool = pool.filter(h => {
      if (
        typeof h.max_explicitness === 'number' &&
        h.max_explicitness < explicitness_level
      ) {
        diagnostics.rejected.explicitness_mismatch++
        return false
      }
      return true
    })

    if (pool.length === 0) {
      return {
        status: 'none',
        hashtags: null,
        hashtag_set_id: null,
        diagnostics,
      }
    }
  }

  /* 3️⃣ Tone (optional) */
  if (tone_allowlist && tone_allowlist.length > 0) {
    pool = pool.filter(h => {
      if (!h.tone || h.tone.length === 0) {
        diagnostics.rejected.tone_mismatch++
        return false
      }
      const match = h.tone.some(t => tone_allowlist.includes(t))
      if (!match) {
        diagnostics.rejected.tone_mismatch++
        return false
      }
      return true
    })

    if (pool.length === 0) {
      return {
        status: 'none',
        hashtags: null,
        hashtag_set_id: null,
        diagnostics,
      }
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

    return a.hashtag_set_id.localeCompare(b.hashtag_set_id)
  })

  const selected = sorted[0]
  if (!selected || !Array.isArray(selected.hashtags)) {
    return {
      status: 'none',
      hashtags: null,
      hashtag_set_id: null,
      diagnostics,
    }
  }

  /* 5️⃣ Platform limit enforcement */
  const max = platform_limits.max_hashtags
  const finalHashtags =
    selected.hashtags.length <= max
      ? selected.hashtags
      : selected.hashtags.slice(0, max)

  return {
    status: 'success',
    hashtags: finalHashtags,
    hashtag_set_id: selected.hashtag_set_id,
    diagnostics: {
      ...diagnostics,
      eligible_count: pool.length,
      truncated: selected.hashtags.length > max,
    },
  }
}
