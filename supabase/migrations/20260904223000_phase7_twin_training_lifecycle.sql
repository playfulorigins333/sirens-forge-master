begin;

alter table public.user_loras
  add column if not exists lifecycle_state text not null default 'active',
  add column if not exists trashed_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists purge_requested_at timestamptz,
  add column if not exists purge_claim_token uuid,
  add column if not exists purge_reason text,
  add column if not exists purged_at timestamptz,
  add column if not exists training_data_state text not null default 'active',
  add column if not exists training_data_purge_requested_at timestamptz,
  add column if not exists training_data_purge_claim_token uuid,
  add column if not exists training_data_purged_at timestamptz;

alter table public.user_loras
  drop constraint if exists user_loras_lifecycle_state_check,
  add constraint user_loras_lifecycle_state_check check (lifecycle_state in ('active','trashed','purge_pending','purged')),
  drop constraint if exists user_loras_purge_reason_check,
  add constraint user_loras_purge_reason_check check (purge_reason is null or purge_reason in ('creator_permanent_delete','retention_expired')),
  drop constraint if exists user_loras_training_data_state_check,
  add constraint user_loras_training_data_state_check check (training_data_state in ('active','purge_pending','purged')),
  drop constraint if exists user_loras_lifecycle_consistency_check,
  add constraint user_loras_lifecycle_consistency_check check (
    (lifecycle_state='active' and trashed_at is null and purge_after is null and purge_requested_at is null and purge_claim_token is null and purge_reason is null and purged_at is null)
    or (lifecycle_state='trashed' and trashed_at is not null and purge_after is not null and purge_requested_at is null and purge_claim_token is null and purge_reason is null and purged_at is null)
    or (lifecycle_state='purge_pending' and trashed_at is not null and purge_after is not null and purge_requested_at is not null and purge_claim_token is not null and purge_reason is not null and purged_at is null)
    or (lifecycle_state='purged' and purge_claim_token is null and purged_at is not null)
  ),
  drop constraint if exists user_loras_training_data_consistency_check,
  add constraint user_loras_training_data_consistency_check check (
    (training_data_state='active' and training_data_purge_requested_at is null and training_data_purge_claim_token is null and training_data_purged_at is null)
    or (training_data_state='purge_pending' and training_data_purge_requested_at is not null and training_data_purge_claim_token is not null and training_data_purged_at is null)
    or (training_data_state='purged' and training_data_purge_claim_token is null and training_data_purged_at is not null)
  ),
  drop constraint if exists user_loras_purged_requires_training_data_purged_check,
  add constraint user_loras_purged_requires_training_data_purged_check check (lifecycle_state <> 'purged' or training_data_state='purged');

create index if not exists user_loras_owner_lifecycle_created_idx on public.user_loras(user_id,lifecycle_state,created_at desc);
create index if not exists user_loras_trash_due_idx on public.user_loras(purge_after) where lifecycle_state='trashed';
create index if not exists user_loras_training_data_state_idx on public.user_loras(user_id,training_data_state);
create index if not exists user_loras_dataset_doctor_job_id_idx on public.user_loras(dataset_doctor_job_id) where dataset_doctor_job_id is not null;
create index if not exists video_projects_identity_id_idx on public.video_projects(identity_id) where identity_id is not null;

create or replace function public.phase7_assert_twin_new_use()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_id uuid; v_owner uuid; v_lifecycle text; v_training text;
begin
  if tg_table_name='dataset_doctor_jobs' then
    v_id:=new.lora_id; v_owner:=new.user_id;
  elsif tg_table_name='video_projects' then
    if new.identity_id is null then return new; end if;
    v_id:=new.identity_id; v_owner:=new.owner_id;
  elsif tg_table_name='compute_jobs' then
    if new.workload::text not in ('trainer','image') then return new; end if;
    if jsonb_typeof(new.request_payload->'identity_id') <> 'string' then return new; end if;
    begin v_id := (new.request_payload->>'identity_id')::uuid; exception when invalid_text_representation then raise exception 'TWIN_LIFECYCLE_INVALID'; end;
    v_owner:=new.owner_id;
  else
    return new;
  end if;

  select lifecycle_state, training_data_state into v_lifecycle,v_training
  from public.user_loras where id=v_id and user_id=v_owner for share;
  if not found or v_lifecycle <> 'active' then raise exception 'TWIN_NOT_ACTIVE'; end if;
  if (tg_table_name='dataset_doctor_jobs' or (tg_table_name='compute_jobs' and new.workload::text='trainer')) and v_training <> 'active' then
    raise exception 'TWIN_TRAINING_DATA_NOT_ACTIVE';
  end if;
  return new;
