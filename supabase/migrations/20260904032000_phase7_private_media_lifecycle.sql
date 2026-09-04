-- Phase 7: private Library media lifecycle foundation.
-- Applying this migration to Production requires a separate explicit authorization.
begin;

-- Direct generation deletion bypasses Trash and can orphan canonical private storage.
drop policy if exists "Users can delete own generations" on public.generations;
revoke delete on table public.generations from public, anon, authenticated;

-- Preserve generation/asset lineage. Generation rows must not cascade-delete private assets.
alter table public.generation_assets
  drop constraint generation_assets_generation_id_fkey;
alter table public.generation_assets
  add constraint generation_assets_generation_id_fkey
  foreign key (generation_id) references public.generations(id) on delete restrict;

-- A purged asset remains as a minimal tombstone so completed video/source lineage survives.
alter table public.generation_assets
  alter column storage_object_id drop not null,
  add column lifecycle_state text not null default 'active',
  add column trashed_at timestamptz,
  add column purge_after timestamptz,
  add column purge_requested_at timestamptz,
  add column purge_claim_token uuid,
  add column purge_reason text,
  add column purged_at timestamptz,
  add column purged_storage_object_id uuid,
  add column purged_object_sha256 text;

alter table public.generation_assets
  add constraint generation_assets_lifecycle_state_check
    check (lifecycle_state in ('active','trashed','purge_pending','purged')),
  add constraint generation_assets_purge_reason_check
    check (purge_reason is null or purge_reason in ('creator_permanent_delete','retention_expired')),
  add constraint generation_assets_purged_sha256_check
    check (purged_object_sha256 is null or purged_object_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint generation_assets_lifecycle_consistency_check
    check (
      (lifecycle_state = 'active'
        and storage_object_id is not null
        and trashed_at is null
        and purge_after is null
        and purge_requested_at is null
        and purge_claim_token is null
        and purge_reason is null
        and purged_at is null
        and purged_storage_object_id is null
        and purged_object_sha256 is null)
      or
      (lifecycle_state = 'trashed'
        and storage_object_id is not null
        and trashed_at is not null
        and purge_after is not null
        and purge_requested_at is null
        and purge_claim_token is null
        and purge_reason is null
        and purged_at is null
        and purged_storage_object_id is null
        and purged_object_sha256 is null)
      or
      (lifecycle_state = 'purge_pending'
        and storage_object_id is not null
        and trashed_at is not null
        and purge_after is not null
        and purge_requested_at is not null
        and purge_claim_token is not null
        and purge_reason is not null
        and purged_at is null
        and purged_storage_object_id is null
        and purged_object_sha256 is null)
      or
      (lifecycle_state = 'purged'
        and storage_object_id is null
        and trashed_at is not null
        and purge_after is not null
        and purge_requested_at is not null
        and purge_claim_token is null
        and purge_reason is not null
        and purged_at is not null
        and purged_storage_object_id is not null
        and purged_object_sha256 is not null)
    );

create index generation_assets_owner_lifecycle_created_idx
  on public.generation_assets(owner_id, lifecycle_state, created_at desc);
create index generation_assets_trash_due_idx
  on public.generation_assets(purge_after, id)
  where lifecycle_state = 'trashed';
create index generation_assets_purge_pending_idx
  on public.generation_assets(owner_id, purge_requested_at)
  where lifecycle_state = 'purge_pending';

-- The original trigger assumed storage_object_id could never be NULL. A NULL storage
-- pointer is valid only for a completed purge tombstone; generation ownership remains mandatory.
create or replace function public.generation_asset_owner_consistent() returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not exists(
    select 1 from public.generations g
    where g.id = new.generation_id and g.user_id = new.owner_id
  ) then
    raise exception 'PRIVATE_GENERATION_ASSET_OWNER_MISMATCH';
  end if;

  if new.storage_object_id is null then
    if new.lifecycle_state <> 'purged' then
      raise exception 'PRIVATE_GENERATION_ASSET_STORAGE_REQUIRED';
    end if;
  elsif not exists(
    select 1 from public.private_storage_objects o
    where o.id = new.storage_object_id and o.owner_id = new.owner_id
  ) then
    raise exception 'PRIVATE_GENERATION_ASSET_OWNER_MISMATCH';
  end if;

  return new;
end;
$$;
revoke execute on function public.generation_asset_owner_consistent() from public, anon, authenticated;

create function public.trash_private_generation_asset(
  p_asset_id uuid,
  p_owner_id uuid
) returns table(
  asset_id uuid,
  lifecycle_state text,
  trashed_at timestamptz,
  purge_after timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  a public.generation_assets%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_asset_id is null or p_owner_id is null then
    raise exception 'PRIVATE_MEDIA_ASSET_NOT_FOUND';
  end if;

  select * into a
  from public.generation_assets
  where id = p_asset_id and owner_id = p_owner_id
  for update;
  if not found then raise exception 'PRIVATE_MEDIA_ASSET_NOT_FOUND'; end if;

  if a.lifecycle_state = 'trashed' then
    return query select a.id, a.lifecycle_state, a.trashed_at, a.purge_after;
    return;
  end if;
  if a.lifecycle_state <> 'active' then
    raise exception 'PRIVATE_MEDIA_ASSET_STATE_CONFLICT';
  end if;

  update public.generation_assets
  set lifecycle_state = 'trashed',
      trashed_at = v_now,
      purge_after = v_now + interval '30 days'
  where id = a.id
  returning id, generation_assets.lifecycle_state, generation_assets.trashed_at, generation_assets.purge_after
    into a.id, a.lifecycle_state, a.trashed_at, a.purge_after;

  update public.private_storage_objects
  set retain_until = v_now + interval '30 days',
      purge_after = v_now + interval '30 days'
  where id = a.storage_object_id;

  return query select a.id, a.lifecycle_state, a.trashed_at, a.purge_after;
end;
$$;

create function public.restore_private_generation_asset(
  p_asset_id uuid,
  p_owner_id uuid
) returns table(
  asset_id uuid,
  lifecycle_state text
)
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  a public.generation_assets%rowtype;
begin
  if p_asset_id is null or p_owner_id is null then
    raise exception 'PRIVATE_MEDIA_ASSET_NOT_FOUND';
  end if;

  select * into a
  from public.generation_assets
  where id = p_asset_id and owner_id = p_owner_id
  for update;
  if not found then raise exception 'PRIVATE_MEDIA_ASSET_NOT_FOUND'; end if;

  if a.lifecycle_state = 'active' then
    return query select a.id, a.lifecycle_state;
    return;
  end if;
  if a.lifecycle_state <> 'trashed' then
    raise exception 'PRIVATE_MEDIA_ASSET_STATE_CONFLICT';
  end if;
  if a.purge_after <= clock_timestamp() then
    raise exception 'PRIVATE_MEDIA_RESTORE_WINDOW_EXPIRED';
  end if;

  update public.generation_assets
  set lifecycle_state = 'active',
      trashed_at = null,
      purge_after = null
  where id = a.id
  returning id, generation_assets.lifecycle_state into a.id, a.lifecycle_state;

  update public.private_storage_objects
  set retain_until = null,
      purge_after = null
  where id = a.storage_object_id
    and retention_state <> 'legal_hold';

  return query select a.id, a.lifecycle_state;
end;
$$;

create function public.claim_private_generation_asset_purge(
  p_asset_id uuid,
  p_owner_id uuid,
  p_claim_token uuid,
  p_reason text,
  p_allow_early boolean default false
) returns table(
  claimed boolean,
  generation_id uuid,
  bucket text,
  object_key text,
  mime_type text,
  size_bytes bigint,
  sha256 text
)
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  a public.generation_assets%rowtype;
  o public.private_storage_objects%rowtype;
  v_active_video boolean := false;
begin
  if p_asset_id is null or p_owner_id is null or p_claim_token is null
     or p_reason not in ('creator_permanent_delete','retention_expired') then
    raise exception 'PRIVATE_MEDIA_PURGE_ARGUMENT_INVALID';
  end if;

  select * into a
  from public.generation_assets
  where id = p_asset_id and owner_id = p_owner_id
  for update;
  if not found then raise exception 'PRIVATE_MEDIA_ASSET_NOT_FOUND'; end if;

  if a.lifecycle_state = 'purged' then
    return query select false, a.generation_id, null::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  if a.lifecycle_state = 'purge_pending' then
    if a.purge_claim_token is distinct from p_claim_token then
      raise exception 'PRIVATE_MEDIA_PURGE_ALREADY_CLAIMED';
    end if;
    select * into o from public.private_storage_objects where id = a.storage_object_id;
    if not found then raise exception 'PRIVATE_MEDIA_STORAGE_OBJECT_NOT_FOUND'; end if;
    return query select false, a.generation_id, o.bucket, o.object_key, o.mime_type, o.size_bytes, o.sha256;
    return;
  end if;

  if a.lifecycle_state <> 'trashed' then
    raise exception 'PRIVATE_MEDIA_ASSET_STATE_CONFLICT';
  end if;
  if not p_allow_early and a.purge_after > clock_timestamp() then
    raise exception 'PRIVATE_MEDIA_PURGE_NOT_DUE';
  end if;

  select * into o
  from public.private_storage_objects
  where id = a.storage_object_id and owner_id = p_owner_id
  for update;
  if not found then raise exception 'PRIVATE_MEDIA_STORAGE_OBJECT_NOT_FOUND'; end if;
  if o.retention_state = 'legal_hold' then
    raise exception 'PRIVATE_MEDIA_LEGAL_HOLD';
  end if;
  if exists(
    select 1 from public.generation_assets other
    where other.storage_object_id = a.storage_object_id and other.id <> a.id
  ) then
    raise exception 'PRIVATE_MEDIA_SHARED_STORAGE_OBJECT';
  end if;

  -- A running image-to-video project still needs the source binary. Use the existing
  -- creator projection when Phase 4 video tables are present; terminal projects keep
  -- the asset ID tombstone but do not block binary purge.
  if to_regclass('public.video_projects') is not null
     and to_regprocedure('public.video_project_creator_projection(public.video_projects)') is not null then
    execute $q$
      select exists(
        select 1
        from public.video_projects vp
        where vp.source_generation_asset_id = $1
          and (public.video_project_creator_projection(vp)->>'creator_status')
              in ('queued','generating','stitching','cancelling')
      )
    $q$ into v_active_video using a.id;
    if v_active_video then
      raise exception 'PRIVATE_MEDIA_PURGE_BLOCKED_ACTIVE_VIDEO';
    end if;
  end if;

  update public.generation_assets
  set lifecycle_state = 'purge_pending',
      purge_requested_at = clock_timestamp(),
      purge_claim_token = p_claim_token,
      purge_reason = p_reason
  where id = a.id;

  update public.private_storage_objects
  set retention_state = 'purge_pending'
  where id = o.id;

  return query select true, a.generation_id, o.bucket, o.object_key, o.mime_type, o.size_bytes, o.sha256;
end;
$$;

create function public.finalize_private_generation_asset_purge(
  p_asset_id uuid,
  p_owner_id uuid,
  p_claim_token uuid
) returns table(
  asset_id uuid,
  lifecycle_state text,
  purged_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  a public.generation_assets%rowtype;
  o public.private_storage_objects%rowtype;
  v_purged_at timestamptz := clock_timestamp();
begin
  if p_asset_id is null or p_owner_id is null or p_claim_token is null then
    raise exception 'PRIVATE_MEDIA_PURGE_ARGUMENT_INVALID';
  end if;

  select * into a
  from public.generation_assets
  where id = p_asset_id and owner_id = p_owner_id
  for update;
  if not found then raise exception 'PRIVATE_MEDIA_ASSET_NOT_FOUND'; end if;

  if a.lifecycle_state = 'purged' then
    return query select a.id, a.lifecycle_state, a.purged_at;
    return;
  end if;
  if a.lifecycle_state <> 'purge_pending'
     or a.purge_claim_token is distinct from p_claim_token then
    raise exception 'PRIVATE_MEDIA_PURGE_CLAIM_INVALID';
  end if;

  select * into o
  from public.private_storage_objects
  where id = a.storage_object_id and owner_id = p_owner_id
  for update;
  if not found then raise exception 'PRIVATE_MEDIA_STORAGE_OBJECT_NOT_FOUND'; end if;
  if o.retention_state = 'legal_hold' then
    raise exception 'PRIVATE_MEDIA_LEGAL_HOLD';
  end if;
  if exists(
    select 1 from public.generation_assets other
    where other.storage_object_id = a.storage_object_id and other.id <> a.id
  ) then
    raise exception 'PRIVATE_MEDIA_SHARED_STORAGE_OBJECT';
  end if;

  update public.generation_assets
  set storage_object_id = null,
      lifecycle_state = 'purged',
      purge_claim_token = null,
      purged_at = v_purged_at,
      purged_storage_object_id = o.id,
      purged_object_sha256 = o.sha256
  where id = a.id;

  delete from public.private_storage_objects where id = o.id;

  return query select a.id, 'purged'::text, v_purged_at;
end;
$$;

revoke execute on function public.trash_private_generation_asset(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.restore_private_generation_asset(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.claim_private_generation_asset_purge(uuid,uuid,uuid,text,boolean) from public, anon, authenticated;
revoke execute on function public.finalize_private_generation_asset_purge(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.trash_private_generation_asset(uuid,uuid) to service_role;
grant execute on function public.restore_private_generation_asset(uuid,uuid) to service_role;
grant execute on function public.claim_private_generation_asset_purge(uuid,uuid,uuid,text,boolean) to service_role;
grant execute on function public.finalize_private_generation_asset_purge(uuid,uuid,uuid) to service_role;

commit;
