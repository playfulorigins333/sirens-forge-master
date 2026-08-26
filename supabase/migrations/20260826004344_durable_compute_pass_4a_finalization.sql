-- Pass 4A: atomic workload finalization and Trainer state projection. Applying is separately authorized.
begin;

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
  elsif new.state='claimed' then
    update public.user_loras set status='training', started_at=coalesce(started_at,new.started_at),error_message=null,updated_at=clock_timestamp()
    where id=v_lora_id and user_id=new.owner_id and training_job_id=new.id::text;
  elsif new.state in ('running','recovering','cancel_requested') then
    update public.user_loras set status='training', started_at=coalesce(new.started_at,started_at),
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


create or replace function public.compute_worker_transition(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_action text,p_safe_error_code text default null,p_result_reference jsonb default null)
returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; safe_code text; expected_outcome text;
begin
 select * into j from public.compute_jobs where id=p_job_id for update; if not found then raise exception 'JOB_NOT_FOUND'; end if;
 if p_action='success' and j.workload in ('image','trainer') then raise exception 'WORKLOAD_FINALIZATION_REQUIRED'; end if;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or a.lease_token<>p_lease_token then raise exception 'LEASE_MISMATCH'; end if;
 expected_outcome:=case p_action when 'success' then 'succeeded' when 'failure' then 'failed' when 'cancelled' then 'cancelled' end;
 if j.state in ('succeeded','failed','cancelled') then
  if expected_outcome is not null and j.state::text=expected_outcome and a.finished_at is not null and a.outcome_class=expected_outcome then return j.state; end if;
  raise exception 'TERMINAL_TRANSITION_CONFLICT';
 end if;
 if j.lease_token is distinct from p_lease_token or a.finished_at is not null or j.lease_expires_at<=clock_timestamp() then raise exception 'LEASE_MISMATCH'; end if;
 safe_code:=public.compute_safe_error(p_safe_error_code);
 if p_action='start' and j.state='claimed' then
  update public.compute_jobs set state='running',started_at=coalesce(started_at,now()),updated_at=now() where id=j.id;
  update public.compute_job_attempts set started_at=coalesce(started_at,now()) where id=a.id;
 elsif p_action='start' and j.state='running' and a.started_at is not null then
  return j.state;
 elsif p_action='success' and j.state in ('running','cancel_requested') then
  if a.provider_dispatch_intent_at is null or a.provider_dispatched_at is null or a.provider_operation_ref is null then raise exception 'EXECUTION_EVIDENCE_REQUIRED'; end if;
  if a.actual_cost_micros is null then raise exception 'ACTUAL_COST_REQUIRED'; end if;
  update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=public.compute_creator_result(p_result_reference),lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
  update public.compute_job_attempts set finished_at=now(),outcome_class='succeeded' where id=a.id;
 elsif p_action in ('failure','cancelled') and ((p_action='failure' and j.state in ('claimed','running')) or (p_action='cancelled' and j.state='cancel_requested')) then
  if a.provider_dispatch_intent_at is not null and a.actual_cost_micros is null then raise exception 'ACTUAL_COST_REQUIRED'; end if;
  if a.provider_dispatch_intent_at is null then perform public.release_compute_reservation(a.id); end if;
  update public.compute_jobs set state=expected_outcome::public.compute_job_state,terminal_at=now(),safe_error_code=case when p_action='failure' then safe_code else safe_error_code end,lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
  update public.compute_job_attempts set finished_at=now(),outcome_class=expected_outcome,safe_error_code=case when p_action='failure' then safe_code else safe_error_code end where id=a.id;
 else raise exception 'ILLEGAL_COMPUTE_TRANSITION'; end if;
 select state into j.state from public.compute_jobs where id=j.id; return j.state;
end$$;