end $$;

revoke all on function public.phase7_assert_twin_new_use() from public, anon, authenticated;
grant execute on function public.phase7_assert_twin_new_use() to service_role;

drop trigger if exists phase7_dataset_doctor_twin_active on public.dataset_doctor_jobs;
create trigger phase7_dataset_doctor_twin_active before insert on public.dataset_doctor_jobs for each row execute function public.phase7_assert_twin_new_use();
drop trigger if exists phase7_video_twin_active on public.video_projects;
create trigger phase7_video_twin_active before insert on public.video_projects for each row execute function public.phase7_assert_twin_new_use();
drop trigger if exists phase7_compute_twin_active on public.compute_jobs;
create trigger phase7_compute_twin_active before insert on public.compute_jobs for each row execute function public.phase7_assert_twin_new_use();

create or replace function public.trash_user_lora(p_lora_id uuid,p_owner_id uuid)
returns table(lora_id uuid,lifecycle_state text,trashed_at timestamptz,purge_after timestamptz)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.user_loras;
begin
 select * into l from public.user_loras where id=p_lora_id and user_id=p_owner_id for update;
 if not found then raise exception 'TWIN_NOT_FOUND'; end if;
 if l.lifecycle_state='active' then
   update public.user_loras set lifecycle_state='trashed',trashed_at=clock_timestamp(),purge_after=clock_timestamp()+interval '30 days',updated_at=clock_timestamp() where id=l.id returning * into l;
 elsif l.lifecycle_state<>'trashed' then raise exception 'TWIN_STATE_CONFLICT'; end if;
 return query select l.id,l.lifecycle_state,l.trashed_at,l.purge_after;
end $$;

create or replace function public.restore_user_lora(p_lora_id uuid,p_owner_id uuid)
returns table(lora_id uuid,lifecycle_state text)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.user_loras;
begin
 select * into l from public.user_loras where id=p_lora_id and user_id=p_owner_id for update;
 if not found then raise exception 'TWIN_NOT_FOUND'; end if;
 if l.lifecycle_state='active' then return query select l.id,l.lifecycle_state; return; end if;
 if l.lifecycle_state<>'trashed' then raise exception 'TWIN_STATE_CONFLICT'; end if;
 if l.purge_after is null or l.purge_after<=clock_timestamp() then raise exception 'TWIN_RESTORE_WINDOW_EXPIRED'; end if;
 update public.user_loras set lifecycle_state='active',trashed_at=null,purge_after=null,updated_at=clock_timestamp() where id=l.id returning * into l;
 return query select l.id,l.lifecycle_state;
end $$;

create or replace function public.claim_user_lora_training_data_purge(p_lora_id uuid,p_owner_id uuid,p_claim_token uuid)
returns table(lora_id uuid,scope text,claim_token uuid)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.user_loras;
begin
 if p_claim_token is null then raise exception 'TWIN_PURGE_CLAIM_INVALID'; end if;
 select * into l from public.user_loras where id=p_lora_id and user_id=p_owner_id for update;
 if not found then raise exception 'TWIN_NOT_FOUND'; end if;
 if l.lifecycle_state in ('purge_pending','purged') then raise exception 'TWIN_STATE_CONFLICT'; end if;
 if l.training_data_state='purged' then return query select l.id,'training_data'::text,p_claim_token; return; end if;
 if l.training_data_state='purge_pending' then
   if l.training_data_purge_claim_token<>p_claim_token then raise exception 'TWIN_PURGE_ALREADY_CLAIMED'; end if;
   return query select l.id,'training_data'::text,p_claim_token; return;
 end if;
 if exists(select 1 from public.compute_jobs j where j.owner_id=p_owner_id and j.workload='trainer' and j.state not in ('succeeded','failed','cancelled') and j.request_payload->>'identity_id'=p_lora_id::text) then raise exception 'TWIN_PURGE_BLOCKED_ACTIVE_TRAINER'; end if;
 if exists(select 1 from public.dataset_doctor_jobs d where d.user_id=p_owner_id and d.lora_id=p_lora_id and greatest(d.created_at,d.updated_at)>clock_timestamp()-interval '11 minutes') then raise exception 'TWIN_PURGE_BLOCKED_UPLOAD_WINDOW'; end if;
 update public.user_loras set training_data_state='purge_pending',training_data_purge_requested_at=clock_timestamp(),training_data_purge_claim_token=p_claim_token,updated_at=clock_timestamp() where id=l.id;
 return query select l.id,'training_data'::text,p_claim_token;
