\set ON_ERROR_STOP on
begin;

insert into auth.users(id) values ('70000000-0000-4000-8000-000000000001');
insert into public.generations(id,user_id,status,image_url,metadata)
values ('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','completed',null,'{"private_creator_media":true}'::jsonb);

insert into public.private_storage_objects(
  id,owner_id,storage_class,bucket,object_key,mime_type,size_bytes,sha256,source_reference
) values (
  '72000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'creator_generation','private-generations',
  'creator-generations/71000000-0000-4000-8000-000000000001/0123456789abcdef0123456789abcdef.png',
  'image/png',8,repeat('a',64),
  '{"generation_id":"71000000-0000-4000-8000-000000000001","ordinal":0}'::jsonb
);
insert into public.generation_assets(
  id,generation_id,storage_object_id,owner_id,ordinal,kind
) values (
  '73000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',0,'image'
);

-- The old direct-delete surface must be gone at both grant and policy layers.
do $$ begin
  if has_table_privilege('anon','public.generations','delete') then raise exception 'ANON_GENERATION_DELETE_STILL_GRANTED'; end if;
  if has_table_privilege('authenticated','public.generations','delete') then raise exception 'AUTH_GENERATION_DELETE_STILL_GRANTED'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='generations' and cmd='DELETE') then raise exception 'GENERATION_DELETE_POLICY_STILL_PRESENT'; end if;
end $$;

-- Lifecycle RPCs are server-only.
do $$ begin
  if has_function_privilege('anon','public.trash_private_generation_asset(uuid,uuid)','execute')
     or has_function_privilege('authenticated','public.trash_private_generation_asset(uuid,uuid)','execute')
     or has_function_privilege('anon','public.restore_private_generation_asset(uuid,uuid)','execute')
     or has_function_privilege('authenticated','public.restore_private_generation_asset(uuid,uuid)','execute')
     or has_function_privilege('anon','public.claim_private_generation_asset_purge(uuid,uuid,uuid,text,boolean)','execute')
     or has_function_privilege('authenticated','public.claim_private_generation_asset_purge(uuid,uuid,uuid,text,boolean)','execute')
     or has_function_privilege('anon','public.finalize_private_generation_asset_purge(uuid,uuid,uuid)','execute')
     or has_function_privilege('authenticated','public.finalize_private_generation_asset_purge(uuid,uuid,uuid)','execute') then
    raise exception 'PHASE7_RPC_PUBLIC_EXECUTE';
  end if;
  if not has_function_privilege('service_role','public.trash_private_generation_asset(uuid,uuid)','execute')
     or not has_function_privilege('service_role','public.restore_private_generation_asset(uuid,uuid)','execute')
     or not has_function_privilege('service_role','public.claim_private_generation_asset_purge(uuid,uuid,uuid,text,boolean)','execute')
     or not has_function_privilege('service_role','public.finalize_private_generation_asset_purge(uuid,uuid,uuid)','execute') then
    raise exception 'PHASE7_RPC_SERVICE_ROLE_MISSING';
  end if;
end $$;

-- Generation deletion is now RESTRICT, never CASCADE.
do $$ begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.generation_assets'::regclass
      and conname='generation_assets_generation_id_fkey'
      and pg_get_constraintdef(oid) ilike '%ON DELETE RESTRICT%'
  ) then raise exception 'GENERATION_ASSET_FK_NOT_RESTRICT'; end if;
end $$;

set local role service_role;

select * from public.trash_private_generation_asset(
  '73000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001'
);

do $$ begin
  if not exists(
    select 1 from public.generation_assets
    where id='73000000-0000-4000-8000-000000000001'
      and lifecycle_state='trashed'
      and trashed_at is not null
      and purge_after between clock_timestamp()+interval '29 days 23 hours' and clock_timestamp()+interval '30 days 1 hour'
      and storage_object_id='72000000-0000-4000-8000-000000000001'
  ) then raise exception 'TRASH_TRANSITION_FAILED'; end if;
end $$;

select * from public.restore_private_generation_asset(
  '73000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001'
);

do $$ begin
  if not exists(
    select 1 from public.generation_assets
    where id='73000000-0000-4000-8000-000000000001'
      and lifecycle_state='active'
      and trashed_at is null and purge_after is null
      and storage_object_id='72000000-0000-4000-8000-000000000001'
  ) then raise exception 'RESTORE_TRANSITION_FAILED'; end if;
end $$;

select * from public.trash_private_generation_asset(
  '73000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001'
);

reset role;

-- Normal retention purge cannot claim before day 30.
do $$ begin
  begin
    perform * from public.claim_private_generation_asset_purge(
      '73000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000001',
      'retention_expired',false
    );
    raise exception 'WRONG_ERROR';
  exception when others then
    if sqlerrm <> 'PRIVATE_MEDIA_PURGE_NOT_DUE' then raise; end if;
  end;
end $$;

set local role service_role;

select * from public.claim_private_generation_asset_purge(
  '73000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'creator_permanent_delete',true
);

do $$ begin
  if not exists(
    select 1 from public.generation_assets a
    join public.private_storage_objects o on o.id=a.storage_object_id
    where a.id='73000000-0000-4000-8000-000000000001'
      and a.lifecycle_state='purge_pending'
      and a.purge_claim_token='74000000-0000-4000-8000-000000000001'
      and a.purge_reason='creator_permanent_delete'
      and o.retention_state='purge_pending'
  ) then raise exception 'PURGE_CLAIM_FAILED'; end if;
end $$;

-- Same-token retry is safe and keeps the canonical object target available.
do $$ begin
  if not exists(
    select 1 from public.claim_private_generation_asset_purge(
      '73000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000001',
      'creator_permanent_delete',true
    ) c
    where c.claimed=false
      and c.bucket='private-generations'
      and c.object_key='creator-generations/71000000-0000-4000-8000-000000000001/0123456789abcdef0123456789abcdef.png'
      and c.sha256=repeat('a',64)
  ) then raise exception 'PURGE_RETRY_CONTRACT_FAILED'; end if;
end $$;

select * from public.finalize_private_generation_asset_purge(
  '73000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001'
);

do $$ begin
  if not exists(
    select 1 from public.generation_assets
    where id='73000000-0000-4000-8000-000000000001'
      and lifecycle_state='purged'
      and storage_object_id is null
      and purge_claim_token is null
      and purged_at is not null
      and purged_storage_object_id='72000000-0000-4000-8000-000000000001'
      and purged_object_sha256=repeat('a',64)
  ) then raise exception 'PURGE_TOMBSTONE_FAILED'; end if;
  if exists(select 1 from public.private_storage_objects where id='72000000-0000-4000-8000-000000000001') then
    raise exception 'PURGED_STORAGE_METADATA_REMAINS';
  end if;
end $$;

-- Finalization is idempotent with the original claim token even after the token is cleared.
select * from public.finalize_private_generation_asset_purge(
  '73000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001'
);

reset role;

-- Tombstones preserve generation lineage and therefore block accidental generation deletion.
do $$ begin
  begin
    delete from public.generations where id='71000000-0000-4000-8000-000000000001';
    raise exception 'WRONG_ERROR';
  exception when foreign_key_violation then null;
  end;
end $$;

rollback;
