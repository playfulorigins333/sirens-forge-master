-- Phase 2A-2: immutable quality-decision receipts and receipt-bound Trainer authority.
begin;
create table public.dataset_doctor_training_decision_receipts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 lora_id uuid not null references public.user_loras(id), dataset_doctor_job_id uuid not null references public.dataset_doctor_jobs(id),
 decision_contract_version text not null check(decision_contract_version='dataset-doctor-training-decision-v1'),
 decision text not null check(decision='train_anyway'), warning_snapshot jsonb not null check(jsonb_typeof(warning_snapshot)='object'),
 warning_fingerprint text not null check(warning_fingerprint~'^[0-9a-f]{64}$'), dataset_snapshot jsonb not null check(jsonb_typeof(dataset_snapshot)='object'),
 dataset_snapshot_fingerprint text not null check(dataset_snapshot_fingerprint~'^[0-9a-f]{64}$'), selected_image_ids jsonb not null check(jsonb_typeof(selected_image_ids)='array'),
 selected_image_count integer not null check(selected_image_count>0 and selected_image_count=jsonb_array_length(selected_image_ids)), shown_at timestamptz not null, decided_at timestamptz not null,
 training_job_id uuid unique references public.compute_jobs(id), created_at timestamptz not null default statement_timestamp(), check(shown_at<=decided_at), check(decided_at<=created_at)
);
create unique index dataset_training_decision_receipts_exact on public.dataset_doctor_training_decision_receipts(user_id,lora_id,dataset_doctor_job_id,decision_contract_version,dataset_snapshot_fingerprint,warning_fingerprint,selected_image_ids);
alter table public.dataset_doctor_training_decision_receipts enable row level security;
create function public.dataset_training_decision_receipts_immutable() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='UPDATE' and old.training_job_id is null and new.training_job_id is not null and new is not distinct from (jsonb_populate_record(old,to_jsonb(old)||jsonb_build_object('training_job_id',new.training_job_id))) then return new; end if;
 raise exception 'DATASET_TRAINING_DECISION_RECEIPT_IMMUTABLE'; end $$;
