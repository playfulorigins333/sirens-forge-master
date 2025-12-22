# AUTOPost Selection Rules (v1)

Status: LOCKED
Phase: 2 (Doc-first)
Autopost selection is deterministic and READ-only.

This document defines HOW content is chosen once a READ request is made.

---

## 1) Core Principle

Autopost selection:
- Never generates content
- Never mutates data during selection
- Never calls Stripe or writes revenue
- Always produces the same output given the same inputs + data

---

## 2) Eligibility Filters (Hard Gates)

A caption enters the candidate pool ONLY if ALL conditions are true:

### Required Flags
- approved = true
- active = true

### Platform Match
- caption_templates.platform === request.platform

### Explicitness Gate
- caption_templates.explicitness_level
  <= creator_scope.comfort_explicitness_max

### Soft Cooldown Gate (LOCKED)
A caption is eligible if:
- last_used_at IS NULL
  OR
- (now - last_used_at) >= cooldown_seconds

Cooldown is evaluated in seconds using UTC timestamps.

---

## 3) Candidate Pool Construction

Default behavior:
- Fetch up to `limit` rows (default 25) AFTER filters
- Order is NOT trusted from storage
- All ordering happens in Autopost logic

Candidate pool is treated as unordered input.

---

## 4) Deterministic Ranking Algorithm

Eligible candidates are sorted using the following strict order:

### Priority 1 — Lowest Usage
Sort ascending by:
- times_used

Rationale:
Prevents burnout of high-performing captions.

---

### Priority 2 — Oldest Use
If tied:
- last_used_at NULL first
- then oldest timestamp first

Rationale:
Ensures even rotation and spacing.

---

### Priority 3 — Stable ID Tie-Break
If still tied:
- sort lexicographically by caption_id

Rationale:
Guarantees stable output with no randomness.

---

## 5) Final Selection

After sorting:
- Select index [0] as the chosen caption
- Selection count = exactly 1 per execution

No random choice.
No weighted randomness.
No AI scoring.

---

## 6) CTA & Hashtag Selection (Phase 2 Rules)

CTA and hashtag selection follow the SAME pattern:

### CTA (cta_variants)
- approved = true
- active = true
- platform-compatible
- optional tone match
- same cooldown logic (future)

### Hashtags (hashtag_sets)
- platform match
- hashtag count <= platform max
- optional explicitness tier match

If CTA or hashtags are unavailable:
- Continue with caption-only output
- Never fail the entire selection

---

## 7) Platform-Specific Constraints (Applied AFTER Selection)

Autopost adapters may enforce:

### Examples
- Max character length
- Hashtag count limits
- CTA placement rules (inline vs end)

If selected caption violates platform constraints:
- Mark as rejected_for_platform
- Select NEXT eligible candidate
- Re-run ranking without the rejected item

This retry loop:
- Is deterministic
- Stops after pool exhaustion
- Never generates content

---

## 8) Dedupe Window (Optional, Phase 2+)

If enabled via request:
- dedupe_window_seconds applies to similar tone / job_id

Rule:
- Captions with same job_id OR overlapping tone tags
  within the window may be deprioritized

Deprioritization means:
- ranked lower, not hard-blocked

---

## 9) Failure Conditions

If no eligible captions remain:
Return:
- selected.caption = null
- reason = "NO_ELIGIBLE_CAPTIONS"
- diagnostics populated

Autopost MUST NOT:
- Fallback to AI
- Auto-approve content
- Bypass cooldowns

---

## 10) Observability (Offline-Safe)

Selection should expose:
- candidate_count
- eligible_count
- rejection reasons
- applied cooldown_seconds

These values are safe to:
- log locally
- include in test fixtures
- expose in dry-run tooling

---

## 11) Explicit Non-Goals (v1)

Autopost does NOT:
- Predict performance
- Optimize revenue dynamically
- A/B test captions
- Modify usage counters during READ

Those occur AFTER successful posting (markUsed step).
