# Task 21 Gate 21B-3A — Creator Publishing Scheduler Runner Operations

Gate 21B-3A prepares manual-first scheduler activation without adding a cron. It keeps the dedicated server-only endpoint at `/api/creator-publishing-queue/scheduler/run` environment-gated while enabling the code build lock. Merging Gate 21B-3A does not by itself invoke the Creator Publishing scheduler.

## Gate 21A historical state

Gate 21A introduced the dedicated server-only route at `/api/creator-publishing-queue/scheduler/run` for a future Creator Publishing scheduler runner. In Gate 21A, `CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED` was literal `false`, `CREATOR_PUBLISHING_SCHEDULER_CLAIM_LIMIT` was `25`, and `CREATOR_PUBLISHING_SCHEDULER_LOCK_MINUTES` was `15`. Gate 21A added no cron and performed no production activation.

## Gate 21B-2 production preflight result

The separately approved Gate 21B-2 read-only production preflight completed successfully. The audit input was valid, no scheduler audit activity existed, no active or logical claimable scheduler events existed, blocking_conditions was empty, safe_existing_rpc_path was true, and database_scoped_path_required was false.

## Current Gate 21B-3A state

Execution requires the code build lock `CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED` to be literal `true` in Gate 21B-3A, while CREATOR_PUBLISHING_SCHEDULER_ENABLED remains disabled until a separately approved production environment change. `CREATOR_PUBLISHING_SCHEDULER_CLAIM_LIMIT` is one, and `CREATOR_PUBLISHING_SCHEDULER_LOCK_MINUTES` remains exactly 15 minutes.

Gate 21B-3A does not add a cron, does not change a migration, performs no new production access, and does not invoke the scheduler. This prepares Gate 21B-4A only. Gate 21B-4A requires a separately approved production environment change and permits exactly one separately authorized manual invocation. recurring execution is not authorized.

The required order remains cron-secret authentication, build-lock check, environment activation check, lazy service-role client creation, claim RPC, then sequential event processing.

## Authentication

The only accepted authentication headers are `Authorization: Bearer <configured secret>` and `x-vercel-cron-secret`. With one approved header, that supplied candidate must be well-formed and match the configured server-side cron secret. With both approved headers, both candidates must independently be well-formed and match the same configured secret. URL secrets, request bodies, cookies, creator sessions, and operator sessions are not accepted.

## Lazy admin initialization and authorized RPCs

The service-role admin client is initialized only after authentication and both activation gates pass. The runner may call only `creator_publishing_claim_due_scheduler_events` with fixed `p_limit: 1` and `p_lock_minutes: 15`, and `creator_publishing_process_scheduler_event` with the claimed event id, claimed lock token, current AI-twin consent version, and current attestation text hash. The existing claim RPC is generic; it is not OnlyFans-scoped and is not publishing-mode-scoped.

## Batch, stop, and recovery policy

Processing is bounded to 1 claimed row and is strictly sequential. Valid processed, blocked, and superseded results complete the single claimed event. Claim transport failure, malformed claim data, process transport failure, malformed process data, unknown safe-error code, stale lock token, missing event, and identity mismatch stop the run immediately. Remaining due events are not reset, locks are not cleared directly, and the existing database lock-expiry behavior remains authoritative for crash and stale-worker recovery.

The exact stale-lock eligibility rule is:

```text
locked_at < db_now - lock_ttl
```

With a possible future 15-minute cron cadence and a 15-minute lock TTL, a failed claim might not be eligible at the immediately following run. Recovery can therefore take approximately 15–30 minutes and is not guaranteed at exactly 15 minutes.

## Response and platform boundaries

Responses are finite aggregate JSON and do not expose secrets, credentials, lock tokens, event IDs, user IDs, creator IDs, operator IDs, raw database errors, exception messages, or stack traces. Gate 21B-3A performs no direct table mutation and makes no external-platform calls. It does not connect to OnlyFans, Fanvue, Reddit, X, or any other platform.

## Gate 21B blocker retained

The completed Gate 21B-2 read-only production preflight found no active or logical claimable scheduler events. Before any future scheduled or recurring production activation beyond the separately authorized Gate 21B-4A manual invocation, another separately approved production review must confirm the activation scope remains safe. Any non-OnlyFans-assisted claimable work blocks activation and requires a separately approved database-owned scope boundary.

Gate 21B-3A performs no new production access and relies on the already completed Gate 21B-2 read-only production preflight.

## Rollback while manually gated

Because no cron is added and environment activation is not changed, rollback remains a normal code rollback of the runner build-lock and single-claim-limit change. No environment value or database migration is changed by Gate 21B-3A.
