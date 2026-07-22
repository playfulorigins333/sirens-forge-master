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

## Gate 21C-2 — uncertain scheduler process outcome reconciliation

Gate 21C-2 preserves exactly one invocation of `creator_publishing_process_scheduler_event` for each successfully claimed scheduler event. It never retries the process RPC. Reconciliation is eligible only when that single process RPC returns an RPC/client error object or throws after the event was already claimed; normal process responses, including malformed normal responses, remain handled only by the existing process-response parser and are not reconciled.

The reconciliation step performs exactly one read-only lookup against `creator_publishing_scheduler_events`, filtered by the trusted claimed event ID, requesting one row with the exact projection `status,processed_at,superseded_at,safe_error_code,lock_token,locked_at`. It does not write, clear locks, invoke another mutating RPC, perform external-platform work, or expose event IDs, lock tokens, raw errors, row contents, creator IDs, user IDs, plan IDs, job IDs, package IDs, account IDs, credentials, content, or media.

A reconciled processed terminal state is accepted only when `status === "processed"`, `processed_at` is a valid nonempty timestamp string under `new Date(value).getTime()`, `superseded_at === null`, `safe_error_code === null`, `lock_token === null`, and `locked_at === null`. A reconciled blocked terminal state is accepted only when `status === "blocked"`, `processed_at` is a valid nonempty timestamp string, `superseded_at === null`, `safe_error_code` is one of the existing scheduler safe error codes, `lock_token === null`, and `locked_at === null`. A reconciled superseded terminal state is accepted only when `status === "superseded"`, `processed_at === null`, `superseded_at` is a valid nonempty timestamp string, `safe_error_code === null`, `lock_token === null`, and `locked_at === null`.

Cancelled states, unresolved states, malformed states, nonterminal states, missing fields, extra fields, invalid timestamps, unknown safe error codes, non-null terminal locks, reconciliation query errors, thrown reconciliation queries, no-row results, multi-row results, and malformed response containers all fail closed to the existing `PROCESS_RPC_FAILED` public result with the current aggregate counts. When reconciliation cannot prove one exact terminal shape, database stale-lock recovery remains authoritative.

Claim-RPC uncertainty remains unresolved by Gate 21C-2 because no trusted claimed event-ID and lock-token response may have been received. Gate 21C-2 authorizes no Production activation, scheduler invocation, cron registration, migration, environment change, generation, direct publishing, credentials, browser automation, scraping, unofficial API use, or external-platform behavior.

## Gate 21C-3 uncertain claim outcomes

Gate 21C-3 treats scheduler claim transport/client uncertainty as a handled scheduler result. The runner invokes `creator_publishing_claim_due_scheduler_events` once only, with the existing claim limit and lock TTL constants, and never retries the claim RPC.

If the claim RPC returns an error or throws while being invoked, the public result is the sanitized `CLAIM_RPC_FAILED` result. All aggregate counts remain zero because no trusted claim response was received. Those zero counts are not proof that the database claimed no scheduler event; the claim transaction may have committed while the response was lost.

After claim uncertainty, the runner does not parse claim data, perform claim reconciliation, infer an event from recent scheduler state, query scheduler or audit tables, invoke the process RPC, clear locks, replace locks, release claims, write tables, or invoke another mutating RPC. Locks must not be cleared directly. If the claim transaction committed, database stale-lock expiry remains authoritative for automated recovery.

Operationally, an uncertain claim outcome should be treated as possible committed work with a lost response. Any Production inspection or intervention requires separate explicit authorization. Gate 21C-3 introduces no Production activation, scheduler invocation, cron registration, migration, environment change, generation behavior, or external-platform behavior.

## Gate 21C-4 — scheduler retry exhaustion

Gate 21C-4 establishes a maximum of three successful claim attempts per scheduler event. `processing_attempts` increments when an event is claimed, not when processing completes. The first successful claim sets the value to 1; stale-lock recovery may issue attempts 2 and 3; after attempt 3 becomes stale, the next claim invocation must never issue attempt 4.

