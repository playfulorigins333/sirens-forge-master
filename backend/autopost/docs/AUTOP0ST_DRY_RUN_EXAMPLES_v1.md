# AUTOPost End-to-End Dry-Run Examples (v1)

Status: LOCKED  
Phase: 2 (SPEC ONLY — NO EXECUTION, OFFLINE-SAFE)

This document contains canonical, deterministic examples that define
what Autopost MUST output for given inputs.
These are NOT tests and MUST NOT be executed.
They are reference specs for future validation only.

---

## 0) Global Assumptions (Applies to ALL Examples)

- No live infrastructure
- No Supabase calls
- No Stripe calls
- No scheduling
- Deterministic behavior only

Revenue share is ALWAYS attached:
```json
{
  "creator_pct": 0.8,
  "sirensforge_pct": 0.2
}
