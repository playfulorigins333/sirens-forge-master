# AUTOPost Platform Adapter UX Rules — Fanvue (v1)

Status: LOCKED  
Phase: 2 (Documentation-only, offline-safe)

This document defines the UX-facing rules enforced by the Fanvue
platform adapter inside Autopost.
No live calls. No Stripe. No Supabase runtime execution.

---

## 1) Purpose

Platform adapters exist to:
- Enforce platform-specific constraints
- Normalize UX behavior across platforms
- Keep selection deterministic and safe

Adapters do NOT:
- Edit captions
- Generate content
- Bypass selection rules
- Mutate data

Fanvue is the FIRST supported adapter.
Other platforms must conform to this pattern.

---

## 2) Fanvue Adapter Scope

The Fanvue adapter applies rules to:
- Caption text
- CTA placement
- Hashtag handling
- Explicitness visibility (UX-level only)

The adapter runs AFTER selection and BEFORE payload return.

---

## 3) Fanvue Constraints (v1)

### Caption Length
- MAX_CHARACTERS: 1000
- Count includes:
  - Caption text
  - CTA text (if appended inline)
- Count excludes:
  - Hashtags if rendered separately by platform

If exceeded:
- Trigger internal rejection
- Apply F002 internally
- Retry selection with next eligible caption

---

### Hashtag Rules
- Fanvue supports hashtags
- MAX_HASHTAGS: 30
- Hashtags may be:
  - Inline at end of caption
  - Or provided as a separate field (preferred)

If hashtag set exceeds limit:
- Truncate deterministically (first N)
- Do NOT reorder
- Do NOT drop caption

This is NOT a failure condition.

---

### CTA Placement
Allowed:
- End of caption
- On its own line
- After a single newline

Not allowed:
- Mid-sentence insertion
- Inline interruption of caption text

If CTA placement is invalid:
- Treat CTA as unavailable
- Continue as PARTIAL_READY

---

## 4) Explicitness Handling (UX-Level)

Autopost does NOT generate explicit content.
Fanvue adapter enforces visibility only.

Rules:
- explicitness_level is informational
- No redaction or modification occurs
- UX may display:
  “Explicitness level: X / Allowed”

Explicitness NEVER:
- Blocks output post-selection
- Alters text
- Changes revenue metadata

---

## 5) Adapter Decision Matrix

| Condition | Adapter Action | User State |
|---------|----------------|------------|
| Caption within limits | Pass through | READY |
| Caption too long | Retry selection | (internal) |
| No alternative caption | Return F001 | BLOCKED |
| CTA invalid | Drop CTA | PARTIAL_READY |
| Hashtag overflow | Truncate | READY |
| Hashtags missing | Allowed | PARTIAL_READY |

---

## 6) UX Copy (Fanvue-Specific)

Allowed copy:
- “Ready for Fanvue”
- “Caption-only post”
- “Hashtags truncated to Fanvue limits”

Not allowed:
- “Fanvue rejected”
- “Platform error”
- “Post failed due to Fanvue rules”

Platform adapters should NEVER blame the platform in UX.

---

## 7) Payload Shape (Fanvue)

Example payload (abstract):

```json
{
  "platform": "fanvue",
  "caption_text": "string",
  "cta_text": "optional",
  "hashtags": ["#tag1", "#tag2"],
  "revenue_share": {
    "creator_pct": 0.8,
    "sirensforge_pct": 0.2
  }
}