create or replace function public.reconcile_compute_recovery(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid,p_outcome text,p_provider_nonexecution_proven boolean default false,p_safe_error_code text default null,p_result_reference jsonb default null,p_actual_cost_micros bigint default null,p_runtime_ms bigint default 0,p_provider_operation_ref text default null) returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; safe_code text; fingerprint text; final_state public.compute_job_state; pol public.compute_spend_policies;
begin
 safe_code:=public.compute_safe_error(p_safe_error_code);
 fingerprint:=encode(digest(jsonb_build_array(p_outcome,p_provider_nonexecution_proven,safe_code,public.compute_creator_result(p_result_reference),p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref)::text,'sha256'),'hex');
 select * into j from public.compute_jobs where id=p_job_id for update; if not found then raise exception 'RECOVERY_AUTHORITY_MISMATCH'; end if;
 if p_outcome='succeeded' and j.workload in ('image','trainer') then raise exception 'WORKLOAD_FINALIZATION_REQUIRED'; end if;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or a.recovery_token is distinct from p_recovery_token then raise exception 'RECOVERY_AUTHORITY_MISMATCH'; end if;
 if a.recovery_fingerprint is not null then
  if a.recovery_fingerprint=fingerprint then return a.recovery_state; end if;
  raise exception 'RECOVERY_REPLAY_CONFLICT';
 end if;
 if j.state<>'recovering' or a.finished_at is not null or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'RECOVERY_AUTHORITY_MISMATCH'; end if;
 if p_outcome='requeue' then
  if not p_provider_nonexecution_proven or p_actual_cost_micros is not null then raise exception 'PROVIDER_NONEXECUTION_EVIDENCE_REQUIRED'; end if;
  perform public.release_compute_reservation(a.id);
  if j.cancellation_requested_at is not null then final_state:='cancelled';
  elsif j.retry_count+1<j.max_attempts then final_state:='queued';
  else final_state:='failed'; end if;
  update public.compute_jobs set state=final_state,retry_count=case when cancellation_requested_at is null then retry_count+1 else retry_count end,
   available_at=case when final_state='queued' then now() else available_at end,terminal_at=case when final_state in ('failed','cancelled') then now() else terminal_at end,
   safe_error_code=case when final_state='failed' then 'RETRY_LIMIT_REACHED' else safe_error_code end,updated_at=now() where id=j.id;
  update public.compute_job_attempts set finished_at=now(),outcome_class=case when final_state='cancelled' then 'cancelled_provider_nonexecution_proven' else 'provider_nonexecution_proven' end,
   recovery_fingerprint=fingerprint,recovery_state=final_state,recovery_lease_token=null,recovery_worker_ref=null,recovery_heartbeat_at=null,recovery_lease_expires_at=null where id=a.id;
 elsif p_outcome in ('succeeded','failed','cancelled') then
  if p_actual_cost_micros is null or p_actual_cost_micros<0 or p_runtime_ms<0 or a.provider_dispatch_intent_at is null then raise exception 'RECOVERY_EXECUTION_EVIDENCE_REQUIRED'; end if;
  if p_provider_operation_ref is not null then
   if length(p_provider_operation_ref) not between 1 and 500 then raise exception 'INVALID_OPERATION_REFERENCE'; end if;
   if a.provider_operation_ref is not null and a.provider_operation_ref<>p_provider_operation_ref then raise exception 'PROVIDER_OPERATION_CONFLICT'; end if;
   update public.compute_job_attempts set provider_operation_ref=coalesce(provider_operation_ref,p_provider_operation_ref),provider_dispatched_at=coalesce(provider_dispatched_at,now()) where id=a.id returning * into a;
  end if;
  if a.actual_cost_micros is not null and (a.actual_cost_micros<>p_actual_cost_micros or a.runtime_ms<>p_runtime_ms) then raise exception 'ACTUAL_COST_CONFLICT'; end if;
  if a.actual_cost_micros is null then
   select * into pol from public.compute_spend_policies where id=a.spend_policy_id for update; if not found then raise exception 'SPEND_POLICY_NOT_FOUND'; end if;
   perform public.release_compute_reservation(a.id);
   insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(j.id,a.id,'actual',p_actual_cost_micros);
   update public.compute_job_attempts set actual_cost_micros=p_actual_cost_micros,runtime_ms=p_runtime_ms where id=a.id returning * into a;
   perform public.emit_compute_spend_thresholds(a.spend_policy_id);
  end if;
  final_state:=p_outcome::public.compute_job_state;
  update public.compute_jobs set state=final_state,terminal_at=now(),result_reference=case when p_outcome='succeeded' then public.compute_creator_result(p_result_reference) else result_reference end,
   safe_error_code=case when p_outcome='failed' then safe_code else safe_error_code end,updated_at=now() where id=j.id;
  update public.compute_job_attempts set finished_at=now(),outcome_class='reconciled_'||p_outcome,safe_error_code=case when p_outcome='failed' then safe_code else safe_error_code end,
   recovery_fingerprint=fingerprint,recovery_state=final_state,recovery_lease_token=null,recovery_worker_ref=null,recovery_heartbeat_at=null,recovery_lease_expires_at=null where id=a.id;
 else raise exception 'INVALID_RECOVERY_OUTCOME'; end if;
 return final_state;
