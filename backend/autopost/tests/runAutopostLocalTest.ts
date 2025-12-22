/**
 * Autopost Phase 3 — Local Offline Test Runner
 *
 * TEST-ONLY FILE
 * - No Supabase
 * - No env vars
 * - Uses JSON fixtures
 * - Explicit unwrapping of fixture shape
 */

import { runAutopost } from '../executor/autopostExecutor'

// Raw JSON fixtures (object shape)
import captionsBasicRaw from '../fixtures/input/captions_basic.json'
import captionsCooldownEdgeRaw from '../fixtures/input/captions_cooldown_edge.json'

// Unwrap fixture payloads
const captionsBasic = (captionsBasicRaw as any).captions as any[]
const captionsCooldownEdge = (captionsCooldownEdgeRaw as any).captions as any[]

function runTest(label: string, captions: any[]) {
  console.log('\n==============================')
  console.log(`TEST: ${label}`)
  console.log('==============================')

  const result = runAutopost({
    captions,
    ctas: [],
    hashtag_sets: [],

    platform: 'fanvue',
    comfort_explicitness_max: 3,
    cooldown_seconds: 3600,
    tone_allowlist: ['playful', 'flirty'],

    platform_limits: {
      max_hashtags: 10,
    },

    current_time_iso: new Date().toISOString(),

    revenue_split: {
      creator_pct: 80,
      platform_pct: 20,
    },
  })

  console.log(JSON.stringify(result, null, 2))
}

/* =========================
   Execute tests
========================= */

runTest('BASIC CAPTIONS', captionsBasic)
runTest('COOLDOWN EDGE', captionsCooldownEdge)
