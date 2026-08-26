-- MANUAL EMERGENCY ROLLBACK ONLY. Requires separate human authorization.
-- Disable Pass 4A callers and verify no Image/Trainer finalization is in flight first.
begin;
drop trigger if exists project_trainer_compute_state on public.compute_jobs;
drop trigger if exists compute_workload_success_guard on public.compute_jobs;
drop function if exists public.finalize_recovered_trainer_compute_job(uuid,uuid,uuid,uuid,text,text,bigint,bigint,text);
drop function if exists public.finalize_trainer_compute_job(uuid,uuid,uuid,text,text);
drop function if exists public.finalize_recovered_image_compute_job(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,bigint,bigint,text);
drop function if exists public.finalize_image_compute_job(uuid,uuid,uuid,uuid,jsonb,jsonb);
drop function if exists public.project_trainer_compute_state();
drop function if exists public.compute_workload_success_guard();

create or replace function public.submit_trainer_compute_job(p_owner_id uuid,p_lora_id uuid,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text,p_dataset_r2_bucket text,p_dataset_r2_prefix text)
returns table(job_id uuid, workload public.compute_workload, creator_status text, queued_at timestamptz, started_at timestamptz, completed_at timestamptz, result_reference jsonb, safe_error_code text, can_cancel boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; policy public.compute_scheduler_policies;
begin
 if p_lora_id is null or length(p_idempotency_key) not between 1 and 128 or p_request_fingerprint!~'^[0-9a-f]{64}$' or p_dataset_r2_bucket is null or p_dataset_r2_prefix is null then raise exception 'INVALID_TRAINER_SUBMISSION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':trainer:'||p_idempotency_key,0));
 select * into j from public.compute_jobs x where x.owner_id=p_owner_id and x.workload='trainer' and x.idempotency_key=p_idempotency_key;
 if found then
  if j.request_fingerprint<>p_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 else
  perform 1 from public.user_loras where id=p_lora_id and user_id=p_owner_id for update; if not found then raise exception 'TRAINER_TARGET_NOT_OWNED'; end if;
  select * into policy from public.compute_scheduler_policies p where p.workload='trainer' and p.enabled; if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
  insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts) values(p_owner_id,'trainer',p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class,policy.max_attempts) returning * into j;
  update public.user_loras set training_job_id=j.id::text,status='queued',dataset_r2_bucket=p_dataset_r2_bucket,dataset_r2_prefix=p_dataset_r2_prefix,updated_at=now() where id=p_lora_id and user_id=p_owner_id;
  if not found then raise exception 'TRAINER_PROJECTION_FAILED'; end if;
 end if;
 return query select j.id,j.workload,case j.state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else j.state::text end,j.queued_at,j.started_at,j.terminal_at,public.compute_creator_result(j.result_reference),j.safe_error_code,j.state not in ('succeeded','failed','cancelled');
end$$;

revoke all on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) to service_role;
commit;
