# AUTOPost Wiring & Folder Structure (v1)

Status: LOCKED  
Phase: 2 (Documentation-only, offline-safe)

This document defines the canonical runtime structure and wiring order
for Autopost once implementation begins.
No execution. No infra. No code changes implied.

---

## 1) Design Goal

Make Autopost implementation:
- Predictable
- Non-circular
- Easy to reason about
- Impossible to wire incorrectly

Every file has ONE responsibility.

---

## 2) Canonical Folder Structure

```text
backend/
└─ autopost/
   ├─ docs/                     # Phase 2 specs (SOURCE OF TRUTH)
   │  ├─ AUTOP0ST_READ_CONTRACT_v1.md
   │  ├─ AUTOP0ST_SELECTION_RULES_v1.md
   │  ├─ AUTOP0ST_FAILURE_MODES_v1.md
   │  ├─ AUTOP0ST_EXECUTION_FLOW_v1.md
   │  ├─ AUTOP0ST_STATE_MACHINE_v1.md
   │  ├─ AUTOP0ST_PLATFORM_ADAPTERS_FANVUE_v1.md
   │  ├─ AUTOP0ST_DRY_RUN_EXAMPLES_v1.md
   │  ├─ AUTOP0ST_IMPLEMENTATION_CHECKLIST_v1.md
   │  ├─ AUTOP0ST_SELECT_CAPTION_PSEUDOCODE_v1.md
   │  ├─ AUTOP0ST_SELECT_CTA_PSEUDOCODE_v1.md
   │  ├─ AUTOP0ST_SELECT_HASHTAGS_PSEUDOCODE_v1.md
   │  └─ AUTOP0ST_WIRING_STRUCTURE_v1.md
   │
   ├─ selectors/
   │  ├─ selectCaption.ts
   │  ├─ selectCTA.ts
   │  └─ selectHashtags.ts
   │
   ├─ adapters/
   │  └─ fanvue.ts
   │
   ├─ executor/
   │  └─ autopostExecutor.ts
   │
   ├─ mutations/
   │  └─ markUsed.ts
   │
   ├─ fixtures/                 # Offline reference data
   │  ├─ input/
   │  └─ expected/
   │
   └─ index.ts                  # Public Autopost entry (Phase 3)
