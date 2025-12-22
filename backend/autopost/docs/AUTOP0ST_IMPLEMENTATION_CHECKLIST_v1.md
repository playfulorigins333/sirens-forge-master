# AUTOPost Implementation Checklist (v1)

Status: LOCKED  
Purpose: Bridge Phase 2 specs → Phase 3 implementation  
Scope: Autopost ONLY

This checklist exists so implementation becomes mechanical,
not conceptual, once infrastructure is available.

---

## 1) Pre-Implementation Gates (MUST be true)

Do NOT implement Autopost unless ALL are true:

- Supabase incident resolved
- Read-only queries return data
- No schema changes required
- Stripe remains untouched
- Phase 2 documents are unchanged

If any gate fails → STOP.

---

## 2) File-by-File Implementation Order

Implement files in EXACTLY this order:

1. selectCaption.ts  
2. selectCTA.ts  
3. selectHashtags.ts  
4. platformAdapters/fanvue.ts  
5. autopostExecutor.ts  
6. markUsed.ts (AFTER publish confirmation)

No parallel work.
No skipping ahead.

---

## 3) Contract Enforcement (MANDATORY)

Before writing logic, hard-code:

- READ contract validation
- Failure code enums
- State enum (READY / PARTIAL_READY / BLOCKED / ERROR)

Implementation MUST match:
- AUTOP0ST_READ_CONTRACT_v1.md
- AUTOP0ST_STATE_MACHINE_v1.md
- AUTOP0ST_FAILURE_MODES_v1.md

No interpretation allowed.

---

## 4) Determinism Rules (NON-NEGOTIABLE)

Implementation MUST guarantee:

- No randomness
- Stable sorting
- Explicit tie-breakers
- Identical input → identical output

Violations → F005 DETERMINISM_VIOLATION

---

## 5) Adapter Implementation Rules

Each platform adapter MUST:

- Run AFTER selection
- Enforce platform constraints
- NEVER edit content
- NEVER bypass rules
- Retry internally only (F002)

Fanvue adapter is reference.

---

## 6) markUsed Boundary (CRITICAL)

markUsed.ts MUST:

- Run ONLY after confirmed publish
- Increment times_used
- Update last_used_at
- Never run on failure or partial preview

Autopost executor MUST NOT call markUsed.

---

## 7) Observability (SAFE)

Implementation SHOULD log:

- caption_id
- state
- failure_code (if any)
- cooldown_seconds
- platform

Logs MUST NOT include:
- PII
- Stripe IDs
- Account tokens

---

## 8) Validation Against Spec

After implementation:

- Compare outputs against:
  AUTOP0ST_DRY_RUN_EXAMPLES_v1.md
- Output MUST match spec byte-for-byte

If mismatch:
- Fix code, not docs

---

## 9) Non-Goals (DO NOT IMPLEMENT)

Autopost must NOT include:

- Scheduling
- Cron logic
- AI generation
- Revenue calculation
- Retry queues
- User overrides

Those belong to Phase 3+.

---

## 10) Completion Definition

Autopost Phase 2 implementation is COMPLETE when:

- All specs are implemented
- All dry-run examples match output
- No live writes occur during preview
- All failures map to correct user states

Until then, Autopost is not “done.”
