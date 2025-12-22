# Autopost selectHashtags Logic — Pseudocode (v1)

Status: LOCKED  
Phase: 2 (Pseudocode only — NO execution)

This document defines the deterministic logic that
selectHashtags.ts MUST implement in Phase 3.
This is a blueprint, not runnable code.

---

## 1) Purpose

selectHashtags is responsible for:
- Choosing ONE hashtag set (if available)
- Enforcing platform limits deterministically
- Returning a hashtag array OR null without blocking Autopost

Hashtag selection is OPTIONAL by design.

---

## 2) Inputs

selectHashtags receives:

- hashtag_sets[] (READ-only dataset)
- platform (string)
- optional tone_allowlist[]
- optional explicitness_level (number)
- platform_limits:
  - max_hashtags (number)
- current_time (UTC ISO string)

---

## 3) Output Shape

Returns ONE of:

### Success (Hashtag set selected)
```json
{
  "status": "success",
  "hashtags": ["#tag1", "#tag2"],
  "hashtag_set_id": "string",
  "diagnostics": { "...counts & reasons..." }
}
