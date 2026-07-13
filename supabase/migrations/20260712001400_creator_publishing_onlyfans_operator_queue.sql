-- Task 17A: OnlyFans operator queue database foundation and Task 15 compatibility.
-- Forward-only. Does not deploy, call platforms, automate browsers, or store platform credentials.
create extension if not exists pgcrypto with schema extensions;

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
  add constraint creator_publishing_queue_claim_all_or_none check ((status='claimed' and claimed_by is not null and claimed_at is not null and claim_token is not null and claim_expires_at is not null) or (status<>'claimed' and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null)),
  add constraint creator_publishing_queue_claim_lifetime check (claim_expires_at is null or (claim_expires_at > claimed_at and claim_expires_at <= claimed_at + interval '30 minutes')),
  add constraint creator_publishing_queue_claim_attempt_nonnegative check (claim_attempt_count >= 0),
  add constraint creator_publishing_queue_operator_progress_revision_nonnegative check (operator_progress_revision >= 0),
  add constraint creator_publishing_queue_operator_progress_state_check check (operator_progress_state in ('not_started','preparing','prepared','handoff_ready'));

create index if not exists creator_publishing_queue_claim_idx on public.creator_publishing_queue_tasks(status, claim_expires_at, claimed_by) where status='claimed';
create index if not exists creator_publishing_queue_task_active_match_idx on public.creator_publishing_queue_tasks(content_package_id, creator_id, target_platform, platform_account_id) where status not in ('archived','skipped','failed_manual_upload','confirmed_posted_manual');

create table if not exists public.creator_publishing_operator_authorizations (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users(id) on delete cascade,
  operator_id uuid not null references auth.users(id) on delete cascade, platform text not null default 'onlyfans',
  status text not null default 'active', authorized_at timestamptz not null default now(), revoked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint creator_publishing_operator_authorizations_onlyfans check (platform='onlyfans'),
  constraint creator_publishing_operator_authorizations_status_check check (status in ('active','revoked')),
  constraint creator_publishing_operator_authorizations_distinct check (creator_id <> operator_id),
  constraint creator_publishing_operator_authorizations_revocation_consistent check ((status='active' and revoked_at is null) or (status='revoked' and revoked_at is not null and revoked_at >= authorized_at))
);
create unique index if not exists creator_publishing_operator_authorizations_one_active_uidx on public.creator_publishing_operator_authorizations(creator_id, operator_id, platform) where status='active';
alter table public.creator_publishing_operator_authorizations enable row level security;
revoke all on table public.creator_publishing_operator_authorizations from public, anon, authenticated;
grant select, insert, update, delete on table public.creator_publishing_operator_authorizations to service_role;

drop trigger if exists trg_creator_publishing_operator_authorizations_updated_at on public.creator_publishing_operator_authorizations;
create trigger trg_creator_publishing_operator_authorizations_updated_at before update on public.creator_publishing_operator_authorizations for each row execute function public.set_updated_at();

