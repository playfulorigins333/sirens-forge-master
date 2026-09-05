-- Phase 8E hardening: remove ambiguous database-side purge-reason normalization.
-- Retention runners now pass `retention_expired` explicitly to shared purge helpers.
-- Production application remains separately gated with the Phase 8E migration sequence.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop trigger if exists phase8_retention_generation_asset_purge_reason on public.generation_assets;
drop trigger if exists phase8_retention_twin_purge_reason on public.user_loras;

drop function if exists public.phase8_retention_normalize_generation_asset_purge_reason();
drop function if exists public.phase8_retention_normalize_twin_purge_reason();
drop function if exists public.phase8_retention_purge_claim_active(uuid);

commit;
