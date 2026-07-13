-- Task 17A: OnlyFans Assisted operator queue database foundation.
-- Forward-only additive migration. Extends the existing queue task, preserves Task 15,
-- introduces no platform access, credentials, sessions, browser automation, or Task 18 completion workflow.

alter table public.creator_publishing_queue_tasks
  add column if not exists claim_token uuid,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists claim_attempts integer not null default 0,
  add column if not exists operator_progress_state text not null default 'not_started',
  add column if not exists progress_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists progress_updated_at timestamptz;

alter table public.creator_publishing_queue_tasks
  drop constraint if exists creator_publishing_queue_tasks_status_check;
alter table public.creator_publishing_queue_tasks
  add constraint creator_publishing_queue_tasks_status_check check (status in (
    'draft','needs_compliance_review','needs_creator_approval','ready_for_handoff','scheduled_internally',
    'awaiting_operator','due_now','claimed','confirmed_posted_manual','skipped','failed_manual_upload',
    'needs_fix','blocked','archived'
  ));

alter table public.creator_publishing_queue_tasks
  add constraint creator_publishing_queue_claim_attempts_nonnegative check (claim_attempts >= 0),
  add constraint creator_publishing_queue_operator_progress_state_check check (
    operator_progress_state in ('not_started','preparing','prepared','handoff_ready')
  ),
  add constraint creator_publishing_queue_progress_metadata_consistent check (
    (progress_updated_at is null and progress_updated_by is null and operator_progress_state = 'not_started') or
    (progress_updated_at is not null and progress_updated_by is not null)
  ),
  add constraint creator_publishing_queue_active_claim_fields_consistent check (
    (status = 'claimed' and claimed_by is not null and claimed_at is not null and claim_token is not null and claim_expires_at is not null and claim_expires_at > claimed_at)
    or
    (status <> 'claimed' and claim_token is null and claim_expires_at is null)
  ) not valid;

comment on column public.creator_publishing_queue_tasks.assigned_operator_id is
  'Legacy/read-only during Task 17A. Active claim ownership is represented only by claimed_by, claimed_at, claim_token, and claim_expires_at.';
comment on column public.creator_publishing_queue_tasks.operator_progress_state is
  'Task 17A preparation-only progress. It does not represent platform scheduling, publishing, proof, URL, or confirmation.';

create index if not exists creator_publishing_queue_claimable_idx
  on public.creator_publishing_queue_tasks(target_platform,status,due_at,claim_expires_at,id)
  where target_platform='onlyfans' and status in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now','claimed');

create table if not exists public.creator_publishing_operator_authorizations (
  creator_id uuid not null references auth.users(id) on delete cascade,
  operator_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform = 'onlyfans'),
  status text not null default 'active' check (status in ('active','revoked')),
  authorized_at timestamptz not null default now(),
  authorized_by uuid not null references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (creator_id,operator_id,platform),
  constraint creator_publishing_operator_authorization_revocation_consistent check (
    (status='active' and revoked_at is null) or (status='revoked' and revoked_at is not null)
  )
);

create trigger trg_creator_publishing_operator_authorizations_updated_at
before update on public.creator_publishing_operator_authorizations
for each row execute function public.set_updated_at();

create table if not exists public.creator_publishing_operator_action_idempotency (
  actor_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  queue_task_id uuid not null references public.creator_publishing_queue_tasks(id) on delete cascade,
  platform_job_id uuid not null references public.creator_publishing_platform_jobs(id) on delete cascade,
  action_type text not null check (action_type in ('claim','release','progress','recover')),
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id,action_type,idempotency_key),
  unique (queue_task_id,action_type,idempotency_key)
);

alter table public.creator_publishing_operator_authorizations enable row level security;
alter table public.creator_publishing_operator_action_idempotency enable row level security;
revoke all on table public.creator_publishing_operator_authorizations from public, anon, authenticated;
revoke all on table public.creator_publishing_operator_action_idempotency from public, anon, authenticated;
grant all on table public.creator_publishing_operator_authorizations to service_role;
grant all on table public.creator_publishing_operator_action_idempotency to service_role;

