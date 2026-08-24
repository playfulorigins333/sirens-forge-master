# P0-02A private creator media rollout

## Storage classes

This batch implements only `creator_generation`: private generated creator media whose binary source of truth is R2. Future, separately reviewed work should keep distinct private classes for raw training uploads, approved training datasets, Twin/LoRA artifacts and checkpoints, and platform/base/video model assets. Supabase stores ownership and object metadata, not the binaries.

## Phase A — this code batch

Ship schema, application code, rollback, and tests with `PRIVATE_CREATOR_MEDIA_ENABLED` off. This code PR performs no manual Production database, storage, or environment mutation; normal merge/deployment behavior remains separate from enabling private media. The legacy generation path remains active.

## Phase B — coordinated API follow-up

Update `sirens-forge-api` to write every one through four outputs to the configured private creator-generation bucket; return `kind: image`, `r2_bucket`, and `r2_key` for every output without requiring `R2_PUBLIC_BASE`; and retain gated legacy response compatibility. Later provider-neutral execution must materialize identity LoRA inputs worker-side rather than disclose storage authority.

## Phase C — live infrastructure (later, separately authorized)

During this separately authorized phase, create/configure `sirens-creator-generations-private` with no public `r2.dev` or custom-public access. Do not share credentials between runtimes and do not treat either credential or feature gate as installed/enabled yet.

- **Railway API private credential:** a dedicated Account API token restricted to this bucket with **Object Read & Write** only. Set `CREATOR_GENERATION_R2_ACCESS_KEY_ID`, `CREATOR_GENERATION_R2_SECRET_ACCESS_KEY`, and `CREATOR_GENERATION_R2_BUCKET` in Railway.
- **Vercel master private credential:** a separate dedicated Account API token restricted to this same bucket with **Object Read only**. Set `CREATOR_GENERATION_R2_ACCESS_KEY_ID`, `CREATOR_GENERATION_R2_SECRET_ACCESS_KEY`, and `CREATOR_GENERATION_R2_BUCKET` in Vercel. Master needs only HeadObject, GetObject, and presigned GetObject; it needs no write, delete, bucket administration, creation, or configuration permission.

Both services may reuse the account-level `R2_ENDPOINT` and `R2_REGION` / `AWS_DEFAULT_REGION` configuration, but the private token values must remain different. Apply the two reviewed Production migrations in order:

1. `supabase/migrations/20260824090000_private_creator_generation_media.sql`
2. `supabase/migrations/20260824100000_private_generation_asset_publishing.sql`

Keep `PRIVATE_CREATOR_MEDIA_ENABLED=false` throughout infrastructure setup and deployment. Do not enable the private cutover until both migrations exist, the coordinated API follow-up is complete, the private bucket is configured, and the real canary passes.

## Phase D — real canary

With generation pods available, verify that a real private object exists and no stable anonymous URL retrieves it; owner preview/download and refresh work; a foreign owner receives `NOT_FOUND`; the signed URL expires; one, two, three, and four outputs all appear independently in Creation Loop; publishing selection still works; and no permanent creator-facing URL is canonical.

## Phase E — cutover

Enable `PRIVATE_CREATOR_MEDIA_ENABLED=true` deliberately only after the API, infrastructure, migration, and canary pass. Monitor verification/finalization failures and signed-access denials. Keep the legacy bucket and objects untouched throughout the rollback window.

## Phase F — legacy retirement

Only after every consumer is proven migrated, remove the private path's `R2_PUBLIC_BASE` dependency, disable old public exposure, and migrate/remove legacy compatibility in a separate audited batch.

## Failure boundary and rollback

R2 and PostgreSQL do not share a distributed transaction. If API-side upload succeeds but master verification or database finalization fails, an unreferenced R2 object can remain; a later retention/orphan worker must reconcile configured-bucket objects against `private_storage_objects`. Database finalization itself is atomic and idempotent.

To roll back application behavior, set/keep `PRIVATE_CREATOR_MEDIA_ENABLED=false`, stop private-path traffic, and redeploy the prior application as appropriate. Do not delete R2 objects or disable old exposure. After taking an appropriate fresh backup, an explicitly authorized operator must run the rollback stages in this order:

1. **First:** `supabase/manual/private_generation_asset_publishing_rollback.sql`. This removes the asset-level publishing RPC/index behavior and restores the legacy generation-level publishing uniqueness contract before the underlying private generation tables and functions are removed. If private multi-output publishing attachments already exist, remove or migrate them as appropriate **before** this stage; restoring the legacy generation-only unique index is not automatically safe while those rows remain.
2. **Then:** `supabase/manual/private_creator_generation_media_rollback.sql`. This may remove `finalize_private_generation`, `generation_assets`, `private_storage_objects`, and their associated triggers/functions while preserving legacy `generations` data and columns.

## Launch cost impact

Fixed software cost introduced by this code batch: **$0**.

Additional fixed monthly cost introduced by this code batch: **$0**.

Variable: Cloudflare R2 storage and operations according to actual usage.

Unknown pending measurement: creator media GB-month, Class A operations, Class B operations, and actual launch media volume.

### API request binding requirement

When the private gate is enabled, master creates the opaque generation UUID before dispatch and sends a server-only `private_media_request` containing that UUID and the fixed `creator-generations/<generation-id>/` prefix. The API follow-up must accept this context only from authenticated master ingress, reject mismatched/unsafe prefixes, write every output beneath that exact request-bound prefix, and echo complete storage metadata for that request. Gate-off payloads remain byte-for-byte structurally unchanged by this addition; no request identity or R2 key is browser-controlled.
