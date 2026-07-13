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
    (status = 'claimed' and claimed_by is not null and claimed_at is not null and claim_token is not null and claim_expires_at is not null and claim_expires_at > claimed_at and claim_expires_at <= claimed_at + interval '30 minutes')
    or (status <> 'claimed' and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null)
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
  constraint creator_publishing_operator_action_idempotency_key check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
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

create or replace function public.creator_publishing_onlyfans_queue_status_from_schedule(p_job public.creator_publishing_platform_jobs, p_now timestamptz)
returns text language sql stable set search_path = public, pg_catalog as $$
  select case
    when p_job.cancelled_at is not null then null
    when p_job.job_state not in ('draft','scheduled_internally','awaiting_operator','due_now') then null
    when p_job.schedule_revision is null and p_job.job_state = 'draft' then 'ready_for_handoff'
    when p_job.schedule_revision is null then null
    when p_job.intended_publish_at is not null and p_job.intended_publish_at <= p_now then 'due_now'
    when p_job.operator_due_at is not null and p_job.operator_due_at <= p_now then 'awaiting_operator'
    when p_job.schedule_revision is not null then 'scheduled_internally'
    else null end;
$$;

create or replace function public.creator_publishing_onlyfans_operator_request_fingerprint(p_action text, p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_claim_token uuid default null, p_progress_state text default null)
returns text language sql immutable set search_path = public, extensions, pg_catalog as $$
  select encode(extensions.digest(jsonb_build_object('action',p_action,'actor_id',p_actor_id,'queue_task_id',p_queue_task_id,'platform_job_id',p_platform_job_id,'claim_token',p_claim_token,'progress_state',p_progress_state)::text,'sha256'),'hex');
$$;


