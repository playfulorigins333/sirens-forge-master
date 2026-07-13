-- Task 17A: OnlyFans assisted operator queue database foundation.
-- Forward-only migration. Do not apply to remote Supabase during Task 17A review.
-- Claim lifetime is database-controlled and bounded at 30 minutes.

alter table public.creator_publishing_queue_tasks drop constraint if exists creator_publishing_queue_tasks_status_check;
alter table public.creator_publishing_queue_tasks
  add constraint creator_publishing_queue_tasks_status_check check (status in ('draft','needs_compliance_review','needs_creator_approval','ready_for_handoff','scheduled_internally','awaiting_operator','due_now','claimed','confirmed_posted_manual','skipped','failed_manual_upload','needs_fix','blocked','archived'));

alter table public.creator_publishing_queue_tasks
  add column if not exists claim_token uuid,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists claim_attempt_count integer not null default 0,
  add column if not exists operator_progress_state text not null default 'not_started',
  add column if not exists operator_progress_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists operator_progress_updated_at timestamptz,
  add column if not exists operator_progress_revision integer not null default 0;

alter table public.creator_publishing_queue_tasks
  add constraint creator_publishing_queue_claim_fields_consistent check (
    (status = 'claimed' and claimed_by is not null and claimed_at is not null and claim_token is not null and claim_expires_at is not null and claim_expires_at > claimed_at)
    or (status <> 'claimed' and claim_token is null and claim_expires_at is null)
  ),
  add constraint creator_publishing_queue_claim_attempt_count_nonnegative check (claim_attempt_count >= 0),
  add constraint creator_publishing_queue_operator_progress_state_check check (operator_progress_state in ('not_started','preparing','prepared','handoff_ready')),
  add constraint creator_publishing_queue_operator_progress_revision_nonnegative check (operator_progress_revision >= 0);

create index if not exists creator_publishing_queue_tasks_operator_claim_idx on public.creator_publishing_queue_tasks(content_package_id, target_platform, platform_account_id, status, claim_expires_at) where status <> 'archived';

create table if not exists public.creator_publishing_operator_authorizations (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  operator_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform = 'onlyfans'),
  status text not null default 'active' check (status in ('active','revoked')),
  authorized_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_operator_authorizations_distinct check (creator_id <> operator_id),
  constraint creator_publishing_operator_authorizations_revoked_at check ((status='active' and revoked_at is null) or (status='revoked' and revoked_at is not null))
);
create unique index if not exists creator_publishing_operator_authorizations_one_active_idx on public.creator_publishing_operator_authorizations(creator_id, operator_id, platform) where status='active';
alter table public.creator_publishing_operator_authorizations enable row level security;
revoke all on table public.creator_publishing_operator_authorizations from public, anon, authenticated;
grant all on table public.creator_publishing_operator_authorizations to service_role;

drop trigger if exists trg_creator_publishing_operator_authorizations_updated_at on public.creator_publishing_operator_authorizations;
create trigger trg_creator_publishing_operator_authorizations_updated_at before update on public.creator_publishing_operator_authorizations for each row execute function public.set_updated_at();

create table if not exists public.creator_publishing_operator_action_idempotency (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  queue_task_id uuid not null references public.creator_publishing_queue_tasks(id) on delete cascade,
  platform_job_id uuid not null references public.creator_publishing_platform_jobs(id) on delete cascade,
  action_type text not null check (action_type in ('claim','release','progress_update','expired_claim_recovery')),
  request_fingerprint text not null,
  idempotency_key text not null,
  stored_result jsonb not null,
  created_at timestamptz not null default now(),
  constraint creator_publishing_operator_action_idempotency_key check (length(btrim(idempotency_key)) between 8 and 200),
  constraint creator_publishing_operator_action_idempotency_fingerprint check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint creator_publishing_operator_action_idempotency_unique unique (actor_id, action_type, idempotency_key)
);
alter table public.creator_publishing_operator_action_idempotency enable row level security;
revoke all on table public.creator_publishing_operator_action_idempotency from public, anon, authenticated;
grant all on table public.creator_publishing_operator_action_idempotency to service_role;

