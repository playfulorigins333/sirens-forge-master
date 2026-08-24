-- P0-02A correction: asset-level CPQ identity for multi-output private generations.
begin;

drop index public.creator_publishing_media_assets_ai_generation_uidx;
create unique index creator_publishing_media_assets_ai_generation_uidx
  on public.creator_publishing_media_assets(content_package_id, (ai_generation_metadata ->> 'generation_id'))
  where source='ai_pipeline' and nullif(btrim(ai_generation_metadata->>'generation_id'),'') is not null
    and nullif(btrim(ai_generation_metadata->>'generation_asset_id'),'') is null;
create unique index creator_publishing_media_assets_ai_generation_asset_uidx
  on public.creator_publishing_media_assets(content_package_id, (ai_generation_metadata ->> 'generation_asset_id'))
  where source='ai_pipeline' and nullif(btrim(ai_generation_metadata->>'generation_asset_id'),'') is not null;

create function public.creator_publishing_attach_generated_media(
  p_creator_id uuid, p_content_package_id uuid, p_generation_id uuid,
  p_storage_key text, p_mime_type text, p_size_bytes bigint, p_sha256 text,
  p_generation_kind text, p_generation_created_at timestamptz, p_generation_mode text,
  p_generation_asset_id uuid, p_generation_ordinal smallint
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_package public.creator_publishing_content_packages%rowtype; v_asset public.creator_publishing_media_assets%rowtype; v_existing public.creator_publishing_media_assets%rowtype; v_audit_id bigint;
begin
  select * into v_package from public.creator_publishing_content_packages where id=p_content_package_id for update;
  if not found or v_package.creator_id<>p_creator_id then return jsonb_build_object('error',jsonb_build_object('code','NOT_FOUND')); end if;
  if v_package.creator_approval_status='approved' or exists(select 1 from public.creator_publishing_queue_tasks where content_package_id=p_content_package_id and status<>'archived') then return jsonb_build_object('error',jsonb_build_object('code','PACKAGE_LOCKED')); end if;
  if p_generation_asset_id is null or p_generation_ordinal not between 0 and 3 or not exists(
    select 1 from public.generation_assets a join public.private_storage_objects o on o.id=a.storage_object_id
    where a.id=p_generation_asset_id and a.generation_id=p_generation_id and a.owner_id=p_creator_id
      and a.ordinal=p_generation_ordinal and a.kind=p_generation_kind and o.owner_id=p_creator_id
  ) then return jsonb_build_object('error',jsonb_build_object('code','NOT_FOUND')); end if;
  select * into v_existing from public.creator_publishing_media_assets where content_package_id=p_content_package_id and source='ai_pipeline' and ai_generation_metadata->>'generation_asset_id'=p_generation_asset_id::text;
  if found then
    if v_existing.storage_key=p_storage_key and v_existing.mime_type=p_mime_type and lower(v_existing.sha256)=lower(p_sha256) then return jsonb_build_object('media_asset',to_jsonb(v_existing),'audit_event_ids','[]'::jsonb,'idempotent',true); end if;
    return jsonb_build_object('error',jsonb_build_object('code','ASSOCIATION_CONFLICT'));
  end if;
  insert into public.creator_publishing_media_assets(content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at)
  values(p_content_package_id,p_storage_key,p_mime_type,lower(p_sha256),'ai_pipeline',jsonb_strip_nulls(jsonb_build_object('generation_id',p_generation_id::text,'generation_asset_id',p_generation_asset_id::text,'generation_ordinal',p_generation_ordinal,'generation_kind',p_generation_kind,'generation_created_at',p_generation_created_at,'generation_mode',p_generation_mode,'size_bytes',p_size_bytes)),clock_timestamp()) returning * into v_asset;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at)
  values('creator_publishing_media_asset',v_asset.id,p_creator_id,'creator','generated_media_attached','{}',jsonb_build_object('content_package_id',p_content_package_id,'media_asset_id',v_asset.id,'generation_id',p_generation_id::text,'generation_asset_id',p_generation_asset_id::text,'generation_ordinal',p_generation_ordinal,'creator_id',p_creator_id,'source','ai_pipeline'),p_content_package_id::text||':asset:'||p_generation_asset_id::text,clock_timestamp()) returning id into v_audit_id;
  return jsonb_build_object('media_asset',to_jsonb(v_asset),'audit_event_ids',jsonb_build_array(v_audit_id),'idempotent',false);
end $$;
revoke execute on function public.creator_publishing_attach_generated_media(uuid,uuid,uuid,text,text,bigint,text,text,timestamptz,text,uuid,smallint) from public,anon,authenticated;
grant execute on function public.creator_publishing_attach_generated_media(uuid,uuid,uuid,text,text,bigint,text,text,timestamptz,text,uuid,smallint) to service_role;
commit;
