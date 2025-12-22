# AUTOPost User-Facing State Machine (v1)

Status: LOCKED  
Phase: 2 (Documentation-only, offline-safe)

This document defines the ONLY user-facing states Autopost may expose
and how transitions occur between them.
No live infra. No Stripe. No Supabase execution.

---

## 1) Purpose

This state machine answers:
- What state is Autopost in right now?
- What does the user see?
- What action (if any) is allowed next?

It does NOT:
- Schedule posts
- Publish content
- Retry automatically
- Modify data

---

## 2) Allowed States (LOCKED)

Autopost may be in EXACTLY one of the following states:

1. READY
2. PARTIAL_READY
3. BLOCKED
4. ERROR

No other states are permitted in Phase 2.

---

## 3) State Definitions

### STATE: READY

**Meaning**
- A complete post payload exists
- Caption + optional CTA + optional hashtags are valid
- Platform constraints are satisfied

**Entry Conditions**
- Selection succeeds
- No platform constraint violations
- Caption exists

**User Sees**
- Selected caption
- CTA (if present)
- Hashtags (if present)
- Platform target
- Cooldown applied
- Revenue share (80/20)

**Allowed Actions**
- Proceed to publish (external to Autopost)
- Save preview
- Exit

**Disallowed Actions**
- Edit caption
- Regenerate content
- Override selection rules

---

### STATE: PARTIAL_READY

**Meaning**
- Caption exists and is valid
- One or more optional components missing (CTA and/or hashtags)

**Entry Conditions**
- Selection succeeds
- Caption valid
- CTA or hashtag set unavailable

**User Sees**
- Selected caption
- Clear note: “CTA / hashtags not available”
- Revenue share (80/20)

**Allowed Actions**
- Proceed to publish caption-only
- Defer posting
- Exit

**Disallowed Actions**
- Treat as error
- Force regeneration
- Block publish

NOTE:
PARTIAL_READY is NOT a failure.

---

### STATE: BLOCKED

**Meaning**
- No eligible content can be selected

**Entry Conditions**
- Failure code F001 — NO_ELIGIBLE_CAPTIONS

**User Sees**
- Status: BLOCKED
- Reason: “No eligible captions meet your current rules”
- Optional diagnostics:
  - cooldown window
  - explicitness comfort level
  - platform target

**Allowed Actions**
- Add new approved content
- Adjust cooldown or comfort settings (outside Autopost)
- Exit

**Disallowed Actions**
- Retry automatically
- Generate content
- Bypass rules

---

### STATE: ERROR

**Meaning**
- System or contract error
- NOT a content availability issue

**Entry Conditions**
- F004 — INVALID_READ_REQUEST
- F005 — DETERMINISM_VIOLATION

**User Sees**
- Status: ERROR
- Generic message: “Autopost cannot proceed”
- Optional error code (non-technical)

**Allowed Actions**
- Exit
- Report issue

**Disallowed Actions**
- Retry blindly
- Continue to publish
- Modify content

---

## 4) State Transitions (Linear)

Initial state: NONE

Possible transitions:

- NONE → READY
- NONE → PARTIAL_READY
- NONE → BLOCKED
- NONE → ERROR

There are NO transitions between READY / PARTIAL / BLOCKED.
Each execution resolves to ONE terminal state.

---

## 5) Mapping Failure Codes → States

| Failure Code | User State |
|-------------|------------|
| F001 | BLOCKED |
| F002 | Internal only (never exposed) |
| F003 | PARTIAL_READY |
| F004 | ERROR |
| F005 | ERROR |

F002 is handled internally and never reaches the user.

---

## 6) UX Copy Rules (IMPORTANT)

User-facing language MUST:
- Be neutral
- Avoid technical jargon
- Avoid financial promises

Allowed:
- “Ready to publish”
- “No eligible content”
- “Partial package available”

Not allowed:
- Stack traces
- Database errors
- Stripe references
- Dollar amounts

---

## 7) Visual Priority (Suggested)

- READY → Green / Confirmed
- PARTIAL_READY → Neutral / Informational
- BLOCKED → Yellow / Attention
- ERROR → Red / Stop

Colors are advisory only.

---

## 8) Guarantees

This state machine guarantees:
- No surprise publishing
- No silent failures
- No hidden retries
- Clear user outcomes

If Autopost reaches READY or PARTIAL_READY,
the payload is safe to hand off for publishing.
