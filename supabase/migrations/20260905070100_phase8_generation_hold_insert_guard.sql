-- Phase 8B legal-hold edge hardening: a hold may target a known generation ID
-- before the generation row is written. Preserve that evidence on INSERT as well.

begin;

create or replace function public.phase8_minimize_generation_metadata_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.governance_target_has_active_legal_hold('generation',new.id::text,new.user_id) then
    return new;
  end if;
  new.metadata := public.phase8_minimized_generation_metadata(new.metadata);
  return new;
end;
$$;
revoke all on function public.phase8_minimize_generation_metadata_write() from public, anon, authenticated, service_role;

commit;
