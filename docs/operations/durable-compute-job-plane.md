# Durable compute control plane (Pass 2)

This source-only control plane is provider-neutral. PostgreSQL owns Image, Trainer,
Video, and Stitch job/attempt state; R2 remains the binary source of truth.
`DURABLE_COMPUTE_JOBS_ENABLED` is server-only, exact-`true`, and defaults **OFF**.
The migration must exist before staged use. Do not enable the gate now.

Dispatch fails closed until deliberately measured scheduler and spend policies are
configured. The migration seeds no production policy or numeric cap. Private compute
also requires the existing private-media migration, credentials, and verification;
`PRIVATE_CREATOR_MEDIA_ENABLED` remains separate and off.

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