create trigger dataset_training_decision_receipts_reject_changes before update or delete on public.dataset_doctor_training_decision_receipts for each row execute function public.dataset_training_decision_receipts_immutable();
create function public.link_dataset_training_decision_receipt(p_receipt_id uuid,p_training_job_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 update public.dataset_doctor_training_decision_receipts r set training_job_id=p_training_job_id where r.id=p_receipt_id and r.training_job_id is null and exists(select 1 from public.compute_jobs j where j.id=p_training_job_id and j.owner_id=r.user_id and j.workload='trainer' and j.request_payload#>>'{dataset_training_decision,receipt_id}'=r.id::text);
 if not found then raise exception 'DATASET_TRAINING_DECISION_LINK_INVALID'; end if; end $$;
revoke all on table public.dataset_doctor_training_decision_receipts from public,anon,authenticated;
grant select,insert on table public.dataset_doctor_training_decision_receipts to service_role;
revoke all on function public.link_dataset_training_decision_receipt(uuid,uuid) from public,anon,authenticated; grant execute on function public.link_dataset_training_decision_receipt(uuid,uuid) to service_role;
create or replace function public.submit_trainer_compute_job(p_owner_id uuid,p_lora_id uuid,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text,p_dataset_r2_bucket text,p_dataset_r2_prefix text)
returns table(job_id uuid, workload public.compute_workload, creator_status text, queued_at timestamptz, started_at timestamptz, completed_at timestamptz, result_reference jsonb, safe_error_code text, can_cancel boolean)
language plpgsql security definer set search_path='' as $function$
declare
 j public.compute_jobs; current_job public.compute_jobs; policy public.compute_scheduler_policies;
 dataset_job public.dataset_doctor_jobs; requested_job_id uuid; stored_ids jsonb; decision jsonb; receipt public.dataset_doctor_training_decision_receipts;
 expected_recipe constant jsonb := '{"version":"sf-sdxl-recommended-v1","mode":"recommended","settings":{"resolution":[1024,1024],"enable_bucket":true,"min_bucket_reso":512,"max_bucket_reso":1024,"bucket_reso_steps":64,"train_batch_size":1,"learning_rate":0.0001,"network_module":"networks.lora","network_dim":64,"network_alpha":32,"mixed_precision":"fp16","gradient_checkpointing":true,"save_model_as":"safetensors","save_every_n_steps":200,"target_effective_samples":1200,"caption_extension":".txt","caption_model":"Salesforce/blip-image-captioning-base","trigger_suffix":"woman"}}'::jsonb;
begin
 if p_owner_id is null or p_lora_id is null or length(p_idempotency_key) not between 1 and 128 or p_request_fingerprint!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p_request_payload)<>'object' or p_priority_class not in ('og','standard') then raise exception 'INVALID_TRAINER_SUBMISSION'; end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_request_payload) key) is distinct from array['dataset_doctor_job_id','dataset_reference','dataset_selection','dataset_snapshot','dataset_training_decision','identity_id','trainer_recipe']::text[]
    or jsonb_typeof(p_request_payload->'identity_id')<>'string' or p_request_payload->>'identity_id' is distinct from p_lora_id::text
    or jsonb_typeof(p_request_payload->'dataset_doctor_job_id')<>'string'
    or jsonb_typeof(p_request_payload->'dataset_reference')<>'object' or jsonb_typeof(p_request_payload->'dataset_snapshot')<>'object'
    or not (p_request_payload ? 'dataset_training_decision') or jsonb_typeof(p_request_payload->'dataset_selection')<>'object' or jsonb_typeof(p_request_payload->'trainer_recipe')<>'object' then raise exception 'TRAINER_REQUEST_AUTHORITY_INVALID'; end if;
 begin requested_job_id := (p_request_payload->>'dataset_doctor_job_id')::uuid; exception when invalid_text_representation then raise exception 'DATASET_JOB_ID_INVALID'; end;
 if requested_job_id::text is distinct from p_request_payload->>'dataset_doctor_job_id' then raise exception 'DATASET_JOB_ID_INVALID'; end if;
 select * into dataset_job from public.dataset_doctor_jobs d where d.id=requested_job_id and d.user_id=p_owner_id and d.lora_id=p_lora_id for share;
 if not found then raise exception 'DATASET_JOB_AUTHORITY_MISMATCH'; end if;
 if dataset_job.status is distinct from 'exported' then raise exception 'DATASET_NOT_EXPORTED'; end if;
 if dataset_job.final_r2_bucket is null or dataset_job.final_r2_prefix is null or dataset_job.final_r2_bucket is distinct from p_dataset_r2_bucket or dataset_job.final_r2_prefix is distinct from p_dataset_r2_prefix
   or dataset_job.final_r2_bucket is distinct from p_request_payload#>>'{dataset_reference,bucket}' or dataset_job.final_r2_prefix is distinct from p_request_payload#>>'{dataset_reference,prefix}' then raise exception 'DATASET_REFERENCE_MISMATCH'; end if;
 if p_request_payload->'dataset_snapshot' is distinct from dataset_job.summary then raise exception 'DATASET_SNAPSHOT_MISMATCH'; end if;
 select coalesce(jsonb_agg(s.image_id::text order by s.image_id::text),'[]'::jsonb) into stored_ids from public.dataset_doctor_selections s where s.job_id=requested_job_id and s.selection_type='final';
 if jsonb_array_length(stored_ids)=0 or p_request_payload#>'{dataset_selection,image_ids}' is distinct from stored_ids
   or jsonb_typeof(p_request_payload#>'{dataset_selection,image_count}')<>'number'
   or (p_request_payload#>>'{dataset_selection,image_count}')::integer <> jsonb_array_length(stored_ids) then raise exception 'DATASET_SELECTION_MISMATCH'; end if;
 decision:=p_request_payload->'dataset_training_decision';
 if dataset_job.summary->'dataset_ready' = 'true'::jsonb then
  if decision is distinct from 'null'::jsonb then raise exception 'DATASET_TRAINING_DECISION_INVALID'; end if;
 elsif dataset_job.summary->'dataset_ready' = 'false'::jsonb then
  if decision is null or decision='null'::jsonb then raise exception 'DATASET_TRAINING_DECISION_REQUIRED'; end if;
  if jsonb_typeof(decision)<>'object' then raise exception 'DATASET_TRAINING_DECISION_INVALID'; end if;
  begin select * into receipt from public.dataset_doctor_training_decision_receipts where id=(decision->>'receipt_id')::uuid for share;
  exception when invalid_text_representation then raise exception 'DATASET_TRAINING_DECISION_INVALID'; end;
  if not found then raise exception 'DATASET_TRAINING_DECISION_INVALID'; end if;
  if receipt.user_id<>p_owner_id or receipt.lora_id<>p_lora_id or receipt.dataset_doctor_job_id<>requested_job_id or receipt.decision<>'train_anyway' or receipt.decision_contract_version<>'dataset-doctor-training-decision-v1'
    or decision->>'decision'<>'train_anyway' or decision->>'contract_version'<>receipt.decision_contract_version then raise exception 'DATASET_TRAINING_DECISION_INVALID'; end if;
  if receipt.dataset_snapshot is distinct from dataset_job.summary or receipt.selected_image_ids is distinct from stored_ids
    or receipt.selected_image_count<>jsonb_array_length(stored_ids) or decision->>'warning_fingerprint'<>receipt.warning_fingerprint
    or decision->>'dataset_snapshot_fingerprint'<>receipt.dataset_snapshot_fingerprint then raise exception 'DATASET_TRAINING_DECISION_STALE'; end if;
 else raise exception 'DATASET_TRAINING_DECISION_INVALID'; end if;
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
  if receipt.id is not null then perform public.link_dataset_training_decision_receipt(receipt.id,j.id); end if;
 end if;
 return query select j.id,j.workload,case when j.state='recovering' and j.cancellation_requested_at is not null then 'cancelling' else case j.state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else j.state::text end end,j.queued_at,j.started_at,j.terminal_at,public.compute_creator_result(j.result_reference),j.safe_error_code,j.state not in ('succeeded','failed','cancelled');
end $function$;
revoke execute on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) to service_role;
commit;
