-- Task 15: Creator Publishing scheduler due-state database engine.
-- Forward-only additive migration. No platform calls, no Fanvue enablement, no legacy queue mutation.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.creator_publishing_queue_jsonb_has_forbidden_credential_key(value jsonb)
returns boolean
language plpgsql
immutable
as $$
#variable_conflict error
declare
  object_entry record;
  array_entry record;
begin
  if jsonb_typeof($1) = 'object' then
    for object_entry in
      select object_source.key as object_key, object_source.value as object_value
      from jsonb_each($1) as object_source(key, value)
    loop
      if lower(object_entry.object_key) in (
        'password','access_token','refresh_token','auth_token','session','session_id',
        'cookie','cookies','two_factor_secret','recovery_code','platform_secret'
      ) then
        return true;
      end if;
      if public.creator_publishing_queue_jsonb_has_forbidden_credential_key(object_entry.object_value) then
        return true;
      end if;
    end loop;
    return false;
  end if;

  if jsonb_typeof($1) = 'array' then
    for array_entry in
      select array_source.value as array_value
      from jsonb_array_elements($1) as array_source(value)
    loop
      if public.creator_publishing_queue_jsonb_has_forbidden_credential_key(array_entry.array_value) then
        return true;
      end if;
    end loop;
    return false;
  end if;

  return false;
end;
$$;

alter table public.creator_publishing_platform_jobs
  add column if not exists intended_publish_at timestamptz,
  add column if not exists schedule_timezone text,
  add column if not exists operator_due_at timestamptz,
  add column if not exists schedule_revision integer,
  add column if not exists scheduled_at timestamptz,
  add column if not exists scheduled_by uuid references auth.users(id) on delete set null,
  add column if not exists rescheduled_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text;

alter table public.creator_publishing_platform_jobs
  add constraint creator_publishing_jobs_id_plan_creator_unique unique (id, publishing_plan_id, creator_id),
  add constraint creator_publishing_jobs_schedule_revision_positive check (schedule_revision is null or schedule_revision > 0),
  add constraint creator_publishing_jobs_unscheduled_fields_null check (
    schedule_revision is not null or (
      intended_publish_at is null and schedule_timezone is null and operator_due_at is null and
      scheduled_at is null and scheduled_by is null and rescheduled_at is null
    )
  ),
  add constraint creator_publishing_jobs_scheduled_fields_required check (
    schedule_revision is null or (
      intended_publish_at is not null and schedule_timezone is not null and length(btrim(schedule_timezone)) > 0 and scheduled_at is not null and scheduled_by is not null
    )
  ),
  add constraint creator_publishing_jobs_cancellation_metadata_consistent check (
    (cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
    (cancelled_at is not null and cancelled_by is not null and length(btrim(coalesce(cancellation_reason,''))) between 1 and 500)
  );

create table if not exists public.creator_publishing_scheduler_events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null,
  publishing_plan_id uuid not null,
  platform_job_id uuid not null,
  event_type text not null check (event_type in ('operator_due','publish_due')),
  status text not null default 'pending' check (status in ('pending','processing','processed','blocked','superseded','cancelled')),
  due_at timestamptz not null,
  schedule_revision integer not null check (schedule_revision > 0),
  processing_attempts integer not null default 0 check (processing_attempts >= 0),
  lock_token uuid,
  locked_at timestamptz,
  processed_at timestamptz,
  superseded_at timestamptz,
  cancelled_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_scheduler_events_plan_creator_fk foreign key (publishing_plan_id, creator_id) references public.creator_publishing_plans(id, creator_id) on delete cascade,
  constraint creator_publishing_scheduler_events_job_plan_creator_fk foreign key (platform_job_id, publishing_plan_id, creator_id) references public.creator_publishing_platform_jobs(id, publishing_plan_id, creator_id) on delete cascade,
  constraint creator_publishing_scheduler_events_job_type_revision_unique unique (platform_job_id, event_type, schedule_revision),
  constraint creator_publishing_scheduler_events_processing_lock_required check (status <> 'processing' or (lock_token is not null and locked_at is not null)),
  constraint creator_publishing_scheduler_events_nonprocessing_lock_clear check (status = 'processing' or (lock_token is null and locked_at is null)),
  constraint creator_publishing_scheduler_events_processed_timestamp check (status <> 'processed' or processed_at is not null),
  constraint creator_publishing_scheduler_events_blocked_metadata check (status <> 'blocked' or (processed_at is not null and length(btrim(coalesce(safe_error_code,''))) > 0)),
  constraint creator_publishing_scheduler_events_superseded_timestamp check (status <> 'superseded' or superseded_at is not null),
  constraint creator_publishing_scheduler_events_cancelled_timestamp check (status <> 'cancelled' or cancelled_at is not null)
);

