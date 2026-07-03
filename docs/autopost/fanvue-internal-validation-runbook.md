# FV-18 / Gate 13A — Fanvue Internal-Validation State Runbook

## 1. Current status summary

Fanvue is connected for internal validation only. Production currently shows Fanvue connected as `@playful_origins`.

A Fanvue validation draft can now be saved in production. Saved Fanvue validation drafts are non-runnable and disabled: they are not public-selectable, not schedulable, and not connected to any live Fanvue posting path.

## 2. Completed gates

- PR #14: Fanvue connected-status UI only
- PR #15: Fanvue text-only readiness guards
- FV-12 / Gate 11E: server-only Fanvue API client boundary
- FV-14 / Gate 12B: Fanvue internal-validation draft panel
- FV-15 / Gate 12C: insert schedule placeholder attempt
- FV-16 / Gate 12D: insert error diagnostics
- Manual Supabase fix: `content_payload jsonb` added
- FV-17 / Gate 12E: Fanvue approval-path audit only

## 3. Manual Supabase change performed

The following manual Supabase change was completed after a manual Supabase backup:

- Backup table was created: `public._backup_autopost_rules_before_content_payload_20250628_001`
- Backup count matched live count:
  - `live_autopost_rules_count = 1`
  - `backup_autopost_rules_count = 1`
- Added nullable column: `public.autopost_rules.content_payload jsonb`
- Schema reload was requested with: `notify pgrst, 'reload schema';`
- No other Supabase schema changes were made.

## 4. Current Fanvue safety flags

Fanvue must remain configured with the following safety state:

- `public_selectable: false`
- `can_schedule: false`
- `supports_real_posting: false`
- `supports_text_posting: false`
- `supports_media_posting: false`
- `native_posting_available: false`
- `native_posting_blocker: FANVUE_NATIVE_POSTING_NOT_ENABLED`

## 5. Current production validation draft behavior

Current production behavior for Fanvue validation drafts is:

- Fanvue validation draft panel appears in Build Rule.
- Button is labeled “Save Fanvue Validation Draft.”
- Saving creates a draft rule.
- Success copy says native posting, scheduling, dispatch, and media upload remain disabled.
- The saved rule appears in My Rules as Fanvue.
- It is disabled.
- It has Last Run: —
- It has Next Run: —
- It does not post.
- It does not schedule.
- It does not upload media.
- It does not call Fanvue live posting.

## 6. Approval-path audit result

The FV-17 / Gate 12E approval-path audit found:

- The UI currently shows Approve for any `DRAFT` rule.
- Fanvue-only validation drafts may show an Approve button.
- Backend approval uses `filterSelectableAutopostPlatformIds`.
- Because Fanvue is `public_selectable: false` and `supports_real_posting: false`, Fanvue-only approval is rejected with `NO_AVAILABLE_PLATFORMS`.
- Approval should not set `enabled` to `true` for Fanvue-only drafts under current code.
- Approval should not set `approval_state` to `APPROVED` for Fanvue-only drafts under current code.
- This is a low backend risk and medium UI-confusion risk.
- Do not click Approve unless a future test gate explicitly authorizes it.

## 7. Run-dispatch safety state

Current run-dispatch safety state is:

- `app/api/autopost/run/route.ts` remains X-only.
- Fanvue is not wired into run dispatch.
- The run route skips non-X platforms.
- Fanvue does not call post adapters.
- Fanvue does not call `persistAutopostJobResult`.
- Fanvue does not advance schedules.
- Fanvue has no live posting path enabled.

## 8. Explicitly out of scope / not enabled

The following are explicitly out of scope and not enabled:

- No `FANVUE_RUN_DISPATCH_ENABLED`
- No `FANVUE_POST_VERIFY_ENABLED`
- No `write:creator`
- No media upload
- No live Fanvue posting
- No live Fanvue verification
- No public Fanvue scheduling
- No public Fanvue selectable UI
- No fake `platform_post_id`
- No treating create response as posted proof

## 8A. Optional `write:creator` scope posture

`write:creator` is broader Fanvue access. It is optional, internal-only, and may be requested only through explicit approved OAuth scope configuration.

Requesting or storing `write:creator` does not approve:

- media upload
- signed upload URL acquisition
- byte upload
- media finalize or readiness polling
- post creation
- dispatch
- scheduling
- public platform selectability
- public Fanvue UI exposure

Fanvue remains internal/testing-only. Existing connected accounts without `write:creator` remain valid for base internal validation, but any future creator-scoped upload diagnostic must block safely before provider calls if `write:creator` is absent.

## 9. Known issues / deferred

- Fanvue validation drafts may still show an Approve button in My Rules.
- Backend blocks Fanvue-only approval, but the UI is confusing.
- A future UI clarity gate may hide or disable Approve for Fanvue-only validation drafts.
- This is deferred because the product has zero public users and is internal-only right now.

## 10. Before Fanvue can ever go live

Before Fanvue native posting can ever be enabled, complete this checklist in explicit gated steps:

- Confirm Fanvue API write scope requirements.
- Do not add `write:creator` until explicitly approved.
- Add media upload only in its own gate.
- Add live post creation only in its own gate.
- Add read-back verification only in its own gate.
- Add dispatch wiring only after proof chain is tested.
- Add schedule advancement only after posted proof is verified.
- Add env vars only in explicitly gated steps.
- Run production-safe tests.
- Do final human confirmation before public enablement.

## 11. Operator warnings

- Do not click Approve on Fanvue validation drafts unless a test gate explicitly authorizes it.
- Do not click Save repeatedly for smoke tests.
- Do not treat saved validation drafts as posted content.
- Do not change Supabase without backup and final human confirmation.
- Do not paste secrets into issues, PRs, Codex, logs, or chat.
