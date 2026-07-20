# Task 21 Creator Publishing Scheduler Reliability Operations

## Current production state

Gate 21B-4A is complete, verified, and closed. Exactly one manual scheduler invocation returned `SCHEDULER_RUN_COMPLETED` with all aggregate counts equal to zero. The accepted Mode C postflight found no scheduler audit activity, no active scheduler events, no logical claimable events, no fresh processing locks, no blocking conditions, `safe_existing_rpc_path = true`, and `database_scoped_path_required = false`.

`CREATOR_PUBLISHING_SCHEDULER_ENABLED` is absent in Production. The shutdown deployment is green. No Creator Publishing cron is registered and recurring execution is disabled.

## Gate 21B-3B1 scope

Gate 21B-3B1 adds sanitized route telemetry and `maxDuration = 60` only. It does not change `vercel.json`, register a cron, change an environment value, invoke the scheduler, create a migration, or modify scheduler service or core business logic.

No cron is registered by Gate 21B-3B1. A future `*/15 * * * *` cadence remains a design proposal only and requires the later controlled gates described below.

## Four-gate recurring-activation structure

1. **Gate 21B-3B1 — telemetry and duration hardening.** Add safe route telemetry and a 60-second route limit without cron or environment changes.
2. **Gate 21B-4B1 — manual Production proof.** After 3B1 is merged and deployed, temporarily enable the environment only for separately approved manual requests, verify telemetry, disable and redeploy, and complete read-only postflights. A legitimate nonzero canary is deferred until the normal application workflow can create one.
3. **Gate 21B-3B2 — cron registration.** Only after the legitimate nonzero canary is accepted, add the exact Creator Publishing cron while keeping Production runtime activation absent through PR review.
4. **Gate 21B-4B2 — recurring Production activation.** Require a fresh preflight, explicit merge and environment approvals, deployment and cron verification, and observation of the first four scheduled invocations.

Approval of one gate does not authorize any later gate.

## Authentication and execution order

The only accepted authentication headers remain `Authorization: Bearer <configured secret>` and `x-vercel-cron-secret`. URL secrets, request bodies, cookies, creator sessions, and operator sessions are not accepted.

The required execution order remains:

1. cron-secret authentication;
2. build-lock check;
3. environment activation check;
4. lazy service-role client creation;
5. `creator_publishing_claim_due_scheduler_events`;
6. sequential `creator_publishing_process_scheduler_event` processing.

The runner remains limited to one claimed row with a 15-minute lock TTL. It makes no external-platform request and performs no direct OnlyFans publishing.

## Telemetry contract

Every route invocation emits exactly one sanitized telemetry record from a `finally` block. The record contains only:

- `event`;
- `trigger`;
- `ok`;
- `code`;
- `httpStatus`;
- `claimedCount`;
- `attemptedCount`;
- `processedCount`;
- `blockedCount`;
- `supersededCount`;
- `durationMs`.

The fixed event name is `creator_publishing_scheduler_run`.

The trigger is `vercel_cron` only when the request user-agent is exactly `vercel-cron/1.0` and the handled runner result code is neither `UNAUTHORIZED` nor `CRON_SECRET_NOT_CONFIGURED`. Otherwise the trigger is `manual_or_unknown`. An unexpected thrown error always remains `manual_or_unknown`.

The user-agent is telemetry-only. It never replaces cron-secret authentication, enables execution, bypasses the build gate, bypasses the environment gate, changes RPC selection, or affects scheduler state. Its value is never logged.

Handled count fields are finite nonnegative integers when present and otherwise `null`. `durationMs` is always a finite nonnegative integer.

The fallback record for an unexpected thrown error contains only the fixed event name, `trigger = manual_or_unknown`, `ok = false`, `code = UNHANDLED_EXCEPTION`, `httpStatus = 500`, null count fields, and finite `durationMs`. The route does not catch or transform the thrown error, so existing HTTP error behavior is preserved.

Telemetry must never include request-header objects, authorization values, `x-vercel-cron-secret`, user-agent values, cookies, secrets, event IDs, lock tokens, creator/user/account identifiers, raw errors, exception objects or messages, stack traces, RPC arguments, database payloads, or media/content details.

## Batch, overlap, and recovery policy

Processing remains bounded to one claimed row and is strictly sequential. The database claim path uses row locking and lock tokens, but it is not a global scheduler-run lease. Overlapping invocations can therefore claim different events. Direct external publishing remains prohibited.

The exact stale-lock eligibility rule is:

```text
locked_at < db_now - lock_ttl
```

With a possible future 15-minute cadence and the existing 15-minute lock TTL, a failed claim might not be eligible at the immediately following run. Recovery can therefore take approximately 15–30 minutes and is not guaranteed at exactly 15 minutes. Locks are not cleared directly; database lock expiry remains authoritative.

## Zero-event proof limitation and legitimate canary requirement

Gate 21B-4A proved Production route reachability, authentication, build and environment gates, admin-client initialization, the claim RPC, empty-claim parsing, a successful aggregate response, shutdown, and a clean read-only postflight. It did not prove a real event claim or processing transition.

The scheduling RPC verifies creator and destination-account state before inserting scheduler events. An unverified destination account returns a failed scheduling result with `mutated:false` and creates no scheduler event.

No fake, fixture, placeholder, fabricated, or direct-database Production event is authorized. The nonzero canary must wait until one legitimate event can be created through the complete approved application workflow. Recurring activation remains blocked until that canary and its read-only postflight are accepted.

## Platform boundaries

OnlyFans remains assisted/manual. Human publishing remains required. The connector cannot upload media, schedule directly, or publish immediately. Fanvue remains frozen, and disabled or unassigned platforms remain ineligible for recurring activation.

No scheduler reliability gate authorizes credentials, browser automation, unofficial APIs, platform sessions, direct posting, AutoPost coupling, or external-platform verification.

## Correct normal rollback order for a future recurring activation

A future normal rollback must fail closed before cron removal:

1. remove or disable `CREATOR_PUBLISHING_SCHEDULER_ENABLED`;
2. redeploy Production;
3. verify the route returns `SCHEDULER_ENV_DISABLED`;
4. remove only the Creator Publishing cron from `vercel.json`;
5. deploy the cron-removal commit;
6. verify the Creator Publishing cron is absent;
7. verify the existing AutoPost cron is unchanged;
8. run the separately approved read-only shutdown postflight.

Project-wide cron disabling is emergency-only because it also affects AutoPost.

## Current authorization boundary

Gate 21B-3B1 does not authorize Production environment changes, scheduler invocations, cron registration, migrations, merge, Gate 21B-4B1, a Production canary, or recurring execution. Those remain separately approved gates.

## Gate 21B-4B1 Phase B1 — trusted application scheduling and cancellation bridge

Gate 21B-4B1 Phase B identified that the trusted application path to the existing scheduler RPCs was missing. Phase B1 adds only that bridge for authenticated, subscribed creators. It does not add a migration, Production data action, Production SQL, Production candidate-row inspection, scheduler invocation, environment activation, cron registration, direct external publishing, a canary, Gate 21B-3B2 work, or recurring execution.

OnlyFans remains assisted/manual. Sirens Forge does not log into OnlyFans, contact OnlyFans, use OnlyFans credentials, upload media to OnlyFans, perform browser automation, or post directly to OnlyFans. Scheduling creates internal plan, job, and scheduler-event state only through the existing `creator_publishing_schedule_plan` RPC. Cancellation uses the existing `creator_publishing_cancel_plan_schedule` RPC.

The initial Phase B1 application path intentionally accepts exactly one active creator-owned OnlyFans-assisted draft job in a draft Publishing Plan. Current AI-twin consent values are derived server-side from the existing consent version and consent text hash sources. The browser cannot provide creator, account, package, consent, platform, publishing mode, revision, RPC, or database state.

Creator-selected publication time is submitted as local date, minute-resolution local time, IANA timezone, and, only when needed, an explicit UTC-offset occurrence for repeated fall-back local times. The server resolves the intended UTC instant deterministically, rejects nonexistent spring-forward local times, requires explicit fall-back occurrence selection, rejects timezone/offset mismatches, requires intended publication to be at least 90 minutes ahead, and sets operator due exactly 60 minutes before publication.

The UI keeps the original idempotency key when scheduling or cancellation has an uncertain transport outcome. A new key is created only after exact success is confirmed or after trusted server state is reloaded and the creator deliberately starts a new action. Cancelled-plan reconciliation after refresh exposes only minimal creator-owned safe state needed to determine whether an uncertain cancellation with a matching normalized reason succeeded; it exposes no queue-task IDs, scheduler-event IDs, account IDs, package IDs, audit payloads, stored idempotency results, or request fingerprints.

Future legitimate nonzero canary activity remains separately gated. Phase B1 does not authorize Production access, environment changes, scheduler activation, cron, Gate 21B-3B2, or recurring execution.