create table if not exists public.creator_publishing_operator_action_idempotency (
  actor_id uuid not null references auth.users(id) on delete cascade, creator_id uuid not null references auth.users(id) on delete cascade,
  queue_task_id uuid not null references public.creator_publishing_queue_tasks(id) on delete cascade,
  platform_job_id uuid not null references public.creator_publishing_platform_jobs(id) on delete cascade,
  action_type text not null check (action_type in ('claim','release','progress_update','expired_claim_recovery')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'), stored_result jsonb not null,
  created_at timestamptz not null default now(),
  constraint creator_publishing_operator_action_idempotency_pk primary key (actor_id, action_type, idempotency_key)
);
alter table public.creator_publishing_operator_action_idempotency enable row level security;
revoke all on table public.creator_publishing_operator_action_idempotency from public, anon, authenticated;
grant select, insert, update, delete on table public.creator_publishing_operator_action_idempotency to service_role;

create or replace function public.creator_publishing_operator_validate_idempotency_key(p_key text) returns void language plpgsql immutable set search_path=public,pg_temp as $$
begin if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'OPERATOR_IDEMPOTENCY_KEY_INVALID'; end if; end; $$;

create or replace function public.creator_publishing_operator_is_authorized(p_creator_id uuid,p_operator_id uuid,p_platform text) returns boolean language sql stable set search_path=public,pg_temp as $$
  select p_creator_id=p_operator_id or exists (select 1 from public.creator_publishing_operator_authorizations a where a.creator_id=p_creator_id and a.operator_id=p_operator_id and a.platform='onlyfans' and p_platform='onlyfans' and a.status='active' and a.revoked_at is null);
$$;

create or replace function public.creator_publishing_operator_restore_queue_status(p_job public.creator_publishing_platform_jobs,p_now timestamptz) returns text language plpgsql stable set search_path=public,pg_temp as $$
begin
 if p_job.job_state not in ('draft','scheduled_internally','awaiting_operator','due_now') or p_job.cancelled_at is not null then return null; end if;
 if p_job.schedule_revision is null then return 'ready_for_handoff'; end if;
 if p_job.operator_due_at is not null and p_now < p_job.operator_due_at then return 'scheduled_internally'; end if;
 if p_job.intended_publish_at is not null and p_now >= p_job.intended_publish_at then return 'due_now'; end if;
 return 'awaiting_operator';
end; $$;

create or replace function public.creator_publishing_operator_request_fingerprint(p jsonb) returns text language sql immutable set search_path=public,pg_temp as $$ select encode(extensions.digest(p::text,'sha256'),'hex') $$;

create or replace function public.creator_publishing_operator_replay_or_conflict(p_actor uuid,p_action text,p_key text,p_fingerprint text) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare r record; begin perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_operator_idempotency:'||p_actor::text||':'||p_action||':'||p_key,0)); select * into r from public.creator_publishing_operator_action_idempotency where actor_id=p_actor and action_type=p_action and idempotency_key=p_key for update; if found then if r.request_fingerprint<>p_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return r.stored_result || jsonb_build_object('idempotent',true); end if; return null; end; $$;

create or replace function public.creator_publishing_claim_onlyfans_operator_task(p_actor_id uuid,p_queue_task_id uuid,p_platform_job_id uuid,p_expected_ai_twin_consent_version text,p_expected_attestation_text_sha256 text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; fp text; replay jsonb; token uuid:=gen_random_uuid(); result jsonb; restore text;
begin
 if p_actor_id is null or p_queue_task_id is null or p_platform_job_id is null then raise exception 'OPERATOR_REQUEST_INVALID'; end if; perform public.creator_publishing_operator_validate_idempotency_key(p_idempotency_key);
 fp:=public.creator_publishing_operator_request_fingerprint(jsonb_build_object('actor',p_actor_id,'task',p_queue_task_id,'job',p_platform_job_id,'consent',p_expected_ai_twin_consent_version,'hash',p_expected_attestation_text_sha256)); replay:=public.creator_publishing_operator_replay_or_conflict(p_actor_id,'claim',p_idempotency_key,fp); if replay is not null then return replay; end if;
 select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update; if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;
 select * into task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
 if job.id<>p_platform_job_id or task.content_package_id<>job.content_package_id or task.creator_id<>job.creator_id or task.platform_account_id<>job.platform_account_id or task.target_platform<>job.target_platform then raise exception 'OPERATOR_TASK_JOB_MISMATCH'; end if;
 if task.target_platform <> 'onlyfans' or job.publishing_mode <> 'assisted' then raise exception 'OPERATOR_TARGET_NOT_SUPPORTED'; end if;
 if not public.creator_publishing_operator_is_authorized(job.creator_id,p_actor_id,'onlyfans') then raise exception 'OPERATOR_NOT_AUTHORIZED'; end if;
 if (select count(*) from public.creator_publishing_queue_tasks q where q.content_package_id=job.content_package_id and q.creator_id=job.creator_id and q.target_platform='onlyfans' and q.platform_account_id=job.platform_account_id and q.status not in ('archived','skipped','failed_manual_upload','confirmed_posted_manual'))<>1 then raise exception 'OPERATOR_QUEUE_TASK_AMBIGUOUS'; end if;
 if task.status='claimed' and task.claim_expires_at <= v_now then restore:=public.creator_publishing_operator_restore_queue_status(job,v_now); if restore is null then raise exception 'OPERATOR_TASK_INELIGIBLE'; end if; update public.creator_publishing_queue_tasks set status=restore, claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null where id=task.id returning * into task; insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',task.id,p_actor_id,'operator','operator_expired_claim_recovered',jsonb_build_object('status','claimed','claimed_by',task.claimed_by,'claim_expires_at',task.claim_expires_at),jsonb_build_object('queue_task_id',task.id,'platform_job_id',job.id,'status',restore),p_idempotency_key,v_now); end if;
 if task.status='claimed' then raise exception 'OPERATOR_TASK_ALREADY_CLAIMED'; end if;
 if job.cancelled_at is not null or job.job_state not in ('draft','scheduled_internally','awaiting_operator','due_now') then raise exception 'OPERATOR_TASK_INELIGIBLE'; end if;
 if job.schedule_revision is null then if task.status<>'ready_for_handoff' or job.operator_due_at is not null then raise exception 'OPERATOR_TASK_INELIGIBLE'; end if; else if job.operator_due_at is null or v_now < job.operator_due_at then raise exception 'OPERATOR_NOT_DUE'; end if; if task.status not in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now') then raise exception 'OPERATOR_TASK_INELIGIBLE'; end if; end if;
 update public.creator_publishing_queue_tasks set status='claimed', claimed_by=p_actor_id, claimed_at=v_now, claim_token=token, claim_expires_at=v_now+interval '30 minutes', claim_attempt_count=claim_attempt_count+1 where id=task.id returning * into task;
 result:=jsonb_build_object('ok',true,'action','claim','queue_task_id',task.id,'platform_job_id',job.id,'creator_id',job.creator_id,'operator_id',p_actor_id,'claim_token',token,'claim_expires_at',task.claim_expires_at,'status',task.status);
 insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',task.id,p_actor_id,'operator','operator_task_claimed',jsonb_build_object('status','ready_for_handoff'),result - 'claim_token',p_idempotency_key,v_now);
 insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,idempotency_key,request_fingerprint,stored_result) values(p_actor_id,job.creator_id,task.id,job.id,'claim',p_idempotency_key,fp,result); return result;
end; $$;

create or replace function public.creator_publishing_release_onlyfans_operator_task(p_actor_id uuid,p_queue_task_id uuid,p_platform_job_id uuid,p_claim_token uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; fp text; replay jsonb; restore text; result jsonb;
begin perform public.creator_publishing_operator_validate_idempotency_key(p_idempotency_key); if p_actor_id is null or p_queue_task_id is null or p_platform_job_id is null or p_claim_token is null then raise exception 'OPERATOR_REQUEST_INVALID'; end if; fp:=public.creator_publishing_operator_request_fingerprint(jsonb_build_object('actor',p_actor_id,'task',p_queue_task_id,'job',p_platform_job_id,'token',p_claim_token)); replay:=public.creator_publishing_operator_replay_or_conflict(p_actor_id,'release',p_idempotency_key,fp); if replay is not null then return replay; end if; select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update; select * into task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; if not found or task.content_package_id<>job.content_package_id or task.creator_id<>job.creator_id or task.platform_account_id<>job.platform_account_id or task.target_platform<>job.target_platform or task.target_platform<>'onlyfans' or job.publishing_mode<>'assisted' or job.cancelled_at is not null or job.job_state not in ('draft','scheduled_internally','awaiting_operator','due_now') then raise exception 'OPERATOR_TASK_JOB_MISMATCH'; end if; if not public.creator_publishing_operator_is_authorized(job.creator_id,p_actor_id,'onlyfans') then raise exception 'OPERATOR_NOT_AUTHORIZED'; end if; if task.status<>'claimed' or task.claimed_by<>p_actor_id or task.claim_token<>p_claim_token then raise exception 'OPERATOR_CLAIM_TOKEN_MISMATCH'; end if; restore:=public.creator_publishing_operator_restore_queue_status(job,v_now); if restore is null then raise exception 'OPERATOR_TASK_INELIGIBLE'; end if; update public.creator_publishing_queue_tasks set status=restore, claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null where id=task.id returning * into task; result:=jsonb_build_object('ok',true,'action','release','queue_task_id',task.id,'platform_job_id',job.id,'status',task.status); insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',task.id,p_actor_id,'operator','operator_task_released',jsonb_build_object('status','claimed','claimed_by',p_actor_id),result,p_idempotency_key,v_now); insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,idempotency_key,request_fingerprint,stored_result,created_at) values(p_actor_id,job.creator_id,task.id,job.id,'release',p_idempotency_key,fp,result,v_now); return result; end; $$;

create or replace function public.creator_publishing_update_onlyfans_operator_progress(p_actor_id uuid,p_queue_task_id uuid,p_platform_job_id uuid,p_claim_token uuid,p_expected_progress_state text,p_expected_progress_revision integer,p_next_progress_state text,p_expected_ai_twin_consent_version text,p_expected_attestation_text_sha256 text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; fp text; replay jsonb; result jsonb; action text;
begin perform public.creator_publishing_operator_validate_idempotency_key(p_idempotency_key); fp:=public.creator_publishing_operator_request_fingerprint(jsonb_build_object('actor',p_actor_id,'task',p_queue_task_id,'job',p_platform_job_id,'token',p_claim_token,'expected_state',p_expected_progress_state,'expected_revision',p_expected_progress_revision,'next',p_next_progress_state,'consent',p_expected_ai_twin_consent_version,'hash',p_expected_attestation_text_sha256)); replay:=public.creator_publishing_operator_replay_or_conflict(p_actor_id,'progress_update',p_idempotency_key,fp); if replay is not null then return replay; end if; select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update; select * into task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; if task.status<>'claimed' or task.claimed_by<>p_actor_id or task.claim_token<>p_claim_token or task.claim_expires_at<=v_now then raise exception 'OPERATOR_CLAIM_TOKEN_MISMATCH'; end if; if not public.creator_publishing_operator_is_authorized(job.creator_id,p_actor_id,'onlyfans') then raise exception 'OPERATOR_NOT_AUTHORIZED'; end if; if task.operator_progress_state<>p_expected_progress_state or task.operator_progress_revision<>p_expected_progress_revision then raise exception 'OPERATOR_PROGRESS_STALE'; end if; if not ((p_expected_progress_state='not_started' and p_next_progress_state='preparing') or (p_expected_progress_state='preparing' and p_next_progress_state='prepared') or (p_expected_progress_state='prepared' and p_next_progress_state='handoff_ready')) then raise exception 'OPERATOR_PROGRESS_INVALID_TRANSITION'; end if; update public.creator_publishing_queue_tasks set operator_progress_state=p_next_progress_state, operator_progress_updated_by=p_actor_id, operator_progress_updated_at=v_now, operator_progress_revision=operator_progress_revision+1 where id=task.id returning * into task; action:=case p_next_progress_state when 'preparing' then 'operator_preparation_started' when 'prepared' then 'operator_package_prepared' else 'operator_handoff_ready' end; result:=jsonb_build_object('ok',true,'action','progress_update','queue_task_id',task.id,'platform_job_id',job.id,'progress_state',task.operator_progress_state,'progress_revision',task.operator_progress_revision); insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',task.id,p_actor_id,'operator',action,jsonb_build_object('progress_state',p_expected_progress_state,'progress_revision',p_expected_progress_revision),result,p_idempotency_key,v_now); insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,idempotency_key,request_fingerprint,stored_result,created_at) values(p_actor_id,job.creator_id,task.id,job.id,'progress_update',p_idempotency_key,fp,result,v_now); return result; end; $$;

create or replace function public.creator_publishing_recover_expired_onlyfans_operator_claim(p_actor_id uuid,p_queue_task_id uuid,p_platform_job_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); job public.creator_publishing_platform_jobs%rowtype; task public.creator_publishing_queue_tasks%rowtype; fp text; replay jsonb; restore text; result jsonb;
begin perform public.creator_publishing_operator_validate_idempotency_key(p_idempotency_key); fp:=public.creator_publishing_operator_request_fingerprint(jsonb_build_object('actor',p_actor_id,'task',p_queue_task_id,'job',p_platform_job_id)); replay:=public.creator_publishing_operator_replay_or_conflict(p_actor_id,'expired_claim_recovery',p_idempotency_key,fp); if replay is not null then return replay; end if; select * into job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update; select * into task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; if task.content_package_id<>job.content_package_id or task.creator_id<>job.creator_id or task.platform_account_id<>job.platform_account_id or task.target_platform<>job.target_platform or task.target_platform<>'onlyfans' or job.publishing_mode<>'assisted' or job.cancelled_at is not null or job.job_state not in ('draft','scheduled_internally','awaiting_operator','due_now') then raise exception 'OPERATOR_TASK_JOB_MISMATCH'; end if; if not public.creator_publishing_operator_is_authorized(job.creator_id,p_actor_id,'onlyfans') then raise exception 'OPERATOR_NOT_AUTHORIZED'; end if; if task.status<>'claimed' or task.claim_expires_at>v_now then raise exception 'OPERATOR_CLAIM_NOT_EXPIRED'; end if; restore:=public.creator_publishing_operator_restore_queue_status(job,v_now); if restore is null then raise exception 'OPERATOR_TASK_INELIGIBLE'; end if; update public.creator_publishing_queue_tasks set status=restore, claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null where id=task.id returning * into task; result:=jsonb_build_object('ok',true,'action','expired_claim_recovery','queue_task_id',task.id,'platform_job_id',job.id,'status',task.status); insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',task.id,p_actor_id,'operator','operator_expired_claim_recovered',jsonb_build_object('status','claimed','claim_expires_at',task.claim_expires_at),result,p_idempotency_key,v_now); insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,idempotency_key,request_fingerprint,stored_result,created_at) values(p_actor_id,job.creator_id,task.id,job.id,'expired_claim_recovery',p_idempotency_key,fp,result,v_now); return result; end; $$;

revoke all on function public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_release_onlyfans_operator_task(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_update_onlyfans_operator_progress(uuid,uuid,uuid,uuid,text,integer,text,text,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_recover_expired_onlyfans_operator_claim(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.creator_publishing_release_onlyfans_operator_task(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.creator_publishing_update_onlyfans_operator_progress(uuid,uuid,uuid,uuid,text,integer,text,text,text,text) to service_role;
grant execute on function public.creator_publishing_recover_expired_onlyfans_operator_claim(uuid,uuid,uuid,text) to service_role;

-- Narrow Task 15 compatibility: direct CREATE OR REPLACE definitions derived from 01300.
create or replace function public.creator_publishing_schedule_plan(
  p_creator_id uuid,
  p_publishing_plan_id uuid,
  p_intended_publish_at timestamptz,
  p_schedule_timezone text,
  p_idempotency_key text,
  p_expected_ai_twin_consent_version text,
  p_expected_ai_twin_consent_text_sha256 text,
  p_target_job_ids uuid[] default null,
  p_expected_schedule_revisions jsonb default '{}'::jsonb,
  p_action_type text default 'schedule'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict error
declare
  plan_rec public.creator_publishing_plans%rowtype;
  job_rec public.creator_publishing_platform_jobs%rowtype;
  capability_rec public.creator_publishing_platform_capabilities%rowtype;
  idempotency_rec public.creator_publishing_scheduler_idempotency%rowtype;
  v_now timestamptz := clock_timestamp();
  v_target_job_ids uuid[];
  v_request jsonb;
  v_request_fingerprint text;
  v_result jsonb := jsonb_build_object('jobs','[]'::jsonb);
  v_jobs jsonb := '[]'::jsonb;
  v_expected_revision integer;
  v_new_revision integer;
  v_job_result jsonb;
  v_success_count integer := 0;
  v_failure_count integer := 0;
  v_action text := btrim(coalesce(p_action_type,''));
  v_operator_due_at timestamptz;
  v_queue_count integer;
  v_gate_code text;
begin
  if p_creator_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_action not in ('schedule','reschedule') then raise exception 'SCHEDULER_INVALID_ACTION'; end if;
  if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if p_intended_publish_at is null or p_intended_publish_at <= v_now then raise exception 'SCHEDULER_INVALID_INTENDED_PUBLISH_AT'; end if;
  if length(btrim(coalesce(p_schedule_timezone,''))) = 0 or not public.creator_publishing_scheduler_validate_timezone(p_schedule_timezone) then raise exception 'SCHEDULER_INVALID_TIMEZONE'; end if;
  if length(btrim(coalesce(p_expected_ai_twin_consent_version,''))) = 0 then raise exception 'SCHEDULER_INVALID_CONSENT_POLICY'; end if;
  if coalesce(p_expected_ai_twin_consent_text_sha256,'') !~ '^[a-f0-9]{64}$' then raise exception 'SCHEDULER_INVALID_CONSENT_POLICY'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_scheduler_idempotency:'||p_creator_id::text||':'||v_action||':'||p_idempotency_key,0));

  select array_agg(distinct target_source order by target_source) into v_target_job_ids
  from unnest(coalesce(p_target_job_ids,'{}'::uuid[])) as target_source;
  if v_target_job_ids is null or array_length(v_target_job_ids,1)=0 then raise exception 'SCHEDULER_TARGET_JOBS_REQUIRED'; end if;
  if array_length(v_target_job_ids,1) <> array_length(p_target_job_ids,1) then raise exception 'SCHEDULER_DUPLICATE_TARGET_JOB'; end if;

  v_request := jsonb_build_object(
    'creator_id',p_creator_id,'publishing_plan_id',p_publishing_plan_id,'action_type',v_action,
    'intended_publish_at',p_intended_publish_at,'schedule_timezone',p_schedule_timezone,
    'target_job_ids',(select jsonb_agg(job_id order by job_id) from unnest(v_target_job_ids) as job_id),
    'expected_schedule_revisions',coalesce(p_expected_schedule_revisions,'{}'::jsonb),
    'expected_ai_twin_consent_version',p_expected_ai_twin_consent_version,
    'expected_ai_twin_consent_text_sha256',p_expected_ai_twin_consent_text_sha256
  );
  v_request_fingerprint := encode(extensions.digest(v_request::text,'sha256'),'hex');

  select * into idempotency_rec from public.creator_publishing_scheduler_idempotency as idempotency_source
  where idempotency_source.creator_id=p_creator_id and idempotency_source.action_type=v_action and idempotency_source.idempotency_key=p_idempotency_key
  for update of idempotency_source;
  if found then
    if idempotency_rec.publishing_plan_id <> p_publishing_plan_id or idempotency_rec.request_fingerprint <> v_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return idempotency_rec.result || jsonb_build_object('idempotent', true);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_scheduler_plan:'||p_publishing_plan_id::text,0));

  select * into plan_rec from public.creator_publishing_plans as plan_source
  where plan_source.id=p_publishing_plan_id and plan_source.creator_id=p_creator_id for update of plan_source;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if plan_rec.status='cancelled' then raise exception 'PLAN_CANCELLED'; end if;

  if v_action='reschedule' then
    if jsonb_typeof(coalesce(p_expected_schedule_revisions,'{}'::jsonb)) <> 'object' then raise exception 'SCHEDULER_EXPECTED_REVISIONS_INVALID'; end if;
    if exists(select 1 from jsonb_object_keys(p_expected_schedule_revisions) as expected_key where expected_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'SCHEDULER_EXPECTED_REVISIONS_INVALID'; end if;
    if exists(select 1 from jsonb_object_keys(p_expected_schedule_revisions) as expected_key where expected_key::uuid <> all(v_target_job_ids)) then raise exception 'SCHEDULER_EXPECTED_REVISIONS_EXTRA'; end if;
    if exists(select 1 from unnest(v_target_job_ids) as target_job_id where not (p_expected_schedule_revisions ? target_job_id::text)) then raise exception 'SCHEDULER_EXPECTED_REVISIONS_MISSING'; end if;
  end if;

  perform 1 from public.creator_publishing_platform_jobs as job_source where job_source.id=any(v_target_job_ids) and job_source.publishing_plan_id=p_publishing_plan_id and job_source.creator_id=p_creator_id order by job_source.id for update of job_source;
  if (select count(*) from public.creator_publishing_platform_jobs where id=any(v_target_job_ids) and publishing_plan_id=p_publishing_plan_id and creator_id=p_creator_id) <> array_length(v_target_job_ids,1) then raise exception 'SCHEDULER_TARGET_JOB_NOT_FOUND'; end if;
  perform 1 from public.creator_publishing_scheduler_events as event_source where event_source.platform_job_id=any(v_target_job_ids) and event_source.status in ('pending','processing') order by event_source.id for update of event_source;
  perform 1 from public.creator_publishing_platform_capabilities as capability_source order by capability_source.platform for update of capability_source;
  perform 1 from public.creator_publishing_content_packages as package_source join public.creator_publishing_platform_jobs as job_source on job_source.content_package_id=package_source.id where job_source.id=any(v_target_job_ids) order by package_source.id for update of package_source;
  perform 1 from public.creator_platform_accounts as account_source join public.creator_publishing_platform_jobs as job_source on job_source.platform_account_id=account_source.id where job_source.id=any(v_target_job_ids) order by account_source.id for update of account_source;
  perform 1 from public.creator_publishing_creator_verifications as verification_source where verification_source.creator_id=p_creator_id order by verification_source.creator_id for update of verification_source;
  perform 1 from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=p_creator_id order by consent_source.creator_id for update of consent_source;
  perform 1 from public.creator_publishing_compliance_reviews as review_source join public.creator_publishing_platform_jobs as job_source on job_source.content_package_id=review_source.content_package_id where job_source.id=any(v_target_job_ids) order by review_source.content_package_id, review_source.created_at, review_source.id for update of review_source;
  perform 1 from public.creator_publishing_co_performer_records as performer_source join public.creator_publishing_platform_jobs as job_source on job_source.content_package_id=performer_source.content_package_id where job_source.id=any(v_target_job_ids) order by performer_source.content_package_id, performer_source.id for update of performer_source;
  perform 1 from public.creator_publishing_media_assets as media_source join public.creator_publishing_platform_jobs as job_source on job_source.content_package_id=media_source.content_package_id where job_source.id=any(v_target_job_ids) order by media_source.content_package_id, media_source.id for update of media_source;
  perform 1 from public.generations as generation_source where generation_source.id in (select (media_source.ai_generation_metadata->>'generation_id')::uuid from public.creator_publishing_media_assets as media_source join public.creator_publishing_platform_jobs as job_source on job_source.content_package_id=media_source.content_package_id where job_source.id=any(v_target_job_ids) and coalesce(media_source.ai_generation_metadata->>'generation_id','') ~* '^[0-9a-f-]{36}$') order by generation_source.id for update of generation_source;
  perform 1 from public.creator_publishing_queue_tasks as queue_source join public.creator_publishing_platform_jobs as job_source on job_source.content_package_id=queue_source.content_package_id and job_source.target_platform=queue_source.target_platform where job_source.id=any(v_target_job_ids) and queue_source.status not in ('archived','blocked','needs_fix','skipped','failed_manual_upload','confirmed_posted_manual') order by queue_source.id for update of queue_source;
  perform 1 from public.creator_publishing_platform_jobs as publication_source where publication_source.content_package_id in (select content_package_id from public.creator_publishing_platform_jobs where id=any(v_target_job_ids)) and publication_source.id <> all(v_target_job_ids) and publication_source.job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived') order by publication_source.id for update of publication_source;

  for job_rec in select * from public.creator_publishing_platform_jobs as job_source where job_source.id=any(v_target_job_ids) order by job_source.id loop
    v_gate_code := null;
    v_job_result := jsonb_build_object('job_id',job_rec.id,'status','blocked','safe_error_code',null);
    select * into capability_rec from public.creator_publishing_platform_capabilities where platform=job_rec.target_platform;
    if not found or capability_rec.availability_status <> 'available' or capability_rec.publishing_mode <> job_rec.publishing_mode then v_gate_code := 'PLATFORM_UNAVAILABLE'; end if;
    if job_rec.target_platform='fanvue' then v_gate_code := 'FANVUE_NOT_AVAILABLE'; end if;
    if job_rec.job_state in ('published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived') or job_rec.cancelled_at is not null then v_gate_code := 'JOB_TERMINAL'; end if;
    if v_gate_code is null and v_action='schedule' and (job_rec.job_state <> 'draft' or job_rec.schedule_revision is not null) then v_gate_code := 'SCHEDULER_JOB_NOT_DRAFT'; end if;
    if v_action='reschedule' then
      begin v_expected_revision := (p_expected_schedule_revisions ->> job_rec.id::text)::integer; exception when others then raise exception 'SCHEDULER_EXPECTED_REVISIONS_INVALID'; end;
      if v_expected_revision is null or v_expected_revision <= 0 then raise exception 'SCHEDULER_EXPECTED_REVISIONS_INVALID'; end if;
      if job_rec.schedule_revision is distinct from v_expected_revision then raise exception 'SCHEDULER_STALE_REVISION'; end if;
      if v_gate_code is null and job_rec.job_state not in ('scheduled_internally','awaiting_operator','due_now','ready_to_publish','package_ready','ready_for_export','needs_fix') then v_gate_code := 'SCHEDULER_RESCHEDULE_STATE_BLOCKED'; end if;
    end if;

    if v_gate_code is null and job_rec.publishing_mode='assisted' then
      v_operator_due_at := p_intended_publish_at - interval '60 minutes';
      if v_operator_due_at <= v_now then v_gate_code := 'SCHEDULER_OPERATOR_DUE_PASSED'; end if;
      select count(*) into v_queue_count from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.target_platform='onlyfans' and queue_source.status not in ('archived','blocked','needs_fix','skipped','failed_manual_upload','confirmed_posted_manual');
      if v_queue_count <> 1 or not exists (select 1 from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.creator_id=job_rec.creator_id and queue_source.target_platform='onlyfans' and queue_source.platform_account_id=job_rec.platform_account_id and ((queue_source.status in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now') and queue_source.claimed_by is null and queue_source.claimed_at is null and queue_source.claim_token is null and queue_source.claim_expires_at is null) or (queue_source.status='claimed' and queue_source.claimed_by is not null and queue_source.claimed_at is not null and queue_source.claim_token is not null and queue_source.claim_expires_at > v_now)) and queue_source.posted_by is null and queue_source.posted_at is null and queue_source.posted_confirmation is false and queue_source.final_post_url is null and queue_source.final_post_url_skip_reason is null and queue_source.proof_screenshot_storage_key is null and queue_source.skip_or_fail_reason is null) then v_gate_code := 'ACTIVE_QUEUE_TASK_CONFLICT'; end if;
    end if;

    if v_gate_code is null and not exists (select 1 from public.creator_publishing_creator_verifications as verification_source where verification_source.creator_id=p_creator_id and verification_source.status='verified') then v_gate_code := 'CREATOR_VERIFICATION_MISSING'; end if;
    if v_gate_code is null and exists (select 1 from public.creator_platform_accounts as account_source where account_source.id=job_rec.platform_account_id and account_source.creator_id=job_rec.creator_id and account_source.platform=job_rec.target_platform and account_source.verification_status='revoked') then v_gate_code := 'DESTINATION_ACCOUNT_REVOKED'; end if;
    if v_gate_code is null and not exists (select 1 from public.creator_platform_accounts as account_source where account_source.id=job_rec.platform_account_id and account_source.creator_id=job_rec.creator_id and account_source.platform=job_rec.target_platform and account_source.verification_status='verified') then v_gate_code := 'DESTINATION_ACCOUNT_NOT_VERIFIED'; end if;
    if v_gate_code is null and not exists (select 1 from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=p_creator_id and consent_source.status='granted' and consent_source.revoked_at is null and consent_source.attestation_version=p_expected_ai_twin_consent_version and consent_source.attestation_text_sha256=p_expected_ai_twin_consent_text_sha256) then v_gate_code := 'AI_TWIN_CONSENT_MISSING'; end if;
    if v_gate_code is null and not exists (select 1 from public.creator_publishing_content_packages as package_source where package_source.id=job_rec.content_package_id and package_source.creator_approval_status='approved' and package_source.compliance_status in ('passed','escalated_approved')) then v_gate_code := 'CREATOR_APPROVAL_MISSING'; end if;
    if v_gate_code is null and public.creator_publishing_autopost_source_fingerprint(job_rec.content_package_id) <> job_rec.source_package_fingerprint then v_gate_code := 'SOURCE_FINGERPRINT_STALE'; end if;
    if v_gate_code is null and exists (select 1 from public.creator_publishing_platform_jobs as publication_source where publication_source.content_package_id=job_rec.content_package_id and publication_source.id <> job_rec.id and publication_source.job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived')) then v_gate_code := 'ACTIVE_PUBLICATION_JOB_CONFLICT'; end if;

    if v_gate_code is not null then
      v_failure_count := v_failure_count + 1;
      v_jobs := v_jobs || jsonb_build_object('job_id',job_rec.id,'status','failed','safe_error_code',v_gate_code,'mutated',false);
    else
      v_new_revision := case when v_action='schedule' then 1 else job_rec.schedule_revision + 1 end;
      if v_action='reschedule' then
        update public.creator_publishing_scheduler_events set status='superseded', superseded_at=v_now, lock_token=null, locked_at=null, updated_at=v_now where platform_job_id=job_rec.id and status in ('pending','processing');
      end if;
      update public.creator_publishing_platform_jobs
      set intended_publish_at=p_intended_publish_at,
          schedule_timezone=p_schedule_timezone,
          operator_due_at=case when job_rec.publishing_mode='assisted' then p_intended_publish_at - interval '60 minutes' else null end,
          schedule_revision=v_new_revision,
          scheduled_at=case when v_action='schedule' then v_now else scheduled_at end,
          scheduled_by=case when v_action='schedule' then p_creator_id else scheduled_by end,
          rescheduled_at=case when v_action='reschedule' then v_now else rescheduled_at end,
          job_state=case job_rec.publishing_mode when 'assisted' then 'scheduled_internally' when 'direct' then 'ready_to_publish' when 'planner' then 'package_ready' else job_state end,
          updated_at=v_now
      where id=job_rec.id;
      if job_rec.publishing_mode='assisted' then
        insert into public.creator_publishing_scheduler_events(creator_id,publishing_plan_id,platform_job_id,event_type,due_at,schedule_revision,created_at,updated_at)
        values (p_creator_id,p_publishing_plan_id,job_rec.id,'operator_due',p_intended_publish_at - interval '60 minutes',v_new_revision,v_now,v_now);
      end if;
      insert into public.creator_publishing_scheduler_events(creator_id,publishing_plan_id,platform_job_id,event_type,due_at,schedule_revision,created_at,updated_at)
      values (p_creator_id,p_publishing_plan_id,job_rec.id,'publish_due',p_intended_publish_at,v_new_revision,v_now,v_now);
      v_success_count := v_success_count + 1;
      v_jobs := v_jobs || jsonb_build_object('job_id',job_rec.id,'status','scheduled','schedule_revision',v_new_revision,'mutated',true);
    end if;
  end loop;

  update public.creator_publishing_plans set status=public.creator_publishing_aggregate_plan_status(p_publishing_plan_id), updated_at=v_now where id=p_publishing_plan_id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at)
  values('creator_publishing_plan',p_publishing_plan_id,p_creator_id,'creator',case when v_action='schedule' then 'creator_publishing_schedule_created' else 'creator_publishing_schedule_rescheduled' end,null,jsonb_build_object('action_type',v_action,'request_fingerprint',v_request_fingerprint,'success_count',v_success_count,'failure_count',v_failure_count,'jobs',v_jobs),p_idempotency_key,v_now);
  v_result := jsonb_build_object('ok',true,'action_type',v_action,'publishing_plan_id',p_publishing_plan_id,'success_count',v_success_count,'failure_count',v_failure_count,'jobs',v_jobs,'idempotent',false);
  insert into public.creator_publishing_scheduler_idempotency(creator_id,publishing_plan_id,action_type,idempotency_key,request_fingerprint,result,created_at)
  values(p_creator_id,p_publishing_plan_id,v_action,p_idempotency_key,v_request_fingerprint,v_result,v_now);
  return v_result;
end;
$$;

create or replace function public.creator_publishing_process_scheduler_event(p_event_id uuid, p_lock_token uuid, p_current_ai_twin_consent_version text, p_current_attestation_text_sha256 text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict error
declare
  identity_rec record;
  plan_rec public.creator_publishing_plans%rowtype;
  job_rec public.creator_publishing_platform_jobs%rowtype;
  event_rec public.creator_publishing_scheduler_events%rowtype;
  capability_rec public.creator_publishing_platform_capabilities%rowtype;
  package_rec public.creator_publishing_content_packages%rowtype;
  evidence_rec public.creator_publishing_compliance_reviews%rowtype;
  v_now timestamptz := clock_timestamp();
  v_next_state text;
  v_gate_code text;
begin
  if length(btrim(coalesce(p_current_ai_twin_consent_version,'')))=0 or coalesce(p_current_attestation_text_sha256,'') !~ '^[a-f0-9]{64}$' then raise exception 'SCHEDULER_INVALID_CONSENT_POLICY'; end if;
  select event_source.publishing_plan_id,event_source.platform_job_id,event_source.creator_id,event_source.schedule_revision into identity_rec from public.creator_publishing_scheduler_events as event_source where event_source.id=p_event_id;
  if not found then return jsonb_build_object('ok',false,'code','EVENT_NOT_FOUND'); end if;
  select * into plan_rec from public.creator_publishing_plans as plan_source where plan_source.id=identity_rec.publishing_plan_id and plan_source.creator_id=identity_rec.creator_id for update of plan_source;
  if not found then return jsonb_build_object('ok',false,'code','IDENTITY_MISMATCH'); end if;
  select * into job_rec from public.creator_publishing_platform_jobs as job_source where job_source.id=identity_rec.platform_job_id and job_source.publishing_plan_id=identity_rec.publishing_plan_id and job_source.creator_id=identity_rec.creator_id for update of job_source;
  if not found then return jsonb_build_object('ok',false,'code','IDENTITY_MISMATCH'); end if;
  select * into event_rec from public.creator_publishing_scheduler_events as event_source where event_source.id=p_event_id for update of event_source;
  if not found or event_rec.publishing_plan_id<>identity_rec.publishing_plan_id or event_rec.platform_job_id<>identity_rec.platform_job_id or event_rec.creator_id<>identity_rec.creator_id or event_rec.schedule_revision<>identity_rec.schedule_revision then return jsonb_build_object('ok',false,'code','IDENTITY_MISMATCH'); end if;
  if event_rec.status <> 'processing' or event_rec.lock_token is distinct from p_lock_token then return jsonb_build_object('ok',false,'code','STALE_LOCK_TOKEN'); end if;
  if job_rec.job_state in ('published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived') or job_rec.cancelled_at is not null then
    update public.creator_publishing_scheduler_events
    set status='superseded', superseded_at=v_now, lock_token=null, locked_at=null, updated_at=v_now
    where id=event_rec.id and lock_token=p_lock_token;
    update public.creator_publishing_scheduler_events
    set status='superseded', superseded_at=v_now, lock_token=null, locked_at=null, updated_at=v_now
    where platform_job_id=job_rec.id and schedule_revision=event_rec.schedule_revision and id<>event_rec.id and status in ('pending','processing');
    insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at)
    values('creator_publishing_scheduler_event',event_rec.id,null,'scheduler','creator_publishing_scheduler_event_superseded',jsonb_build_object('status','processing','event_type',event_rec.event_type,'schedule_revision',event_rec.schedule_revision),jsonb_build_object('status','superseded','safe_error_code','JOB_TERMINAL','job_state',job_rec.job_state),v_now);
    return jsonb_build_object('ok', true, 'status', 'superseded', 'code', 'JOB_TERMINAL', 'job_state', job_rec.job_state);
  end if;
  if job_rec.schedule_revision is distinct from event_rec.schedule_revision then
    update public.creator_publishing_scheduler_events
    set status='superseded', superseded_at=v_now, lock_token=null, locked_at=null, updated_at=v_now
    where id=event_rec.id and lock_token=p_lock_token;
    update public.creator_publishing_scheduler_events
    set status='superseded', superseded_at=v_now, lock_token=null, locked_at=null, updated_at=v_now
    where platform_job_id=job_rec.id and schedule_revision=event_rec.schedule_revision and id<>event_rec.id and status in ('pending','processing');
    insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at)
    values('creator_publishing_scheduler_event',event_rec.id,null,'scheduler','creator_publishing_scheduler_event_superseded',jsonb_build_object('status','processing','event_type',event_rec.event_type,'schedule_revision',event_rec.schedule_revision),jsonb_build_object('status','superseded','safe_error_code','SCHEDULER_STALE_REVISION','stale_schedule_revision',event_rec.schedule_revision,'current_schedule_revision',job_rec.schedule_revision,'job_state',job_rec.job_state),v_now);
    return jsonb_build_object('ok', true, 'status', 'superseded', 'code', 'SCHEDULER_STALE_REVISION', 'job_state', job_rec.job_state, 'schedule_revision', job_rec.schedule_revision);
  end if;
  if v_gate_code is null and event_rec.event_type='operator_due' and job_rec.publishing_mode='assisted' and job_rec.job_state='due_now' then
    update public.creator_publishing_scheduler_events set status='superseded', superseded_at=v_now, lock_token=null, locked_at=null, updated_at=v_now where id=event_rec.id and lock_token=p_lock_token;
    insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at)
    values('creator_publishing_scheduler_event',event_rec.id,null,'scheduler','creator_publishing_scheduler_event_superseded',jsonb_build_object('status','processing','event_type',event_rec.event_type,'schedule_revision',event_rec.schedule_revision),jsonb_build_object('status','superseded','safe_error_code','OBSOLETE_OPERATOR_DUE_SUPERSEDED','job_state',job_rec.job_state),v_now);
    return jsonb_build_object('ok',true,'status','superseded','code','OBSOLETE_OPERATOR_DUE_SUPERSEDED');
  end if;
  perform 1 from public.creator_publishing_platform_capabilities as capability_source where capability_source.platform=job_rec.target_platform order by capability_source.platform for update of capability_source;
  perform 1 from public.creator_publishing_content_packages as package_source where package_source.id=job_rec.content_package_id order by package_source.id for update of package_source;
  perform 1 from public.creator_platform_accounts as account_source where account_source.id=job_rec.platform_account_id order by account_source.id for update of account_source;
  perform 1 from public.creator_publishing_creator_verifications as verification_source where verification_source.creator_id=job_rec.creator_id order by verification_source.creator_id for update of verification_source;
  perform 1 from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=job_rec.creator_id order by consent_source.creator_id for update of consent_source;
  perform 1 from public.creator_publishing_compliance_reviews as review_source where review_source.content_package_id=job_rec.content_package_id order by review_source.content_package_id, review_source.created_at, review_source.id for update of review_source;
  perform 1 from public.creator_publishing_co_performer_records as performer_source where performer_source.content_package_id=job_rec.content_package_id order by performer_source.content_package_id, performer_source.id for update of performer_source;
  perform 1 from public.creator_publishing_media_assets as media_source where media_source.content_package_id=job_rec.content_package_id order by media_source.content_package_id, media_source.id for update of media_source;
  perform 1 from public.generations as generation_source where generation_source.id in (select (media_source.ai_generation_metadata->>'generation_id')::uuid from public.creator_publishing_media_assets as media_source where media_source.content_package_id=job_rec.content_package_id and coalesce(media_source.ai_generation_metadata->>'generation_id','') ~* '^[0-9a-f-]{36}$') order by generation_source.id for update of generation_source;
  perform 1 from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.target_platform=job_rec.target_platform order by queue_source.id for update of queue_source;
  perform 1 from public.creator_publishing_platform_jobs as publication_source where publication_source.content_package_id=job_rec.content_package_id and publication_source.id<>job_rec.id order by publication_source.id for update of publication_source;

  select * into capability_rec from public.creator_publishing_platform_capabilities where platform=job_rec.target_platform;
  if v_gate_code is null and (not found or capability_rec.availability_status <> 'available' or capability_rec.publishing_mode <> job_rec.publishing_mode) then v_gate_code := 'PLATFORM_UNAVAILABLE'; end if;
  if v_gate_code is null and job_rec.target_platform='fanvue' then v_gate_code := 'FANVUE_NOT_AVAILABLE'; end if;
  if v_gate_code is null and exists (
    select 1
    from public.creator_platform_accounts as account_source
    where account_source.id = job_rec.platform_account_id
      and account_source.creator_id = job_rec.creator_id
      and account_source.platform = job_rec.target_platform
      and account_source.verification_status = 'revoked'
  ) then
    v_gate_code := 'DESTINATION_ACCOUNT_REVOKED';
  end if;
  if v_gate_code is null and not exists (
    select 1
    from public.creator_platform_accounts as account_source
    where account_source.id = job_rec.platform_account_id
      and account_source.creator_id = job_rec.creator_id
      and account_source.platform = job_rec.target_platform
      and account_source.verification_status = 'verified'
  ) then
    v_gate_code := 'DESTINATION_ACCOUNT_NOT_VERIFIED';
  end if;
  if v_gate_code is null and not exists (
    select 1
    from public.creator_publishing_creator_verifications as verification_source
    where verification_source.creator_id = job_rec.creator_id
      and verification_source.status = 'verified'
  ) then
    v_gate_code := 'CREATOR_VERIFICATION_MISSING';
  end if;
  if v_gate_code is null and not exists(select 1 from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=job_rec.creator_id and consent_source.status='granted' and consent_source.revoked_at is null and consent_source.attestation_version=p_current_ai_twin_consent_version and consent_source.attestation_text_sha256=p_current_attestation_text_sha256) then v_gate_code := 'AI_TWIN_CONSENT_MISSING'; end if;
  if v_gate_code is null then
    select * into package_rec from public.creator_publishing_content_packages as package_source where package_source.id=job_rec.content_package_id;
    if not found or package_rec.creator_id<>job_rec.creator_id or package_rec.platform_account_id<>job_rec.platform_account_id or package_rec.target_platform<>job_rec.target_platform or package_rec.creator_approval_status<>'approved' or package_rec.compliance_status not in ('passed','escalated_approved') or package_rec.compliance_policy_version is null or package_rec.compliance_policy_version='unassigned' then
      v_gate_code := 'CREATOR_APPROVAL_MISSING';
    end if;
  end if;
  if v_gate_code is null then
    if package_rec.compliance_status='passed' then
      select * into evidence_rec from public.creator_publishing_compliance_reviews as review_source where review_source.content_package_id=package_rec.id and review_source.review_source='automated' and review_source.outcome='pass' and review_source.compliance_policy_version=package_rec.compliance_policy_version order by review_source.created_at desc, review_source.id desc limit 1;
    else
      select * into evidence_rec from public.creator_publishing_compliance_reviews as review_source where review_source.content_package_id=package_rec.id and review_source.review_source='human' and review_source.outcome='escalate' and length(btrim(coalesce(review_source.escalated_approval_reason,'')))>0 and review_source.compliance_policy_version=package_rec.compliance_policy_version order by review_source.created_at desc, review_source.id desc limit 1;
    end if;
    if not found or exists (select 1 from public.creator_publishing_compliance_reviews as later_source where later_source.content_package_id=package_rec.id and later_source.outcome in ('block','manual_review') and (later_source.created_at > evidence_rec.created_at or (later_source.created_at = evidence_rec.created_at and later_source.id > evidence_rec.id))) then
      v_gate_code := 'COMPLIANCE_EVIDENCE_INVALID';
    end if;
  end if;
  if v_gate_code is null and package_rec.second_person_present and (not exists (select 1 from public.creator_publishing_co_performer_records as performer_source where performer_source.content_package_id=package_rec.id) or exists (select 1 from public.creator_publishing_co_performer_records as performer_source where performer_source.content_package_id=package_rec.id and performer_source.platform_release_confirmed is not true)) then
    v_gate_code := 'CO_PERFORMER_RELEASE_MISSING';
  end if;
  if v_gate_code is null and job_rec.publishing_mode='assisted' and (not exists (select 1 from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.creator_id=job_rec.creator_id and queue_source.target_platform='onlyfans' and queue_source.platform_account_id=job_rec.platform_account_id and ((queue_source.status in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now') and queue_source.claimed_by is null and queue_source.claimed_at is null and queue_source.claim_token is null and queue_source.claim_expires_at is null) or (queue_source.status='claimed' and queue_source.claimed_by is not null and queue_source.claimed_at is not null and queue_source.claim_token is not null and queue_source.claim_expires_at > v_now)) and queue_source.posted_by is null and queue_source.posted_at is null and queue_source.posted_confirmation is false and queue_source.final_post_url is null and queue_source.final_post_url_skip_reason is null and queue_source.proof_screenshot_storage_key is null and queue_source.skip_or_fail_reason is null) or (select count(*) from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.target_platform='onlyfans' and queue_source.status not in ('archived','blocked','needs_fix','skipped','failed_manual_upload','confirmed_posted_manual')) <> 1) then
    v_gate_code := 'ACTIVE_QUEUE_TASK_CONFLICT';
  end if;
  if v_gate_code is null and public.creator_publishing_autopost_source_fingerprint(job_rec.content_package_id) <> job_rec.source_package_fingerprint then v_gate_code := 'SOURCE_FINGERPRINT_STALE'; end if;
  if v_gate_code is null and exists (select 1 from public.creator_publishing_platform_jobs as publication_source where publication_source.content_package_id=job_rec.content_package_id and publication_source.id<>job_rec.id and publication_source.job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived')) then v_gate_code := 'ACTIVE_PUBLICATION_JOB_CONFLICT'; end if;

  v_next_state := case
    when job_rec.publishing_mode='assisted' and event_rec.event_type='operator_due' and job_rec.job_state='scheduled_internally' then 'awaiting_operator'
    when job_rec.publishing_mode='assisted' and event_rec.event_type='publish_due' and job_rec.job_state in ('scheduled_internally','awaiting_operator') then 'due_now'
    when job_rec.publishing_mode='direct' and event_rec.event_type='publish_due' and job_rec.job_state='ready_to_publish' then 'direct_publish_queued'
    when job_rec.publishing_mode='planner' and event_rec.event_type='publish_due' and job_rec.job_state='package_ready' then 'ready_for_export'
    else null end;
  if v_gate_code is null and v_next_state is null then
    v_gate_code := 'SCHEDULER_STATE_TRANSITION_INVALID';
  end if;

  if v_gate_code is not null then
    update public.creator_publishing_scheduler_events set status='blocked', processed_at=v_now, safe_error_code=v_gate_code, lock_token=null, locked_at=null, updated_at=v_now where id=event_rec.id and lock_token=p_lock_token;
    update public.creator_publishing_scheduler_events set status='superseded', superseded_at=v_now, lock_token=null, locked_at=null, updated_at=v_now where platform_job_id=job_rec.id and schedule_revision=event_rec.schedule_revision and id<>event_rec.id and status in ('pending','processing');
    update public.creator_publishing_platform_jobs set job_state=case when v_gate_code in ('SOURCE_FINGERPRINT_STALE','AI_TWIN_CONSENT_MISSING','CREATOR_VERIFICATION_MISSING','SCHEDULER_STATE_TRANSITION_INVALID','CREATOR_APPROVAL_MISSING','COMPLIANCE_EVIDENCE_INVALID','CO_PERFORMER_RELEASE_MISSING') then 'needs_fix' else 'blocked' end, updated_at=v_now where id=job_rec.id;
    update public.creator_publishing_plans set status=public.creator_publishing_aggregate_plan_status(plan_rec.id), updated_at=v_now where id=plan_rec.id;
    insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,null,'scheduler','creator_publishing_scheduler_gate_failed',jsonb_build_object('status','processing','event_type',event_rec.event_type,'schedule_revision',event_rec.schedule_revision),jsonb_build_object('status','blocked','safe_error_code',v_gate_code),v_now);
    return jsonb_build_object('ok',true,'status','blocked','safe_error_code',v_gate_code);
  end if;

  update public.creator_publishing_platform_jobs set job_state=v_next_state, updated_at=v_now where id=job_rec.id;
  update public.creator_publishing_queue_tasks set status=case when status='claimed' then 'claimed' when event_rec.event_type='operator_due' and status in ('ready_for_handoff','scheduled_internally','awaiting_operator') then 'awaiting_operator' when event_rec.event_type='operator_due' and status='due_now' then 'due_now' when event_rec.event_type='publish_due' and status in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now') then 'due_now' else status end, updated_at=v_now where content_package_id=job_rec.content_package_id and creator_id=job_rec.creator_id and target_platform=job_rec.target_platform and platform_account_id=job_rec.platform_account_id and status in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now','claimed');
  update public.creator_publishing_scheduler_events set status='processed', processed_at=v_now, lock_token=null, locked_at=null, updated_at=v_now where id=event_rec.id and lock_token=p_lock_token;
  update public.creator_publishing_plans set status=public.creator_publishing_aggregate_plan_status(plan_rec.id), updated_at=v_now where id=plan_rec.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,null,'scheduler','creator_publishing_scheduler_event_processed',jsonb_build_object('status','processing','event_type',event_rec.event_type,'schedule_revision',event_rec.schedule_revision),jsonb_build_object('status','processed','job_state',v_next_state),v_now);
  return jsonb_build_object('ok',true,'status','processed','job_state',v_next_state);
end; $$;

revoke all on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) to service_role;
grant execute on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) to service_role;
