-- Emergency rollback for unapplied/empty Pass 4C-A only. Execution requires separate authorization.
begin;
do $$ begin
 if to_regclass('public.video_projects') is not null and exists(select 1 from public.video_projects) then raise exception 'PASS4C_ROLLBACK_REFUSED_VIDEO_PROJECT_DATA'; end if;
 if exists(select 1 from public.generations g join public.generation_assets a on a.generation_id=g.id join public.private_storage_objects o on o.id=a.storage_object_id where g.metadata->>'video_project_id' is not null and a.kind='video' and o.mime_type='video/mp4') then raise exception 'PASS4C_ROLLBACK_REFUSED_CANONICAL_DATA'; end if;
end$$;
drop trigger if exists propagate_video_project_terminal_state on public.compute_jobs;
drop function if exists public.propagate_video_project_terminal_state(),public.creator_video_project_status(uuid,uuid),public.cancel_video_project(uuid,uuid),public.finalize_recovered_stitch_compute_job(uuid,uuid,uuid,uuid,jsonb,bigint,bigint,text),public.finalize_stitch_compute_job(uuid,uuid,uuid,jsonb),public.finalize_recovered_video_compute_job(uuid,uuid,uuid,uuid,jsonb,bigint,bigint,text),public.finalize_video_compute_job(uuid,uuid,uuid,jsonb),public.finalize_stitch_product(public.compute_jobs,public.compute_job_attempts,jsonb,bigint),public.settle_recovered_video_attempt(public.compute_jobs,public.compute_job_attempts,bigint,bigint,text),public.finalize_video_segments(public.compute_jobs,public.compute_job_attempts,jsonb),public.recovered_stitch_compute_manifest(uuid,uuid,uuid,uuid),public.stitch_compute_manifest(uuid,uuid,uuid),public.recovered_video_compute_manifest(uuid,uuid,uuid,uuid),public.video_compute_manifest(uuid,uuid,uuid),public.submit_video_project_compute_jobs(uuid,uuid,uuid,text,text,jsonb,text);
drop function if exists public.video_project_creator_projection(public.video_projects); drop table if exists public.video_project_segments; drop table if exists public.video_projects; drop function if exists public.video_project_segment_consistent();
alter table public.private_storage_objects drop constraint private_storage_objects_mime_type_check;
alter table public.private_storage_objects drop constraint private_storage_objects_size_bytes_check;
alter table public.private_storage_objects add constraint private_storage_objects_mime_type_check check(mime_type in ('image/jpeg','image/png','image/webp'));
alter table public.private_storage_objects add constraint private_storage_objects_size_bytes_check check(size_bytes>0 and size_bytes<=52428800);
create or replace function public.finalize_private_generation(
  p_generation_id uuid,
  p_owner_id uuid,
  p_generation jsonb,
  p_assets jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_asset jsonb;
  v_existing public.private_storage_objects%rowtype;
  v_object_id uuid;
  v_asset_ids jsonb := '[]'::jsonb;
  v_count integer;
  v_generation public.generations%rowtype;
begin
  if p_generation_id is null or p_owner_id is null or jsonb_typeof(p_generation) <> 'object' or jsonb_typeof(p_assets) <> 'array' then
    raise exception 'PRIVATE_GENERATION_ARGUMENT_INVALID';
  end if;
  v_count := jsonb_array_length(p_assets);
  if v_count < 1 or v_count > 4 then raise exception 'PRIVATE_GENERATION_ASSET_COUNT_INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(p_assets) a group by (a->>'ordinal') having count(*) > 1) then
    raise exception 'PRIVATE_GENERATION_DUPLICATE_ORDINAL';
  end if;

  select * into v_generation from public.generations where id = p_generation_id for update;
  if found and v_generation.user_id <> p_owner_id then raise exception 'PRIVATE_GENERATION_OWNER_MISMATCH'; end if;
  if not found then
    insert into public.generations(id,user_id,prompt,image_url,lora_used,job_type,body_type,mode,status,negative_prompt,steps,cfg_scale,seed,width,height,runpod_job_id,processing_time_ms,completed_at,metadata,r2_bucket,r2_key,updated_at)
    values (p_generation_id,p_owner_id,p_generation->>'prompt',null,nullif(p_generation->>'lora_used',''),'image',p_generation->>'body_type','txt2img','completed',p_generation->>'negative_prompt',(p_generation->>'steps')::integer,(p_generation->>'cfg_scale')::numeric,(p_generation->>'seed')::bigint,(p_generation->>'width')::integer,(p_generation->>'height')::integer,nullif(p_generation->>'upstream_generation_id',''),(p_generation->>'processing_time_ms')::integer,clock_timestamp(),coalesce(p_generation->'metadata','{}'::jsonb),null,null,clock_timestamp());
  elsif v_generation.status <> 'completed' or v_generation.image_url is not null then
    raise exception 'PRIVATE_GENERATION_STATE_CONFLICT';
  end if;

  for v_asset in select value from jsonb_array_elements(p_assets) loop
    if (v_asset->>'ordinal')::integer not between 0 and 3 or v_asset->>'kind' <> 'image'
       or v_asset->>'owner_id' <> p_owner_id::text or coalesce(v_asset->>'storage_class','') <> 'creator_generation'
       or coalesce(v_asset->>'bucket','') = '' or coalesce(v_asset->>'object_key','') = '' then
      raise exception 'PRIVATE_GENERATION_ASSET_INVALID';
    end if;
    select * into v_existing from public.private_storage_objects where bucket=v_asset->>'bucket' and object_key=v_asset->>'object_key' for update;
    if found then
      if v_existing.owner_id <> p_owner_id or v_existing.mime_type <> v_asset->>'mime_type' or v_existing.size_bytes <> (v_asset->>'size_bytes')::bigint or v_existing.sha256 <> v_asset->>'sha256' then
        raise exception 'PRIVATE_STORAGE_OBJECT_CONFLICT';
      end if;
      v_object_id := v_existing.id;
    else
      insert into public.private_storage_objects(owner_id,storage_class,bucket,object_key,mime_type,size_bytes,sha256,source_reference)
      values(p_owner_id,'creator_generation',v_asset->>'bucket',v_asset->>'object_key',v_asset->>'mime_type',(v_asset->>'size_bytes')::bigint,v_asset->>'sha256',jsonb_build_object('generation_id',p_generation_id,'ordinal',(v_asset->>'ordinal')::integer)) returning id into v_object_id;
    end if;
    insert into public.generation_assets(generation_id,storage_object_id,owner_id,ordinal,kind)
    values(p_generation_id,v_object_id,p_owner_id,(v_asset->>'ordinal')::smallint,'image')
    on conflict (generation_id, ordinal) do nothing;
    if not exists(select 1 from public.generation_assets where generation_id=p_generation_id and ordinal=(v_asset->>'ordinal')::smallint and storage_object_id=v_object_id and owner_id=p_owner_id and kind='image') then
      raise exception 'PRIVATE_GENERATION_ASSET_CONFLICT';
    end if;
    v_asset_ids := v_asset_ids || jsonb_build_array((select id from public.generation_assets where generation_id=p_generation_id and ordinal=(v_asset->>'ordinal')::smallint));
  end loop;
  if (select count(*) from public.generation_assets where generation_id=p_generation_id) <> v_count then raise exception 'PRIVATE_GENERATION_ASSET_SET_CONFLICT'; end if;
  return jsonb_build_object('generation_id',p_generation_id,'asset_ids',v_asset_ids);
end;
$$;

create or replace function public.submit_compute_job(p_owner_id uuid,p_workload public.compute_workload,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text)
returns table(job_id uuid, workload public.compute_workload, creator_status text, queued_at timestamptz, started_at timestamptz, completed_at timestamptz, result_reference jsonb, safe_error_code text, can_cancel boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; policy public.compute_scheduler_policies;
begin
 if p_owner_id is null or length(p_idempotency_key) not between 1 and 128 or p_request_fingerprint!~'^[0-9a-f]{64}$' or jsonb_typeof(p_request_payload)<>'object' or p_priority_class not in ('og','standard') then raise exception 'INVALID_COMPUTE_SUBMISSION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_workload::text||':'||p_idempotency_key,0));
 select * into j from public.compute_jobs x where x.owner_id=p_owner_id and x.workload=p_workload and x.idempotency_key=p_idempotency_key;
 if found then if j.request_fingerprint<>p_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; else
  select * into policy from public.compute_scheduler_policies p where p.workload=p_workload and p.enabled;
  if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
  insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts)
  values(p_owner_id,p_workload,p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class,policy.max_attempts) returning * into j;
 end if;
 return query select j.id,j.workload,case when j.state='recovering' and j.cancellation_requested_at is not null then 'cancelling' else case j.state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else j.state::text end end,j.queued_at,j.started_at,j.terminal_at,public.compute_creator_result(j.result_reference),j.safe_error_code,j.state not in ('succeeded','failed','cancelled');
end$$;


create or replace function public.claim_compute_job(p_workload public.compute_workload,p_worker_ref text)
returns table(job_id uuid,attempt_id uuid,lease_token uuid,request_payload jsonb) language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.compute_scheduler_policies; j public.compute_jobs; a public.compute_job_attempts; active_count int;
begin
 if length(p_worker_ref) not between 1 and 200 then raise exception 'INVALID_WORKER'; end if;
 select * into p from public.compute_scheduler_policies where workload=p_workload and enabled for update; if not found then return; end if;
 select count(*) into active_count from public.compute_jobs where workload=p_workload and state in ('claimed','running','recovering','cancel_requested'); if active_count>=p.max_global_active then return; end if;
 select * into j from public.compute_jobs q where q.workload=p_workload and q.state='queued' and q.available_at<=now() and q.retry_count<q.max_attempts
 and (q.workload='stitch' or not exists(select 1 from public.compute_jobs x where x.owner_id=q.owner_id and x.workload=q.workload and x.state in ('claimed','running','recovering','cancel_requested')))
 order by q.queued_at-(case when q.workload in ('trainer','image','video') and q.priority_class='og' then p.og_priority_seconds else 0 end)*interval '1 second',q.queued_at,q.id for update skip locked limit 1;
 if not found then return; end if;
 update public.compute_jobs set state='claimed',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=now()+p.lease_seconds*interval '1 second',internal_hold_code=null,updated_at=now() where id=j.id returning * into j;
 insert into public.compute_job_attempts(job_id,ordinal,lease_token,worker_ref,lease_expires_at) values(j.id,j.attempt_count,j.lease_token,p_worker_ref,j.lease_expires_at) returning * into a;
 return query select j.id,a.id,j.lease_token,j.request_payload;
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


commit;
