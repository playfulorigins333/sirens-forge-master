-- Manual emergency rollback for 20260827050727 only. Do not run without separate authorization.
begin;
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


revoke execute on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text) to service_role;

revoke all privileges on table public.dataset_doctor_jobs, public.dataset_doctor_images, public.dataset_doctor_selections, public.user_loras from public, anon, authenticated;
do $policies$
declare r record;
begin
 for r in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('dataset_doctor_jobs','dataset_doctor_images','dataset_doctor_selections','user_loras')
 loop execute format('drop policy %I on %I.%I',r.policyname,r.schemaname,r.tablename); end loop;
end $policies$;

grant select, insert, update, delete on table public.dataset_doctor_jobs, public.dataset_doctor_images, public.dataset_doctor_selections to anon, authenticated;
grant select, insert, update on table public.user_loras to anon, authenticated;

create policy "Users can delete own dataset doctor jobs" on public.dataset_doctor_jobs for delete to public using (auth.uid() = user_id);
create policy "Users can insert own dataset doctor jobs" on public.dataset_doctor_jobs for insert to public with check (auth.uid() = user_id);
create policy "Users can update own dataset doctor jobs" on public.dataset_doctor_jobs for update to public using (auth.uid() = user_id);
create policy "Users can view own dataset doctor jobs" on public.dataset_doctor_jobs for select to public using (auth.uid() = user_id);
create policy "Users can delete own dataset doctor images" on public.dataset_doctor_images for delete to public using (auth.uid() = user_id);
create policy "Users can insert own dataset doctor images" on public.dataset_doctor_images for insert to public with check (auth.uid() = user_id);
create policy "Users can update own dataset doctor images" on public.dataset_doctor_images for update to public using (auth.uid() = user_id);
create policy "Users can view own dataset doctor images" on public.dataset_doctor_images for select to public using (auth.uid() = user_id);
create policy "Users can delete own dataset doctor selections" on public.dataset_doctor_selections for delete to public using (auth.uid() = user_id);
create policy "Users can insert own dataset doctor selections" on public.dataset_doctor_selections for insert to public with check (auth.uid() = user_id);
create policy "Users can update own dataset doctor selections" on public.dataset_doctor_selections for update to public using (auth.uid() = user_id);
create policy "Users can view own dataset doctor selections" on public.dataset_doctor_selections for select to public using (auth.uid() = user_id);
create policy "Users can create own loras" on public.user_loras for insert to public with check (auth.uid() = user_id);
create policy "Users can update own loras" on public.user_loras for update to public using (auth.uid() = user_id);
create policy "Users can view own loras" on public.user_loras for select to public using (auth.uid() = user_id);
create policy "Users can view their own completed loras" on public.user_loras for select to public using (auth.uid() = user_id and status = 'completed'::public.lora_status);
commit;