end$$;

create function public.finalize_durable_image_product(p_job public.compute_jobs,p_attempt public.compute_job_attempts,p_assets jsonb,p_runtime_ms bigint)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare output_count integer; expected_prefix text; normalized jsonb; generation_data jsonb; fingerprint text; product jsonb; canonical public.generations;
begin
 if jsonb_typeof(p_job.request_payload->'output_count')<>'number' or p_job.request_payload->>'output_count' !~ '^[1-4]$' then raise exception 'IMAGE_OUTPUT_COUNT_INVALID'; end if;
 if jsonb_typeof(p_job.request_payload->'prompt')<>'string' or jsonb_typeof(p_job.request_payload->'body_presentation')<>'string'
   or jsonb_typeof(p_job.request_payload->'steps')<>'number' or p_job.request_payload->>'steps' !~ '^[0-9]+$'
   or jsonb_typeof(p_job.request_payload->'cfg')<>'number' or p_job.request_payload->>'cfg' !~ '^[0-9]+([.][0-9]+)?$'
   or jsonb_typeof(p_job.request_payload->'seed')<>'number' or p_job.request_payload->>'seed' !~ '^[0-9]+$'
   or jsonb_typeof(p_job.request_payload->'width')<>'number' or p_job.request_payload->>'width' !~ '^[0-9]+$'
   or jsonb_typeof(p_job.request_payload->'height')<>'number' or p_job.request_payload->>'height' !~ '^[0-9]+$'
   or (p_job.request_payload ? 'negative_prompt' and jsonb_typeof(p_job.request_payload->'negative_prompt') not in ('string','null'))
   or (p_job.request_payload ? 'identity_id' and jsonb_typeof(p_job.request_payload->'identity_id') not in ('string','null')) then raise exception 'IMAGE_REQUEST_METADATA_INVALID'; end if;
 output_count:=(p_job.request_payload->>'output_count')::integer;
 if jsonb_typeof(p_assets)<>'array' or jsonb_array_length(p_assets)<>output_count then raise exception 'IMAGE_OUTPUT_COUNT_MISMATCH'; end if;
 if exists(select 1 from jsonb_array_elements(p_assets) e where jsonb_typeof(e)<>'object' or e ?| array['owner_id','kind','storage_class']
   or jsonb_typeof(e->'ordinal')<>'number' or e->>'ordinal' !~ '^[0-3]$' or e->>'bucket' is null or e->>'object_key' is null or e->>'mime_type' not in ('image/jpeg','image/png','image/webp')
   or jsonb_typeof(e->'size_bytes')<>'number' or e->>'size_bytes' !~ '^[1-9][0-9]*$' or e->>'sha256' !~ '^[0-9a-f]{64}$') then raise exception 'IMAGE_ASSET_EVIDENCE_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(p_assets) e group by (e->>'ordinal') having count(*)<>1)
   or exists(select 1 from generate_series(0,output_count-1) n where not exists(select 1 from jsonb_array_elements(p_assets) e where (e->>'ordinal')::integer=n))
   or exists(select 1 from jsonb_array_elements(p_assets) e where (e->>'ordinal')::integer>=output_count) then raise exception 'IMAGE_OUTPUT_ORDINALS_INVALID'; end if;
 expected_prefix:='creator-generations/'||p_job.id::text||'/';
 if exists(select 1 from jsonb_array_elements(p_assets) e where left(e->>'object_key',length(expected_prefix))<>expected_prefix or length(e->>'object_key')<=length(expected_prefix)) then raise exception 'IMAGE_OBJECT_NAMESPACE_INVALID'; end if;
 select jsonb_agg(jsonb_build_object('owner_id',p_job.owner_id,'ordinal',(e->>'ordinal')::integer,'kind','image','storage_class','creator_generation',
   'bucket',e->>'bucket','object_key',e->>'object_key','mime_type',e->>'mime_type','size_bytes',(e->>'size_bytes')::bigint,'sha256',e->>'sha256') order by (e->>'ordinal')::integer)
 into normalized from jsonb_array_elements(p_assets) e;
 generation_data:=jsonb_build_object('prompt',p_job.request_payload->>'prompt','negative_prompt',p_job.request_payload->>'negative_prompt',
   'lora_used',p_job.request_payload->>'identity_id','body_type',p_job.request_payload->>'body_presentation','steps',p_job.request_payload->'steps',
   'cfg_scale',p_job.request_payload->'cfg','seed',p_job.request_payload->'seed','width',p_job.request_payload->'width','height',p_job.request_payload->'height',
   'processing_time_ms',p_runtime_ms,'metadata',jsonb_build_object('private_creator_media',true,'policy_version',1,'output_count',output_count));
 fingerprint:=encode(digest(jsonb_build_array(p_job.id,generation_data,normalized)::text,'sha256'),'hex');
 if p_attempt.internal_telemetry->>'workload_finalization_fingerprint' is not null and p_attempt.internal_telemetry->>'workload_finalization_fingerprint'<>fingerprint then raise exception 'IMAGE_FINALIZATION_REPLAY_CONFLICT'; end if;
 product:=public.finalize_private_generation(p_job.id,p_job.owner_id,generation_data,normalized);
 select * into canonical from public.generations where id=p_job.id for update;
 if not found or row(canonical.user_id,canonical.prompt,canonical.negative_prompt,canonical.lora_used,canonical.job_type,canonical.body_type,canonical.mode,canonical.status,
   canonical.image_url,canonical.steps,canonical.cfg_scale,canonical.seed,canonical.width,canonical.height,canonical.processing_time_ms,canonical.metadata,
   canonical.r2_bucket,canonical.r2_key,canonical.runpod_job_id)
   is distinct from row(p_job.owner_id,generation_data->>'prompt',generation_data->>'negative_prompt',nullif(generation_data->>'lora_used',''),'image',generation_data->>'body_type','txt2img','completed',
   null,(generation_data->>'steps')::integer,(generation_data->>'cfg_scale')::numeric,(generation_data->>'seed')::bigint,(generation_data->>'width')::integer,
   (generation_data->>'height')::integer,(generation_data->>'processing_time_ms')::integer,generation_data->'metadata',null::text,null::text,null::text) then
  raise exception 'DURABLE_IMAGE_GENERATION_CONFLICT';
 end if;
 update public.compute_job_attempts set internal_telemetry=jsonb_set(internal_telemetry,'{workload_finalization_fingerprint}',to_jsonb(fingerprint)) where id=p_attempt.id;
 return product;
