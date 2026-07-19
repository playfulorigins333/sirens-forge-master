# Task 21 Gate 21A — Creator Publishing Scheduler Runner Operations

Gate 21A adds a dedicated server-only endpoint at `/api/creator-publishing-queue/scheduler/run` for a future Creator Publishing scheduler runner. Gate 21A is hard-disabled and unscheduled. Merging Gate 21A does not activate the Creator Publishing scheduler.

## Activation locks and order

Execution requires the code build lock `CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED` to be literal `false` in Gate 21A until a later approved gate changes it, and would also require `CREATOR_PUBLISHING_SCHEDULER_ENABLED` to be exactly `true`. The required order is cron-secret authentication, build-lock check, environment activation check, lazy service-role client creation, claim RPC, then sequential event processing.

## Authentication

The only accepted authentication headers are `Authorization: Bearer <configured secret>` and `x-vercel-cron-secret`. With one approved header, that supplied candidate must be well-formed and match the configured server-side cron secret. With both approved headers, both candidates must independently be well-formed and match the same configured secret. URL secrets, request bodies, cookies, creator sessions, and operator sessions are not accepted.

## Lazy admin initialization and authorized RPCs

The service-role admin client is initialized only after authentication and both activation gates pass. The runner may call only `creator_publishing_claim_due_scheduler_events` with fixed `p_limit: 25` and `p_lock_minutes: 15`, and `creator_publishing_process_scheduler_event` with the claimed event id, claimed lock token, current AI-twin consent version, and current attestation text hash. The existing claim RPC is generic; it is not OnlyFans-scoped and is not publishing-mode-scoped.

## Batch, stop, and recovery policy

Processing is bounded to 25 claimed rows and is strictly sequential. Valid processed, blocked, and superseded results continue the batch. Claim transport failure, malformed claim data, process transport failure, malformed process data, unknown safe-error code, stale lock token, missing event, and identity mismatch stop the batch immediately. Remaining claimed events are not reset, locks are not cleared directly, and the existing database lock-expiry behavior remains authoritative for crash and stale-worker recovery.

## Response and platform boundaries

Responses are finite aggregate JSON and do not expose secrets, credentials, lock tokens, event IDs, user IDs, creator IDs, operator IDs, raw database errors, exception messages, or stack traces. Gate 21A performs no direct table mutation and makes no external-platform calls. It does not connect to OnlyFans, Fanvue, Reddit, X, or any other platform.

## Gate 21B blocker

Before Gate 21B activation, a separately approved read-only production preflight must prove that all claimable pending and expired-processing scheduler events are OnlyFans assisted-mode work. Any non-OnlyFans-assisted claimable work blocks activation and requires a separately approved database-owned scope boundary.

Gate 21B must separately authorize changing the build lock, configuring the environment flag, adding a cron, selecting cadence, and production activation. No production preflight is performed in Gate 21A.

## Rollback while disabled

Because the build lock remains false and no cron is added, rollback while disabled is a normal code rollback of this route and runner module. No environment value or database migration is changed by Gate 21A.
