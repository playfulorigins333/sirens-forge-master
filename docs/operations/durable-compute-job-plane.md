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
worker can safely reclaim it with a new lease token. While observing provider work, a
recovery worker holding a live recovery lease checks `compute_recovery_signal` so it
can act on creator cancellation without direct compute-table reads. No provider
implementation exists yet.

## Pass 4A workload finalization

Pass 4A adds service-role-only normal and recovery finalizers for Image and Trainer.
Each finalizer persists its canonical product and terminal durable outcome in one
PostgreSQL transaction. Image delegates canonical persistence to
`finalize_private_generation`, returning only `generation_id` and `asset_ids`.
Trainer binds through the job's authoritative `identity_id`, persists the artifact,
and derives `sf` plus the first eight normalized LoRA UUID characters server-side.
Identical replay is idempotent and conflicting replay fails closed.

A `compute_jobs` transition guard rejects generic Image/Trainer success unless the
workload finalizer has installed its transaction-local authority marker. Generic
Stitch success is unchanged. Video remains unavailable. Both recovery finalizers
retain recovery-token, recovery-lease, execution-evidence, and actual-cost settlement
requirements.

An exact-binding trigger projects current Trainer jobs to `user_loras`: queued maps
to queued; claimed, running, recovering, and cancel_requested map to training; failed
and cancelled map to failed (with creator-safe codes only). Succeeded never projects
completed; only atomic artifact finalization does that. A row lock on the authoritative
LoRA prevents a different idempotency key from replacing a nonterminal current job,
while different Twins remain independently queueable and terminal Twins may retrain.

The Pass 4A migration is still a separately authorized Production operation. All
runtime gates remain **OFF**; this pass adds no provider adapter, provider
configuration, GPU canary, real generation, or real training.

## Eventual activation sequence

1. Merge reviewed source and obtain a green Production deployment.
2. With separate human authorization, apply `20260825090000_durable_compute_job_plane.sql`.
3. With a further separate authorization, apply `20260826004344_durable_compute_pass_4a_finalization.sql`.
4. Verify schema, functions, RLS, grants, and keep the durable gate off.
5. Complete provider-neutral worker adapters in a later pass.
6. Configure measured scheduler/spend policies and private compute storage prerequisites.
7. Only then authorize a controlled canary and later activation.

## Emergency rollback

Keep the gate and workers off, drain or reconcile every nonterminal job, export audit
records, and obtain explicit authorization. Run
`supabase/manual/durable_compute_job_plane_emergency_rollback.sql`. It drops only
Pass 2 objects and intentionally preserves generations, user_loras, legacy generation,
private-media, and publishing tables.

To remove only Pass 4A while preserving the Pass 2 plane and private-media schema,
use `supabase/manual/durable_compute_pass_4a_emergency_rollback.sql` after separate
authorization. It drops the four finalizers and two triggers/helpers and restores the
exact pre-Pass-4A Trainer submission function.
