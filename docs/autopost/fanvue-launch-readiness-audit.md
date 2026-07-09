# Fanvue launch-readiness while blocked audit

Date: 2026-07-09

## Summary

Fanvue remains publicly blocked. The repository already has a locked internal/admin Fanvue provider engine for text, image, and video proof paths, plus OAuth/account posture checks. The smallest safe launch-readiness PR is a backend/test-only payload bridge that proves normal rule/job data can represent Fanvue text, image, and video jobs without dispatching, posting, scheduling native Fanvue posts, exposing provider identifiers, or changing public UI/platform availability.

## Mapping audit

| Area | Current state | Launch-readiness status while blocked |
| --- | --- | --- |
| Platform registry / definitions | `fanvue` exists in the registry and public platform status remains `public_selectable: false`, `supports_real_posting: false`, and `supports_async_dispatch: false`. | Reusable as the public block. Do not change for launch readiness. |
| Account connection / OAuth model | `autopost_accounts` supports `platform = fanvue`; Fanvue OAuth status can report connectability and safe connection posture without exposing tokens. | Users can connect only when Fanvue OAuth env/config is present; if not configured, the exact blocker is surfaced as `FANVUE_CONNECT_CONFIG_UNAVAILABLE` / config errors. |
| Schedule creation flow | Existing normal public selection remains blocked. Fanvue draft/internal validation payloads already exist, but public scheduling must not be enabled. | Keep public scheduling blocked. Internal tests can validate Fanvue rule/job payload shape behind an internal flag. |
| Rules/jobs tables and payload shape | `autopost_rules.selected_platforms` and `autopost_jobs.platform/payload` can store `fanvue`; internal seed/proof helpers already create Fanvue job rows. | Launch-readiness bridge now validates sanitized text/image/video payloads for normal job data without provider IDs or live dispatch fields. |
| `/api/autopost/run` / runner path | Normal runner remains X-only for live dispatch and has no Fanvue adapter/provider eligibility. | Route-level dry-run verification now loads app-shaped `autopost_rules` rows with `selected_platforms` containing `fanvue` and text/image/video `content_payload` shapes, but only returns safe mocked envelopes when both the env gate and exact request confirmation are present. |
| Feature flags/env gates | Internal Fanvue proof routes use explicit gates; live gate is off. | New payload bridge is dry-run only and gated by `FANVUE_INTERNAL_LAUNCH_READINESS_ENABLED=true`; live execution remains blocked. |
| Text/image/video media payload handling | Internal adapter supports text and approved media. | Bridge validates text/image/video data using server-owned `asset_id` references only; no media bytes, signed URLs, R2 keys, or provider UUIDs. |
| Success/failure persistence | Existing internal controlled dispatch can persist proof/audit in admin paths; normal runner persistence is X-only. | Mocked/dry-run runner persistence bridge is now complete behind an internal gate. It proves safe success/failure persistence intent and schedule advancement intent without Supabase mutation, live dispatch, upload, token decrypt, cron, retry, or public wiring. |
| User-facing safe status/error shape | Platform availability returns safe blockers and no secrets. Internal routes redact provider UUIDs/details from route responses. | Maintained. Bridge returns safe error codes/messages only. |
| Tests covering normal scheduling paths | Existing tests assert Fanvue stays non-public and the run route does not dispatch Fanvue. | Added text/image/video bridge tests proving normal job payload shape while blocked. |

## Reusable pieces

- Fanvue OAuth/account row posture in `autopost_accounts`.
- Fanvue platform registry entry and public availability blocker shape.
- Internal Fanvue adapter for text and media proof paths.
- Internal media loaders/seed assets for approved server-owned image/video proof inputs.
- Existing safety tests that prevent public Fanvue UI, run-route dispatch, provider UUID leaks, price/paywall/native scheduling, and live-gate weakening.

## Remaining gaps before true public launch

1. Public platform selection remains intentionally disabled.
2. Normal `/api/autopost/run` does not route Fanvue jobs to an adapter branch yet.
3. Live normal runner Fanvue result persistence and schedule advancement are not wired; only mocked/dry-run intent is proven behind the internal bridge gate.
4. No public scheduler/cron/bulk/retry path should include Fanvue until explicit live gates and proof persistence are reviewed.
5. Public UI copy and controls are intentionally absent and must be added only when public blocks are ready to lift.

## Smallest safe PR made

- Added a pure backend Fanvue launch-readiness payload bridge for text, image, and video job shapes.
- Added tests proving the payload bridge is internal-flag gated, dispatch-disabled, provider-data-free, and that `/api/autopost/run` remains without Fanvue runtime dispatch.
- Added route-level dry-run verification around app-shaped Fanvue rule rows for text, image, and video payloads; missing env gate or missing/wrong request confirmation blocks safely.
- Added a pure mocked/dry-run runner persistence bridge that reuses the launch-readiness payload validator and returns safe success/failure persistence plus schedule advancement intent only.
- Did not change public registry availability, public UI, cron/scheduler behavior, bulk/retry behavior, live gates, native Fanvue scheduling, price/paywall, or provider calls.
