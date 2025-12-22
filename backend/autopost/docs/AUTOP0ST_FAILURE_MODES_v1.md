# AUTOPost Failure Modes & Recovery (v1)

Status: LOCKED  
Phase: 2 (Documentation-only, offline-safe)

Autopost must fail safely, visibly, and deterministically.  
It must NEVER invent content, bypass rules, or mutate data during failure.

---

## 1) Design Principles

When Autopost cannot produce a valid post payload:

- It returns a structured failure object
- It does NOT mutate data
- It does NOT retry automatically
- It does NOT escalate to AI generation
- It does NOT bypass cooldowns or explicitness gates

All recovery actions occur OUTSIDE Autopost.

---

## 2) Failure Categories

### F001 — NO_ELIGIBLE_CAPTIONS

**Condition**
- All captions fail one or more eligibility rules:
  - approved != true
  - active != true
  - platform mismatch
  - explicitness_level too high
  - cooldown not met

**Response**
```json
{
  "status": "failure",
  "code": "NO_ELIGIBLE_CAPTIONS",
  "selected": null
}