create or replace function public.creator_publishing_onlyfans_operator_gate_code(p_job public.creator_publishing_platform_jobs, p_actor_id uuid, p_require_current_safety boolean, p_current_ai_twin_consent_version text default null, p_current_attestation_text_sha256 text default null)
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare package_rec public.creator_publishing_content_packages%rowtype; evidence_rec public.creator_publishing_compliance_reviews%rowtype;
begin
  if p_job.id is null then return 'OPERATOR_JOB_NOT_FOUND'; end if;
  if p_job.target_platform <> 'onlyfans' then return 'OPERATOR_ONLYFANS_REQUIRED'; end if;
  if p_job.publishing_mode <> 'assisted' then return 'OPERATOR_ASSISTED_REQUIRED'; end if;
  if p_job.cancelled_at is not null or p_job.job_state not in ('draft','scheduled_internally','awaiting_operator','due_now') then return 'OPERATOR_TERMINAL_TASK'; end if;
  if not public.creator_publishing_onlyfans_operator_authorized(p_job.creator_id,p_actor_id) then return 'OPERATOR_NOT_AUTHORIZED'; end if;
  if not p_require_current_safety then return null; end if;
  if not exists (select 1 from public.creator_publishing_platform_capabilities c where c.platform='onlyfans' and c.availability_status='available' and c.publishing_mode='assisted' and c.human_operator_queue_supported is true and c.human_publishing_required is true) then return 'PLATFORM_UNAVAILABLE'; end if;
  if not exists (select 1 from public.creator_publishing_creator_verifications v where v.creator_id=p_job.creator_id and v.status='verified') then return 'CREATOR_VERIFICATION_MISSING'; end if;
  if not exists (select 1 from public.creator_platform_accounts a where a.id=p_job.platform_account_id and a.creator_id=p_job.creator_id and a.platform='onlyfans' and a.verification_status='verified') then return 'DESTINATION_ACCOUNT_NOT_VERIFIED'; end if;
  if not exists (select 1 from public.creator_publishing_ai_twin_consents c where c.creator_id=p_job.creator_id and c.status='granted' and c.revoked_at is null and c.attestation_version=p_current_ai_twin_consent_version and c.attestation_text_sha256=p_current_attestation_text_sha256) then return 'AI_TWIN_CONSENT_MISSING'; end if;
  select * into package_rec from public.creator_publishing_content_packages p where p.id=p_job.content_package_id;
  if not found or package_rec.creator_id<>p_job.creator_id or package_rec.platform_account_id<>p_job.platform_account_id or package_rec.target_platform<>'onlyfans' or package_rec.creator_approval_status<>'approved' or package_rec.compliance_status not in ('passed','escalated_approved') or package_rec.compliance_policy_version is null or package_rec.compliance_policy_version='unassigned' then return 'CREATOR_APPROVAL_MISSING'; end if;
  if package_rec.compliance_status='passed' then
    select * into evidence_rec from public.creator_publishing_compliance_reviews r where r.content_package_id=package_rec.id and r.review_source='automated' and r.outcome='pass' and r.compliance_policy_version=package_rec.compliance_policy_version order by r.created_at desc, r.id desc limit 1;
  else
    select * into evidence_rec from public.creator_publishing_compliance_reviews r where r.content_package_id=package_rec.id and r.review_source='human' and r.outcome='escalate' and length(btrim(coalesce(r.escalated_approval_reason,'')))>0 and r.compliance_policy_version=package_rec.compliance_policy_version order by r.created_at desc, r.id desc limit 1;
  end if;
  if not found or exists(select 1 from public.creator_publishing_compliance_reviews later where later.content_package_id=package_rec.id and later.outcome in ('block','manual_review') and (later.created_at>evidence_rec.created_at or (later.created_at=evidence_rec.created_at and later.id>evidence_rec.id))) then return 'COMPLIANCE_EVIDENCE_INVALID'; end if;
  if package_rec.second_person_present and (not exists(select 1 from public.creator_publishing_co_performer_records cp where cp.content_package_id=package_rec.id) or exists(select 1 from public.creator_publishing_co_performer_records cp where cp.content_package_id=package_rec.id and cp.platform_release_confirmed is not true)) then return 'CO_PERFORMER_RELEASE_MISSING'; end if;
  if public.creator_publishing_autopost_source_fingerprint(p_job.content_package_id) <> p_job.source_package_fingerprint then return 'SOURCE_FINGERPRINT_STALE'; end if;
  if exists(select 1 from public.creator_publishing_platform_jobs j where j.content_package_id=p_job.content_package_id and j.id<>p_job.id and j.job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived')) then return 'ACTIVE_PUBLICATION_JOB_CONFLICT'; end if;
  return null;
end; $$;

create or replace function public.creator_publishing_claim_onlyfans_operator_task(p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_current_ai_twin_consent_version text, p_current_attestation_text_sha256 text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_task public.creator_publishing_queue_tasks%rowtype; v_job public.creator_publishing_platform_jobs%rowtype; v_now timestamptz:=clock_timestamp(); v_fp text; v_existing public.creator_publishing_operator_action_idempotency%rowtype; v_token uuid; v_result jsonb; v_prior_status text; v_recovered boolean:=false; v_count integer; v_gate_code text;
begin
  if p_actor_id is null or p_queue_task_id is null or p_platform_job_id is null or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' or length(btrim(coalesce(p_current_ai_twin_consent_version,'')))=0 or coalesce(p_current_attestation_text_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'OPERATOR_INVALID_REQUEST'; end if;
  v_fp := public.creator_publishing_onlyfans_operator_request_fingerprint('claim',p_actor_id,p_queue_task_id,p_platform_job_id,null,concat_ws(':',p_current_ai_twin_consent_version,p_current_attestation_text_sha256));
  perform pg_advisory_xact_lock(hashtextextended('creator_operator_idempotency:'||p_actor_id||':claim:'||p_idempotency_key,0));
  select * into v_existing from public.creator_publishing_operator_action_idempotency where actor_id=p_actor_id and action_type='claim' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_fingerprint<>v_fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.stored_result; end if;
  select * into v_job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update; if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;
  select * into v_task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  select count(*) into v_count from public.creator_publishing_queue_tasks where content_package_id=v_job.content_package_id and target_platform='onlyfans' and status <> 'archived';
  if v_count<>1 or v_task.creator_id<>v_job.creator_id or v_task.content_package_id<>v_job.content_package_id or v_task.platform_account_id<>v_job.platform_account_id or v_task.target_platform<>'onlyfans' or v_job.target_platform<>'onlyfans' then raise exception 'OPERATOR_TASK_IDENTITY_AMBIGUOUS'; end if;
  v_gate_code := public.creator_publishing_onlyfans_operator_gate_code(v_job,p_actor_id,true,p_current_ai_twin_consent_version,p_current_attestation_text_sha256);
  if v_gate_code is not null then raise exception '%', v_gate_code; end if;
  if v_task.status='claimed' and v_task.claim_expires_at <= v_now then
    v_prior_status:=v_task.status; v_recovered:=true;
    update public.creator_publishing_queue_tasks set status=public.creator_publishing_onlyfans_queue_status_from_schedule(v_job, v_now), claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null, updated_at=v_now where id=v_task.id returning * into v_task;
    insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator','creator_publishing_operator_claim_recovered',jsonb_build_object('status',v_prior_status),jsonb_build_object('status',v_task.status,'platform_job_id',v_job.id),p_idempotency_key,v_now);
  elsif v_task.status='claimed' and v_task.claim_expires_at > v_now then raise exception 'OPERATOR_TASK_ALREADY_CLAIMED';
  end if;
  if v_job.schedule_revision is null then if v_task.status<>'ready_for_handoff' or v_job.operator_due_at is not null then raise exception 'OPERATOR_TASK_NOT_READY'; end if;
  elsif v_job.operator_due_at is null or v_job.operator_due_at > v_now then raise exception 'OPERATOR_NOT_DUE';
  elsif v_task.status not in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now') then raise exception 'OPERATOR_TASK_NOT_READY'; end if;
  v_token:=gen_random_uuid(); v_prior_status:=v_task.status;
  update public.creator_publishing_queue_tasks set status='claimed', claimed_by=p_actor_id, claimed_at=v_now, claim_token=v_token, claim_expires_at=v_now+interval '30 minutes', claim_attempt_count=claim_attempt_count+1, updated_at=v_now where id=v_task.id returning * into v_task;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator','creator_publishing_operator_task_claimed',jsonb_build_object('status',v_prior_status),jsonb_build_object('status','claimed','platform_job_id',v_job.id,'claim_expires_at',v_task.claim_expires_at,'request_fingerprint',v_fp),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'status','claimed','queue_task_id',v_task.id,'platform_job_id',v_job.id,'claim_token',v_token,'claim_expires_at',v_task.claim_expires_at,'expired_claim_recovered',v_recovered);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,request_fingerprint,idempotency_key,stored_result,created_at) values(p_actor_id,v_job.creator_id,v_task.id,v_job.id,'claim',v_fp,p_idempotency_key,v_result,v_now);
  return v_result;
end; $$;

create or replace function public.creator_publishing_release_onlyfans_operator_task(p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_claim_token uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_task public.creator_publishing_queue_tasks%rowtype; v_job public.creator_publishing_platform_jobs%rowtype; v_now timestamptz:=clock_timestamp(); v_fp text; v_existing public.creator_publishing_operator_action_idempotency%rowtype; v_status text; v_result jsonb; v_count integer; v_gate_code text;
begin
  if p_actor_id is null or p_queue_task_id is null or p_platform_job_id is null or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'OPERATOR_INVALID_REQUEST'; end if;
  v_fp:=public.creator_publishing_onlyfans_operator_request_fingerprint('release',p_actor_id,p_queue_task_id,p_platform_job_id,p_claim_token,null);
  perform pg_advisory_xact_lock(hashtextextended('creator_operator_idempotency:'||p_actor_id||':release:'||p_idempotency_key,0));
  select * into v_existing from public.creator_publishing_operator_action_idempotency where actor_id=p_actor_id and action_type='release' and idempotency_key=p_idempotency_key; if found then if v_existing.request_fingerprint<>v_fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.stored_result; end if;
  select * into v_job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update; if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;
  select * into v_task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  select count(*) into v_count from public.creator_publishing_queue_tasks where content_package_id=v_job.content_package_id and target_platform='onlyfans' and status <> 'archived';
  if v_count<>1 or v_task.creator_id<>v_job.creator_id or v_task.content_package_id<>v_job.content_package_id or v_task.platform_account_id<>v_job.platform_account_id or v_task.target_platform<>'onlyfans' or v_job.target_platform<>'onlyfans' then raise exception 'OPERATOR_TASK_IDENTITY_AMBIGUOUS'; end if;
  v_gate_code := public.creator_publishing_onlyfans_operator_gate_code(v_job,p_actor_id,false,null,null); if v_gate_code is not null then raise exception '%', v_gate_code; end if;
  if v_task.claimed_by<>p_actor_id or v_task.claim_token<>p_claim_token or v_task.status<>'claimed' then raise exception 'OPERATOR_CLAIM_TOKEN_MISMATCH'; end if;
  v_status:=public.creator_publishing_onlyfans_queue_status_from_schedule(v_job, v_now);
  if v_status is null then raise exception 'OPERATOR_TERMINAL_TASK'; end if;
  update public.creator_publishing_queue_tasks set status=v_status, claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null, updated_at=v_now where id=v_task.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator','creator_publishing_operator_task_released',jsonb_build_object('status','claimed'),jsonb_build_object('status',v_status,'platform_job_id',v_job.id),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'status',v_status,'queue_task_id',v_task.id,'platform_job_id',v_job.id);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,request_fingerprint,idempotency_key,stored_result,created_at) values(p_actor_id,v_job.creator_id,v_task.id,v_job.id,'release',v_fp,p_idempotency_key,v_result,v_now);
  return v_result;
end; $$;

create or replace function public.creator_publishing_update_onlyfans_operator_progress(p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_claim_token uuid, p_expected_progress_state text, p_next_progress_state text, p_current_ai_twin_consent_version text, p_current_attestation_text_sha256 text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_task public.creator_publishing_queue_tasks%rowtype; v_job public.creator_publishing_platform_jobs%rowtype; v_now timestamptz:=clock_timestamp(); v_fp text; v_existing public.creator_publishing_operator_action_idempotency%rowtype; v_action text; v_result jsonb; v_count integer; v_gate_code text;
begin
  if p_actor_id is null or p_queue_task_id is null or p_platform_job_id is null or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' or length(btrim(coalesce(p_current_ai_twin_consent_version,'')))=0 or coalesce(p_current_attestation_text_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'OPERATOR_INVALID_REQUEST'; end if;
  if (p_expected_progress_state,p_next_progress_state) not in (('not_started','preparing'),('preparing','prepared'),('prepared','handoff_ready')) then raise exception 'OPERATOR_PROGRESS_INVALID_TRANSITION'; end if;
  v_fp:=public.creator_publishing_onlyfans_operator_request_fingerprint('progress_update',p_actor_id,p_queue_task_id,p_platform_job_id,p_claim_token,concat_ws(':',p_next_progress_state,p_current_ai_twin_consent_version,p_current_attestation_text_sha256));
  perform pg_advisory_xact_lock(hashtextextended('creator_operator_idempotency:'||p_actor_id||':progress_update:'||p_idempotency_key,0));
  select * into v_existing from public.creator_publishing_operator_action_idempotency where actor_id=p_actor_id and action_type='progress_update' and idempotency_key=p_idempotency_key; if found then if v_existing.request_fingerprint<>v_fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.stored_result; end if;
  select * into v_job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update; if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;
  select * into v_task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  select count(*) into v_count from public.creator_publishing_queue_tasks where content_package_id=v_job.content_package_id and target_platform='onlyfans' and status <> 'archived';
  if v_count<>1 or v_task.creator_id<>v_job.creator_id or v_task.content_package_id<>v_job.content_package_id or v_task.platform_account_id<>v_job.platform_account_id or v_task.target_platform<>'onlyfans' or v_job.target_platform<>'onlyfans' then raise exception 'OPERATOR_TASK_IDENTITY_AMBIGUOUS'; end if;
  v_gate_code := public.creator_publishing_onlyfans_operator_gate_code(v_job,p_actor_id,true,p_current_ai_twin_consent_version,p_current_attestation_text_sha256); if v_gate_code is not null then raise exception '%', v_gate_code; end if;
  if v_task.status<>'claimed' or v_task.claimed_by<>p_actor_id or v_task.claim_token<>p_claim_token or v_task.claim_expires_at<=v_now then raise exception 'OPERATOR_ACTIVE_CLAIM_REQUIRED'; end if;
  if v_task.operator_progress_state<>p_expected_progress_state then raise exception 'OPERATOR_PROGRESS_STALE'; end if;
  update public.creator_publishing_queue_tasks set operator_progress_state=p_next_progress_state, operator_progress_updated_by=p_actor_id, operator_progress_updated_at=v_now, operator_progress_revision=operator_progress_revision+1, updated_at=v_now where id=v_task.id;
  v_action:=case p_next_progress_state when 'preparing' then 'creator_publishing_operator_preparation_started' when 'prepared' then 'creator_publishing_operator_package_prepared' else 'creator_publishing_operator_handoff_ready' end;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator',v_action,jsonb_build_object('progress_state',p_expected_progress_state),jsonb_build_object('progress_state',p_next_progress_state,'platform_job_id',v_job.id),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'progress_state',p_next_progress_state,'queue_task_id',v_task.id,'platform_job_id',v_job.id);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,request_fingerprint,idempotency_key,stored_result,created_at) values(p_actor_id,v_job.creator_id,v_task.id,v_job.id,'progress_update',v_fp,p_idempotency_key,v_result,v_now);
  return v_result;
end; $$;

create or replace function public.creator_publishing_recover_expired_onlyfans_operator_claim(p_actor_id uuid, p_queue_task_id uuid, p_platform_job_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_task public.creator_publishing_queue_tasks%rowtype; v_job public.creator_publishing_platform_jobs%rowtype; v_now timestamptz:=clock_timestamp(); v_fp text; v_existing public.creator_publishing_operator_action_idempotency%rowtype; v_status text; v_result jsonb; v_count integer; v_gate_code text;
begin
  if p_actor_id is null or p_queue_task_id is null or p_platform_job_id is null or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'OPERATOR_INVALID_REQUEST'; end if;
  v_fp:=public.creator_publishing_onlyfans_operator_request_fingerprint('expired_claim_recovery',p_actor_id,p_queue_task_id,p_platform_job_id,null,null);
  perform pg_advisory_xact_lock(hashtextextended('creator_operator_idempotency:'||p_actor_id||':expired_claim_recovery:'||p_idempotency_key,0));
  select * into v_existing from public.creator_publishing_operator_action_idempotency where actor_id=p_actor_id and action_type='expired_claim_recovery' and idempotency_key=p_idempotency_key; if found then if v_existing.request_fingerprint<>v_fp then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.stored_result; end if;
  select * into v_job from public.creator_publishing_platform_jobs where id=p_platform_job_id for update; if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;
  select * into v_task from public.creator_publishing_queue_tasks where id=p_queue_task_id for update; if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  select count(*) into v_count from public.creator_publishing_queue_tasks where content_package_id=v_job.content_package_id and target_platform='onlyfans' and status <> 'archived';
  if v_count<>1 or v_task.creator_id<>v_job.creator_id or v_task.content_package_id<>v_job.content_package_id or v_task.platform_account_id<>v_job.platform_account_id or v_task.target_platform<>'onlyfans' or v_job.target_platform<>'onlyfans' then raise exception 'OPERATOR_TASK_IDENTITY_AMBIGUOUS'; end if;
  v_gate_code := public.creator_publishing_onlyfans_operator_gate_code(v_job,p_actor_id,false,null,null); if v_gate_code is not null then raise exception '%', v_gate_code; end if;
  if v_task.status<>'claimed' or v_task.claim_expires_at>v_now then raise exception 'OPERATOR_CLAIM_NOT_EXPIRED'; end if;
  v_status:=public.creator_publishing_onlyfans_queue_status_from_schedule(v_job, v_now);
  if v_status is null then raise exception 'OPERATOR_TERMINAL_TASK'; end if;
  update public.creator_publishing_queue_tasks set status=v_status, claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null, updated_at=v_now where id=v_task.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_queue_task',v_task.id,p_actor_id,'operator','creator_publishing_operator_claim_recovered',jsonb_build_object('status','claimed'),jsonb_build_object('status',v_status,'platform_job_id',v_job.id),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'status',v_status,'queue_task_id',v_task.id,'platform_job_id',v_job.id);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,request_fingerprint,idempotency_key,stored_result,created_at) values(p_actor_id,v_job.creator_id,v_task.id,v_job.id,'expired_claim_recovery',v_fp,p_idempotency_key,v_result,v_now);
  return v_result;
end; $$;

revoke all on function public.creator_publishing_onlyfans_operator_authorized(uuid,uuid) from public, anon, authenticated;
revoke all on function public.creator_publishing_onlyfans_queue_status_from_schedule(public.creator_publishing_platform_jobs,timestamptz) from public, anon, authenticated;
revoke all on function public.creator_publishing_onlyfans_operator_request_fingerprint(text,uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_onlyfans_operator_gate_code(public.creator_publishing_platform_jobs,uuid,boolean,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_release_onlyfans_operator_task(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_update_onlyfans_operator_progress(uuid,uuid,uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_recover_expired_onlyfans_operator_claim(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.creator_publishing_release_onlyfans_operator_task(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.creator_publishing_update_onlyfans_operator_progress(uuid,uuid,uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.creator_publishing_recover_expired_onlyfans_operator_claim(uuid,uuid,uuid,text) to service_role;


-- Narrow Task 15 compatibility implementations copied from migration 01300 with only queue-task claim compatibility changed.

-- Task 15 compatibility helper: accept exactly one active matching unclaimed task or one valid active Task 17 claim.
create or replace function public.creator_publishing_task17a_queue_task_compatible(
  p_job public.creator_publishing_platform_jobs,
  p_now timestamptz,
  p_valid_unclaimed_statuses text[]
) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with matching as (
    select q.*
    from public.creator_publishing_queue_tasks q
    where q.content_package_id = p_job.content_package_id
      and q.target_platform = 'onlyfans'
      and q.status <> 'archived'
  ), one_match as (
    select * from matching
    where (select count(*) from matching) = 1
      and creator_id = p_job.creator_id
      and platform_account_id = p_job.platform_account_id
      and target_platform = p_job.target_platform
      and content_package_id = p_job.content_package_id
      and posted_by is null
      and posted_at is null
      and posted_confirmation is false
      and final_post_url is null
      and final_post_url_skip_reason is null
      and proof_screenshot_storage_key is null
      and skip_or_fail_reason is null
  )
  select exists (
    select 1 from one_match q
    where (
      q.status = any(p_valid_unclaimed_statuses)
      and q.claimed_by is null and q.claimed_at is null and q.claim_token is null and q.claim_expires_at is null
    ) or (
      q.status = 'claimed'
      and q.claimed_by is not null and q.claimed_at is not null and q.claim_token is not null and q.claim_expires_at > p_now
      and public.creator_publishing_onlyfans_operator_authorized(p_job.creator_id, q.claimed_by)
    )
  );
$$;

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
  perform 1 from public.creator_publishing_queue_tasks as queue_source join public.creator_publishing_platform_jobs as job_source on job_source.content_package_id=queue_source.content_package_id and job_source.target_platform=queue_source.target_platform where job_source.id=any(v_target_job_ids) and queue_source.status <> 'archived' order by queue_source.id for update of queue_source;
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
      select count(*) into v_queue_count from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.target_platform='onlyfans' and queue_source.status <> 'archived';
      if v_queue_count <> 1 or not public.creator_publishing_task17a_queue_task_compatible(job_rec, v_now, case when v_action='schedule' then array['ready_for_handoff','awaiting_operator','due_now']::text[] else array['ready_for_handoff','scheduled_internally','awaiting_operator','due_now']::text[] end) then v_gate_code := 'ACTIVE_QUEUE_TASK_CONFLICT'; end if;
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
  if v_gate_code is null and job_rec.publishing_mode='assisted' and not public.creator_publishing_task17a_queue_task_compatible(job_rec, v_now, case when event_rec.event_type='operator_due' then array['ready_for_handoff','scheduled_internally']::text[] else array['scheduled_internally','awaiting_operator','due_now']::text[] end) then
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
  if job_rec.publishing_mode='assisted' then
    update public.creator_publishing_queue_tasks
    set status = case when event_rec.event_type='operator_due' then 'awaiting_operator' else 'due_now' end,
        updated_at = v_now
    where content_package_id=job_rec.content_package_id
      and creator_id=job_rec.creator_id
      and target_platform='onlyfans'
      and platform_account_id=job_rec.platform_account_id
      and status <> 'archived'
      and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null;
  end if;
  update public.creator_publishing_scheduler_events set status='processed', processed_at=v_now, lock_token=null, locked_at=null, updated_at=v_now where id=event_rec.id and lock_token=p_lock_token;
  update public.creator_publishing_plans set status=public.creator_publishing_aggregate_plan_status(plan_rec.id), updated_at=v_now where id=plan_rec.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,null,'scheduler','creator_publishing_scheduler_event_processed',jsonb_build_object('status','processing','event_type',event_rec.event_type,'schedule_revision',event_rec.schedule_revision),jsonb_build_object('status','processed','job_state',v_next_state),v_now);
  return jsonb_build_object('ok',true,'status','processed','job_state',v_next_state);
end; $$;


revoke all on function public.creator_publishing_task17a_queue_task_compatible(public.creator_publishing_platform_jobs,timestamptz,text[]) from public, anon, authenticated;
revoke all on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) to service_role;
grant execute on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) to service_role;