create index if not exists creator_publishing_scheduler_events_due_idx on public.creator_publishing_scheduler_events(status, due_at, platform_job_id, event_type, id) where status in ('pending','processing');
create index if not exists creator_publishing_scheduler_events_job_active_idx on public.creator_publishing_scheduler_events(platform_job_id, status, due_at, event_type, id) where status in ('pending','processing');
create index if not exists creator_publishing_scheduler_events_plan_job_revision_idx on public.creator_publishing_scheduler_events(publishing_plan_id, platform_job_id, schedule_revision);

drop trigger if exists trg_creator_publishing_scheduler_events_updated_at on public.creator_publishing_scheduler_events;
create trigger trg_creator_publishing_scheduler_events_updated_at before update on public.creator_publishing_scheduler_events for each row execute function public.set_updated_at();

create table if not exists public.creator_publishing_scheduler_idempotency (
  creator_id uuid not null references auth.users(id) on delete cascade,
  publishing_plan_id uuid not null,
  action_type text not null check (action_type in ('schedule','reschedule','cancel_plan','cancel_job')),
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint creator_publishing_scheduler_idempotency_pk primary key (creator_id, publishing_plan_id, action_type, idempotency_key),
  constraint creator_publishing_scheduler_idempotency_creator_action_key_unique unique (creator_id, action_type, idempotency_key),
  constraint creator_publishing_scheduler_idempotency_plan_creator_fk foreign key (publishing_plan_id, creator_id) references public.creator_publishing_plans(id, creator_id) on delete cascade
);

alter table public.creator_publishing_scheduler_events enable row level security;
alter table public.creator_publishing_scheduler_idempotency enable row level security;
revoke all on table public.creator_publishing_scheduler_events from public, anon, authenticated;
revoke all on table public.creator_publishing_scheduler_idempotency from public, anon, authenticated;
grant all on table public.creator_publishing_scheduler_events to service_role;
grant all on table public.creator_publishing_scheduler_idempotency to service_role;

create or replace function public.creator_publishing_scheduler_validate_timezone(p_schedule_timezone text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_schedule_timezone);
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
      if v_queue_count <> 1 or not exists (select 1 from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.creator_id=job_rec.creator_id and queue_source.target_platform='onlyfans' and queue_source.platform_account_id=job_rec.platform_account_id and queue_source.status='ready_for_handoff' and queue_source.claimed_by is null and queue_source.claimed_at is null and queue_source.posted_by is null and queue_source.posted_at is null and queue_source.posted_confirmation is false and queue_source.final_post_url is null and queue_source.final_post_url_skip_reason is null and queue_source.proof_screenshot_storage_key is null and queue_source.skip_or_fail_reason is null) then v_gate_code := 'ACTIVE_QUEUE_TASK_CONFLICT'; end if;
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

