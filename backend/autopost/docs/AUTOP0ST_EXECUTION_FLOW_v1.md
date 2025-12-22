# AUTOPost Execution Flow (v1)

Status: LOCKED  
Phase: 2 (Documentation-only, offline-safe)

This document defines the SINGLE, deterministic execution path for Autopost.
It references existing contracts, rules, and failure definitions.
No live infrastructure is required to understand or validate this flow.

---

## 1) Purpose

This document answers ONE question:

“How does Autopost execute from request → payload → stop?”

It does NOT:
- Define schemas (see READ contract)
- Define ranking logic (see Selection Rules)
- Define failure meanings (see Failure Modes)

It ONLY defines flow and control boundaries.

---

## 2) High-Level Flow (Linear)

Autopost executes in the following strict order:

1. Validate READ request
2. Build candidate pool
3. Apply eligibility filters
4. Rank eligible candidates
5. Select caption
6. Validate platform constraints
7. Assemble payload
8. Return success OR failure

There are NO side paths.

---

## 3) Step-by-Step Execution

### STEP 1 — Validate READ Request

Input:
- AutopostReadRequestV1

Checks:
- version is supported
- platform is supported
- mode is supported
- required fields are present

If validation fails:
- RETURN failure → **F004 INVALID_READ_REQUEST**
- STOP execution

---

### STEP 2 — Build Candidate Pool (READ-ONLY)

Source:
- caption_templates table (READ-only)

Initial filters:
- approved = true
- active = true
- platform match

Result:
- unordered candidate pool

If pool is empty:
- RETURN failure → **F001 NO_ELIGIBLE_CAPTIONS**
- STOP execution

---

### STEP 3 — Apply Eligibility Gates

Apply:
- explicitness_level gate
- soft cooldown gate
- optional tone / DNA scope gates

Result:
- eligible pool
- rejected pool with reasons

If eligible pool is empty:
- RETURN failure → **F001 NO_ELIGIBLE_CAPTIONS**
- STOP execution

---

### STEP 4 — Deterministic Ranking

Rank eligible captions using:
1. Lowest times_used
2. Oldest last_used_at (NULL first)
3. Lexicographic caption_id

If ranking cannot be resolved deterministically:
- RETURN failure → **F005 DETERMINISM_VIOLATION**
- STOP execution

---

### STEP 5 — Select Caption

Select:
- ranked_candidates[0]

This selection is FINAL for this iteration.

---

### STEP 6 — Platform Constraint Validation

Validate selected caption against:
- max character length
- platform formatting rules
- CTA placement rules (if applicable)

If caption FAILS platform constraints:
- Remove caption from eligible pool
- RE-RUN Step 4 (ranking) with remaining pool

If pool becomes empty:
- RETURN failure → **F001 NO_ELIGIBLE_CAPTIONS**
- STOP execution

This retry loop is:
- deterministic
- bounded
- internal only

---

### STEP 7 — Assemble Package

Depending on mode:
- caption_only → caption required
- full_package → caption + optional CTA + optional hashtags

CTA / hashtag rules:
- If unavailable → allowed
- Missing CTA/hashtags does NOT block output

If CTA or hashtags missing:
- Mark result as **partial_success**
- Reference **F003 PARTIAL_PACKAGE_AVAILABLE**

---

### STEP 8 — Attach Revenue Metadata

Always attach:
```json
{
  "creator_pct": 0.8,
  "sirensforge_pct": 0.2
}