The claim transaction first terminalizes a deterministic, bounded set of stale `processing` events whose `processing_attempts >= 3`, using the normalized database lock TTL and `FOR UPDATE SKIP LOCKED`. Terminalization is limited by the normalized claim limit and ordered by `due_at`, `operator_due` before `publish_due`, then event ID. Each exhausted event becomes terminal `blocked` with `safe_error_code = SCHEDULER_RETRY_EXHAUSTED`, retains `processing_attempts = 3`, receives `processed_at`, clears `lock_token` and `locked_at`, and appends exactly one sanitized `creator_publishing_scheduler_event_retry_exhausted` audit event.

Ordinary claim selection runs only after exhaustion terminalization in the same transaction and operates against the resulting state. A terminalized earlier event therefore no longer blocks a later eligible event for the same Platform Job during that invocation. Ordinary claims remain independently bounded, deterministic, lock-token protected, and limited to pending events or stale processing events below attempt 3. Fresh processing locks remain untouched, pending events are never terminalized for exhaustion, and exhausted events never appear in claim output.

Retry exhaustion changes no Platform Job, Publishing Plan, queue task, content package, platform account, scheduler idempotency row, historical attempt count, or unrelated scheduler event. It does not automatically requeue or retry an exhausted event. Any later manual recovery policy, dashboard, alert, or product workflow requires a separately authorized gate.

`SCHEDULER_RETRY_EXHAUSTED` is not a process-RPC safe code. A normal process response containing it remains `UNKNOWN_SAFE_ERROR_CODE`. Only the exact read-only uncertain-process reconciliation shape may recognize a blocked event with this code after another scheduler invocation legitimately terminalized its expired lock.

Migration `20260721001900_creator_publishing_scheduler_retry_exhaustion.sql` is applied and verified in Production. Gate 21C-4 is closed. The Production scheduler remains disabled, no Creator Publishing cron is registered, and the legitimate nonzero OnlyFans-assisted canary remains deferred until the creator account is genuinely verified.

## Gate 21C-5 — controlled retry-exhaustion recovery

Gate 21C-5 adds one dormant, service-role-only RPC for an explicitly authorized operator to requeue one exact scheduler event that is still terminally blocked with `SCHEDULER_RETRY_EXHAUSTED`. It is not automatic recovery and is not called by the scheduler runner, a route, the browser, cron, or any external platform integration.

Recovery uses one transaction-stable database timestamp and one transaction advisory lock scoped to `creator_scheduler_retry_recovery:<event_id>`. It then follows the scheduler process lock order: read event identity, lock Publishing Plan, lock Platform Job, lock Scheduler Event, and revalidate identity. A first successful recovery is allowed only when the event remains exhausted with cleared locks, is already due, belongs to a noncancelled nonterminal plan/job at the current revision, and still matches one transition family accepted by scheduler processing.

The only mutation is the targeted scheduler event: `status = pending`, `processing_attempts = 0`, `processed_at = null`, `safe_error_code = null`, and cleared locks. Scheduling identity, timestamps not listed for mutation, sibling events, plans, jobs, queue tasks, packages, accounts, capabilities, generations, scheduler idempotency rows, and historical audits remain unchanged. One sanitized append-only `creator_publishing_scheduler_event_retry_requeued` audit records the finite recovery reason and the exhausted cycle's prior `processed_at` marker.

Successful-operation idempotency is scoped to event, action, and key. An exact same-key/same-reason replay returns finite idempotent success even after the recovered event progresses. A reused key with a different reason conflicts. If the event later legitimately exhausts again with a new `processed_at`, the old key is stale and cannot falsely report recovery for the new cycle; a new valid key is required.

Gate 21C-5 repository implementation does not authorize merge, Production migration application, Production RPC invocation, scheduler invocation, cron or environment changes, automatic recovery, a recovery UI or API, dashboards, alert delivery, a live canary, generation, credentials, browser automation, scraping, unofficial APIs, or external-platform interaction.
