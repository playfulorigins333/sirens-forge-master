# P0-02A private creator media rollout

## Storage classes

This batch implements only `creator_generation`: private generated creator media whose binary source of truth is R2. Future, separately reviewed work should keep distinct private classes for raw training uploads, approved training datasets, Twin/LoRA artifacts and checkpoints, and platform/base/video model assets. Supabase stores ownership and object metadata, not the binaries.

## Phase A — this code batch

Ship schema, application code, rollback, and tests only. `PRIVATE_CREATOR_MEDIA_ENABLED` remains false. No Production database, deployment, or storage mutation is part of this phase. The legacy generation path remains active.

## Phase B — coordinated API follow-up

Update `sirens-forge-api` to write every one through four outputs to the configured private creator-generation bucket; return `kind: image`, `r2_bucket`, and `r2_key` for every output without requiring `R2_PUBLIC_BASE`; and retain gated legacy response compatibility. Later provider-neutral execution must materialize identity LoRA inputs worker-side rather than disclose storage authority.

## Phase C — live infrastructure (later, separately authorized)

Create/configure a private creator-generation R2 bucket with no public `r2.dev` or custom-public access and least-privilege credentials. Assign server-only Vercel/Railway environment variables, apply the reviewed Supabase migration, and deploy while the feature gate remains false.

## Phase D — real canary

With generation pods available, verify that a real private object exists and no stable anonymous URL retrieves it; owner preview/download and refresh work; a foreign owner receives `NOT_FOUND`; the signed URL expires; one, two, three, and four outputs all appear independently in Creation Loop; publishing selection still works; and no permanent creator-facing URL is canonical.

## Phase E — cutover

Enable `PRIVATE_CREATOR_MEDIA_ENABLED=true` deliberately only after the API, infrastructure, migration, and canary pass. Monitor verification/finalization failures and signed-access denials. Keep the legacy bucket and objects untouched throughout the rollback window.

## Phase F — legacy retirement

Only after every consumer is proven migrated, remove the private path's `R2_PUBLIC_BASE` dependency, disable old public exposure, and migrate/remove legacy compatibility in a separate audited batch.

## Failure boundary and rollback

R2 and PostgreSQL do not share a distributed transaction. If API-side upload succeeds but master verification or database finalization fails, an unreferenced R2 object can remain; a later retention/orphan worker must reconcile configured-bucket objects against `private_storage_objects`. Database finalization itself is atomic and idempotent.

To roll back application behavior, set/keep the gate false and redeploy the prior application. Do not delete R2 objects or disable old exposure. After confirming no private-path traffic and taking a fresh backup, an explicitly authorized operator may run `supabase/manual/private_creator_generation_media_rollback.sql`; it removes only this batch's function and tables and preserves `generations` and its legacy columns.

## Launch cost impact

Fixed software cost introduced by this code batch: **$0**.

Additional fixed monthly cost introduced by this code batch: **$0**.

Variable: Cloudflare R2 storage and operations according to actual usage.

Unknown pending measurement: creator media GB-month, Class A operations, Class B operations, and actual launch media volume.
