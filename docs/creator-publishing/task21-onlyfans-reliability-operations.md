# Task 21 Gate 21B-3A — Creator Publishing Scheduler Runner Operations

Gate 21B-3A prepares manual-first scheduler activation without adding a cron. It keeps the dedicated server-only endpoint at `/api/creator-publishing-queue/scheduler/run` environment-gated while enabling the code build lock. Merging Gate 21B-3A does not by itself invoke the Creator Publishing scheduler.

## Activation locks and order

Execution requires the code build lock `CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED` to be literal `true` in Gate 21B-3A and still requires `CREATOR_PUBLISHING_SCHEDULER_ENABLED` to be exactly `true`. The required order remains cron-secret authentication, build-lock check, environment activation check, lazy service-role client creation, claim RPC, then sequential event processing.

## Authentication

The only accepted authentication headers are `Authorization: Bearer <configured secret>` and `x-vercel-cron-secret`. With one approved header, that supplied candidate must be well-formed and match the configured server-side cron secret. With both approved headers, both candidates must independently be well-formed and match the same configured secret. URL secrets, request bodies, cookies, creator sessions, and operator sessions are not accepted.

## Lazy admin initialization and authorized RPCs

The service-role admin client is initialized only after authentication and both activation gates pass. The runner may call only `creator_publishing_claim_due_scheduler_events` with fixed `p_limit: 1` and `p_lock_minutes: 15`, and `creator_publishing_process_scheduler_event` with the claimed event id, claimed lock token, current AI-twin consent version, and current attestation text hash. The existing claim RPC is generic; it is not OnlyFans-scoped and is not publishing-mode-scoped.

## Batch, stop, and recovery policy

Processing is bounded to 1 claimed row and is strictly sequential. Valid processed, blocked, and superseded results complete the single claimed event. Claim transport failure, malformed claim data, process transport failure, malformed process data, unknown safe-error code, stale lock token, missing event, and identity mismatch stop the run immediately. Remaining due events are not reset, locks are not cleared directly, and the existing database lock-expiry behavior remains authoritative for crash and stale-worker recovery.

## Response and platform boundaries

Responses are finite aggregate JSON and do not expose secrets, credentials, lock tokens, event IDs, user IDs, creator IDs, operator IDs, raw database errors, exception messages, or stack traces. Gate 21B-3A performs no direct table mutation and makes no external-platform calls. It does not connect to OnlyFans, Fanvue, Reddit, X, or any other platform.

## Gate 21B blocker retained

Before any scheduled or production activation beyond this manual-first preparation, a separately approved read-only production preflight must prove that all claimable pending and expired-processing scheduler events are OnlyFans assisted-mode work. Any non-OnlyFans-assisted claimable work blocks activation and requires a separately approved database-owned scope boundary.

Gate 21B-3A does not configure the environment flag, add a cron, select a cadence, invoke the scheduler, or perform production activation. No production preflight is performed in Gate 21B-3A.

## Rollback while manually gated

Because no cron is added and environment activation is not changed, rollback remains a normal code rollback of the runner build-lock and single-claim-limit change. No environment value or database migration is changed by Gate 21B-3A.