end $$;

create or replace function public.finalize_user_lora_training_data_purge(p_lora_id uuid,p_owner_id uuid,p_claim_token uuid)
returns table(lora_id uuid,training_data_state text,training_data_purged_at timestamptz)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.user_loras;
begin
 select * into l from public.user_loras where id=p_lora_id and user_id=p_owner_id for update;
 if not found then raise exception 'TWIN_NOT_FOUND'; end if;
 if l.training_data_state='purged' then return query select l.id,l.training_data_state,l.training_data_purged_at; return; end if;
 if l.training_data_state<>'purge_pending' or l.training_data_purge_claim_token<>p_claim_token then raise exception 'TWIN_PURGE_CLAIM_INVALID'; end if;
 delete from public.dataset_doctor_selections where lora_id=p_lora_id and user_id=p_owner_id;
 delete from public.dataset_doctor_images where lora_id=p_lora_id and user_id=p_owner_id;
 update public.dataset_doctor_jobs set raw_count=0,accepted_count=0,rejected_count=0,review_count=0,needs_more_images=false,missing_coverage='[]'::jsonb,summary='{}'::jsonb,raw_r2_bucket=null,raw_r2_prefix=null,final_r2_bucket=null,final_r2_prefix=null,error_message=null,updated_at=clock_timestamp() where lora_id=p_lora_id and user_id=p_owner_id;
 update public.user_loras set training_data_state='purged',training_data_purge_claim_token=null,training_data_purged_at=clock_timestamp(),dataset_r2_bucket=null,dataset_r2_prefix=null,dataset_doctor_job_id=null,image_count=0,updated_at=clock_timestamp() where id=p_lora_id returning * into l;
 return query select l.id,l.training_data_state,l.training_data_purged_at;
end $$;

create or replace function public.reactivate_user_lora_training_data(p_lora_id uuid,p_owner_id uuid)
returns table(lora_id uuid,training_data_state text)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.user_loras;
begin
 select * into l from public.user_loras where id=p_lora_id and user_id=p_owner_id for update;
 if not found then raise exception 'TWIN_NOT_FOUND'; end if;
 if l.lifecycle_state<>'active' then raise exception 'TWIN_NOT_ACTIVE'; end if;
 if l.training_data_state='purge_pending' then raise exception 'TWIN_PURGE_ALREADY_CLAIMED'; end if;
 if l.training_data_state='purged' then update public.user_loras set training_data_state='active',training_data_purge_requested_at=null,training_data_purged_at=null,updated_at=clock_timestamp() where id=l.id returning * into l; end if;
 return query select l.id,l.training_data_state;
end $$;

