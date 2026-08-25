# Durable compute control plane (Pass 2)

This source-only control plane is provider-neutral. PostgreSQL owns Image, Trainer,
Video, and Stitch job/attempt state; R2 remains the binary source of truth.
`DURABLE_COMPUTE_JOBS_ENABLED` is server-only, exact-`true`, and defaults **OFF**.
The migration must exist before staged use. Do not enable the gate now.

Dispatch fails closed until deliberately measured scheduler and spend policies are
configured. The migration seeds no production policy or numeric cap. Private compute
also requires the existing private-media migration, credentials, and verification;
`PRIVATE_CREATOR_MEDIA_ENABLED` remains separate and off.

Claims use the configured lease duration; heartbeats renew both authoritative expiries through the configured stale interval. An authority-bound worker signal exposes only internal state and whether creator cancellation was requested.
Pre-dispatch retry is bounded by the job retry ceiling. Dispatch uncertainty enters
`recovering` and requires the exact attempt recovery token: it can become terminal,
or requeue only when an adapter positively proves provider work never occurred.
Cancellation without dispatch becomes terminal on stale recovery; cancellation after
dispatch remains reconciliation-bound.

Spend events are exact integer USD micros. Each attempt has at most one reservation,
one release, and one actual settlement. Settlement appends the reservation's negative
release before actual cost, so net spend equals actual cost. Repeated identical calls
are idempotent; conflicting amounts fail closed. A denied authorization finishes the
attempt, clears its lease, and queues it until the configured spend-hold interval.
The service role executes security-definer functions but has no direct compute-table
DML grant, keeping the ledger append-only through the control contract.
Claim ordinals are monotonic and independent from the bounded retry counter, so
capacity/spend holds never exhaust execution retries. Actual settlement requires
provider-dispatch evidence and evaluates daily/monthly threshold crossings against
the attempt's reserved policy. A service-only, idempotency-keyed correction RPC
supports signed post-settlement adjustments without weakening worker leases.

Trainer durable submission and `user_loras` projection linkage occur in one database
transaction. Image submission priority uses only the exact canonical `og_throne`
subscription tier, and the Generator persists/polls every nonterminal submitted job.

Future normal workers must execute in this order: claim, heartbeat, check the worker
signal for cancellation, authorize spend, record
durable provider-dispatch intent, make the external request, attach the opaque provider
operation reference, heartbeat/check the signal, settle actual cost, finalize the result/artifact, and
only then terminalize the job. A crash after dispatch intent always enters recovering;
it is never a blind retry. Proven non-execution releases a reservation exactly once.
Zero actual cost is valid settlement evidence. Stitch has no per-creator active limit;
OG weighting and creator concurrency apply only to Trainer, Image, and Video.

Future recovery workers claim an exclusive recovery lease, heartbeat it, query the
provider through a future adapter, and reconcile with both the stable recovery token
and current ephemeral lease. If a worker disappears, the lease expires and another
worker can safely reclaim it with a new lease token. No provider implementation exists yet.

Pass 3 must supply worker/provider adapters, reconciliation, cancellation, and result
finalization. Video remains unavailable. No Salad configuration, provider workload,
GPU canary, or real generation is part of this pass.

## Eventual activation sequence

1. Merge reviewed source and obtain a green Production deployment.
2. With separate human authorization, apply `20260825090000_durable_compute_job_plane.sql`.
3. Verify schema, functions, RLS, grants, and keep the durable gate off.
4. Complete Pass 3 provider-neutral worker adapters.
5. Configure measured scheduler/spend policies and private compute storage prerequisites.
6. Only then authorize a controlled canary and later activation.

## Emergency rollback

Keep the gate and workers off, drain or reconcile every nonterminal job, export audit
records, and obtain explicit authorization. Run
`supabase/manual/durable_compute_job_plane_emergency_rollback.sql`. It drops only
Pass 2 objects and intentionally preserves generations, user_loras, legacy generation,
private-media, and publishing tables.
