-- EMERGENCY MANUAL ROLLBACK ONLY after private multi-output attachments are removed or migrated.
begin;
drop function public.creator_publishing_attach_generated_media(uuid,uuid,uuid,text,text,bigint,text,text,timestamptz,text,uuid,smallint);
drop index public.creator_publishing_media_assets_ai_generation_asset_uidx;
drop index public.creator_publishing_media_assets_ai_generation_uidx;
create unique index creator_publishing_media_assets_ai_generation_uidx
  on public.creator_publishing_media_assets(content_package_id,(ai_generation_metadata->>'generation_id'))
  where source='ai_pipeline' and length(btrim(coalesce(ai_generation_metadata->>'generation_id','')))>0;
commit;
