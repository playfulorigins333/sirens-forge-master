# Siren's Mind Production Checkpoint — PR #300

This document records the verified Siren's Mind architecture and Production baseline after PR #299. It is a recovery checkpoint and reference, not a new runtime specification or an override of source code.

- **Repository:** `playfulorigins333/sirens-forge-master`
- **Production main at document creation:** `dc8e24af7ba6534c492b756f76d02001c979f557`

## Completed Production phases

All phases in this section are **COMPLETE / MERGED / PRODUCTION**.

### Phase 6A — Conversational Core

- Dedicated `/api/sirens-mind/chat` route.
- Conversational Siren's Mind is separate from deterministic Generator routes.
- `SAFE`, `NSFW`, and `ULTRA` mode validation, bounded history, and safe error handling.
- Optional Generator handoff.

### Phase 6B — Vaults / Macros / Character DNA Truth

- Canonical capability registries and a real, mode-gated Vault/Macro capability catalog.
- Character DNA ownership and security validation.
- Capability IDs are not browser-authoritative.

### Phase 6C — Hidden Owner RP Runtime

- Server-gated hidden admin RP with no visible RP toggle.
- Streaming SSE, hidden continuity metadata, and content-free telemetry.
- One provider call architecture.

### Phase 6C.1 — RP Continuity Fallback

- Provider continuity is preferred; deterministic server fallback is used when provider metadata is absent or invalid.
- Explicit exit clears continuity.
- A live Production canary proved provider continuity → provider metadata failure → server fallback → subsequent turns remaining `admin_rp`.
- No second model call.

### Phase 6C.2 — RP Quality Hardening

- Interactive RP defaults to embodied first-person character voice and addresses the creator as “you.”
- Alternate POV remains possible when explicitly requested.
- Avoids repeated hesitation/stall loops.
- Preserves adult-only sexual scene integrity: no minor or age-ambiguous witness/risk devices; consensual risk/power-play remains revocable.

### Phase 6D — Long-Form Story Lane

- Dedicated `story` interaction class with streamed long-form generation.
- Story takes precedence over RP and has a story-specific timeout and output budget.
- The story lane emits no RP continuity metadata.

### Phase 6E — Desktop Reading UX / Capability Naming

- Improved reading layout and canonical capability naming.

### Phase 6E.1 — Desktop Width

- Production Siren's Mind shell widened to `78rem` (approximately 1248 px).

### Phase 6E.2 — Autosizing Composer

- Textarea grows and shrinks with wrapped or newline input, has a bounded maximum height, and gains a scrollbar only after that maximum.
- `ResizeObserver` recalculates on width changes; sizing resets after send.
- Enter handling is IME-safe.
- Live Production visual canary passed.

## Current model routing

The shipped route selects the configured model for the requested mode, with these exact source-defined defaults:

| Mode | Default model |
| --- | --- |
| `SAFE` | `openai/gpt-5-mini` |
| `NSFW` | `openai/gpt-4o` |
| `ULTRA` | `nousresearch/hermes-4-405b` |

RP normally uses the selected mode model; source also permits the server-side admin-RP model override. Story uses the selected mode model and does not use the RP override.

## Live RP canary evidence

The verified Production canary demonstrated, without retaining creator content or identifiers:

- Explicit RP activation was classified as `admin_rp`.
- `ULTRA` selected `nousresearch/hermes-4-405b` (Hermes 4 405B).
- Streaming first-token telemetry was populated.
- The first RP turn produced provider continuity.
- Later turns with failed provider metadata used fallback continuity, and that fallback carried further turns.
- No handoff occurred.
- Hidden metadata did not appear in creator-visible output.
- Ordinary discussion of the word “roleplay” previously passed negative non-trigger testing.

## Known architectural limitation / next priority

### THREAD-SCOPED CONTINUITY — NOT YET BUILT

Current browser RP continuity is session/tab scoped rather than isolated by an explicit Siren's Mind conversation or thread identifier.

A future Production phase must ensure:

- Separate RP and conversation threads do not cross-contaminate continuity.
- Each creator/subscriber/story/RP conversation retains its own context.
- Switching conversations restores the correct thread state.

This future architecture phase is **not part of PR #300** and is not implemented by this checkpoint.

## Remaining live validation

1. **Fresh post-6C.2 RP quality canary:** verify first-person embodiment, reduced repetitive stalling, and continued continuity behavior.
2. **Long-form story live Production canary:** verify `interactionClass: "story"`, a substantial finished narrative, working streaming, no RP metadata or handoff, and no timeout.
3. **Only after product lanes are proven:** perform model/cost comparison and consider future provider decisions.

## Boundaries

- Siren's Mind is the conversational and creative intelligence layer above Forge; it is broader than any single creator-platform workflow.
- The separate `sirens-forge-api` repository remains the durable compute/generation worker plane and must not be conflated with Siren's Mind conversation, RP, or story behavior.
- Do not replace current model infrastructure solely on the basis of this checkpoint.
- Source code remains authoritative if this document becomes stale.
