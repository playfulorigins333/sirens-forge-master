begin;

create or replace function public.phase7_assert_twin_new_use()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_owner uuid;
  v_lifecycle text;
  v_training text;
  v_training_required boolean := false;
begin
  if tg_table_name='dataset_doctor_jobs' then
    v_id:=new.lora_id;
    v_owner:=new.user_id;
    v_training_required:=true;
  elsif tg_table_name='video_projects' then
    if new.identity_id is null then return new; end if;
    v_id:=new.identity_id;
    v_owner:=new.owner_id;
  elsif tg_table_name='compute_jobs' then
    if new.workload::text not in ('trainer','image') then return new; end if;
    if jsonb_typeof(new.request_payload->'identity_id') <> 'string' then return new; end if;
    begin
      v_id := (new.request_payload->>'identity_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'TWIN_LIFECYCLE_INVALID';
    end;
    v_owner:=new.owner_id;
    v_training_required:=(new.workload::text='trainer');
  else
    return new;
  end if;

  select u.lifecycle_state,u.training_data_state
    into v_lifecycle,v_training
    from public.user_loras u
   where u.id=v_id and u.user_id=v_owner
   for share;

  if not found or v_lifecycle <> 'active' then
    raise exception 'TWIN_NOT_ACTIVE';
  end if;
  if v_training_required and v_training <> 'active' then
    raise exception 'TWIN_TRAINING_DATA_NOT_ACTIVE';
  end if;
  return new;
end $$;

revoke all on function public.phase7_assert_twin_new_use() from public,anon,authenticated;
grant execute on function public.phase7_assert_twin_new_use() to service_role;

commit;