create or replace function public.claim_user_lora_purge(p_lora_id uuid,p_owner_id uuid,p_claim_token uuid,p_reason text,p_allow_early boolean default false)
returns table(lora_id uuid,scope text,claim_token uuid)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.user_loras;
begin
 if p_claim_token is null or p_reason not in ('creator_permanent_delete','retention_expired') then raise exception 'TWIN_PURGE_CLAIM_INVALID'; end if;
 select * into l from public.user_loras where id=p_lora_id and user_id=p_owner_id for update;
 if not found then raise exception 'TWIN_NOT_FOUND'; end if;
 if l.lifecycle_state='purged' then return query select l.id,'twin'::text,p_claim_token; return; end if;
 if l.lifecycle_state='purge_pending' then
   if l.purge_claim_token<>p_claim_token then raise exception 'TWIN_PURGE_ALREADY_CLAIMED'; end if;
   return query select l.id,'twin'::text,p_claim_token; return;
 end if;
 if l.lifecycle_state<>'trashed' then raise exception 'TWIN_STATE_CONFLICT'; end if;
 if not p_allow_early and (l.purge_after is null or l.purge_after>clock_timestamp()) then raise exception 'TWIN_PURGE_NOT_DUE'; end if;
 if exists(select 1 from public.compute_jobs j where j.owner_id=p_owner_id and j.state not in ('succeeded','failed','cancelled') and ((j.workload in ('trainer','image') and j.request_payload->>'identity_id'=p_lora_id::text) or exists(select 1 from public.video_projects v where v.identity_id=p_lora_id and v.owner_id=p_owner_id and (v.video_job_id=j.id or v.stitch_job_id=j.id)))) then raise exception 'TWIN_PURGE_BLOCKED_ACTIVE_COMPUTE'; end if;
 if exists(select 1 from public.dataset_doctor_jobs d where d.user_id=p_owner_id and d.lora_id=p_lora_id and greatest(d.created_at,d.updated_at)>clock_timestamp()-interval '11 minutes') then raise exception 'TWIN_PURGE_BLOCKED_UPLOAD_WINDOW'; end if;
 update public.user_loras set lifecycle_state='purge_pending',purge_requested_at=clock_timestamp(),purge_claim_token=p_claim_token,purge_reason=p_reason,training_data_state=case when training_data_state='purged' then 'purged' else 'purge_pending' end,training_data_purge_requested_at=case when training_data_state='purged' then training_data_purge_requested_at else clock_timestamp() end,training_data_purge_claim_token=case when training_data_state='purged' then null else p_claim_token end,updated_at=clock_timestamp() where id=l.id;
 return query select l.id,'twin'::text,p_claim_token;
end $$;

create or replace function public.finalize_user_lora_purge(p_lora_id uuid,p_owner_id uuid,p_claim_token uuid)
returns table(lora_id uuid,lifecycle_state text,purged_at timestamptz)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.user_loras;
begin
 select * into l from public.user_loras where id=p_lora_id and user_id=p_owner_id for update;
 if not found then raise exception 'TWIN_NOT_FOUND'; end if;
 if l.lifecycle_state='purged' then return query select l.id,l.lifecycle_state,l.purged_at; return; end if;
 if l.lifecycle_state<>'purge_pending' or l.purge_claim_token<>p_claim_token then raise exception 'TWIN_PURGE_CLAIM_INVALID'; end if;
 delete from public.dataset_doctor_selections where lora_id=p_lora_id and user_id=p_owner_id;
 delete from public.dataset_doctor_images where lora_id=p_lora_id and user_id=p_owner_id;
 update public.dataset_doctor_jobs set raw_count=0,accepted_count=0,rejected_count=0,review_count=0,needs_more_images=false,missing_coverage='[]'::jsonb,summary='{}'::jsonb,raw_r2_bucket=null,raw_r2_prefix=null,final_r2_bucket=null,final_r2_prefix=null,error_message=null,updated_at=clock_timestamp() where lora_id=p_lora_id and user_id=p_owner_id;
 update public.user_loras set lifecycle_state='purged',purge_claim_token=null,purged_at=clock_timestamp(),training_data_state='purged',training_data_purge_claim_token=null,training_data_purged_at=coalesce(training_data_purged_at,clock_timestamp()),artifact_r2_bucket=null,artifact_r2_key=null,trigger_token=null,dataset_r2_bucket=null,dataset_r2_prefix=null,dataset_doctor_job_id=null,lora_url=null,preview_url=null,prompt=null,negative_prompt=null,image_count=0,updated_at=clock_timestamp() where id=p_lora_id returning * into l;
 return query select l.id,l.lifecycle_state,l.purged_at;
end $$;

revoke all on function public.trash_user_lora(uuid,uuid) from public,anon,authenticated;
revoke all on function public.restore_user_lora(uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_user_lora_training_data_purge(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.finalize_user_lora_training_data_purge(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.reactivate_user_lora_training_data(uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_user_lora_purge(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.finalize_user_lora_purge(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.trash_user_lora(uuid,uuid) to service_role;
grant execute on function public.restore_user_lora(uuid,uuid) to service_role;
grant execute on function public.claim_user_lora_training_data_purge(uuid,uuid,uuid) to service_role;
grant execute on function public.finalize_user_lora_training_data_purge(uuid,uuid,uuid) to service_role;
grant execute on function public.reactivate_user_lora_training_data(uuid,uuid) to service_role;
grant execute on function public.claim_user_lora_purge(uuid,uuid,uuid,text,boolean) to service_role;
grant execute on function public.finalize_user_lora_purge(uuid,uuid,uuid) to service_role;

commit;