create or replace function public.creator_publishing_cancel_plan_schedule(p_creator_id uuid, p_publishing_plan_id uuid, p_cancellation_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict error
declare
  plan_rec public.creator_publishing_plans%rowtype;
  v_now timestamptz := clock_timestamp();
  v_reason text := btrim(coalesce(p_cancellation_reason,''));
  v_request_fingerprint text;
  idempotency_rec public.creator_publishing_scheduler_idempotency%rowtype;
  v_result jsonb;
begin
  if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if length(v_reason) not between 1 and 500 then raise exception 'SCHEDULER_CANCELLATION_REASON_REQUIRED'; end if;
  v_request_fingerprint := encode(extensions.digest(jsonb_build_object('creator_id',p_creator_id,'publishing_plan_id',p_publishing_plan_id,'action_type','cancel_plan','reason',v_reason)::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_scheduler_idempotency:'||p_creator_id::text||':cancel_plan:'||p_idempotency_key,0));
  select * into idempotency_rec from public.creator_publishing_scheduler_idempotency as idempotency_source where creator_id=p_creator_id and action_type='cancel_plan' and idempotency_key=p_idempotency_key for update of idempotency_source;
  if found then if idempotency_rec.publishing_plan_id<>p_publishing_plan_id or idempotency_rec.request_fingerprint<>v_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return idempotency_rec.result || jsonb_build_object('idempotent', true); end if;
  select * into plan_rec from public.creator_publishing_plans as plan_source where id=p_publishing_plan_id and creator_id=p_creator_id for update of plan_source;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  perform 1 from public.creator_publishing_platform_jobs as job_source where publishing_plan_id=p_publishing_plan_id order by id for update of job_source;
  perform 1 from public.creator_publishing_scheduler_events as event_source where publishing_plan_id=p_publishing_plan_id and status in ('pending','processing') order by id for update of event_source;
  update public.creator_publishing_scheduler_events set status='cancelled', cancelled_at=v_now, lock_token=null, locked_at=null, updated_at=v_now where publishing_plan_id=p_publishing_plan_id and status in ('pending','processing');
  update public.creator_publishing_platform_jobs set job_state='archived', cancelled_at=v_now, cancelled_by=p_creator_id, cancellation_reason=v_reason, updated_at=v_now where publishing_plan_id=p_publishing_plan_id and job_state not in ('published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived');
  update public.creator_publishing_plans set status='cancelled', cancelled_at=v_now, cancelled_by=p_creator_id, cancellation_reason=v_reason, updated_at=v_now where id=p_publishing_plan_id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_plan',p_publishing_plan_id,p_creator_id,'creator','creator_publishing_schedule_cancelled',jsonb_build_object('status',plan_rec.status),jsonb_build_object('status','cancelled','reason',v_reason),p_idempotency_key,v_now);
  v_result := jsonb_build_object('ok',true,'action_type','cancel_plan','publishing_plan_id',p_publishing_plan_id,'idempotent',false);
  insert into public.creator_publishing_scheduler_idempotency values(p_creator_id,p_publishing_plan_id,'cancel_plan',p_idempotency_key,v_request_fingerprint,v_result,v_now);
  return v_result;
end; $$;

create or replace function public.creator_publishing_cancel_job_schedule(p_creator_id uuid, p_platform_job_id uuid, p_cancellation_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict error
declare
  job_rec public.creator_publishing_platform_jobs%rowtype;
  plan_rec public.creator_publishing_plans%rowtype;
  v_now timestamptz := clock_timestamp();
  v_reason text := btrim(coalesce(p_cancellation_reason,''));
  v_request_fingerprint text;
  idempotency_rec public.creator_publishing_scheduler_idempotency%rowtype;
  v_result jsonb;
  v_resulting_job_state text;
begin
  if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if length(v_reason) not between 1 and 500 then raise exception 'SCHEDULER_CANCELLATION_REASON_REQUIRED'; end if;
  select * into job_rec from public.creator_publishing_platform_jobs where id=p_platform_job_id and creator_id=p_creator_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  v_request_fingerprint := encode(extensions.digest(jsonb_build_object('creator_id',p_creator_id,'publishing_plan_id',job_rec.publishing_plan_id,'job_id',p_platform_job_id,'action_type','cancel_job','reason',v_reason)::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator_scheduler_idempotency:'||p_creator_id::text||':cancel_job:'||p_idempotency_key,0));
  select * into idempotency_rec from public.creator_publishing_scheduler_idempotency as idempotency_source where creator_id=p_creator_id and action_type='cancel_job' and idempotency_key=p_idempotency_key for update of idempotency_source;
  if found then if idempotency_rec.publishing_plan_id<>job_rec.publishing_plan_id or idempotency_rec.request_fingerprint<>v_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return idempotency_rec.result || jsonb_build_object('idempotent', true); end if;
  select * into plan_rec from public.creator_publishing_plans as plan_source where id=job_rec.publishing_plan_id and creator_id=p_creator_id for update of plan_source;
  select * into job_rec from public.creator_publishing_platform_jobs as job_source where id=p_platform_job_id and creator_id=p_creator_id for update of job_source;
  v_resulting_job_state := job_rec.job_state;
  perform 1 from public.creator_publishing_scheduler_events as event_source where platform_job_id=p_platform_job_id and status in ('pending','processing') order by id for update of event_source;
  update public.creator_publishing_scheduler_events set status='cancelled', cancelled_at=v_now, lock_token=null, locked_at=null, updated_at=v_now where platform_job_id=p_platform_job_id and status in ('pending','processing');
  if job_rec.job_state not in ('published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived') then update public.creator_publishing_platform_jobs set job_state='archived', cancelled_at=v_now, cancelled_by=p_creator_id, cancellation_reason=v_reason, updated_at=v_now where id=p_platform_job_id; v_resulting_job_state := 'archived'; end if;
  update public.creator_publishing_plans set status=public.creator_publishing_aggregate_plan_status(job_rec.publishing_plan_id), updated_at=v_now where id=job_rec.publishing_plan_id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_platform_job',p_platform_job_id,p_creator_id,'creator','creator_publishing_job_schedule_cancelled',jsonb_build_object('job_state',job_rec.job_state),jsonb_build_object('job_state',v_resulting_job_state,'reason',v_reason),p_idempotency_key,v_now);
  v_result := jsonb_build_object('ok',true,'action_type','cancel_job','platform_job_id',p_platform_job_id,'publishing_plan_id',job_rec.publishing_plan_id,'idempotent',false);
  insert into public.creator_publishing_scheduler_idempotency values(p_creator_id,job_rec.publishing_plan_id,'cancel_job',p_idempotency_key,v_request_fingerprint,v_result,v_now);
  return v_result;
end; $$;

create or replace function public.creator_publishing_claim_due_scheduler_events(p_limit integer default 25, p_lock_minutes integer default 15)
returns table(event_id uuid, lock_token uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
with bounds as (
  select least(greatest(coalesce(p_limit,25),1),50) as claim_limit,
         make_interval(mins => least(greatest(coalesce(p_lock_minutes,15),1),60)) as lock_ttl,
         clock_timestamp() as db_now
), eligible as (
  select event_source.id, event_source.platform_job_id, event_source.due_at, event_source.event_type, event_source.schedule_revision,
         event_source.status as prior_status, event_source.processing_attempts as prior_processing_attempts,
         case event_source.event_type when 'operator_due' then 0 else 1 end as event_order
  from public.creator_publishing_scheduler_events as event_source cross join bounds
  where (
    (event_source.status = 'pending' and event_source.due_at <= bounds.db_now)
    or
    (event_source.status = 'processing' and event_source.locked_at < bounds.db_now - bounds.lock_ttl)
  )
  and not exists (
    select 1 from public.creator_publishing_scheduler_events as earlier_event_source
    where earlier_event_source.platform_job_id=event_source.platform_job_id
      and earlier_event_source.status in ('pending','processing')
      and earlier_event_source.id<>event_source.id
      and (
        earlier_event_source.due_at < event_source.due_at or
        (earlier_event_source.due_at = event_source.due_at and (case earlier_event_source.event_type when 'operator_due' then 0 else 1 end) < (case event_source.event_type when 'operator_due' then 0 else 1 end)) or
        (earlier_event_source.due_at = event_source.due_at and earlier_event_source.event_type=event_source.event_type and earlier_event_source.id < event_source.id)
      )
  )
  and not exists (
    select 1 from public.creator_publishing_scheduler_events as processing_event_source cross join bounds as processing_bounds
    where processing_event_source.platform_job_id=event_source.platform_job_id
      and processing_event_source.status='processing'
      and processing_event_source.id<>event_source.id
      and processing_event_source.locked_at >= processing_bounds.db_now - processing_bounds.lock_ttl
  )
  order by event_source.due_at, case event_source.event_type when 'operator_due' then 0 else 1 end, event_source.id
  limit (select claim_limit from bounds)
  for update of event_source skip locked
), claimed as (
  update public.creator_publishing_scheduler_events as event_update
  set status='processing', lock_token=gen_random_uuid(), locked_at=(select db_now from bounds), processing_attempts=event_update.processing_attempts+1, updated_at=(select db_now from bounds)
  from eligible
  where event_update.id=eligible.id and event_update.status in ('pending','processing')
  returning event_update.id, event_update.lock_token, event_update.status as new_status, event_update.processing_attempts as new_processing_attempts,
            eligible.prior_status, eligible.prior_processing_attempts, eligible.due_at, eligible.event_type, eligible.schedule_revision, eligible.event_order, eligible.platform_job_id
), claim_audits as (
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at)
  select 'creator_publishing_scheduler_event', claimed.id, null, 'scheduler', 'creator_publishing_scheduler_event_claimed',
         jsonb_build_object('status',claimed.prior_status,'processing_attempts',claimed.prior_processing_attempts,'event_type',claimed.event_type,'due_at',claimed.due_at,'schedule_revision',claimed.schedule_revision),
         jsonb_build_object('status',claimed.new_status,'processing_attempts',claimed.new_processing_attempts,'event_type',claimed.event_type,'due_at',claimed.due_at,'schedule_revision',claimed.schedule_revision),
         (select db_now from bounds)
  from claimed
  returning id
)
select claimed.id as event_id, claimed.lock_token from claimed;
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
  if v_gate_code is null and job_rec.publishing_mode='assisted' and (not exists (select 1 from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.creator_id=job_rec.creator_id and queue_source.target_platform='onlyfans' and queue_source.platform_account_id=job_rec.platform_account_id and queue_source.status='ready_for_handoff' and queue_source.claimed_by is null and queue_source.claimed_at is null and queue_source.posted_by is null and queue_source.posted_at is null and queue_source.posted_confirmation is false and queue_source.final_post_url is null and queue_source.final_post_url_skip_reason is null and queue_source.proof_screenshot_storage_key is null and queue_source.skip_or_fail_reason is null) or (select count(*) from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.target_platform='onlyfans' and queue_source.status <> 'archived') <> 1) then
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
  update public.creator_publishing_scheduler_events set status='processed', processed_at=v_now, lock_token=null, locked_at=null, updated_at=v_now where id=event_rec.id and lock_token=p_lock_token;
  update public.creator_publishing_plans set status=public.creator_publishing_aggregate_plan_status(plan_rec.id), updated_at=v_now where id=plan_rec.id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,null,'scheduler','creator_publishing_scheduler_event_processed',jsonb_build_object('status','processing','event_type',event_rec.event_type,'schedule_revision',event_rec.schedule_revision),jsonb_build_object('status','processed','job_state',v_next_state),v_now);
  return jsonb_build_object('ok',true,'status','processed','job_state',v_next_state);
end; $$;

revoke all on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_cancel_plan_schedule(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_cancel_job_schedule(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_claim_due_scheduler_events(integer,integer) from public, anon, authenticated;
revoke all on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) to service_role;
grant execute on function public.creator_publishing_cancel_plan_schedule(uuid,uuid,text,text) to service_role;
grant execute on function public.creator_publishing_cancel_job_schedule(uuid,uuid,text,text) to service_role;
grant execute on function public.creator_publishing_claim_due_scheduler_events(integer,integer) to service_role;
grant execute on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) to service_role;
