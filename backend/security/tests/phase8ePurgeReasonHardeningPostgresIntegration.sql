\set ON_ERROR_STOP on

-- Final-state contract after the Phase 8E hardening migration:
-- ambiguous database-side purge-reason normalizers are absent, and generic
-- creator-delete reasons are not silently rewritten by Postgres.
do $$
begin
  if exists(
    select 1
    from pg_trigger
    where tgname in (
      'phase8_retention_generation_asset_purge_reason',
      'phase8_retention_twin_purge_reason'
    )
      and not tgisinternal
  ) then
    raise exception 'phase8e_purge_reason_normalizer_trigger_still_present';
  end if;

  if to_regprocedure('public.phase8_retention_normalize_generation_asset_purge_reason()') is not null
     or to_regprocedure('public.phase8_retention_normalize_twin_purge_reason()') is not null
     or to_regprocedure('public.phase8_retention_purge_claim_active(uuid)') is not null then
    raise exception 'phase8e_purge_reason_normalizer_function_still_present';
  end if;
end$$;

update public.generation_assets
set purge_reason='creator_permanent_delete'
where id='88000000-0000-4000-8000-000000000005';

update public.user_loras
set purge_reason='creator_permanent_delete'
where id='89000000-0000-4000-8000-000000000005';

do $$
begin
  if not exists(
    select 1 from public.generation_assets
    where id='88000000-0000-4000-8000-000000000005'
      and purge_reason='creator_permanent_delete'
  ) then
    raise exception 'phase8e_media_reason_was_silently_rewritten';
  end if;

  if not exists(
    select 1 from public.user_loras
    where id='89000000-0000-4000-8000-000000000005'
      and purge_reason='creator_permanent_delete'
  ) then
    raise exception 'phase8e_twin_reason_was_silently_rewritten';
  end if;
end$$;