create or replace function public.creator_publishing_onlyfans_operator_authorized(p_creator_id uuid, p_operator_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select p_creator_id = p_operator_id or exists (
    select 1 from public.creator_publishing_operator_authorizations a
    where a.creator_id=p_creator_id and a.operator_id=p_operator_id and a.platform='onlyfans' and a.status='active' and a.revoked_at is null
  );
$$;

create or replace function public.creator_publishing_onlyfans_queue_status_from_schedule(p_job public.creator_publishing_platform_jobs)
returns text language sql stable set search_path = public, pg_catalog as $$
  select case
    when p_job.job_state in ('skipped','blocked','archived','confirmed_posted_manual','failed_manual_upload') then p_job.job_state
    when p_job.schedule_revision is null then 'ready_for_handoff'
    when p_job.intended_publish_at <= now() then 'due_now'
    when p_job.operator_due_at is not null and p_job.operator_due_at <= now() then 'awaiting_operator'
    else 'scheduled_internally' end;
$$;

create or replace function public.creator_publishing_onlyfans_operator_request_fingerprint(p_action text, p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_claim_token uuid default null, p_progress_state text default null)
returns text language sql immutable set search_path = public, extensions, pg_catalog as $$
  select encode(extensions.digest(jsonb_build_object('action',p_action,'actor_id',p_actor_id,'queue_task_id',p_queue_task_id,'platform_job_id',p_platform_job_id,'claim_token',p_claim_token,'progress_state',p_progress_state)::text,'sha256'),'hex');
$$;

create or replace function public.creator_publishing_claim_onlyfans_operator_task(p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_task public.creator_publishing_queue_tasks%rowtype; v_job public.creator_publishing_platform_jobs%rowtype; v_now timestamptz:=clock_timestamp(); v_fp text; v_existing public.creator_publishing_operator_action_idempotency%rowtype; v_token uuid; v_result jsonb; v_prior_status text; v_recovered boolean:=false; v_count integer;
begin
  if p_actor_id is null or p_queue_task_id is null or p_platform_job_id is null or length(btrim(coalesce(p_idempotency_key,''))) < 8 then raise exception 'OPERATOR_INVALID_REQUEST'; end if;
  v_fp := public.creator_publishing_onlyfans_operator_request_fingerprint('claim',p_actor_id,p_queue_task_id,p_platform_job_id,null,null);
  perform pg_advisory_xact_lock(hashtextextended('creator_operator_idempotency:'||p_actor_id||':claim:'||p_idempotency_key,0));
  select * into v_existing from public.creator_publishing_operator_action_idempotency where actor_id=p_actor_id and action_type='claim' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_fingerprint<>v_fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.stored_result; end if;
  select * into v_task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  select * into v_job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update; if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;
  select count(*) into v_count from public.creator_publishing_queue_tasks where content_package_id=v_job.content_package_id and target_platform='onlyfans' and status <> 'archived';
  if v_count<>1 or v_task.creator_id<>v_job.creator_id or v_task.content_package_id<>v_job.content_package_id or v_task.platform_account_id<>v_job.platform_account_id or v_task.target_platform<>'onlyfans' or v_job.target_platform<>'onlyfans' then raise exception 'OPERATOR_TASK_IDENTITY_AMBIGUOUS'; end if;
  if v_job.publishing_mode<>'assisted' then raise exception 'OPERATOR_ASSISTED_REQUIRED'; end if;
  if not public.creator_publishing_onlyfans_operator_authorized(v_job.creator_id,p_actor_id) then raise exception 'OPERATOR_NOT_AUTHORIZED'; end if;
  if v_task.status='claimed' and v_task.claim_expires_at <= v_now then
    v_prior_status:=v_task.status; v_recovered:=true;
    update public.creator_publishing_queue_tasks set status=public.creator_publishing_onlyfans_queue_status_from_schedule(v_job), claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null, updated_at=v_now where id=v_task.id returning * into v_task;
    insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator','creator_publishing_operator_claim_recovered',jsonb_build_object('status',v_prior_status),jsonb_build_object('status',v_task.status,'platform_job_id',v_job.id),p_idempotency_key,v_now);
  elsif v_task.status='claimed' and v_task.claim_expires_at > v_now and v_task.claimed_by<>p_actor_id then raise exception 'OPERATOR_TASK_ALREADY_CLAIMED';
  end if;
  if v_job.schedule_revision is null then if v_task.status<>'ready_for_handoff' or v_job.operator_due_at is not null then raise exception 'OPERATOR_TASK_NOT_READY'; end if;
  elsif v_job.operator_due_at is null or v_job.operator_due_at > v_now then raise exception 'OPERATOR_NOT_DUE'; end if;
  v_token:=gen_random_uuid(); v_prior_status:=v_task.status;
  update public.creator_publishing_queue_tasks set status='claimed', claimed_by=p_actor_id, claimed_at=v_now, claim_token=v_token, claim_expires_at=v_now+interval '30 minutes', claim_attempt_count=claim_attempt_count+1, updated_at=v_now where id=v_task.id returning * into v_task;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator','creator_publishing_operator_task_claimed',jsonb_build_object('status',v_prior_status),jsonb_build_object('status','claimed','platform_job_id',v_job.id,'claim_expires_at',v_task.claim_expires_at,'request_fingerprint',v_fp),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'status','claimed','queue_task_id',v_task.id,'platform_job_id',v_job.id,'claim_token',v_token,'claim_expires_at',v_task.claim_expires_at,'expired_claim_recovered',v_recovered);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,request_fingerprint,idempotency_key,stored_result,created_at) values(p_actor_id,v_job.creator_id,v_task.id,v_job.id,'claim',v_fp,p_idempotency_key,v_result,v_now);
  return v_result;
end; $$;

create or replace function public.creator_publishing_release_onlyfans_operator_task(p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_claim_token uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_task public.creator_publishing_queue_tasks%rowtype; v_job public.creator_publishing_platform_jobs%rowtype; v_now timestamptz:=clock_timestamp(); v_fp text; v_existing public.creator_publishing_operator_action_idempotency%rowtype; v_status text; v_result jsonb;
begin
  v_fp:=public.creator_publishing_onlyfans_operator_request_fingerprint('release',p_actor_id,p_queue_task_id,p_platform_job_id,p_claim_token,null);
  perform pg_advisory_xact_lock(hashtextextended('creator_operator_idempotency:'||p_actor_id||':release:'||p_idempotency_key,0));
  select * into v_existing from public.creator_publishing_operator_action_idempotency where actor_id=p_actor_id and action_type='release' and idempotency_key=p_idempotency_key; if found then if v_existing.request_fingerprint<>v_fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.stored_result; end if;
  select * into v_task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; select * into v_job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update;
  if not found or v_task.id is null or v_job.id is null then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  if v_task.claimed_by<>p_actor_id or v_task.claim_token<>p_claim_token or v_task.status<>'claimed' then raise exception 'OPERATOR_CLAIM_TOKEN_MISMATCH'; end if;
  if not public.creator_publishing_onlyfans_operator_authorized(v_job.creator_id,p_actor_id) then raise exception 'OPERATOR_NOT_AUTHORIZED'; end if;
  v_status:=public.creator_publishing_onlyfans_queue_status_from_schedule(v_job);
  update public.creator_publishing_queue_tasks set status=v_status, claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null, updated_at=v_now where id=v_task.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator','creator_publishing_operator_task_released',jsonb_build_object('status','claimed'),jsonb_build_object('status',v_status,'platform_job_id',v_job.id),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'status',v_status,'queue_task_id',v_task.id,'platform_job_id',v_job.id);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,request_fingerprint,idempotency_key,stored_result,created_at) values(p_actor_id,v_job.creator_id,v_task.id,v_job.id,'release',v_fp,p_idempotency_key,v_result,v_now);
  return v_result;
end; $$;

create or replace function public.creator_publishing_update_onlyfans_operator_progress(p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_claim_token uuid, p_expected_progress_state text, p_next_progress_state text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_task public.creator_publishing_queue_tasks%rowtype; v_job public.creator_publishing_platform_jobs%rowtype; v_now timestamptz:=clock_timestamp(); v_fp text; v_existing public.creator_publishing_operator_action_idempotency%rowtype; v_action text; v_result jsonb;
begin
  if (p_expected_progress_state,p_next_progress_state) not in (('not_started','preparing'),('preparing','prepared'),('prepared','handoff_ready')) then raise exception 'OPERATOR_PROGRESS_INVALID_TRANSITION'; end if;
  v_fp:=public.creator_publishing_onlyfans_operator_request_fingerprint('progress_update',p_actor_id,p_queue_task_id,p_platform_job_id,p_claim_token,p_next_progress_state);
  perform pg_advisory_xact_lock(hashtextextended('creator_operator_idempotency:'||p_actor_id||':progress_update:'||p_idempotency_key,0));
  select * into v_existing from public.creator_publishing_operator_action_idempotency where actor_id=p_actor_id and action_type='progress_update' and idempotency_key=p_idempotency_key; if found then if v_existing.request_fingerprint<>v_fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.stored_result; end if;
  select * into v_task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; select * into v_job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update;
  if v_task.status<>'claimed' or v_task.claimed_by<>p_actor_id or v_task.claim_token<>p_claim_token or v_task.claim_expires_at<=v_now then raise exception 'OPERATOR_ACTIVE_CLAIM_REQUIRED'; end if;
  if v_task.operator_progress_state<>p_expected_progress_state then raise exception 'OPERATOR_PROGRESS_STALE'; end if;
  if not public.creator_publishing_onlyfans_operator_authorized(v_job.creator_id,p_actor_id) then raise exception 'OPERATOR_NOT_AUTHORIZED'; end if;
  update public.creator_publishing_queue_tasks set operator_progress_state=p_next_progress_state, operator_progress_updated_by=p_actor_id, operator_progress_updated_at=v_now, operator_progress_revision=operator_progress_revision+1, updated_at=v_now where id=v_task.id;
  v_action:=case p_next_progress_state when 'preparing' then 'creator_publishing_operator_preparation_started' when 'prepared' then 'creator_publishing_operator_package_prepared' else 'creator_publishing_operator_handoff_ready' end;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator',v_action,jsonb_build_object('progress_state',p_expected_progress_state),jsonb_build_object('progress_state',p_next_progress_state,'platform_job_id',v_job.id),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'progress_state',p_next_progress_state,'queue_task_id',v_task.id,'platform_job_id',v_job.id);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,request_fingerprint,idempotency_key,stored_result,created_at) values(p_actor_id,v_job.creator_id,v_task.id,v_job.id,'progress_update',v_fp,p_idempotency_key,v_result,v_now);
  return v_result;
end; $$;

create or replace function public.creator_publishing_recover_expired_onlyfans_operator_claim(p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_task public.creator_publishing_queue_tasks%rowtype; v_job public.creator_publishing_platform_jobs%rowtype; v_now timestamptz:=clock_timestamp(); v_fp text; v_existing public.creator_publishing_operator_action_idempotency%rowtype; v_status text; v_result jsonb;
begin
  v_fp:=public.creator_publishing_onlyfans_operator_request_fingerprint('expired_claim_recovery',p_actor_id,p_queue_task_id,p_platform_job_id,null,null);
  perform pg_advisory_xact_lock(hashtextextended('creator_operator_idempotency:'||p_actor_id||':expired_claim_recovery:'||p_idempotency_key,0));
  select * into v_existing from public.creator_publishing_operator_action_idempotency where actor_id=p_actor_id and action_type='expired_claim_recovery' and idempotency_key=p_idempotency_key; if found then if v_existing.request_fingerprint<>v_fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.stored_result; end if;
  select * into v_task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; select * into v_job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update;
  if v_task.status<>'claimed' or v_task.claim_expires_at>v_now then raise exception 'OPERATOR_CLAIM_NOT_EXPIRED'; end if;
  if not public.creator_publishing_onlyfans_operator_authorized(v_job.creator_id,p_actor_id) then raise exception 'OPERATOR_NOT_AUTHORIZED'; end if;
  if v_job.job_state in ('skipped','blocked','archived','confirmed_posted_manual','failed_manual_upload') then raise exception 'OPERATOR_TERMINAL_TASK'; end if;
  v_status:=public.creator_publishing_onlyfans_queue_status_from_schedule(v_job);
  update public.creator_publishing_queue_tasks set status=v_status, claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null, updated_at=v_now where id=v_task.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator','creator_publishing_operator_claim_recovered',jsonb_build_object('status','claimed'),jsonb_build_object('status',v_status,'platform_job_id',v_job.id),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'status',v_status,'queue_task_id',v_task.id,'platform_job_id',v_job.id);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,request_fingerprint,idempotency_key,stored_result,created_at) values(p_actor_id,v_job.creator_id,v_task.id,v_job.id,'expired_claim_recovery',v_fp,p_idempotency_key,v_result,v_now);
  return v_result;
end; $$;

revoke all on function public.creator_publishing_onlyfans_operator_authorized(uuid,uuid) from public, anon, authenticated;
revoke all on function public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_release_onlyfans_operator_task(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_update_onlyfans_operator_progress(uuid,uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_recover_expired_onlyfans_operator_claim(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text) to service_role;
grant execute on function public.creator_publishing_release_onlyfans_operator_task(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.creator_publishing_update_onlyfans_operator_progress(uuid,uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.creator_publishing_recover_expired_onlyfans_operator_claim(uuid,uuid,uuid,text) to service_role;

-- Narrow Task 15 compatibility: migration 01400 intentionally does not alter scheduling math.
-- It introduces the active claim fields that Task 15 queue-task gates can recognize as the only valid active Task 17 claim ownership shape.
