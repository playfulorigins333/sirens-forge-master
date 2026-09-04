begin;

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
 if l.training_data_state='purge_pending' and l.training_data_purge_claim_token is distinct from p_claim_token then raise exception 'TWIN_TRAINING_DATA_PURGE_ALREADY_CLAIMED'; end if;
 if not p_allow_early and (l.purge_after is null or l.purge_after>clock_timestamp()) then raise exception 'TWIN_PURGE_NOT_DUE'; end if;
 if exists(select 1 from public.compute_jobs j where j.owner_id=p_owner_id and j.state not in ('succeeded','failed','cancelled') and ((j.workload in ('trainer','image') and j.request_payload->>'identity_id'=p_lora_id::text) or exists(select 1 from public.video_projects v where v.identity_id=p_lora_id and v.owner_id=p_owner_id and (v.video_job_id=j.id or v.stitch_job_id=j.id)))) then raise exception 'TWIN_PURGE_BLOCKED_ACTIVE_COMPUTE'; end if;
 if exists(select 1 from public.dataset_doctor_jobs d where d.user_id=p_owner_id and d.lora_id=p_lora_id and greatest(d.created_at,d.updated_at)>clock_timestamp()-interval '11 minutes') then raise exception 'TWIN_PURGE_BLOCKED_UPLOAD_WINDOW'; end if;
 update public.user_loras set lifecycle_state='purge_pending',purge_requested_at=clock_timestamp(),purge_claim_token=p_claim_token,purge_reason=p_reason,training_data_state=case when training_data_state='purged' then 'purged' else 'purge_pending' end,training_data_purge_requested_at=case when training_data_state='purged' then training_data_purge_requested_at else clock_timestamp() end,training_data_purge_claim_token=case when training_data_state='purged' then null else p_claim_token end,updated_at=clock_timestamp() where id=l.id;
 return query select l.id,'twin'::text,p_claim_token;
end $$;

revoke all on function public.claim_user_lora_purge(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_user_lora_purge(uuid,uuid,uuid,text,boolean) to service_role;

commit;
