begin;

create or replace function public.finalize_user_lora_training_data_purge(p_lora_id uuid,p_owner_id uuid,p_claim_token uuid)
returns table(lora_id uuid,training_data_state text,training_data_purged_at timestamptz)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.user_loras;
begin
 select u.* into l from public.user_loras u where u.id=p_lora_id and u.user_id=p_owner_id for update;
 if not found then raise exception 'TWIN_NOT_FOUND'; end if;
 if l.training_data_state='purged' then return query select l.id,l.training_data_state,l.training_data_purged_at; return; end if;
 if l.training_data_state<>'purge_pending' or l.training_data_purge_claim_token<>p_claim_token then raise exception 'TWIN_PURGE_CLAIM_INVALID'; end if;
 delete from public.dataset_doctor_selections s where s.lora_id=p_lora_id and s.user_id=p_owner_id;
 delete from public.dataset_doctor_images i where i.lora_id=p_lora_id and i.user_id=p_owner_id;
 update public.dataset_doctor_jobs d set raw_count=0,accepted_count=0,rejected_count=0,review_count=0,needs_more_images=false,missing_coverage='[]'::jsonb,summary='{}'::jsonb,raw_r2_bucket=null,raw_r2_prefix=null,final_r2_bucket=null,final_r2_prefix=null,error_message=null,updated_at=clock_timestamp() where d.lora_id=p_lora_id and d.user_id=p_owner_id;
 update public.user_loras u set training_data_state='purged',training_data_purge_claim_token=null,training_data_purged_at=clock_timestamp(),dataset_r2_bucket=null,dataset_r2_prefix=null,dataset_doctor_job_id=null,image_count=0,updated_at=clock_timestamp() where u.id=p_lora_id returning u.* into l;
 return query select l.id,l.training_data_state,l.training_data_purged_at;
end $$;

create or replace function public.finalize_user_lora_purge(p_lora_id uuid,p_owner_id uuid,p_claim_token uuid)
returns table(lora_id uuid,lifecycle_state text,purged_at timestamptz)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.user_loras;
begin
 select u.* into l from public.user_loras u where u.id=p_lora_id and u.user_id=p_owner_id for update;
 if not found then raise exception 'TWIN_NOT_FOUND'; end if;
 if l.lifecycle_state='purged' then return query select l.id,l.lifecycle_state,l.purged_at; return; end if;
 if l.lifecycle_state<>'purge_pending' or l.purge_claim_token<>p_claim_token then raise exception 'TWIN_PURGE_CLAIM_INVALID'; end if;
 delete from public.dataset_doctor_selections s where s.lora_id=p_lora_id and s.user_id=p_owner_id;
 delete from public.dataset_doctor_images i where i.lora_id=p_lora_id and i.user_id=p_owner_id;
 update public.dataset_doctor_jobs d set raw_count=0,accepted_count=0,rejected_count=0,review_count=0,needs_more_images=false,missing_coverage='[]'::jsonb,summary='{}'::jsonb,raw_r2_bucket=null,raw_r2_prefix=null,final_r2_bucket=null,final_r2_prefix=null,error_message=null,updated_at=clock_timestamp() where d.lora_id=p_lora_id and d.user_id=p_owner_id;
 update public.user_loras u set lifecycle_state='purged',purge_claim_token=null,purged_at=clock_timestamp(),training_data_state='purged',training_data_purge_claim_token=null,training_data_purged_at=coalesce(u.training_data_purged_at,clock_timestamp()),artifact_r2_bucket=null,artifact_r2_key=null,trigger_token=null,dataset_r2_bucket=null,dataset_r2_prefix=null,dataset_doctor_job_id=null,lora_url=null,preview_url=null,prompt=null,negative_prompt=null,image_count=0,updated_at=clock_timestamp() where u.id=p_lora_id returning u.* into l;
 return query select l.id,l.lifecycle_state,l.purged_at;
end $$;

revoke all on function public.finalize_user_lora_training_data_purge(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.finalize_user_lora_purge(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_user_lora_training_data_purge(uuid,uuid,uuid) to service_role;
grant execute on function public.finalize_user_lora_purge(uuid,uuid,uuid) to service_role;

commit;
