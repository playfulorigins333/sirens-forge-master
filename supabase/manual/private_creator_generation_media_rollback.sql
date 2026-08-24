-- EMERGENCY MANUAL ROLLBACK ONLY. Requires explicit human authorization and a fresh backup.
-- Existing generations and legacy columns/data are intentionally preserved.
begin;
revoke execute on function public.finalize_private_generation(uuid,uuid,jsonb,jsonb) from service_role;
drop function public.finalize_private_generation(uuid,uuid,jsonb,jsonb);
drop table public.generation_assets;
drop table public.private_storage_objects;
drop function public.generation_asset_owner_consistent();
drop function public.private_storage_object_identity_immutable();
commit;
