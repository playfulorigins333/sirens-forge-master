-- Pass 4A: atomic workload finalization and Trainer state projection.
-- Applying this migration to any shared environment is a separately authorized operation.
begin;

create function public.compute_workload_success_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.state = 'succeeded' and old.state <> 'succeeded' and new.workload in ('image','trainer')
     and current_setting('sirens_forge.workload_finalization_job', true) is distinct from new.id::text then
    raise exception 'WORKLOAD_FINALIZATION_REQUIRED';
  end if;
  return new;
end
$$;

create trigger compute_workload_success_guard
before update of state on public.compute_jobs
for each row execute function public.compute_workload_success_guard();

create function public.project_trainer_compute_state() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_lora_id uuid;
begin
  if new.workload <> 'trainer' or new.request_payload->>'identity_id' !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    return new;
  end if;
  v_lora_id := (new.request_payload->>'identity_id')::uuid;
  if new.state = 'queued' then
    update public.user_loras set status='queued', progress=0, started_at=null, completed_at=null,
      error_message=null, updated_at=clock_timestamp()
    where id=v_lora_id and user_id=new.owner_id and training_job_id=new.id::text;
  elsif new.state in ('claimed','running','recovering','cancel_requested') then
    update public.user_loras set status='training', started_at=coalesce(started_at,new.started_at,clock_timestamp()),
      error_message=null, updated_at=clock_timestamp()
    where id=v_lora_id and user_id=new.owner_id and training_job_id=new.id::text;
  elsif new.state in ('failed','cancelled') then
    update public.user_loras set status='failed', completed_at=coalesce(new.terminal_at,clock_timestamp()),
      error_message=case when new.state='failed' then public.compute_safe_error(new.safe_error_code) else 'TRAINING_CANCELLED' end,
      updated_at=clock_timestamp()
    where id=v_lora_id and user_id=new.owner_id and training_job_id=new.id::text;
  end if;
  return new;
end
$$;

create trigger project_trainer_compute_state
after update of state, started_at, terminal_at on public.compute_jobs
for each row when (new.workload = 'trainer') execute function public.project_trainer_compute_state();

create or replace function public.submit_trainer_compute_job(p_owner_id uuid,p_lora_id uuid,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text,p_dataset_r2_bucket text,p_dataset_r2_prefix text)
returns table(job_id uuid, workload public.compute_workload, creator_status text, queued_at timestamptz, started_at timestamptz, completed_at timestamptz, result_reference jsonb, safe_error_code text, can_cancel boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; current_job public.compute_jobs; policy public.compute_scheduler_policies;
begin
 if p_owner_id is null or p_lora_id is null or length(p_idempotency_key) not between 1 and 128 or p_request_fingerprint!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p_request_payload)<>'object' or p_request_payload->>'identity_id' is distinct from p_lora_id::text
    or p_priority_class not in ('og','standard') or p_dataset_r2_bucket is null or p_dataset_r2_prefix is null then
   raise exception 'INVALID_TRAINER_SUBMISSION';
 end if;
 -- The target row lock serializes all submissions for one Twin, including different keys.
 perform 1 from public.user_loras where id=p_lora_id and user_id=p_owner_id for update;
 if not found then raise exception 'TRAINER_TARGET_NOT_OWNED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':trainer:'||p_idempotency_key,0));
 select * into j from public.compute_jobs x where x.owner_id=p_owner_id and x.workload='trainer' and x.idempotency_key=p_idempotency_key;
 if found then
  if j.request_fingerprint<>p_request_fingerprint or j.request_payload->>'identity_id' is distinct from p_lora_id::text then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 else
  select x.* into current_job from public.user_loras l join public.compute_jobs x on x.id::text=l.training_job_id
   where l.id=p_lora_id and x.owner_id=p_owner_id and x.workload='trainer';
  if found and current_job.state not in ('succeeded','failed','cancelled') then raise exception 'TRAINER_ALREADY_ACTIVE'; end if;
  select * into policy from public.compute_scheduler_policies p where p.workload='trainer' and p.enabled;
  if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
  insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts)
   values(p_owner_id,'trainer',p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class,policy.max_attempts) returning * into j;
  update public.user_loras set training_job_id=j.id::text,status='queued',progress=0,started_at=null,completed_at=null,error_message=null,
   artifact_r2_bucket=null,artifact_r2_key=null,trigger_token=null,dataset_r2_bucket=p_dataset_r2_bucket,dataset_r2_prefix=p_dataset_r2_prefix,updated_at=clock_timestamp()
   where id=p_lora_id and user_id=p_owner_id;
  if not found then raise exception 'TRAINER_PROJECTION_FAILED'; end if;
 end if;
 return query select j.id,j.workload,case when j.state='recovering' and j.cancellation_requested_at is not null then 'cancelling' else case j.state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else j.state::text end end,j.queued_at,j.started_at,j.terminal_at,public.compute_creator_result(j.result_reference),j.safe_error_code,j.state not in ('succeeded','failed','cancelled');
