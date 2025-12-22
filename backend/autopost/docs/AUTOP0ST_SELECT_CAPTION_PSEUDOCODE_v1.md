# Autopost selectCaption Logic — Pseudocode (v1)

Status: LOCKED  
Phase: 2 (Pseudocode only — NO execution)

This document defines the exact deterministic logic that
selectCaption.ts MUST implement in Phase 3.
This is a blueprint, not runnable code.

---

## 1) Purpose

selectCaption is responsible for:
- Choosing ONE eligible caption
- Applying eligibility + cooldown rules
- Returning a deterministic result OR a failure code

It does NOT:
- Modify data
- Call platform adapters
- Increment usage
- Generate content

---

## 2) Inputs

selectCaption receives:

- captions[] (READ-only dataset)
- platform (string)
- comfort_explicitness_max (number)
- cooldown_seconds (number)
- optional tone_allowlist[]
- current_time (UTC ISO string)

---

## 3) Output Shape

Returns ONE of:

### Success
```json
{
  "status": "success",
  "caption": { "...caption object..." },
  "diagnostics": { "...counts & reasons..." }
}