create or replace function public.creator_publishing_onlyfans_operator_is_authorized(
  p_creator_id uuid,
  p_operator_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_creator_id is not null and p_operator_id is not null and (
    p_creator_id = p_operator_id or exists (
      select 1
      from public.creator_publishing_operator_authorizations authorization_source
      where authorization_source.creator_id = p_creator_id
        and authorization_source.operator_id = p_operator_id
        and authorization_source.platform = 'onlyfans'
        and authorization_source.status = 'active'
        and authorization_source.revoked_at is null
    )
  );
$$;

create or replace function public.creator_publishing_onlyfans_queue_restore_status(
  p_platform_job_id uuid,
  p_now timestamptz default clock_timestamp()
) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when job_source.schedule_revision is null then 'ready_for_handoff'
    when job_source.operator_due_at is not null and job_source.operator_due_at > p_now then 'scheduled_internally'
    when job_source.intended_publish_at is not null and job_source.intended_publish_at <= p_now then 'due_now'
    else 'awaiting_operator'
  end
  from public.creator_publishing_platform_jobs job_source
  where job_source.id = p_platform_job_id;
$$;

create or replace function public.creator_publishing_claim_onlyfans_operator_task(
  p_actor_id uuid,
  p_queue_task_id uuid,
  p_claim_minutes integer,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict error
declare
  queue_rec public.creator_publishing_queue_tasks%rowtype;
  job_rec public.creator_publishing_platform_jobs%rowtype;
  package_rec public.creator_publishing_content_packages%rowtype;
  existing_rec public.creator_publishing_operator_action_idempotency%rowtype;
  v_now timestamptz := clock_timestamp();
  v_claim_minutes integer := least(greatest(coalesce(p_claim_minutes,15),5),120);
  v_claim_token uuid := gen_random_uuid();
  v_request_fingerprint text;
  v_result jsonb;
  v_gate_code text;
begin
  if p_actor_id is null then raise exception 'OPERATOR_UNAUTHENTICATED'; end if;
  if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'OPERATOR_IDEMPOTENCY_INVALID'; end if;

  select * into queue_rec
  from public.creator_publishing_queue_tasks queue_source
  where queue_source.id=p_queue_task_id
  for update of queue_source;
  if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  if queue_rec.target_platform <> 'onlyfans' then raise exception 'OPERATOR_ONLYFANS_REQUIRED'; end if;

  select * into job_rec
  from public.creator_publishing_platform_jobs job_source
  where job_source.content_package_id=queue_rec.content_package_id
    and job_source.creator_id=queue_rec.creator_id
    and job_source.platform_account_id=queue_rec.platform_account_id
    and job_source.target_platform='onlyfans'
    and job_source.publishing_mode='assisted'
    and job_source.job_state not in ('published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived')
  order by job_source.created_at desc, job_source.id desc
  limit 1
  for update of job_source;
  if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;

  v_request_fingerprint := encode(extensions.digest(jsonb_build_object(
    'actor_id',p_actor_id,'creator_id',queue_rec.creator_id,'queue_task_id',queue_rec.id,
    'platform_job_id',job_rec.id,'action_type','claim','claim_minutes',v_claim_minutes
  )::text,'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_operator_action:'||p_actor_id::text||':claim:'||p_idempotency_key,0));
  select * into existing_rec
  from public.creator_publishing_operator_action_idempotency source
  where source.actor_id=p_actor_id and source.action_type='claim' and source.idempotency_key=p_idempotency_key
  for update of source;
  if found then
    if existing_rec.queue_task_id<>queue_rec.id or existing_rec.platform_job_id<>job_rec.id or existing_rec.request_fingerprint<>v_request_fingerprint then raise exception 'OPERATOR_IDEMPOTENCY_CONFLICT'; end if;
    return existing_rec.result || jsonb_build_object('idempotent',true);
  end if;

  if not public.creator_publishing_onlyfans_operator_is_authorized(queue_rec.creator_id,p_actor_id) then raise exception 'OPERATOR_UNAUTHORIZED'; end if;
  if job_rec.cancelled_at is not null then raise exception 'OPERATOR_JOB_CANCELLED'; end if;

  if queue_rec.status='claimed' and queue_rec.claim_expires_at is not null and queue_rec.claim_expires_at <= v_now then
    update public.creator_publishing_queue_tasks
    set status=public.creator_publishing_onlyfans_queue_restore_status(job_rec.id,v_now),
        claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null, updated_at=v_now
    where id=queue_rec.id;
    insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at)
    values('creator_publishing_queue_task',queue_rec.id,p_actor_id,'operator','creator_publishing_operator_claim_expired',
      jsonb_build_object('claimed_by',queue_rec.claimed_by,'claimed_at',queue_rec.claimed_at,'claim_expires_at',queue_rec.claim_expires_at),
      jsonb_build_object('status',public.creator_publishing_onlyfans_queue_restore_status(job_rec.id,v_now),'recovered_inside_claim',true),v_now);
    select * into queue_rec from public.creator_publishing_queue_tasks where id=p_queue_task_id for update;
  end if;

  if queue_rec.status='claimed' then raise exception 'OPERATOR_ALREADY_CLAIMED'; end if;
  if queue_rec.status not in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now') then raise exception 'OPERATOR_TASK_NOT_CLAIMABLE'; end if;

  if job_rec.schedule_revision is null then
    if queue_rec.status <> 'ready_for_handoff' then raise exception 'OPERATOR_TASK_NOT_CLAIMABLE'; end if;
  else
    if job_rec.operator_due_at is null or job_rec.operator_due_at > v_now then raise exception 'OPERATOR_NOT_DUE'; end if;
    if job_rec.job_state not in ('awaiting_operator','due_now') then raise exception 'OPERATOR_NOT_DUE'; end if;
  end if;

  select * into package_rec from public.creator_publishing_content_packages package_source where package_source.id=job_rec.content_package_id for update of package_source;
  if not found or package_rec.creator_id<>job_rec.creator_id or package_rec.platform_account_id<>job_rec.platform_account_id or package_rec.target_platform<>'onlyfans' then v_gate_code:='OPERATOR_IDENTITY_MISMATCH'; end if;
  if v_gate_code is null and not exists(select 1 from public.creator_publishing_platform_capabilities capability_source where capability_source.platform='onlyfans' and capability_source.availability_status='available' and capability_source.publishing_mode='assisted' and capability_source.human_operator_queue_supported is true and capability_source.human_publishing_required is true) then v_gate_code:='PLATFORM_UNAVAILABLE'; end if;
  if v_gate_code is null and not exists(select 1 from public.creator_publishing_creator_verifications verification_source where verification_source.creator_id=job_rec.creator_id and verification_source.status='verified') then v_gate_code:='CREATOR_VERIFICATION_MISSING'; end if;
  if v_gate_code is null and not exists(select 1 from public.creator_platform_accounts account_source where account_source.id=job_rec.platform_account_id and account_source.creator_id=job_rec.creator_id and account_source.platform='onlyfans' and account_source.verification_status='verified') then v_gate_code:='DESTINATION_ACCOUNT_NOT_VERIFIED'; end if;
  if v_gate_code is null and not exists(select 1 from public.creator_publishing_ai_twin_consents consent_source where consent_source.creator_id=job_rec.creator_id and consent_source.status='granted' and consent_source.revoked_at is null) then v_gate_code:='AI_TWIN_CONSENT_MISSING'; end if;
  if v_gate_code is null and (package_rec.creator_approval_status<>'approved' or package_rec.compliance_status not in ('passed','escalated_approved') or package_rec.compliance_policy_version is null or package_rec.compliance_policy_version='unassigned') then v_gate_code:='CREATOR_APPROVAL_MISSING'; end if;
  if v_gate_code is null and package_rec.compliance_status='passed' and not exists(select 1 from public.creator_publishing_compliance_reviews review_source where review_source.content_package_id=package_rec.id and review_source.review_source='automated' and review_source.outcome='pass' and review_source.compliance_policy_version=package_rec.compliance_policy_version) then v_gate_code:='COMPLIANCE_EVIDENCE_INVALID'; end if;
  if v_gate_code is null and package_rec.compliance_status='escalated_approved' and not exists(select 1 from public.creator_publishing_compliance_reviews review_source where review_source.content_package_id=package_rec.id and review_source.review_source='human' and review_source.outcome='escalate' and length(btrim(coalesce(review_source.escalated_approval_reason,'')))>0 and review_source.compliance_policy_version=package_rec.compliance_policy_version) then v_gate_code:='COMPLIANCE_EVIDENCE_INVALID'; end if;
  if v_gate_code is null and package_rec.second_person_present and (not exists(select 1 from public.creator_publishing_co_performer_records performer_source where performer_source.content_package_id=package_rec.id) or exists(select 1 from public.creator_publishing_co_performer_records performer_source where performer_source.content_package_id=package_rec.id and performer_source.platform_release_confirmed is not true)) then v_gate_code:='CO_PERFORMER_RELEASE_MISSING'; end if;
  if v_gate_code is null and public.creator_publishing_autopost_source_fingerprint(job_rec.content_package_id)<>job_rec.source_package_fingerprint then v_gate_code:='SOURCE_FINGERPRINT_STALE'; end if;
  if v_gate_code is null and exists(select 1 from public.creator_publishing_platform_jobs conflict_source where conflict_source.content_package_id=job_rec.content_package_id and conflict_source.id<>job_rec.id and conflict_source.job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived')) then v_gate_code:='ACTIVE_PUBLICATION_JOB_CONFLICT'; end if;
  if v_gate_code is not null then raise exception '%',v_gate_code; end if;

  update public.creator_publishing_queue_tasks
  set status='claimed', claimed_by=p_actor_id, claimed_at=v_now, claim_token=v_claim_token,
      claim_expires_at=v_now+make_interval(mins=>v_claim_minutes), claim_attempts=claim_attempts+1, updated_at=v_now
  where id=queue_rec.id;

  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at)
  values('creator_publishing_queue_task',queue_rec.id,p_actor_id,'operator','creator_publishing_operator_task_claimed',
    jsonb_build_object('status',queue_rec.status,'schedule_revision',job_rec.schedule_revision),
    jsonb_build_object('status','claimed','claimed_by',p_actor_id,'claimed_at',v_now,'claim_expires_at',v_now+make_interval(mins=>v_claim_minutes),'platform_job_id',job_rec.id),p_idempotency_key,v_now);

  v_result:=jsonb_build_object('ok',true,'action_type','claim','queue_task_id',queue_rec.id,'platform_job_id',job_rec.id,'claim_token',v_claim_token,'claim_expires_at',v_now+make_interval(mins=>v_claim_minutes),'idempotent',false);
  insert into public.creator_publishing_operator_action_idempotency(actor_id,creator_id,queue_task_id,platform_job_id,action_type,idempotency_key,request_fingerprint,result,created_at)
  values(p_actor_id,queue_rec.creator_id,queue_rec.id,job_rec.id,'claim',p_idempotency_key,v_request_fingerprint,v_result,v_now);
  return v_result;
end;
$$;

create or replace function public.creator_publishing_release_onlyfans_operator_task(
  p_actor_id uuid,
  p_queue_task_id uuid,
  p_claim_token uuid,
  p_release_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict error
declare
  queue_rec public.creator_publishing_queue_tasks%rowtype;
  job_rec public.creator_publishing_platform_jobs%rowtype;
  existing_rec public.creator_publishing_operator_action_idempotency%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_reason text:=btrim(coalesce(p_release_reason,''));
  v_restore_status text;
  v_request_fingerprint text;
  v_result jsonb;
begin
  if p_actor_id is null then raise exception 'OPERATOR_UNAUTHENTICATED'; end if;
  if p_claim_token is null then raise exception 'OPERATOR_CLAIM_TOKEN_REQUIRED'; end if;
  if length(v_reason) not between 1 and 500 then raise exception 'OPERATOR_RELEASE_REASON_REQUIRED'; end if;
  if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'OPERATOR_IDEMPOTENCY_INVALID'; end if;
  select * into queue_rec from public.creator_publishing_queue_tasks queue_source where queue_source.id=p_queue_task_id for update of queue_source;
  if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  select * into job_rec from public.creator_publishing_platform_jobs job_source where job_source.content_package_id=queue_rec.content_package_id and job_source.creator_id=queue_rec.creator_id and job_source.platform_account_id=queue_rec.platform_account_id and job_source.target_platform='onlyfans' and job_source.publishing_mode='assisted' order by job_source.created_at desc,job_source.id desc limit 1 for update of job_source;
  if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;
  v_request_fingerprint:=encode(extensions.digest(jsonb_build_object('actor_id',p_actor_id,'queue_task_id',queue_rec.id,'platform_job_id',job_rec.id,'action_type','release','claim_token',p_claim_token,'reason',v_reason)::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_operator_action:'||p_actor_id::text||':release:'||p_idempotency_key,0));
  select * into existing_rec from public.creator_publishing_operator_action_idempotency source where source.actor_id=p_actor_id and source.action_type='release' and source.idempotency_key=p_idempotency_key for update of source;
  if found then if existing_rec.queue_task_id<>queue_rec.id or existing_rec.platform_job_id<>job_rec.id or existing_rec.request_fingerprint<>v_request_fingerprint then raise exception 'OPERATOR_IDEMPOTENCY_CONFLICT'; end if; return existing_rec.result||jsonb_build_object('idempotent',true); end if;
  if not public.creator_publishing_onlyfans_operator_is_authorized(queue_rec.creator_id,p_actor_id) then raise exception 'OPERATOR_UNAUTHORIZED'; end if;
  if queue_rec.status<>'claimed' or queue_rec.claimed_by<>p_actor_id or queue_rec.claim_token is distinct from p_claim_token then raise exception 'OPERATOR_STALE_CLAIM'; end if;
  v_restore_status:=public.creator_publishing_onlyfans_queue_restore_status(job_rec.id,v_now);
  update public.creator_publishing_queue_tasks set status=v_restore_status,claimed_by=null,claimed_at=null,claim_token=null,claim_expires_at=null,updated_at=v_now where id=queue_rec.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at)
  values('creator_publishing_queue_task',queue_rec.id,p_actor_id,'operator','creator_publishing_operator_task_released',jsonb_build_object('status','claimed','claim_expires_at',queue_rec.claim_expires_at),jsonb_build_object('status',v_restore_status,'reason',v_reason),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'action_type','release','queue_task_id',queue_rec.id,'platform_job_id',job_rec.id,'status',v_restore_status,'idempotent',false);
  insert into public.creator_publishing_operator_action_idempotency values(p_actor_id,queue_rec.creator_id,queue_rec.id,job_rec.id,'release',p_idempotency_key,v_request_fingerprint,v_result,v_now);
  return v_result;
end;
$$;

create or replace function public.creator_publishing_update_onlyfans_operator_progress(
  p_actor_id uuid,
  p_queue_task_id uuid,
  p_claim_token uuid,
  p_progress_state text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict error
declare
  queue_rec public.creator_publishing_queue_tasks%rowtype;
  job_rec public.creator_publishing_platform_jobs%rowtype;
  existing_rec public.creator_publishing_operator_action_idempotency%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_progress text:=btrim(coalesce(p_progress_state,''));
  v_request_fingerprint text;
  v_result jsonb;
begin
  if p_actor_id is null then raise exception 'OPERATOR_UNAUTHENTICATED'; end if;
  if p_claim_token is null then raise exception 'OPERATOR_CLAIM_TOKEN_REQUIRED'; end if;
  if v_progress not in ('preparing','prepared','handoff_ready') then raise exception 'OPERATOR_PROGRESS_INVALID'; end if;
  if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'OPERATOR_IDEMPOTENCY_INVALID'; end if;
  select * into queue_rec from public.creator_publishing_queue_tasks queue_source where queue_source.id=p_queue_task_id for update of queue_source;
  if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  select * into job_rec from public.creator_publishing_platform_jobs job_source where job_source.content_package_id=queue_rec.content_package_id and job_source.creator_id=queue_rec.creator_id and job_source.platform_account_id=queue_rec.platform_account_id and job_source.target_platform='onlyfans' and job_source.publishing_mode='assisted' order by job_source.created_at desc,job_source.id desc limit 1 for update of job_source;
  if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;
  v_request_fingerprint:=encode(extensions.digest(jsonb_build_object('actor_id',p_actor_id,'queue_task_id',queue_rec.id,'platform_job_id',job_rec.id,'action_type','progress','claim_token',p_claim_token,'progress_state',v_progress)::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_operator_action:'||p_actor_id::text||':progress:'||p_idempotency_key,0));
  select * into existing_rec from public.creator_publishing_operator_action_idempotency source where source.actor_id=p_actor_id and source.action_type='progress' and source.idempotency_key=p_idempotency_key for update of source;
  if found then if existing_rec.queue_task_id<>queue_rec.id or existing_rec.platform_job_id<>job_rec.id or existing_rec.request_fingerprint<>v_request_fingerprint then raise exception 'OPERATOR_IDEMPOTENCY_CONFLICT'; end if; return existing_rec.result||jsonb_build_object('idempotent',true); end if;
  if not public.creator_publishing_onlyfans_operator_is_authorized(queue_rec.creator_id,p_actor_id) then raise exception 'OPERATOR_UNAUTHORIZED'; end if;
  if queue_rec.status<>'claimed' or queue_rec.claimed_by<>p_actor_id or queue_rec.claim_token is distinct from p_claim_token or queue_rec.claim_expires_at is null or queue_rec.claim_expires_at<=v_now then raise exception 'OPERATOR_STALE_CLAIM'; end if;
  if not ((queue_rec.operator_progress_state='not_started' and v_progress='preparing') or (queue_rec.operator_progress_state='preparing' and v_progress='prepared') or (queue_rec.operator_progress_state='prepared' and v_progress='handoff_ready')) then raise exception 'OPERATOR_PROGRESS_TRANSITION_INVALID'; end if;
  update public.creator_publishing_queue_tasks set operator_progress_state=v_progress,progress_updated_by=p_actor_id,progress_updated_at=v_now,updated_at=v_now where id=queue_rec.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at)
  values('creator_publishing_queue_task',queue_rec.id,p_actor_id,'operator',case v_progress when 'preparing' then 'creator_publishing_operator_preparation_started' when 'prepared' then 'creator_publishing_operator_package_prepared' else 'creator_publishing_operator_handoff_ready' end,jsonb_build_object('operator_progress_state',queue_rec.operator_progress_state),jsonb_build_object('operator_progress_state',v_progress,'platform_job_id',job_rec.id),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'action_type','progress','queue_task_id',queue_rec.id,'platform_job_id',job_rec.id,'operator_progress_state',v_progress,'idempotent',false);
  insert into public.creator_publishing_operator_action_idempotency values(p_actor_id,queue_rec.creator_id,queue_rec.id,job_rec.id,'progress',p_idempotency_key,v_request_fingerprint,v_result,v_now);
  return v_result;
end;
$$;

create or replace function public.creator_publishing_recover_expired_onlyfans_operator_claim(
  p_actor_id uuid,
  p_queue_task_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict error
declare
  queue_rec public.creator_publishing_queue_tasks%rowtype;
  job_rec public.creator_publishing_platform_jobs%rowtype;
  existing_rec public.creator_publishing_operator_action_idempotency%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_restore_status text;
  v_request_fingerprint text;
  v_result jsonb;
begin
  if p_actor_id is null then raise exception 'OPERATOR_UNAUTHENTICATED'; end if;
  if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'OPERATOR_IDEMPOTENCY_INVALID'; end if;
  select * into queue_rec from public.creator_publishing_queue_tasks queue_source where queue_source.id=p_queue_task_id for update of queue_source;
  if not found then raise exception 'OPERATOR_TASK_NOT_FOUND'; end if;
  select * into job_rec from public.creator_publishing_platform_jobs job_source where job_source.content_package_id=queue_rec.content_package_id and job_source.creator_id=queue_rec.creator_id and job_source.platform_account_id=queue_rec.platform_account_id and job_source.target_platform='onlyfans' and job_source.publishing_mode='assisted' order by job_source.created_at desc,job_source.id desc limit 1 for update of job_source;
  if not found then raise exception 'OPERATOR_JOB_NOT_FOUND'; end if;
  v_request_fingerprint:=encode(extensions.digest(jsonb_build_object('actor_id',p_actor_id,'queue_task_id',queue_rec.id,'platform_job_id',job_rec.id,'action_type','recover')::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_operator_action:'||p_actor_id::text||':recover:'||p_idempotency_key,0));
  select * into existing_rec from public.creator_publishing_operator_action_idempotency source where source.actor_id=p_actor_id and source.action_type='recover' and source.idempotency_key=p_idempotency_key for update of source;
  if found then if existing_rec.queue_task_id<>queue_rec.id or existing_rec.platform_job_id<>job_rec.id or existing_rec.request_fingerprint<>v_request_fingerprint then raise exception 'OPERATOR_IDEMPOTENCY_CONFLICT'; end if; return existing_rec.result||jsonb_build_object('idempotent',true); end if;
  if not public.creator_publishing_onlyfans_operator_is_authorized(queue_rec.creator_id,p_actor_id) then raise exception 'OPERATOR_UNAUTHORIZED'; end if;
  if queue_rec.status<>'claimed' or queue_rec.claim_expires_at is null or queue_rec.claim_expires_at>v_now then raise exception 'OPERATOR_CLAIM_NOT_EXPIRED'; end if;
  v_restore_status:=public.creator_publishing_onlyfans_queue_restore_status(job_rec.id,v_now);
  update public.creator_publishing_queue_tasks set status=v_restore_status,claimed_by=null,claimed_at=null,claim_token=null,claim_expires_at=null,updated_at=v_now where id=queue_rec.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at)
  values('creator_publishing_queue_task',queue_rec.id,p_actor_id,'operator','creator_publishing_operator_claim_expired',jsonb_build_object('status','claimed','claimed_by',queue_rec.claimed_by,'claim_expires_at',queue_rec.claim_expires_at),jsonb_build_object('status',v_restore_status,'explicit_recovery',true),p_idempotency_key,v_now);
  v_result:=jsonb_build_object('ok',true,'action_type','recover','queue_task_id',queue_rec.id,'platform_job_id',job_rec.id,'status',v_restore_status,'idempotent',false);
  insert into public.creator_publishing_operator_action_idempotency values(p_actor_id,queue_rec.creator_id,queue_rec.id,job_rec.id,'recover',p_idempotency_key,v_request_fingerprint,v_result,v_now);
  return v_result;
end;
$$;

-- Narrow Task 15 compatibility extension: preserve the complete Task 15 processor and
-- temporarily present a valid active Task 17A claim as the unclaimed handoff row expected
-- by Task 15. The platform job, scheduler event, schedule revision, locks, cancellation,
-- routing, gate validation, and due-state transition remain exclusively controlled by Task 15.
alter function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)
  rename to creator_publishing_process_scheduler_event_task15;

create or replace function public.creator_publishing_process_scheduler_event(
  p_event_id uuid,
  p_lock_token uuid,
  p_current_ai_twin_consent_version text,
  p_current_attestation_text_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict error
declare
  event_rec public.creator_publishing_scheduler_events%rowtype;
  job_rec public.creator_publishing_platform_jobs%rowtype;
  queue_rec public.creator_publishing_queue_tasks%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_valid_active_claim boolean:=false;
  v_claimed_by uuid;
  v_claimed_at timestamptz;
  v_claim_token uuid;
  v_claim_expires_at timestamptz;
  v_claim_attempts integer;
  v_progress_state text;
  v_progress_updated_by uuid;
  v_progress_updated_at timestamptz;
  v_result jsonb;
begin
  select * into event_rec from public.creator_publishing_scheduler_events where id=p_event_id;
  if found then
    select * into job_rec from public.creator_publishing_platform_jobs where id=event_rec.platform_job_id;
    if found and job_rec.target_platform='onlyfans' and job_rec.publishing_mode='assisted' then
      select * into queue_rec
      from public.creator_publishing_queue_tasks queue_source
      where queue_source.content_package_id=job_rec.content_package_id
        and queue_source.creator_id=job_rec.creator_id
        and queue_source.target_platform='onlyfans'
        and queue_source.platform_account_id=job_rec.platform_account_id
        and queue_source.status='claimed'
      order by queue_source.id
      limit 1
      for update of queue_source;
      if found then
        v_valid_active_claim := queue_rec.claimed_by is not null and queue_rec.claimed_at is not null and queue_rec.claim_token is not null and queue_rec.claim_expires_at is not null and queue_rec.claim_expires_at>v_now and public.creator_publishing_onlyfans_operator_is_authorized(queue_rec.creator_id,queue_rec.claimed_by) and queue_rec.posted_by is null and queue_rec.posted_at is null and queue_rec.posted_confirmation is false and queue_rec.final_post_url is null and queue_rec.final_post_url_skip_reason is null and queue_rec.proof_screenshot_storage_key is null and queue_rec.skip_or_fail_reason is null;
        if v_valid_active_claim then
          v_claimed_by:=queue_rec.claimed_by; v_claimed_at:=queue_rec.claimed_at; v_claim_token:=queue_rec.claim_token; v_claim_expires_at:=queue_rec.claim_expires_at; v_claim_attempts:=queue_rec.claim_attempts; v_progress_state:=queue_rec.operator_progress_state; v_progress_updated_by:=queue_rec.progress_updated_by; v_progress_updated_at:=queue_rec.progress_updated_at;
          update public.creator_publishing_queue_tasks set status='ready_for_handoff',claimed_by=null,claimed_at=null,claim_token=null,claim_expires_at=null where id=queue_rec.id;
        end if;
      end if;
    end if;
  end if;

  v_result:=public.creator_publishing_process_scheduler_event_task15(p_event_id,p_lock_token,p_current_ai_twin_consent_version,p_current_attestation_text_sha256);

  if v_valid_active_claim then
    update public.creator_publishing_queue_tasks
    set status='claimed',claimed_by=v_claimed_by,claimed_at=v_claimed_at,claim_token=v_claim_token,claim_expires_at=v_claim_expires_at,claim_attempts=v_claim_attempts,operator_progress_state=v_progress_state,progress_updated_by=v_progress_updated_by,progress_updated_at=v_progress_updated_at
    where id=queue_rec.id;
  end if;
  return v_result;
exception when others then
  if v_valid_active_claim then
    update public.creator_publishing_queue_tasks
    set status='claimed',claimed_by=v_claimed_by,claimed_at=v_claimed_at,claim_token=v_claim_token,claim_expires_at=v_claim_expires_at,claim_attempts=v_claim_attempts,operator_progress_state=v_progress_state,progress_updated_by=v_progress_updated_by,progress_updated_at=v_progress_updated_at
    where id=queue_rec.id;
  end if;
  raise;
end;
$$;

revoke all on function public.creator_publishing_onlyfans_operator_is_authorized(uuid,uuid) from public, anon, authenticated;
revoke all on function public.creator_publishing_onlyfans_queue_restore_status(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,integer,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_release_onlyfans_operator_task(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_update_onlyfans_operator_progress(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_recover_expired_onlyfans_operator_claim(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_process_scheduler_event_task15(uuid,uuid,text,text) from public, anon, authenticated;

grant execute on function public.creator_publishing_onlyfans_operator_is_authorized(uuid,uuid) to service_role;
grant execute on function public.creator_publishing_onlyfans_queue_restore_status(uuid,timestamptz) to service_role;
grant execute on function public.creator_publishing_claim_onlyfans_operator_task(uuid,uuid,integer,text) to service_role;
grant execute on function public.creator_publishing_release_onlyfans_operator_task(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.creator_publishing_update_onlyfans_operator_progress(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.creator_publishing_recover_expired_onlyfans_operator_claim(uuid,uuid,text) to service_role;
grant execute on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) to service_role;
grant execute on function public.creator_publishing_process_scheduler_event_task15(uuid,uuid,text,text) to service_role;