end$$;

create function public.finalize_image_compute_job(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_generation_id uuid,p_generation jsonb,p_assets jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; product jsonb; fingerprint text;
begin
 select * into j from public.compute_jobs where id=p_job_id for update;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if j.workload is distinct from 'image' or not found or a.lease_token<>p_lease_token then raise exception 'IMAGE_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if j.state not in ('running','cancel_requested','succeeded') or (j.state<>'succeeded' and (j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp())) then raise exception 'IMAGE_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if a.provider_dispatch_intent_at is null or a.provider_dispatched_at is null or a.provider_operation_ref is null or a.actual_cost_micros is null then raise exception 'IMAGE_EXECUTION_EVIDENCE_REQUIRED'; end if;
 fingerprint:=encode(digest(jsonb_build_array(p_generation_id,p_generation,p_assets)::text,'sha256'),'hex');
 if a.internal_telemetry->>'workload_finalization_fingerprint' is not null and a.internal_telemetry->>'workload_finalization_fingerprint'<>fingerprint then raise exception 'IMAGE_FINALIZATION_REPLAY_CONFLICT'; end if;
 product:=public.finalize_private_generation(p_generation_id,j.owner_id,p_generation,p_assets);
 if j.state='succeeded' and j.result_reference is distinct from product then raise exception 'IMAGE_FINALIZATION_REPLAY_CONFLICT'; end if;
 perform set_config('sirens_forge.workload_finalization_job',j.id::text,true);
 update public.compute_job_attempts set internal_telemetry=jsonb_set(internal_telemetry,'{workload_finalization_fingerprint}',to_jsonb(fingerprint)) where id=a.id;
 perform public.compute_worker_transition(j.id,a.id,p_lease_token,'success',null,product);
 return product;
end$$;

create function public.finalize_recovered_image_compute_job(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid,p_generation_id uuid,p_generation jsonb,p_assets jsonb,p_actual_cost_micros bigint,p_runtime_ms bigint,p_provider_operation_ref text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; product jsonb; fingerprint text; recovery_fingerprint text;
begin
 select * into j from public.compute_jobs where id=p_job_id for update;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if j.workload is distinct from 'image' or not found or a.recovery_token is distinct from p_recovery_token then raise exception 'IMAGE_RECOVERY_AUTHORITY_MISMATCH'; end if;
 fingerprint:=encode(digest(jsonb_build_array(p_generation_id,p_generation,p_assets)::text,'sha256'),'hex');
 if a.recovery_fingerprint is not null then
   if j.state='succeeded' then
     product:=public.finalize_private_generation(p_generation_id,j.owner_id,p_generation,p_assets);
     recovery_fingerprint:=encode(digest(jsonb_build_array('succeeded',false,null,public.compute_creator_result(product),p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref)::text,'sha256'),'hex');
     if j.result_reference=product and a.recovery_fingerprint=recovery_fingerprint and a.internal_telemetry->>'workload_finalization_fingerprint'=fingerprint then return product; end if;
   end if;
   raise exception 'IMAGE_FINALIZATION_REPLAY_CONFLICT';
 end if;
 if j.state<>'recovering' or a.finished_at is not null or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'IMAGE_RECOVERY_AUTHORITY_MISMATCH'; end if;
 product:=public.finalize_private_generation(p_generation_id,j.owner_id,p_generation,p_assets);
 perform set_config('sirens_forge.workload_finalization_job',j.id::text,true);
 update public.compute_job_attempts set internal_telemetry=jsonb_set(internal_telemetry,'{workload_finalization_fingerprint}',to_jsonb(fingerprint)) where id=a.id;
 perform public.reconcile_compute_recovery(j.id,a.id,p_recovery_token,p_recovery_lease_token,'succeeded',false,null,product,p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref);
 return product;
end$$;

create function public.finalize_trainer_compute_job(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_artifact_r2_bucket text,p_artifact_r2_key text)
returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; l public.user_loras; lora_id uuid; token text; fingerprint text;
begin
 select * into j from public.compute_jobs where id=p_job_id for update;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if j.workload is distinct from 'trainer' or not found or a.lease_token<>p_lease_token or j.request_payload->>'identity_id' !~ '^[0-9a-fA-F-]{36}$' then raise exception 'TRAINER_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if j.state not in ('running','cancel_requested','succeeded') or (j.state<>'succeeded' and (j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp())) then raise exception 'TRAINER_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if a.provider_dispatch_intent_at is null or a.provider_dispatched_at is null or a.provider_operation_ref is null or a.actual_cost_micros is null then raise exception 'TRAINER_EXECUTION_EVIDENCE_REQUIRED'; end if;
 if p_artifact_r2_bucket is null or p_artifact_r2_bucket<>btrim(p_artifact_r2_bucket) or length(p_artifact_r2_bucket) not between 3 and 63
   or p_artifact_r2_key is null or p_artifact_r2_key<>btrim(p_artifact_r2_key) or length(p_artifact_r2_key) not between 1 and 1024
   or p_artifact_r2_key like '/%' or p_artifact_r2_key like E'%\\%' or p_artifact_r2_key ~ '[[:cntrl:]]'
   or exists(select 1 from unnest(string_to_array(p_artifact_r2_key,'/')) s where s in ('','.','..')) then raise exception 'TRAINER_ARTIFACT_REFERENCE_INVALID'; end if;
 lora_id:=(j.request_payload->>'identity_id')::uuid;
 select * into l from public.user_loras where id=lora_id for update;
 if not found or l.user_id<>j.owner_id or l.training_job_id is distinct from j.id::text then raise exception 'TRAINER_TARGET_BINDING_MISMATCH'; end if;
 token:='sf'||lower(substr(replace(l.id::text,'-',''),1,8));
 fingerprint:=encode(digest(jsonb_build_array(p_artifact_r2_bucket,p_artifact_r2_key)::text,'sha256'),'hex');
 if a.internal_telemetry->>'workload_finalization_fingerprint' is not null and a.internal_telemetry->>'workload_finalization_fingerprint'<>fingerprint then raise exception 'TRAINER_FINALIZATION_REPLAY_CONFLICT'; end if;
 if j.state='succeeded' then
   if l.status='completed' and l.progress=100 and l.artifact_r2_bucket=p_artifact_r2_bucket and l.artifact_r2_key=p_artifact_r2_key and l.trigger_token=token then return j.state; end if;
   raise exception 'TRAINER_FINALIZATION_REPLAY_CONFLICT';
 end if;
 update public.user_loras set status='completed',progress=100,artifact_r2_bucket=p_artifact_r2_bucket,artifact_r2_key=p_artifact_r2_key,
   trigger_token=token,started_at=coalesce(started_at,a.started_at,j.started_at,clock_timestamp()),completed_at=clock_timestamp(),updated_at=clock_timestamp(),error_message=null where id=l.id;
 perform set_config('sirens_forge.workload_finalization_job',j.id::text,true);
 update public.compute_job_attempts set internal_telemetry=jsonb_set(internal_telemetry,'{workload_finalization_fingerprint}',to_jsonb(fingerprint)) where id=a.id;
 return public.compute_worker_transition(j.id,a.id,p_lease_token,'success',null,null);
end$$;

create function public.finalize_recovered_trainer_compute_job(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid,p_artifact_r2_bucket text,p_artifact_r2_key text,p_actual_cost_micros bigint,p_runtime_ms bigint,p_provider_operation_ref text default null)
returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; l public.user_loras; lora_id uuid; token text; final_state public.compute_job_state; fingerprint text; replay_fingerprint text;
begin
 select * into j from public.compute_jobs where id=p_job_id for update;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if j.workload is distinct from 'trainer' or not found or a.recovery_token is distinct from p_recovery_token or j.request_payload->>'identity_id' !~ '^[0-9a-fA-F-]{36}$' then raise exception 'TRAINER_RECOVERY_AUTHORITY_MISMATCH'; end if;
 lora_id:=(j.request_payload->>'identity_id')::uuid; select * into l from public.user_loras where id=lora_id for update;
 token:='sf'||lower(substr(replace(lora_id::text,'-',''),1,8));
 fingerprint:=encode(digest(jsonb_build_array(p_artifact_r2_bucket,p_artifact_r2_key)::text,'sha256'),'hex');
 if a.recovery_fingerprint is not null then
   replay_fingerprint:=encode(digest(jsonb_build_array('succeeded',false,null,null,p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref)::text,'sha256'),'hex');
   if j.state='succeeded' and a.recovery_fingerprint=replay_fingerprint and a.internal_telemetry->>'workload_finalization_fingerprint'=fingerprint and l.user_id=j.owner_id and l.training_job_id=j.id::text and l.status='completed' and l.progress=100 and l.artifact_r2_bucket=p_artifact_r2_bucket and l.artifact_r2_key=p_artifact_r2_key and l.trigger_token=token then return j.state; end if;
   raise exception 'TRAINER_FINALIZATION_REPLAY_CONFLICT';
 end if;
 if j.state<>'recovering' or a.finished_at is not null or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'TRAINER_RECOVERY_AUTHORITY_MISMATCH'; end if;
 if not found or l.user_id<>j.owner_id or l.training_job_id is distinct from j.id::text then raise exception 'TRAINER_TARGET_BINDING_MISMATCH'; end if;
 if p_artifact_r2_bucket is null or p_artifact_r2_bucket<>btrim(p_artifact_r2_bucket) or length(p_artifact_r2_bucket) not between 3 and 63
   or p_artifact_r2_key is null or p_artifact_r2_key<>btrim(p_artifact_r2_key) or length(p_artifact_r2_key) not between 1 and 1024
   or p_artifact_r2_key like '/%' or p_artifact_r2_key like E'%\\%' or p_artifact_r2_key ~ '[[:cntrl:]]'
   or exists(select 1 from unnest(string_to_array(p_artifact_r2_key,'/')) s where s in ('','.','..')) then raise exception 'TRAINER_ARTIFACT_REFERENCE_INVALID'; end if;
 update public.user_loras set status='completed',progress=100,artifact_r2_bucket=p_artifact_r2_bucket,artifact_r2_key=p_artifact_r2_key,
  trigger_token=token,started_at=coalesce(started_at,a.started_at,j.started_at,clock_timestamp()),completed_at=clock_timestamp(),updated_at=clock_timestamp(),error_message=null where id=l.id;
 perform set_config('sirens_forge.workload_finalization_job',j.id::text,true);
 update public.compute_job_attempts set internal_telemetry=jsonb_set(internal_telemetry,'{workload_finalization_fingerprint}',to_jsonb(fingerprint)) where id=a.id;
 final_state:=public.reconcile_compute_recovery(j.id,a.id,p_recovery_token,p_recovery_lease_token,'succeeded',false,null,null,p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref);
 return final_state;
end$$;

revoke all on function public.compute_workload_success_guard(),public.project_trainer_compute_state(),
 public.finalize_image_compute_job(uuid,uuid,uuid,uuid,jsonb,jsonb),
 public.finalize_recovered_image_compute_job(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,bigint,bigint,text),
 public.finalize_trainer_compute_job(uuid,uuid,uuid,text,text),
 public.finalize_recovered_trainer_compute_job(uuid,uuid,uuid,uuid,text,text,bigint,bigint,text)
 from public,anon,authenticated;
grant execute on function public.finalize_image_compute_job(uuid,uuid,uuid,uuid,jsonb,jsonb),
 public.finalize_recovered_image_compute_job(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,bigint,bigint,text),
 public.finalize_trainer_compute_job(uuid,uuid,uuid,text,text),
 public.finalize_recovered_trainer_compute_job(uuid,uuid,uuid,uuid,text,text,bigint,bigint,text)
 to service_role;

commit;
