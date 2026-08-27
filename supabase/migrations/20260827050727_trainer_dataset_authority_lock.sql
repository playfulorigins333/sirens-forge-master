-- Phase 2A-1: server-authoritative Trainer and Dataset Doctor boundary. Applying is separately authorized.
begin;

revoke all privileges on table public.dataset_doctor_jobs, public.dataset_doctor_images, public.dataset_doctor_selections from public, anon, authenticated;
revoke insert, update, delete on table public.user_loras from public, anon, authenticated;
grant select on table public.user_loras to authenticated;

do $policies$
declare r record;
begin
 for r in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('dataset_doctor_jobs','dataset_doctor_images','dataset_doctor_selections','user_loras')
 loop execute format('drop policy %I on %I.%I',r.policyname,r.schemaname,r.tablename); end loop;
end $policies$;

create policy user_loras_authenticated_owner_select on public.user_loras for select to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.submit_trainer_compute_job(p_owner_id uuid,p_lora_id uuid,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text,p_dataset_r2_bucket text,p_dataset_r2_prefix text)
returns table(job_id uuid, workload public.compute_workload, creator_status text, queued_at timestamptz, started_at timestamptz, completed_at timestamptz, result_reference jsonb, safe_error_code text, can_cancel boolean)
language plpgsql security definer set search_path='' as $function$
declare
 j public.compute_jobs; current_job public.compute_jobs; policy public.compute_scheduler_policies;
 dataset_job public.dataset_doctor_jobs; requested_job_id uuid; stored_ids jsonb;
 expected_recipe constant jsonb := '{"version":"sf-sdxl-recommended-v1","mode":"recommended","settings":{"resolution":[1024,1024],"enable_bucket":true,"min_bucket_reso":512,"max_bucket_reso":1024,"bucket_reso_steps":64,"train_batch_size":1,"learning_rate":0.0001,"network_module":"networks.lora","network_dim":64,"network_alpha":32,"mixed_precision":"fp16","gradient_checkpointing":true,"save_model_as":"safetensors","save_every_n_steps":200,"target_effective_samples":1200,"caption_extension":".txt","caption_model":"Salesforce/blip-image-captioning-base","trigger_suffix":"woman"}}'::jsonb;
begin
 if p_owner_id is null or p_lora_id is null or length(p_idempotency_key) not between 1 and 128 or p_request_fingerprint!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p_request_payload)<>'object' or p_priority_class not in ('og','standard') then raise exception 'INVALID_TRAINER_SUBMISSION'; end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_request_payload) key) is distinct from array['dataset_doctor_job_id','dataset_reference','dataset_selection','dataset_snapshot','identity_id','trainer_recipe']::text[]
    or jsonb_typeof(p_request_payload->'identity_id')<>'string' or p_request_payload->>'identity_id' is distinct from p_lora_id::text
    or jsonb_typeof(p_request_payload->'dataset_doctor_job_id')<>'string'
    or jsonb_typeof(p_request_payload->'dataset_reference')<>'object' or jsonb_typeof(p_request_payload->'dataset_snapshot')<>'object'
    or jsonb_typeof(p_request_payload->'dataset_selection')<>'object' or jsonb_typeof(p_request_payload->'trainer_recipe')<>'object' then raise exception 'TRAINER_REQUEST_AUTHORITY_INVALID'; end if;
 begin requested_job_id := (p_request_payload->>'dataset_doctor_job_id')::uuid; exception when invalid_text_representation then raise exception 'DATASET_JOB_ID_INVALID'; end;
 if requested_job_id::text is distinct from p_request_payload->>'dataset_doctor_job_id' then raise exception 'DATASET_JOB_ID_INVALID'; end if;
 select * into dataset_job from public.dataset_doctor_jobs d where d.id=requested_job_id and d.user_id=p_owner_id and d.lora_id=p_lora_id for share;
 if not found then raise exception 'DATASET_JOB_AUTHORITY_MISMATCH'; end if;
 if dataset_job.status is distinct from 'exported' then raise exception 'DATASET_NOT_EXPORTED'; end if;
 if dataset_job.final_r2_bucket is null or dataset_job.final_r2_prefix is null or dataset_job.final_r2_bucket is distinct from p_dataset_r2_bucket or dataset_job.final_r2_prefix is distinct from p_dataset_r2_prefix
   or dataset_job.final_r2_bucket is distinct from p_request_payload#>>'{dataset_reference,bucket}' or dataset_job.final_r2_prefix is distinct from p_request_payload#>>'{dataset_reference,prefix}' then raise exception 'DATASET_REFERENCE_MISMATCH'; end if;
 if p_request_payload->'dataset_snapshot' is distinct from dataset_job.summary then raise exception 'DATASET_SNAPSHOT_MISMATCH'; end if;
 if dataset_job.summary->'dataset_ready' = 'false'::jsonb then raise exception 'DATASET_TRAINING_DECISION_REQUIRED'; end if;
 select coalesce(jsonb_agg(s.image_id::text order by s.image_id::text),'[]'::jsonb) into stored_ids from public.dataset_doctor_selections s where s.job_id=requested_job_id and s.selection_type='final';
 if jsonb_array_length(stored_ids)=0 or p_request_payload#>'{dataset_selection,image_ids}' is distinct from stored_ids
   or jsonb_typeof(p_request_payload#>'{dataset_selection,image_count}')<>'number'
   or (p_request_payload#>>'{dataset_selection,image_count}')::integer <> jsonb_array_length(stored_ids) then raise exception 'DATASET_SELECTION_MISMATCH'; end if;
 if p_request_payload->'trainer_recipe' is distinct from expected_recipe then raise exception 'TRAINER_RECIPE_INVALID'; end if;
 perform 1 from public.user_loras where id=p_lora_id and user_id=p_owner_id for update; if not found then raise exception 'TRAINER_TARGET_NOT_OWNED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text||':trainer:'||p_idempotency_key,0));
 select * into j from public.compute_jobs x where x.owner_id=p_owner_id and x.workload='trainer' and x.idempotency_key=p_idempotency_key;
 if found then
  if j.request_fingerprint<>p_request_fingerprint or j.request_payload is distinct from p_request_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 else
  select x.* into current_job from public.user_loras l join public.compute_jobs x on x.id::text=l.training_job_id where l.id=p_lora_id and x.owner_id=p_owner_id and x.workload='trainer';
  if found and current_job.state not in ('succeeded','failed','cancelled') then raise exception 'TRAINER_ALREADY_ACTIVE'; end if;
  select * into policy from public.compute_scheduler_policies p where p.workload='trainer' and p.enabled;
  if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
  insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts) values(p_owner_id,'trainer',p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class,policy.max_attempts) returning * into j;
  update public.user_loras set training_job_id=j.id::text,status='queued',progress=0,started_at=null,completed_at=null,error_message=null,artifact_r2_bucket=null,artifact_r2_key=null,trigger_token=null,dataset_r2_bucket=p_dataset_r2_bucket,dataset_r2_prefix=p_dataset_r2_prefix,updated_at=pg_catalog.clock_timestamp() where id=p_lora_id and user_id=p_owner_id;
  if not found then raise exception 'TRAINER_PROJECTION_FAILED'; end if;
 end if;
 return query select j.id,j.workload,case when j.state='recovering' and j.cancellation_requested_at is not null then 'cancelling' else case j.state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else j.state::text end end,j.queued_at,j.started_at,j.terminal_at,public.compute_creator_result(j.result_reference),j.safe_error_code,j.state not in ('succeeded','failed','cancelled');
end $function$;
revoke execute on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) to service_role;
commit;
