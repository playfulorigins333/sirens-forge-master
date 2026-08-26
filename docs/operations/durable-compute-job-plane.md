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
`finalize_private_generation`, always using the compute job UUID as `generation_id`
and deriving creator-facing generation metadata from the durable request. Image asset
evidence must exactly match `output_count`, use contiguous ordinals starting at zero,
and live below `creator-generations/<job_id>/`; owner, media kind, and storage class
are injected by PostgreSQL rather than trusted from a worker. The creator result
contains only `generation_id` and `asset_ids`. After canonical persistence, the
durable wrapper locks the generation row and compares every creator-facing generation
field with the authoritative contract; a same-ID legacy/poisoned row fails closed and
the transaction rolls back any attempted asset attachment.
Trainer binds through the job's authoritative `identity_id`, persists the artifact,
enforces the provider-neutral canonical key `loras/<lora_id>/final.safetensors`,
derives `sf` plus the first eight normalized LoRA UUID characters server-side, and
stores only `{ "result_id": "<lora_id>" }` in the creator result reference.
Identical replay is idempotent and conflicting replay fails closed.
Normal replay additionally requires the supplied attempt to be the current attempt
ordinal and the recorded successful attempt with its workload fingerprint; an older
retried attempt cannot replay a newer success. Recovery Trainer replay verifies the
entire completed LoRA product, including progress and server-derived trigger token.

The forward migration replaces the generic normal transition and recovery
reconciliation functions so they unconditionally reject Image/Trainer success with
`WORKLOAD_FINALIZATION_REQUIRED`. There is no session setting or caller-settable
bypass. Workload finalizers perform their narrow terminal updates directly in the
same product transaction. Generic Stitch success is unchanged. Video remains
unavailable. Both recovery finalizers retain recovery-token, recovery-lease,
execution-evidence, and actual-cost settlement requirements, including valid zero
cost and dispatch uncertainty without a provider operation reference.

An exact-binding trigger projects current Trainer jobs to `user_loras`: queued maps
to queued; claimed maps to training without inventing `started_at`; running maps its
authoritative durable start; recovering and cancel_requested preserve that start; failed
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
authorization. It drops the four finalizers and projection helper/trigger and restores
the exact pre-Pass-4A Trainer submission, generic worker transition, and generic
recovery reconciliation definitions.

## Pass 4C-A Video/Stitch foundation (execution disabled)

Pass 4C-A defines a creator-rooted **Video Project** without enabling creator Video.
One service-only submission transaction derives either two standard segments (10–15s)
or three OG segments (20–25s), creates exactly one Video job for the entire private
segment set, and creates exactly one dependent Stitch job. Stitch cannot claim until
the Video job succeeded and PostgreSQL has the exact contiguous segment set. The
`project_id` is the creator-facing root; compute job IDs, attempts, segment rows, and
R2 coordinates remain internal.

Video and recovery workers obtain authority-bound, service-role-only manifests and
must use the dedicated atomic finalizers. The Video finalizer records MP4 segment
metadata under `creator-video-projects/<project>/segments/<ordinal>/` without creating
Library assets. The Stitch finalizer accepts the verified continuous MP4 under
`creator-video-projects/<project>/final/` and creates exactly one completed Video
generation plus one Video Library asset. R2 remains binary truth and PostgreSQL owns
job and product truth. Generic Video/Stitch submission is forbidden, and generic
success is forbidden for Image, Trainer, Video, and Stitch.

This migration has **not** been applied to Production. Both public Video POST routes
still return `503 VIDEO_GENERATION_UNAVAILABLE`, and Generate continues to label both
Video modes Coming Soon. This pass adds no provider adapter, worker/API wiring,
identity materialization, FFmpeg/Stitch implementation, R2 runtime upload, scheduler
or spend policy configuration, gate activation, canary, deployment, or live work.
