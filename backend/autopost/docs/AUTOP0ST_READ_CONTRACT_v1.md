# AUTOPost READ Contract (v1)

Status: LOCKED (Doc-First)
Scope: Phase 2
Autopost is READ-FIRST and deterministic. No creative generation.

---

## 1) What Autopost IS / IS NOT

### IS
- READ-FIRST: consumes approved, active content already in Supabase tables
- Deterministic: selection is rules-based (no creative AI)
- Monetized: attaches revenue-share metadata to the output payload
- Platform-agnostic: supports Fanvue first, OF later, plus future adapters

### IS NOT
- A content generator
- A real-time system
- A Stripe writer
- A Supabase schema editor
- A cron runner yet (cron/queue is Phase 3)

---

## 2) Source Tables (READ-ONLY)

Autopost reads from these tables (schema not owned by Autopost):

### caption_templates
Required fields used by selection:
- approved: boolean
- active: boolean
- explicitness_level: number | enum
- platform: string
- tone: string[] (optional)
- job_id: string (optional)
- times_used: number
- last_used_at: string (ISO timestamp) | null

Future tables (Phase 2+):
- cta_variants
- hashtag_sets

Autopost MUST NOT modify schema.

---

## 3) Soft Cooldown Rule (LOCKED)

Autopost enforces a cooldown window using `last_used_at`.

Definition:
- A caption is eligible only if:
  - last_used_at is NULL, OR
  - now - last_used_at >= cooldown_seconds

This prevents overuse without permanent caps.

---

## 4) READ Request Contract (Input)

Autopost READ request defines the selection context and filters.

### Type: AutopostReadRequestV1
\`\`\`json
{
  "version": "1.0",
  "platform": "fanvue",
  "mode": "full_package",
  "limit": 25,
  "cursor": null,
  "language": "en",
  "creator_scope": {
    "creator_id": "uuid-or-string",
    "comfort_explicitness_max": 3,
    "tone_allowlist": ["playful", "teasing"],
    "dna_scope": null
  },
  "selection_policy": {
    "cooldown_seconds": 259200,
    "dedupe_window_seconds": 604800
  }
}
\`\`\`

### Field meanings
- version: contract version string ("1.0")
- platform: target platform adapter key (fanvue now, onlyfans later)
- mode:
  - caption_only
  - hashtags_only
  - full_package (caption + cta + hashtags)
- limit: max items to consider in the candidate pool (default: 25)
- cursor: pagination anchor (null for first page)
- language: "en" default
- creator_scope:
  - creator_id: used for logging + optional future scoping
  - comfort_explicitness_max: gate content by explicitness level
  - tone_allowlist: optional filter
  - dna_scope: optional (null if not used)
- selection_policy:
  - cooldown_seconds: eligibility cooldown based on last_used_at
  - dedupe_window_seconds: optional extra protection against repeating "same vibe" too often

NOTES:
- Autopost READ does not create or approve content.
- Autopost READ does not update usage counters in this step.

---

## 5) READ Response Contract (Output)

### Type: AutopostReadResponseV1
\`\`\`json
{
  "version": "1.0",
  "platform": "fanvue",
  "mode": "full_package",
  "selected": {
    "caption": {
      "caption_id": "uuid-or-string",
      "caption_text": "string",
      "explicitness_level": 2,
      "tone": ["playful"],
      "job_id": "optional-string",
      "times_used": 4,
      "last_used_at": "2025-12-01T12:34:56Z"
    },
    "cta": {
      "cta_id": "optional",
      "cta_text": "optional"
    },
    "hashtags": {
      "hashtag_set_id": "optional",
      "hashtags": ["#tag1", "#tag2"]
    }
  },
  "revenue_share": {
    "creator_pct": 0.8,
    "sirensforge_pct": 0.2
  },
  "read_policy_enforced": {
    "approved_required": true,
    "active_required": true,
    "cooldown_seconds": 259200,
    "comfort_explicitness_max": 3,
    "platform_match_required": true
  },
  "diagnostics": {
    "candidate_count": 25,
    "eligible_count": 7,
    "rejected": {
      "not_approved": 0,
      "not_active": 1,
      "platform_mismatch": 3,
      "explicitness_too_high": 5,
      "cooldown_not_met": 9
    }
  },
  "next_cursor": null
}
\`\`\`

Notes:
- selected.caption MUST exist in v1 if mode includes captions.
- cta + hashtags may be optional until those tables are live.
- revenue_share is always attached at selection time (80/20 locked).
- diagnostics are included for offline testing + debugging (safe to log).

---

## 6) Deterministic Selection Rules (v1)

Candidate pool rules:
- approved = true
- active = true
- platform matches request.platform
- explicitness_level <= creator_scope.comfort_explicitness_max
- cooldown passes (see Section 3)

Tie-breaking (deterministic):
1) Prefer lowest times_used
2) If tie, prefer oldest last_used_at (or NULL first)
3) If tie, stable sort by caption_id (lexicographic)

This ensures predictable selection.

---

## 7) Failure Modes (v1)

If NO eligible captions:
Return:
- selected.caption = null
- include diagnostics with rejection counts
- include a reason code:
  - "NO_ELIGIBLE_CAPTIONS"

Autopost MUST NOT fallback to creative generation.

---

## 8) Phase 3 Notes (NOT IMPLEMENTED)

Later integrations may add:
- queue rows + scheduling windows
- post success callbacks
- markUsed step after confirmed publish
- creator-specific pacing policies
- cron runner / worker triggers

This doc only defines Phase 2 READ + deterministic selection.
