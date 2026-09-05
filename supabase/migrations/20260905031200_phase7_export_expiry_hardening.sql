begin;

create or replace function public.mark_creator_data_export_downloaded(
  p_export_id uuid,
  p_auth_user_id uuid
)
returns table(export_id uuid, export_status text, downloaded_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_export public.creator_data_exports;
begin
  select * into v_export from public.creator_data_exports
  where id=p_export_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'EXPORT_NOT_FOUND'; end if;

  if v_export.status='expired' then
    return query select v_export.id,v_export.status,v_export.downloaded_at;
    return;
  end if;

  if v_export.expires_at is null or v_export.expires_at<=clock_timestamp() then
    if v_export.status in ('completed','downloaded') then
      update public.creator_data_exports
      set status='expired',updated_at=clock_timestamp()
      where id=v_export.id returning * into v_export;
      return query select v_export.id,v_export.status,v_export.downloaded_at;
      return;
    end if;
    raise exception 'EXPORT_NOT_READY';
  end if;

  if v_export.status not in ('completed','downloaded') then raise exception 'EXPORT_NOT_READY'; end if;
  if v_export.status='completed' then
    update public.creator_data_exports
    set status='downloaded',downloaded_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=v_export.id returning * into v_export;
  end if;
  return query select v_export.id,v_export.status,v_export.downloaded_at;
end $$;

revoke all on function public.mark_creator_data_export_downloaded(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_creator_data_export_downloaded(uuid,uuid) to service_role;

commit;