end$$;

create function public.finalize_image_compute_job(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_assets jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; product jsonb;
begin
 select * into j from public.compute_jobs where id=p_job_id for update; if not found or j.workload<>'image' then raise exception 'IMAGE_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id for update;
 if not found or a.lease_token<>p_lease_token or a.ordinal<>j.attempt_count then raise exception 'IMAGE_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if j.state='succeeded' then
  if a.finished_at is null or a.outcome_class<>'succeeded' or a.internal_telemetry->>'workload_finalization_fingerprint' is null then raise exception 'IMAGE_FINALIZATION_AUTHORITY_MISMATCH'; end if;
  product:=public.finalize_durable_image_product(j,a,p_assets,a.runtime_ms); if j.result_reference=product then return product; end if; raise exception 'IMAGE_FINALIZATION_REPLAY_CONFLICT';
 end if;
 if j.state not in ('running','cancel_requested') or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() then raise exception 'IMAGE_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if a.provider_dispatch_intent_at is null or a.provider_dispatched_at is null or a.provider_operation_ref is null then raise exception 'IMAGE_EXECUTION_EVIDENCE_REQUIRED'; end if;
 if a.actual_cost_micros is null or a.runtime_ms is null then raise exception 'ACTUAL_COST_REQUIRED'; end if;
 product:=public.finalize_durable_image_product(j,a,p_assets,a.runtime_ms);
 update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=public.compute_creator_result(product),lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
 update public.compute_job_attempts set finished_at=now(),outcome_class='succeeded' where id=a.id;
 return product;
end$$;

create function public.finalize_recovered_image_compute_job(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid,p_assets jsonb,p_actual_cost_micros bigint,p_runtime_ms bigint,p_provider_operation_ref text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; pol public.compute_spend_policies; product jsonb; fingerprint text;
begin
 select * into j from public.compute_jobs where id=p_job_id for update; if not found or j.workload<>'image' then raise exception 'IMAGE_RECOVERY_AUTHORITY_MISMATCH'; end if;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id for update;
 if not found or a.recovery_token is distinct from p_recovery_token then raise exception 'IMAGE_RECOVERY_AUTHORITY_MISMATCH'; end if;
 if a.recovery_fingerprint is not null then
  product:=public.finalize_durable_image_product(j,a,p_assets,p_runtime_ms);
  fingerprint:=encode(digest(jsonb_build_array('succeeded',false,null,public.compute_creator_result(product),p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref)::text,'sha256'),'hex');
  if j.state='succeeded' and a.recovery_fingerprint=fingerprint and j.result_reference=product then return product; end if; raise exception 'IMAGE_FINALIZATION_REPLAY_CONFLICT';
 end if;
 if j.state<>'recovering' or a.finished_at is not null or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'IMAGE_RECOVERY_AUTHORITY_MISMATCH'; end if;
 if p_actual_cost_micros is null or p_actual_cost_micros<0 or p_runtime_ms<0 or a.provider_dispatch_intent_at is null then raise exception 'RECOVERY_EXECUTION_EVIDENCE_REQUIRED'; end if;
 if p_provider_operation_ref is not null then
  if length(p_provider_operation_ref) not between 1 and 500 then raise exception 'INVALID_OPERATION_REFERENCE'; end if;
  if a.provider_operation_ref is not null and a.provider_operation_ref<>p_provider_operation_ref then raise exception 'PROVIDER_OPERATION_CONFLICT'; end if;
  update public.compute_job_attempts set provider_operation_ref=coalesce(provider_operation_ref,p_provider_operation_ref),provider_dispatched_at=coalesce(provider_dispatched_at,now()) where id=a.id returning * into a;
 end if;
 if a.actual_cost_micros is not null and (a.actual_cost_micros<>p_actual_cost_micros or a.runtime_ms<>p_runtime_ms) then raise exception 'ACTUAL_COST_CONFLICT'; end if;
 if a.actual_cost_micros is null then
  select * into pol from public.compute_spend_policies where id=a.spend_policy_id for update; if not found then raise exception 'SPEND_POLICY_NOT_FOUND'; end if;
  perform public.release_compute_reservation(a.id); insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(j.id,a.id,'actual',p_actual_cost_micros);
  update public.compute_job_attempts set actual_cost_micros=p_actual_cost_micros,runtime_ms=p_runtime_ms where id=a.id returning * into a; perform public.emit_compute_spend_thresholds(a.spend_policy_id);
 end if;
 product:=public.finalize_durable_image_product(j,a,p_assets,p_runtime_ms);
 fingerprint:=encode(digest(jsonb_build_array('succeeded',false,null,public.compute_creator_result(product),p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref)::text,'sha256'),'hex');
 update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=public.compute_creator_result(product),updated_at=now() where id=j.id;
 update public.compute_job_attempts set finished_at=now(),outcome_class='reconciled_succeeded',recovery_fingerprint=fingerprint,recovery_state='succeeded',recovery_lease_token=null,recovery_worker_ref=null,recovery_heartbeat_at=null,recovery_lease_expires_at=null where id=a.id;
 return product;
end$$;

create function public.finalize_trainer_compute_job(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_artifact_r2_bucket text,p_artifact_r2_key text)
returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; l public.user_loras; lora_id uuid; token text; fingerprint text; result jsonb;
begin
 select * into j from public.compute_jobs where id=p_job_id for update; if not found or j.workload<>'trainer' or j.request_payload->>'identity_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then raise exception 'TRAINER_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id for update; if not found or a.lease_token<>p_lease_token or a.ordinal<>j.attempt_count then raise exception 'TRAINER_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 lora_id:=(j.request_payload->>'identity_id')::uuid; select * into l from public.user_loras where id=lora_id for update;
 if not found or l.user_id<>j.owner_id or l.training_job_id is distinct from j.id::text then raise exception 'TRAINER_TARGET_BINDING_MISMATCH'; end if;
 if p_artifact_r2_bucket is null or p_artifact_r2_bucket<>btrim(p_artifact_r2_bucket) or length(p_artifact_r2_bucket) not between 3 and 63 or p_artifact_r2_key is distinct from 'loras/'||lora_id::text||'/final.safetensors' then raise exception 'TRAINER_ARTIFACT_REFERENCE_INVALID'; end if;
 token:='sf'||lower(substr(replace(lora_id::text,'-',''),1,8)); result:=jsonb_build_object('result_id',lora_id); fingerprint:=encode(digest(jsonb_build_array(p_artifact_r2_bucket,p_artifact_r2_key,result)::text,'sha256'),'hex');
 if a.internal_telemetry->>'workload_finalization_fingerprint' is not null and a.internal_telemetry->>'workload_finalization_fingerprint'<>fingerprint then raise exception 'TRAINER_FINALIZATION_REPLAY_CONFLICT'; end if;
 if j.state='succeeded' then
  if a.finished_at is null or a.outcome_class<>'succeeded' or a.internal_telemetry->>'workload_finalization_fingerprint' is null then raise exception 'TRAINER_FINALIZATION_AUTHORITY_MISMATCH'; end if;
  if j.result_reference=result and l.status='completed' and l.progress=100 and l.artifact_r2_bucket=p_artifact_r2_bucket and l.artifact_r2_key=p_artifact_r2_key and l.trigger_token=token then return j.state; end if; raise exception 'TRAINER_FINALIZATION_REPLAY_CONFLICT';
 end if;
 if j.state not in ('running','cancel_requested') or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() then raise exception 'TRAINER_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if a.provider_dispatch_intent_at is null or a.provider_dispatched_at is null or a.provider_operation_ref is null then raise exception 'TRAINER_EXECUTION_EVIDENCE_REQUIRED'; end if; if a.actual_cost_micros is null then raise exception 'ACTUAL_COST_REQUIRED'; end if;
 update public.user_loras set status='completed',progress=100,artifact_r2_bucket=p_artifact_r2_bucket,artifact_r2_key=p_artifact_r2_key,trigger_token=token,started_at=coalesce(a.started_at,j.started_at),completed_at=clock_timestamp(),updated_at=clock_timestamp(),error_message=null where id=l.id;
 update public.compute_job_attempts set internal_telemetry=jsonb_set(internal_telemetry,'{workload_finalization_fingerprint}',to_jsonb(fingerprint)),finished_at=now(),outcome_class='succeeded' where id=a.id;
 update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=result,lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id; return 'succeeded';
end$$;

create function public.finalize_recovered_trainer_compute_job(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid,p_artifact_r2_bucket text,p_artifact_r2_key text,p_actual_cost_micros bigint,p_runtime_ms bigint,p_provider_operation_ref text default null)
returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; l public.user_loras; pol public.compute_spend_policies; lora_id uuid; token text; artifact_fingerprint text; recovery_fp text; result jsonb;
begin
 select * into j from public.compute_jobs where id=p_job_id for update; if not found or j.workload<>'trainer' or j.request_payload->>'identity_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then raise exception 'TRAINER_RECOVERY_AUTHORITY_MISMATCH'; end if;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id for update; if not found or a.recovery_token is distinct from p_recovery_token then raise exception 'TRAINER_RECOVERY_AUTHORITY_MISMATCH'; end if;
 lora_id:=(j.request_payload->>'identity_id')::uuid; select * into l from public.user_loras where id=lora_id for update; if not found or l.user_id<>j.owner_id or l.training_job_id is distinct from j.id::text then raise exception 'TRAINER_TARGET_BINDING_MISMATCH'; end if;
 if p_artifact_r2_bucket is null or p_artifact_r2_bucket<>btrim(p_artifact_r2_bucket) or length(p_artifact_r2_bucket) not between 3 and 63 or p_artifact_r2_key is distinct from 'loras/'||lora_id::text||'/final.safetensors' then raise exception 'TRAINER_ARTIFACT_REFERENCE_INVALID'; end if;
 token:='sf'||lower(substr(replace(lora_id::text,'-',''),1,8)); result:=jsonb_build_object('result_id',lora_id); artifact_fingerprint:=encode(digest(jsonb_build_array(p_artifact_r2_bucket,p_artifact_r2_key,result)::text,'sha256'),'hex'); recovery_fp:=encode(digest(jsonb_build_array('succeeded',false,null,result,p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref)::text,'sha256'),'hex');
 if a.recovery_fingerprint is not null then if j.state='succeeded' and a.recovery_fingerprint=recovery_fp and a.internal_telemetry->>'workload_finalization_fingerprint'=artifact_fingerprint and j.result_reference=result and l.status='completed' and l.progress=100 and l.artifact_r2_bucket=p_artifact_r2_bucket and l.artifact_r2_key=p_artifact_r2_key and l.trigger_token=token and l.training_job_id=j.id::text and l.user_id=j.owner_id then return j.state; end if; raise exception 'TRAINER_FINALIZATION_REPLAY_CONFLICT'; end if;
 if j.state<>'recovering' or a.finished_at is not null or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'TRAINER_RECOVERY_AUTHORITY_MISMATCH'; end if;
 if p_actual_cost_micros is null or p_actual_cost_micros<0 or p_runtime_ms<0 or a.provider_dispatch_intent_at is null then raise exception 'RECOVERY_EXECUTION_EVIDENCE_REQUIRED'; end if;
 if p_provider_operation_ref is not null then if length(p_provider_operation_ref) not between 1 and 500 then raise exception 'INVALID_OPERATION_REFERENCE'; end if; if a.provider_operation_ref is not null and a.provider_operation_ref<>p_provider_operation_ref then raise exception 'PROVIDER_OPERATION_CONFLICT'; end if; update public.compute_job_attempts set provider_operation_ref=coalesce(provider_operation_ref,p_provider_operation_ref),provider_dispatched_at=coalesce(provider_dispatched_at,now()) where id=a.id returning * into a; end if;
 if a.actual_cost_micros is not null and (a.actual_cost_micros<>p_actual_cost_micros or a.runtime_ms<>p_runtime_ms) then raise exception 'ACTUAL_COST_CONFLICT'; end if;
 if a.actual_cost_micros is null then select * into pol from public.compute_spend_policies where id=a.spend_policy_id for update; if not found then raise exception 'SPEND_POLICY_NOT_FOUND'; end if; perform public.release_compute_reservation(a.id); insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(j.id,a.id,'actual',p_actual_cost_micros); update public.compute_job_attempts set actual_cost_micros=p_actual_cost_micros,runtime_ms=p_runtime_ms where id=a.id returning * into a; perform public.emit_compute_spend_thresholds(a.spend_policy_id); end if;
 update public.user_loras set status='completed',progress=100,artifact_r2_bucket=p_artifact_r2_bucket,artifact_r2_key=p_artifact_r2_key,trigger_token=token,started_at=coalesce(a.started_at,j.started_at),completed_at=clock_timestamp(),updated_at=clock_timestamp(),error_message=null where id=l.id;
 update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=result,updated_at=now() where id=j.id;
 update public.compute_job_attempts set internal_telemetry=jsonb_set(internal_telemetry,'{workload_finalization_fingerprint}',to_jsonb(artifact_fingerprint)),finished_at=now(),outcome_class='reconciled_succeeded',recovery_fingerprint=recovery_fp,recovery_state='succeeded',recovery_lease_token=null,recovery_worker_ref=null,recovery_heartbeat_at=null,recovery_lease_expires_at=null where id=a.id; return 'succeeded';
end$$;

revoke all on function public.project_trainer_compute_state(),public.finalize_durable_image_product(public.compute_jobs,public.compute_job_attempts,jsonb,bigint),
 public.finalize_image_compute_job(uuid,uuid,uuid,jsonb),public.finalize_recovered_image_compute_job(uuid,uuid,uuid,uuid,jsonb,bigint,bigint,text),
 public.finalize_trainer_compute_job(uuid,uuid,uuid,text,text),public.finalize_recovered_trainer_compute_job(uuid,uuid,uuid,uuid,text,text,bigint,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.finalize_image_compute_job(uuid,uuid,uuid,jsonb),public.finalize_recovered_image_compute_job(uuid,uuid,uuid,uuid,jsonb,bigint,bigint,text),
 public.finalize_trainer_compute_job(uuid,uuid,uuid,text,text),public.finalize_recovered_trainer_compute_job(uuid,uuid,uuid,uuid,text,text,bigint,bigint,text) to service_role;
commit;
