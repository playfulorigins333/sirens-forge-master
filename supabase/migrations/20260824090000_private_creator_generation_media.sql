-- P0-02A: normalized private creator generation media. Applying this migration is a separate authorized operation.
begin;

create table public.private_storage_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  storage_class text not null check (storage_class in ('creator_generation')),
  bucket text not null check (bucket = btrim(bucket) and length(bucket) between 3 and 63),
  object_key text not null check (object_key = btrim(object_key) and length(object_key) between 1 and 1024),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  policy_version smallint not null default 1 check (policy_version > 0),
  retention_state text not null default 'active' check (retention_state in ('active','purge_pending','legal_hold')),
  retain_until timestamptz,
  purge_after timestamptz,
  source_reference jsonb not null default '{}'::jsonb check (jsonb_typeof(source_reference) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint private_storage_objects_physical_unique unique (bucket, object_key)
);

create table public.generation_assets (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  storage_object_id uuid not null references public.private_storage_objects(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  ordinal smallint not null check (ordinal between 0 and 3),
  kind text not null check (kind in ('image','video')),
  created_at timestamptz not null default clock_timestamp(),
  constraint generation_assets_ordinal_unique unique (generation_id, ordinal),
  constraint generation_assets_object_unique unique (generation_id, storage_object_id)
);

create index generation_assets_owner_created_idx on public.generation_assets(owner_id, created_at desc);
create index generation_assets_generation_idx on public.generation_assets(generation_id, ordinal);
create index private_storage_objects_owner_created_idx on public.private_storage_objects(owner_id, created_at desc);
create index private_storage_objects_retention_idx on public.private_storage_objects(retention_state, purge_after) where purge_after is not null;

create function public.private_storage_object_identity_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if row(old.owner_id,old.storage_class,old.bucket,old.object_key,old.mime_type,old.size_bytes,old.sha256)
     is distinct from row(new.owner_id,new.storage_class,new.bucket,new.object_key,new.mime_type,new.size_bytes,new.sha256) then
    raise exception 'PRIVATE_STORAGE_OBJECT_IDENTITY_IMMUTABLE';
  end if;
  new.updated_at := clock_timestamp(); return new;
end $$;
create trigger private_storage_object_identity_immutable before update on public.private_storage_objects for each row execute function public.private_storage_object_identity_immutable();

create function public.generation_asset_owner_consistent() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if not exists(select 1 from public.private_storage_objects o where o.id=new.storage_object_id and o.owner_id=new.owner_id)
     or not exists(select 1 from public.generations g where g.id=new.generation_id and g.user_id=new.owner_id) then
    raise exception 'PRIVATE_GENERATION_ASSET_OWNER_MISMATCH';
  end if;
  return new;
end $$;
create trigger generation_asset_owner_consistent before insert or update on public.generation_assets for each row execute function public.generation_asset_owner_consistent();

alter table public.private_storage_objects enable row level security;
alter table public.private_storage_objects force row level security;
alter table public.generation_assets enable row level security;
alter table public.generation_assets force row level security;
revoke all privileges on table public.private_storage_objects, public.generation_assets from public, anon, authenticated;
grant select, insert, update, delete on table public.private_storage_objects, public.generation_assets to service_role;
revoke execute on function public.private_storage_object_identity_immutable(), public.generation_asset_owner_consistent() from public, anon, authenticated;

create function public.finalize_private_generation(
  p_generation_id uuid,
  p_owner_id uuid,
  p_generation jsonb,
  p_assets jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_asset jsonb;
  v_existing public.private_storage_objects%rowtype;
  v_object_id uuid;
  v_asset_ids jsonb := '[]'::jsonb;
  v_count integer;
  v_generation public.generations%rowtype;
begin
  if p_generation_id is null or p_owner_id is null or jsonb_typeof(p_generation) <> 'object' or jsonb_typeof(p_assets) <> 'array' then
    raise exception 'PRIVATE_GENERATION_ARGUMENT_INVALID';
  end if;
  v_count := jsonb_array_length(p_assets);
  if v_count < 1 or v_count > 4 then raise exception 'PRIVATE_GENERATION_ASSET_COUNT_INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(p_assets) a group by (a->>'ordinal') having count(*) > 1) then
    raise exception 'PRIVATE_GENERATION_DUPLICATE_ORDINAL';
  end if;

  select * into v_generation from public.generations where id = p_generation_id for update;
  if found and v_generation.user_id <> p_owner_id then raise exception 'PRIVATE_GENERATION_OWNER_MISMATCH'; end if;
  if not found then
    insert into public.generations(id,user_id,prompt,image_url,lora_used,job_type,body_type,mode,status,negative_prompt,steps,cfg_scale,seed,width,height,runpod_job_id,processing_time_ms,completed_at,metadata,r2_bucket,r2_key,updated_at)
    values (p_generation_id,p_owner_id,p_generation->>'prompt',null,nullif(p_generation->>'lora_used',''),'image',p_generation->>'body_type','txt2img','completed',p_generation->>'negative_prompt',(p_generation->>'steps')::integer,(p_generation->>'cfg_scale')::numeric,(p_generation->>'seed')::bigint,(p_generation->>'width')::integer,(p_generation->>'height')::integer,nullif(p_generation->>'upstream_generation_id',''),(p_generation->>'processing_time_ms')::integer,clock_timestamp(),coalesce(p_generation->'metadata','{}'::jsonb),null,null,clock_timestamp());
  elsif v_generation.status <> 'completed' or v_generation.image_url is not null then
    raise exception 'PRIVATE_GENERATION_STATE_CONFLICT';
  end if;

  for v_asset in select value from jsonb_array_elements(p_assets) loop
    if (v_asset->>'ordinal')::integer not between 0 and 3 or v_asset->>'kind' <> 'image'
       or v_asset->>'owner_id' <> p_owner_id::text or coalesce(v_asset->>'storage_class','') <> 'creator_generation'
       or coalesce(v_asset->>'bucket','') = '' or coalesce(v_asset->>'object_key','') = '' then
      raise exception 'PRIVATE_GENERATION_ASSET_INVALID';
    end if;
    select * into v_existing from public.private_storage_objects where bucket=v_asset->>'bucket' and object_key=v_asset->>'object_key' for update;
    if found then
      if v_existing.owner_id <> p_owner_id or v_existing.mime_type <> v_asset->>'mime_type' or v_existing.size_bytes <> (v_asset->>'size_bytes')::bigint or v_existing.sha256 <> v_asset->>'sha256' then
        raise exception 'PRIVATE_STORAGE_OBJECT_CONFLICT';
      end if;
      v_object_id := v_existing.id;
    else
      insert into public.private_storage_objects(owner_id,storage_class,bucket,object_key,mime_type,size_bytes,sha256,source_reference)
      values(p_owner_id,'creator_generation',v_asset->>'bucket',v_asset->>'object_key',v_asset->>'mime_type',(v_asset->>'size_bytes')::bigint,v_asset->>'sha256',jsonb_build_object('generation_id',p_generation_id,'ordinal',(v_asset->>'ordinal')::integer)) returning id into v_object_id;
    end if;
    insert into public.generation_assets(generation_id,storage_object_id,owner_id,ordinal,kind)
    values(p_generation_id,v_object_id,p_owner_id,(v_asset->>'ordinal')::smallint,'image')
    on conflict (generation_id, ordinal) do nothing;
    if not exists(select 1 from public.generation_assets where generation_id=p_generation_id and ordinal=(v_asset->>'ordinal')::smallint and storage_object_id=v_object_id and owner_id=p_owner_id and kind='image') then
      raise exception 'PRIVATE_GENERATION_ASSET_CONFLICT';
    end if;
    v_asset_ids := v_asset_ids || jsonb_build_array((select id from public.generation_assets where generation_id=p_generation_id and ordinal=(v_asset->>'ordinal')::smallint));
  end loop;
  if (select count(*) from public.generation_assets where generation_id=p_generation_id) <> v_count then raise exception 'PRIVATE_GENERATION_ASSET_SET_CONFLICT'; end if;
  return jsonb_build_object('generation_id',p_generation_id,'asset_ids',v_asset_ids);
end;
$$;

revoke execute on function public.finalize_private_generation(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.finalize_private_generation(uuid,uuid,jsonb,jsonb) to service_role;
commit;
