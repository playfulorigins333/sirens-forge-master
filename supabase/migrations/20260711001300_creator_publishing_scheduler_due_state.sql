-- Task 15: platform-neutral Creator Publishing scheduler and due-state engine.
-- Forward-only additive migration. Do not apply automatically; do not edit migrations 00100-01200.
create extension if not exists pgcrypto with schema extensions;

-- Forward-only repair for deployed Task 1 helper ambiguity under standard PL/pgSQL variable-conflict handling.
create or replace function public.creator_publishing_queue_jsonb_has_forbidden_credential_key(value jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  object_key text;
  object_value jsonb;
  array_value jsonb;
begin
  if jsonb_typeof($1) = 'object' then
    for object_key, object_value in
      select entry.key, entry.value
      from jsonb_each($1) as entry(key, value)
    loop
      if lower(object_key) in (
        'password','access_token','refresh_token','auth_token','session','session_id',
        'cookie','cookies','two_factor_secret','recovery_code','platform_secret'
      ) then
        return true;
      end if;

      if public.creator_publishing_queue_jsonb_has_forbidden_credential_key(object_value) then
        return true;
      end if;
    end loop;

    return false;
  end if;

  if jsonb_typeof($1) = 'array' then
    for array_value in
      select element.value
      from jsonb_array_elements($1) as element(value)
    loop
      if public.creator_publishing_queue_jsonb_has_forbidden_credential_key(array_value) then
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
  add constraint creator_publishing_jobs_schedule_timezone_required check (intended_publish_at is null or length(btrim(coalesce(schedule_timezone,''))) > 0),
  add constraint creator_publishing_jobs_assisted_operator_due_required check (not (publishing_mode = 'assisted' and job_state in ('scheduled_internally','awaiting_operator','due_now','claimed') and operator_due_at is null)),
  add constraint creator_publishing_jobs_operator_due_before_publish check (operator_due_at is null or intended_publish_at is null or operator_due_at <= intended_publish_at),
  add constraint creator_publishing_jobs_schedule_revision_positive check (schedule_revision is null or schedule_revision > 0),
  add constraint creator_publishing_jobs_cancelled_metadata_consistent check ((cancelled_at is null and cancelled_by is null and cancellation_reason is null) or (cancelled_at is not null and cancelled_by is not null and length(btrim(coalesce(cancellation_reason,''))) between 1 and 500)),
  add constraint creator_publishing_jobs_id_plan_creator_unique unique (id, publishing_plan_id, creator_id);

create table if not exists public.creator_publishing_schedule_idempotency (
  creator_id uuid not null references auth.users(id) on delete cascade,
  publishing_plan_id uuid not null,
  idempotency_key text not null,
  action_type text not null check (action_type in ('schedule','reschedule')),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  first_execution_snapshot_fingerprint text check (first_execution_snapshot_fingerprint is null or first_execution_snapshot_fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (creator_id, idempotency_key),
  constraint creator_publishing_schedule_idem_plan_creator_fk foreign key (publishing_plan_id, creator_id) references public.creator_publishing_plans(id, creator_id) on delete cascade
);

create table if not exists public.creator_publishing_scheduler_events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null,
  publishing_plan_id uuid not null,
  platform_job_id uuid not null,
  event_type text not null check (event_type in ('operator_due','publish_due')),
  due_at timestamptz not null,
  schedule_revision integer not null check (schedule_revision > 0),
  event_status text not null default 'pending' check (event_status in ('pending','processing','processed','blocked','superseded','cancelled')),
  processing_attempts integer not null default 0 check (processing_attempts >= 0),
  lock_token uuid,
  locked_at timestamptz,
  processed_at timestamptz,
  superseded_at timestamptz,
  cancelled_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_scheduler_plan_creator_fk foreign key (publishing_plan_id, creator_id) references public.creator_publishing_plans(id, creator_id) on delete cascade,
  constraint creator_publishing_scheduler_job_plan_creator_fk foreign key (platform_job_id, publishing_plan_id, creator_id) references public.creator_publishing_platform_jobs(id, publishing_plan_id, creator_id) on delete cascade,
  constraint creator_publishing_scheduler_event_unique unique (platform_job_id, event_type, schedule_revision),
  constraint creator_publishing_scheduler_final_metadata check (
    (event_status <> 'processed' or (processed_at is not null and lock_token is null and locked_at is null)) and
    (event_status <> 'blocked' or (processed_at is not null and lock_token is null and locked_at is null)) and
    (event_status <> 'superseded' or (superseded_at is not null and lock_token is null and locked_at is null)) and
    (event_status <> 'cancelled' or (cancelled_at is not null and lock_token is null and locked_at is null))
  )
);
create unique index if not exists creator_publishing_scheduler_active_uidx on public.creator_publishing_scheduler_events(platform_job_id,event_type,schedule_revision) where event_status in ('pending','processing');
create index if not exists creator_publishing_scheduler_due_idx on public.creator_publishing_scheduler_events(event_status,due_at,id);

drop trigger if exists trg_creator_publishing_scheduler_events_updated_at on public.creator_publishing_scheduler_events;
create trigger trg_creator_publishing_scheduler_events_updated_at before update on public.creator_publishing_scheduler_events for each row execute function public.set_updated_at();

alter table public.creator_publishing_scheduler_events enable row level security;
alter table public.creator_publishing_schedule_idempotency enable row level security;
revoke all on table public.creator_publishing_scheduler_events from public, anon, authenticated;
revoke all on table public.creator_publishing_schedule_idempotency from public, anon, authenticated;
grant all on table public.creator_publishing_scheduler_events to service_role;
grant all on table public.creator_publishing_schedule_idempotency to service_role;

create or replace function public.creator_publishing_recalculate_plan_status(p_plan_id uuid) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text; begin
  select public.creator_publishing_aggregate_plan_status(p_plan_id) into v_status;
  update public.creator_publishing_plans set status=v_status, updated_at=now() where id=p_plan_id and status <> 'cancelled';
  return v_status;
end; $$;

create or replace function public.creator_publishing_scheduler_queue_gate(p_creator_id uuid,p_content_package_id uuid,p_target_platform text,p_platform_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_nonterminal_count integer;
  v_task public.creator_publishing_queue_tasks%rowtype;
  terminal_queue_states constant text[] := array['confirmed_posted_manual','skipped','failed_manual_upload','blocked','archived'];
begin
  select count(*) into v_nonterminal_count from public.creator_publishing_queue_tasks q
  where q.content_package_id=p_content_package_id and not (q.status = any(terminal_queue_states));
  if v_nonterminal_count=0 then
    return jsonb_build_object('ok',true,'code','OK','compatible_legacy_queue_task',null);
  end if;
  if v_nonterminal_count>1 then
    return jsonb_build_object('ok',false,'code','ACTIVE_QUEUE_TASK_CONFLICT','hard',true,'compatible_legacy_queue_task',null);
  end if;
  select * into v_task from public.creator_publishing_queue_tasks q
  where q.content_package_id=p_content_package_id and not (q.status = any(terminal_queue_states))
  order by q.id for update;
  if v_task.status='ready_for_handoff'
     and v_task.creator_id=p_creator_id
     and v_task.content_package_id=p_content_package_id
     and v_task.target_platform=p_target_platform
     and v_task.platform_account_id=p_platform_account_id then
    return jsonb_build_object('ok',true,'code','OK','compatible_legacy_queue_task',jsonb_build_object('id',v_task.id,'status',v_task.status,'creator_id',v_task.creator_id,'content_package_id',v_task.content_package_id,'target_platform',v_task.target_platform,'platform_account_id',v_task.platform_account_id));
  end if;
  return jsonb_build_object('ok',false,'code','ACTIVE_QUEUE_TASK_CONFLICT','hard',true,'compatible_legacy_queue_task',null);
end; $$;

create or replace function public.creator_publishing_scheduler_fact_snapshot(p_job_id uuid,p_expected_ai_twin_consent_version text,p_expected_ai_twin_consent_text_sha256 text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict error
declare
  job_rec public.creator_publishing_platform_jobs%rowtype;
  pkg public.creator_publishing_content_packages%rowtype;
  cap public.creator_publishing_platform_capabilities%rowtype;
  acct public.creator_platform_accounts%rowtype;
  v_review jsonb;
  v_evidence jsonb;
  v_queue_gate jsonb;
  v_media jsonb;
  v_consent jsonb;
begin
  select * into job_rec from public.creator_publishing_platform_jobs where id=p_job_id;
  if not found then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  select * into pkg from public.creator_publishing_content_packages where id=job_rec.content_package_id;
  select * into cap from public.creator_publishing_platform_capabilities where platform=job_rec.target_platform;
  select * into acct from public.creator_platform_accounts where id=job_rec.platform_account_id;
  select jsonb_build_object('id',r.id,'outcome',r.outcome,'review_source',r.review_source,'reason',coalesce(r.escalated_approval_reason,r.notes,''),'compliance_policy_version',r.compliance_policy_version,'created_at',r.created_at)
    into v_review from public.creator_publishing_compliance_reviews r
    where r.content_package_id=job_rec.content_package_id
    order by r.created_at desc, r.id desc limit 1;
  select jsonb_build_object('id',r.id,'outcome',r.outcome,'review_source',r.review_source,'reason',coalesce(r.escalated_approval_reason,r.notes,''),'compliance_policy_version',r.compliance_policy_version,'created_at',r.created_at)
    into v_evidence from public.creator_publishing_compliance_reviews r
    where r.content_package_id=job_rec.content_package_id and r.compliance_policy_version=pkg.compliance_policy_version and ((pkg.compliance_status='passed' and r.review_source='automated' and r.outcome='pass') or (pkg.compliance_status='escalated_approved' and r.review_source='human' and r.outcome='escalate' and length(btrim(coalesce(r.escalated_approval_reason,r.notes,'')))>0))
    order by r.created_at desc, r.id desc limit 1;
  v_queue_gate := public.creator_publishing_scheduler_queue_gate(job_rec.creator_id,job_rec.content_package_id,job_rec.target_platform,job_rec.platform_account_id);
  select jsonb_build_object('creator_id',consent_source.creator_id,'status',consent_source.status,'revoked_at',consent_source.revoked_at,'attestation_version',consent_source.attestation_version,'attestation_text_sha256',consent_source.attestation_text_sha256,'expected_attestation_version',p_expected_ai_twin_consent_version,'expected_attestation_text_sha256',p_expected_ai_twin_consent_text_sha256) into v_consent from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=job_rec.creator_id;
  select coalesce(jsonb_agg(jsonb_build_object('media_id',m.id,'source',m.source,'generation_id',m.ai_generation_metadata ->> 'generation_id','storage_key',m.storage_key,'mime_type',m.mime_type,'sha256',m.sha256) order by m.id),'[]'::jsonb)
    into v_media from public.creator_publishing_media_assets m where m.content_package_id=job_rec.content_package_id;
  return jsonb_build_object(
    'ok',true,'job_id',job_rec.id,'creator_id',job_rec.creator_id,'plan_id',job_rec.publishing_plan_id,'package_id',job_rec.content_package_id,
    'platform_account_id',job_rec.platform_account_id,'target_platform',job_rec.target_platform,'publishing_mode',job_rec.publishing_mode,
    'capability_registry_version',coalesce(cap.registry_version,''),'capability_mode',coalesce(cap.publishing_mode,''),'capability_available',coalesce(cap.availability_status,'')='available',
    'package_compliance_status',coalesce(pkg.compliance_status,''),'creator_approval_status',coalesce(pkg.creator_approval_status,''),
    'creator_approved_at',pkg.creator_approved_at,'creator_approved_by',pkg.creator_approved_by,
    'ai_flag',coalesce(pkg.ai_flag,''),'second_person_present',coalesce(pkg.second_person_present,false),
    'account_verification_status',coalesce(acct.verification_status,''),'ai_twin_consent',coalesce(v_consent,'{}'::jsonb),'latest_compliance_review',coalesce(v_review,'{}'::jsonb),'current_compliance_evidence',coalesce(v_evidence,'{}'::jsonb),'queue_gate',v_queue_gate,
    'media',v_media,'source_package_fingerprint',job_rec.source_package_fingerprint,
    'source_is_current',public.creator_publishing_job_source_is_current(job_rec.id)
  );
end; $$;

create or replace function public.creator_publishing_scheduler_gate(p_job_id uuid,p_expected_ai_twin_consent_version text,p_expected_ai_twin_consent_text_sha256 text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict error
declare
  job_rec public.creator_publishing_platform_jobs%rowtype;
  plan_rec public.creator_publishing_plans%rowtype;
  pkg public.creator_publishing_content_packages%rowtype;
  acct public.creator_platform_accounts%rowtype;
  cap public.creator_publishing_platform_capabilities%rowtype;
  current_review public.creator_publishing_compliance_reviews%rowtype;
  later_review public.creator_publishing_compliance_reviews%rowtype;
  consent public.creator_publishing_ai_twin_consents%rowtype;
  v_queue_gate jsonb;
  v_media_count integer;
  v_media_bad boolean;
  v_profile_id uuid;
  v_snapshot jsonb;
  terminal_states constant text[] := array['published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived'];
begin
  select * into job_rec from public.creator_publishing_platform_jobs where id=p_job_id;
  if not found then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND','hard',true); end if;
  select * into plan_rec from public.creator_publishing_plans where id=job_rec.publishing_plan_id and creator_id=job_rec.creator_id;
  if not found then return jsonb_build_object('ok',false,'code','PLAN_OWNERSHIP_INVALID','hard',true); end if;
  if job_rec.job_state = any(terminal_states) then return jsonb_build_object('ok',false,'code','TERMINAL_JOB','hard',true); end if;
  select * into pkg from public.creator_publishing_content_packages where id=job_rec.content_package_id and creator_id=job_rec.creator_id and platform_account_id=job_rec.platform_account_id and target_platform=job_rec.target_platform;
  if not found then return jsonb_build_object('ok',false,'code','PACKAGE_OWNERSHIP_INVALID','hard',true); end if;
  select * into acct from public.creator_platform_accounts where id=job_rec.platform_account_id and creator_id=job_rec.creator_id and platform=job_rec.target_platform;
  if not found then return jsonb_build_object('ok',false,'code','DESTINATION_ACCOUNT_INVALID','hard',true); end if;
  select * into cap from public.creator_publishing_platform_capabilities where platform=job_rec.target_platform;
  if not found then return jsonb_build_object('ok',false,'code','CAPABILITY_NOT_FOUND','hard',true); end if;
  if cap.registry_version <> job_rec.capability_registry_version or cap.publishing_mode <> job_rec.publishing_mode then return jsonb_build_object('ok',false,'code','CAPABILITY_SNAPSHOT_STALE','hard',false); end if;
  if cap.availability_status <> 'available' or cap.publishing_mode='disabled' or job_rec.publishing_mode='disabled' then return jsonb_build_object('ok',false,'code','PLATFORM_UNAVAILABLE','hard',true); end if;
  if job_rec.target_platform='fanvue' then return jsonb_build_object('ok',false,'code','FANVUE_NOT_AVAILABLE','hard',true); end if;

  if pkg.compliance_status='blocked' then
    return jsonb_build_object('ok',false,'code','COMPLIANCE_BLOCKED','hard',true);
  elsif pkg.compliance_status='passed' then
    select * into current_review from public.creator_publishing_compliance_reviews r
    where r.content_package_id=pkg.id and r.review_source='automated' and r.outcome='pass' and r.compliance_policy_version=pkg.compliance_policy_version
    order by r.created_at desc, r.id desc limit 1;
    if current_review.id is null then return jsonb_build_object('ok',false,'code','COMPLIANCE_CURRENT_EVIDENCE_REQUIRED','hard',false); end if;
  elsif pkg.compliance_status='escalated_approved' then
    select * into current_review from public.creator_publishing_compliance_reviews r
    where r.content_package_id=pkg.id and r.review_source='human' and r.outcome='escalate' and r.compliance_policy_version=pkg.compliance_policy_version and length(btrim(coalesce(r.escalated_approval_reason,r.notes,'')))>0
    order by r.created_at desc, r.id desc limit 1;
    if current_review.id is null then return jsonb_build_object('ok',false,'code','COMPLIANCE_CURRENT_EVIDENCE_REQUIRED','hard',false); end if;
  else
    return jsonb_build_object('ok',false,'code','COMPLIANCE_NOT_PASSED','hard',false);
  end if;
  select * into later_review from public.creator_publishing_compliance_reviews r
  where r.content_package_id=pkg.id and r.outcome in ('block','manual_review') and (r.created_at,r.id) > (current_review.created_at,current_review.id)
  order by r.created_at desc, r.id desc limit 1;
  if later_review.id is not null then return jsonb_build_object('ok',false,'code','COMPLIANCE_LATER_BLOCKING_REVIEW','hard',later_review.outcome='block'); end if;

  if pkg.creator_approval_status <> 'approved' or pkg.creator_approved_at is null or pkg.creator_approved_by is null then return jsonb_build_object('ok',false,'code','CREATOR_APPROVAL_REQUIRED','hard',false); end if;
  if not exists(select 1 from public.creator_publishing_creator_verifications v where v.creator_id=job_rec.creator_id and v.status='verified') then return jsonb_build_object('ok',false,'code','CREATOR_VERIFICATION_REQUIRED','hard',false); end if;
  if coalesce(acct.verification_status,'')='revoked' then return jsonb_build_object('ok',false,'code','DESTINATION_ACCOUNT_VERIFICATION_REVOKED','hard',true); end if;
  if coalesce(cap.platform_requires_creator_verification,false) and acct.verification_status <> 'verified' then return jsonb_build_object('ok',false,'code','DESTINATION_ACCOUNT_VERIFICATION_REQUIRED','hard',false); end if;
  if not coalesce(cap.platform_requires_creator_verification,false) and acct.verification_status not in ('verified','creator_attested') then return jsonb_build_object('ok',false,'code','DESTINATION_ACCOUNT_VERIFICATION_REQUIRED','hard',false); end if;
  if pkg.ai_flag in ('ai_enhanced','ai_generated') then
    select consent_source.* into consent from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=job_rec.creator_id;
    if consent.creator_id is null or consent.status <> 'granted' or consent.revoked_at is not null then return jsonb_build_object('ok',false,'code','AI_TWIN_CONSENT_REQUIRED','hard',false); end if;
    if length(btrim(coalesce(p_expected_ai_twin_consent_version,'')))=0 or consent.attestation_version is distinct from p_expected_ai_twin_consent_version then return jsonb_build_object('ok',false,'code','AI_TWIN_CONSENT_POLICY_STALE','hard',false); end if;
    if coalesce(p_expected_ai_twin_consent_text_sha256,'') !~ '^[a-f0-9]{64}$' or coalesce(consent.attestation_text_sha256,'') !~ '^[a-f0-9]{64}$' or lower(consent.attestation_text_sha256) is distinct from lower(p_expected_ai_twin_consent_text_sha256) then return jsonb_build_object('ok',false,'code','AI_TWIN_CONSENT_HASH_INVALID','hard',false); end if;
  end if;
  if pkg.second_person_present and not exists(select 1 from public.creator_publishing_co_performer_records r where r.content_package_id=pkg.id) then return jsonb_build_object('ok',false,'code','CO_PERFORMER_RELEASE_REQUIRED','hard',false); end if;
  if pkg.second_person_present and exists(select 1 from public.creator_publishing_co_performer_records r where r.content_package_id=pkg.id and (coalesce(r.platform_release_confirmed,false) is not true or length(btrim(coalesce(r.release_document_reference,'')))=0)) then return jsonb_build_object('ok',false,'code','CO_PERFORMER_RELEASE_REQUIRED','hard',false); end if;

  select count(*) into v_media_count from public.creator_publishing_media_assets m where m.content_package_id=pkg.id;
  if v_media_count=0 then return jsonb_build_object('ok',false,'code','MEDIA_REQUIRED','hard',false); end if;
  select pr.id into v_profile_id from public.profiles pr where pr.user_id=job_rec.creator_id order by pr.id limit 1;
  select exists(
    select 1 from public.creator_publishing_media_assets m
    left join public.generations g on g.id::text = m.ai_generation_metadata ->> 'generation_id'
    where m.content_package_id=pkg.id and (
      m.source <> 'ai_pipeline' or coalesce(m.ai_generation_metadata ->> 'generation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
      g.id is null or g.user_id is null or (g.user_id <> job_rec.creator_id and g.user_id is distinct from v_profile_id) or g.status is distinct from 'completed' or
      length(btrim(coalesce(g.r2_bucket,'')))=0 or length(btrim(coalesce(g.r2_key,'')))=0 or length(btrim(coalesce(m.storage_key,'')))=0 or length(btrim(coalesce(m.mime_type,'')))=0 or coalesce(m.sha256,'') !~* '^[a-f0-9]{64}$' or
      coalesce(jsonb_typeof(g.metadata -> 'placeholder')='boolean' and g.metadata -> 'placeholder'='true'::jsonb,false) or
      coalesce(jsonb_typeof(g.metadata -> 'is_placeholder')='boolean' and g.metadata -> 'is_placeholder'='true'::jsonb,false) or
      coalesce(jsonb_typeof(g.metadata -> 'test')='boolean' and g.metadata -> 'test'='true'::jsonb,false) or
      coalesce(jsonb_typeof(g.metadata -> 'is_test')='boolean' and g.metadata -> 'is_test'='true'::jsonb,false) or
      coalesce(jsonb_typeof(g.metadata -> 'unsafe')='boolean' and g.metadata -> 'unsafe'='true'::jsonb,false) or
      lower(btrim(coalesce(g.metadata ->> 'safety', g.metadata ->> 'safety_classification','')))='unsafe'
    )
  ) into v_media_bad;
  if v_media_bad then return jsonb_build_object('ok',false,'code','GENERATED_MEDIA_PROVENANCE_REQUIRED','hard',true); end if;
  if not public.creator_publishing_job_source_is_current(job_rec.id) then return jsonb_build_object('ok',false,'code','STALE_SOURCE_FINGERPRINT','hard',false); end if;
  v_queue_gate := public.creator_publishing_scheduler_queue_gate(job_rec.creator_id,job_rec.content_package_id,job_rec.target_platform,job_rec.platform_account_id);
  if (v_queue_gate->>'ok')::boolean is not true then return jsonb_build_object('ok',false,'code','ACTIVE_QUEUE_TASK_CONFLICT','hard',true); end if;
  if exists(select 1 from public.creator_publishing_platform_jobs other where other.content_package_id=job_rec.content_package_id and other.id<>job_rec.id and other.job_state not in ('published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived')) then return jsonb_build_object('ok',false,'code','ACTIVE_PUBLICATION_JOB_CONFLICT','hard',true); end if;
  v_snapshot := public.creator_publishing_scheduler_fact_snapshot(job_rec.id,p_expected_ai_twin_consent_version,p_expected_ai_twin_consent_text_sha256);
  return jsonb_build_object('ok',true,'code','OK','hard',false,'mode',job_rec.publishing_mode,'capability_registry_version',cap.registry_version,'source_package_fingerprint',job_rec.source_package_fingerprint,'compatible_legacy_queue_task',v_queue_gate->'compatible_legacy_queue_task','facts_fingerprint',encode(extensions.digest(v_snapshot::text,'sha256'),'hex'));
end; $$;

create or replace function public.creator_publishing_schedule_plan(p_creator_id uuid,p_publishing_plan_id uuid,p_intended_publish_at timestamptz,p_schedule_timezone text,p_idempotency_key text,p_expected_ai_twin_consent_version text,p_expected_ai_twin_consent_text_sha256 text,p_target_job_ids uuid[] default null,p_expected_schedule_revisions jsonb default '{}'::jsonb,p_action_type text default 'schedule')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict error
declare
  v_now timestamptz:=now(); v_key text:=btrim(coalesce(p_idempotency_key,'')); v_plan public.creator_publishing_plans%rowtype; v_request_fingerprint text; v_snapshot_fingerprint text; v_existing record; v_results jsonb:='[]'::jsonb; v_audits jsonb:='[]'::jsonb; job_rec record; v_rev int; v_state text; v_operator_due timestamptz; v_event_ids jsonb; v_superseded_event_ids jsonb:='[]'::jsonb; v_audit bigint; v_request_canonical jsonb; v_snapshot_canonical jsonb; v_gate jsonb; v_expected int; v_target_ids uuid[];
begin
 if p_creator_id is null then raise exception 'UNAUTHENTICATED'; end if; if length(btrim(coalesce(p_expected_ai_twin_consent_version,'')))=0 or coalesce(p_expected_ai_twin_consent_text_sha256,'') !~ '^[a-f0-9]{64}$' then raise exception 'AI_TWIN_CONSENT_POLICY_INVALID'; end if; if v_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'IDEMPOTENCY_CONFLICT'; end if; if p_intended_publish_at is null or length(btrim(coalesce(p_schedule_timezone,'')))=0 then raise exception 'INVALID_SCHEDULE_REQUEST'; end if; if p_action_type not in ('schedule','reschedule') then raise exception 'INVALID_SCHEDULE_ACTION'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_creator_id::text||':schedule:'||v_key,0));
 select * into v_plan from public.creator_publishing_plans where id=p_publishing_plan_id and creator_id=p_creator_id for update; if not found then raise exception 'PLAN_NOT_FOUND'; end if;
 if p_target_job_ids is null then
   select array_agg(job_source.id order by job_source.id) into v_target_ids from public.creator_publishing_platform_jobs as job_source where job_source.publishing_plan_id=p_publishing_plan_id and job_source.creator_id=p_creator_id;
 else
   select array_agg(x.id order by x.id) into v_target_ids from unnest(p_target_job_ids) as x(id);
 end if;
 if v_target_ids is null or array_length(v_target_ids,1)=0 then raise exception 'JOB_NOT_FOUND'; end if;
 if p_target_job_ids is not null and array_length(v_target_ids,1) <> (select count(distinct x.id) from unnest(p_target_job_ids) as x(id)) then raise exception 'DUPLICATE_OR_UNKNOWN_TARGET_JOB'; end if;
 if p_action_type='reschedule' and (p_expected_schedule_revisions is null or jsonb_typeof(p_expected_schedule_revisions)<>'object') then raise exception 'EXPECTED_REVISIONS_REQUIRED'; end if;
 v_request_canonical:=jsonb_build_object('creator_id',p_creator_id,'plan_id',p_publishing_plan_id,'target_job_ids',to_jsonb(v_target_ids),'intended_publish_at',p_intended_publish_at,'schedule_timezone',p_schedule_timezone,'action_type',p_action_type,'expected_schedule_revisions',coalesce(p_expected_schedule_revisions,'{}'::jsonb),'assisted_lead_policy','task15_60_minutes_v1');
 v_request_fingerprint:=encode(extensions.digest(v_request_canonical::text,'sha256'),'hex');
 select * into v_existing from public.creator_publishing_schedule_idempotency where creator_id=p_creator_id and idempotency_key=v_key for update;
 if found then if v_existing.request_fingerprint<>v_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.result || jsonb_build_object('idempotent',true); end if;
 if v_plan.status='cancelled' then raise exception 'PLAN_CANCELLED'; end if;
 -- Task 15 global lock order: plan, platform jobs, scheduler events, supporting facts.
 drop table if exists pg_temp.scheduler_gate_snapshot,pg_temp.scheduler_locked_publication_conflicts,pg_temp.scheduler_locked_queue_conflicts,pg_temp.scheduler_locked_generations,pg_temp.scheduler_locked_media,pg_temp.scheduler_locked_coperformers,pg_temp.scheduler_locked_reviews,pg_temp.scheduler_locked_ai_consents,pg_temp.scheduler_locked_creator_verifications,pg_temp.scheduler_locked_accounts,pg_temp.scheduler_locked_packages,pg_temp.scheduler_locked_capabilities,pg_temp.scheduler_locked_events,pg_temp.scheduler_locked_jobs;
 perform 1 from public.creator_publishing_platform_jobs as job_source where job_source.publishing_plan_id=p_publishing_plan_id and job_source.creator_id=p_creator_id and job_source.id=any(v_target_ids) order by job_source.id for update of job_source;
 create temp table scheduler_locked_jobs on commit drop as select job_source.* from public.creator_publishing_platform_jobs as job_source where job_source.publishing_plan_id=p_publishing_plan_id and job_source.creator_id=p_creator_id and job_source.id=any(v_target_ids) order by job_source.id;
 if (select count(*) from pg_temp.scheduler_locked_jobs) <> array_length(v_target_ids,1) then raise exception 'JOB_NOT_FOUND'; end if;
 perform 1 from public.creator_publishing_scheduler_events as event_source where event_source.platform_job_id=any(v_target_ids) and event_source.event_status in ('pending','processing') order by event_source.id for update of event_source;
 create temp table scheduler_locked_events on commit drop as select event_source.* from public.creator_publishing_scheduler_events as event_source where event_source.platform_job_id=any(v_target_ids) and event_source.event_status in ('pending','processing') order by event_source.id;
 perform 1 from public.creator_publishing_platform_capabilities as capability_source join (select distinct locked_job.target_platform from pg_temp.scheduler_locked_jobs as locked_job) as locked_platform on locked_platform.target_platform=capability_source.platform order by capability_source.platform for update of capability_source;
 create temp table scheduler_locked_capabilities on commit drop as select capability_source.* from public.creator_publishing_platform_capabilities as capability_source join (select distinct locked_job.target_platform from pg_temp.scheduler_locked_jobs as locked_job) as locked_platform on locked_platform.target_platform=capability_source.platform order by capability_source.platform;
 perform 1 from public.creator_publishing_content_packages as package_source join pg_temp.scheduler_locked_jobs as locked_job on locked_job.content_package_id=package_source.id order by package_source.id for update of package_source;
 create temp table scheduler_locked_packages on commit drop as select package_source.* from public.creator_publishing_content_packages as package_source join pg_temp.scheduler_locked_jobs as locked_job on locked_job.content_package_id=package_source.id order by package_source.id;
 perform 1 from public.creator_platform_accounts as account_source join pg_temp.scheduler_locked_jobs as locked_job on locked_job.platform_account_id=account_source.id order by account_source.id for update of account_source;
 create temp table scheduler_locked_accounts on commit drop as select account_source.* from public.creator_platform_accounts as account_source join pg_temp.scheduler_locked_jobs as locked_job on locked_job.platform_account_id=account_source.id order by account_source.id;
 perform 1 from public.creator_publishing_creator_verifications as verification_source where verification_source.creator_id=p_creator_id order by verification_source.creator_id for update of verification_source;
 create temp table scheduler_locked_creator_verifications on commit drop as select verification_source.* from public.creator_publishing_creator_verifications as verification_source where verification_source.creator_id=p_creator_id order by verification_source.creator_id;
 perform 1 from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=p_creator_id order by consent_source.creator_id for update of consent_source;
 create temp table scheduler_locked_ai_consents on commit drop as select consent_source.* from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=p_creator_id order by consent_source.creator_id;
 perform 1 from public.creator_publishing_compliance_reviews as review_source join pg_temp.scheduler_locked_packages as locked_package on locked_package.id=review_source.content_package_id order by review_source.content_package_id,review_source.created_at,review_source.id for update of review_source;
 create temp table scheduler_locked_reviews on commit drop as select review_source.* from public.creator_publishing_compliance_reviews as review_source join pg_temp.scheduler_locked_packages as locked_package on locked_package.id=review_source.content_package_id order by review_source.content_package_id,review_source.created_at,review_source.id;
 perform 1 from public.creator_publishing_co_performer_records as coperformer_source join pg_temp.scheduler_locked_packages as locked_package on locked_package.id=coperformer_source.content_package_id order by coperformer_source.content_package_id,coperformer_source.id for update of coperformer_source;
 create temp table scheduler_locked_coperformers on commit drop as select coperformer_source.* from public.creator_publishing_co_performer_records as coperformer_source join pg_temp.scheduler_locked_packages as locked_package on locked_package.id=coperformer_source.content_package_id order by coperformer_source.content_package_id,coperformer_source.id;
 perform 1 from public.creator_publishing_media_assets as media_source join pg_temp.scheduler_locked_packages as locked_package on locked_package.id=media_source.content_package_id order by media_source.content_package_id,media_source.id for update of media_source;
 create temp table scheduler_locked_media on commit drop as select media_source.* from public.creator_publishing_media_assets as media_source join pg_temp.scheduler_locked_packages as locked_package on locked_package.id=media_source.content_package_id order by media_source.content_package_id,media_source.id;
 perform 1 from public.generations as generation_source join pg_temp.scheduler_locked_media as locked_media on generation_source.id::text=locked_media.ai_generation_metadata ->> 'generation_id' order by generation_source.id for update of generation_source;
 create temp table scheduler_locked_generations on commit drop as select generation_source.* from public.generations as generation_source join pg_temp.scheduler_locked_media as locked_media on generation_source.id::text=locked_media.ai_generation_metadata ->> 'generation_id' order by generation_source.id;
 perform 1 from public.creator_publishing_queue_tasks as queue_source join pg_temp.scheduler_locked_packages as locked_package on locked_package.id=queue_source.content_package_id where queue_source.status not in ('confirmed_posted_manual','skipped','failed_manual_upload','blocked','archived') order by queue_source.id for update of queue_source;
 create temp table scheduler_locked_queue_conflicts on commit drop as select queue_source.* from public.creator_publishing_queue_tasks as queue_source join pg_temp.scheduler_locked_packages as locked_package on locked_package.id=queue_source.content_package_id where queue_source.status not in ('confirmed_posted_manual','skipped','failed_manual_upload','blocked','archived') order by queue_source.id;
 perform 1 from public.creator_publishing_platform_jobs as publication_source join pg_temp.scheduler_locked_jobs as locked_job on publication_source.content_package_id=locked_job.content_package_id and publication_source.id<>locked_job.id where publication_source.job_state not in ('published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived') order by publication_source.id for update of publication_source;
 create temp table scheduler_locked_publication_conflicts on commit drop as select publication_source.* from public.creator_publishing_platform_jobs as publication_source join pg_temp.scheduler_locked_jobs as locked_job on publication_source.content_package_id=locked_job.content_package_id and publication_source.id<>locked_job.id where publication_source.job_state not in ('published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived') order by publication_source.id;
 create temp table scheduler_gate_snapshot(job_id uuid primary key, gate jsonb not null) on commit drop;
 for job_rec in select locked_job.* from pg_temp.scheduler_locked_jobs as locked_job order by locked_job.id loop insert into pg_temp.scheduler_gate_snapshot values(job_rec.id, public.creator_publishing_scheduler_gate(job_rec.id,p_expected_ai_twin_consent_version,p_expected_ai_twin_consent_text_sha256)); end loop;
 v_snapshot_canonical:=jsonb_build_object('locked_jobs',(select jsonb_agg(to_jsonb(locked_job) order by locked_job.id) from pg_temp.scheduler_locked_jobs as locked_job),'gates',(select jsonb_agg(jsonb_build_object('job_id',gate_snapshot.job_id,'gate',gate_snapshot.gate) order by gate_snapshot.job_id) from pg_temp.scheduler_gate_snapshot as gate_snapshot),'capabilities',(select jsonb_agg(to_jsonb(capability_snapshot) order by capability_snapshot.platform) from pg_temp.scheduler_locked_capabilities as capability_snapshot),'packages',(select jsonb_agg(to_jsonb(package_snapshot) order by package_snapshot.id) from pg_temp.scheduler_locked_packages as package_snapshot),'accounts',(select jsonb_agg(to_jsonb(account_snapshot) order by account_snapshot.id) from pg_temp.scheduler_locked_accounts as account_snapshot),'creator_verifications',(select jsonb_agg(to_jsonb(verification_snapshot) order by verification_snapshot.creator_id) from pg_temp.scheduler_locked_creator_verifications as verification_snapshot),'ai_consents',(select jsonb_agg(to_jsonb(consent_snapshot) order by consent_snapshot.creator_id) from pg_temp.scheduler_locked_ai_consents as consent_snapshot),'reviews',(select jsonb_agg(to_jsonb(review_snapshot) order by review_snapshot.content_package_id,review_snapshot.created_at,review_snapshot.id) from pg_temp.scheduler_locked_reviews as review_snapshot),'co_performers',(select jsonb_agg(to_jsonb(coperformer_snapshot) order by coperformer_snapshot.content_package_id,coperformer_snapshot.id) from pg_temp.scheduler_locked_coperformers as coperformer_snapshot),'media',(select jsonb_agg(to_jsonb(media_snapshot) order by media_snapshot.content_package_id,media_snapshot.id) from pg_temp.scheduler_locked_media as media_snapshot),'generations',(select jsonb_agg(to_jsonb(generation_snapshot) order by generation_snapshot.id) from pg_temp.scheduler_locked_generations as generation_snapshot),'active_queue_conflicts',(select jsonb_agg(to_jsonb(queue_snapshot) order by queue_snapshot.id) from pg_temp.scheduler_locked_queue_conflicts as queue_snapshot),'active_publication_conflicts',(select jsonb_agg(to_jsonb(publication_snapshot) order by publication_snapshot.id) from pg_temp.scheduler_locked_publication_conflicts as publication_snapshot));
 v_snapshot_fingerprint:=encode(extensions.digest(v_snapshot_canonical::text,'sha256'),'hex');
 for job_rec in select locked_job.*,gate_snapshot.gate from pg_temp.scheduler_locked_jobs as locked_job join pg_temp.scheduler_gate_snapshot as gate_snapshot on gate_snapshot.job_id=locked_job.id order by locked_job.id loop
   v_gate:=job_rec.gate; v_event_ids:='[]'::jsonb; v_superseded_event_ids:='[]'::jsonb; v_operator_due:=case when job_rec.publishing_mode='assisted' then p_intended_publish_at - interval '60 minutes' else null end;
   if p_action_type='schedule' and (coalesce(job_rec.schedule_revision,0)<>0 or job_rec.job_state <> 'draft' or exists(select 1 from pg_temp.scheduler_locked_events as event_snapshot where event_snapshot.platform_job_id=job_rec.id and event_snapshot.event_status in ('pending','processing'))) then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'ok',false,'code','ALREADY_SCHEDULED','scheduleRevision',coalesce(job_rec.schedule_revision,0))); continue; end if;
   if p_action_type='reschedule' then v_expected:=nullif(p_expected_schedule_revisions ->> job_rec.id::text,'')::int; if v_expected is null then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'ok',false,'code','EXPECTED_REVISION_REQUIRED','scheduleRevision',coalesce(job_rec.schedule_revision,0))); continue; end if; if v_expected<0 or v_expected>1000000 or coalesce(job_rec.schedule_revision,0)<>v_expected then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'ok',false,'code','STALE_SCHEDULE_REVISION','scheduleRevision',coalesce(job_rec.schedule_revision,0))); continue; end if; if job_rec.job_state not in ('scheduled_internally','awaiting_operator','due_now','ready_to_publish','package_ready','ready_for_export','needs_fix') then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'ok',false,'code','INVALID_RESCHEDULE_STATE','scheduleRevision',coalesce(job_rec.schedule_revision,0))); continue; end if; end if;
   if (v_gate->>'ok')::boolean is not true then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'ok',false,'code',v_gate->>'code','scheduleRevision',coalesce(job_rec.schedule_revision,0))); continue; end if;
   if job_rec.publishing_mode='assisted' and v_operator_due <= v_now then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'ok',false,'code','ASSISTED_LEAD_TIME_REQUIRED','scheduleRevision',coalesce(job_rec.schedule_revision,0))); continue; end if;
   v_rev:=coalesce(job_rec.schedule_revision,0)+1; v_state:=case job_rec.publishing_mode when 'assisted' then 'scheduled_internally' when 'direct' then 'ready_to_publish' when 'planner' then 'package_ready' else 'draft' end;
   with superseded as (update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now,lock_token=null,locked_at=null where platform_job_id=job_rec.id and event_status in ('pending','processing') returning id) select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_superseded_event_ids from superseded;
   update public.creator_publishing_platform_jobs set intended_publish_at=p_intended_publish_at,schedule_timezone=p_schedule_timezone,operator_due_at=v_operator_due,schedule_revision=v_rev,scheduled_at=coalesce(scheduled_at,v_now),scheduled_by=coalesce(scheduled_by,p_creator_id),rescheduled_at=case when job_rec.schedule_revision is null then rescheduled_at else v_now end,job_state=v_state,updated_at=v_now where id=job_rec.id and schedule_revision is not distinct from job_rec.schedule_revision;
   if job_rec.publishing_mode='assisted' then insert into public.creator_publishing_scheduler_events(creator_id,publishing_plan_id,platform_job_id,event_type,due_at,schedule_revision) values(p_creator_id,job_rec.publishing_plan_id,job_rec.id,'operator_due',v_operator_due,v_rev) returning jsonb_build_array(id) into v_event_ids; end if;
   insert into public.creator_publishing_scheduler_events(creator_id,publishing_plan_id,platform_job_id,event_type,due_at,schedule_revision) values(p_creator_id,job_rec.publishing_plan_id,job_rec.id,'publish_due',p_intended_publish_at,v_rev) returning coalesce(v_event_ids,'[]'::jsonb)||jsonb_build_array(id) into v_event_ids;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_platform_job',job_rec.id,p_creator_id,'creator',case when p_action_type='reschedule' then 'creator_publishing_job_rescheduled' else 'creator_publishing_job_scheduled' end,jsonb_build_object('job_state',job_rec.job_state,'schedule_revision',job_rec.schedule_revision),jsonb_build_object('job_state',v_state,'schedule_revision',v_rev,'scheduler_event_ids',v_event_ids,'superseded_event_ids',v_superseded_event_ids),v_key,v_now) returning id into v_audit;
   v_audits:=v_audits||to_jsonb(v_audit::text); v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'ok',true,'jobState',v_state,'scheduleRevision',v_rev,'operatorDueAt',v_operator_due,'schedulerEventIds',v_event_ids,'auditEventId',v_audit::text));
 end loop;
 perform public.creator_publishing_recalculate_plan_status(p_publishing_plan_id);
 v_request_canonical:=jsonb_build_object('ok',true,'planId',p_publishing_plan_id,'results',v_results,'auditEventIds',v_audits,'idempotent',false); insert into public.creator_publishing_schedule_idempotency(creator_id,publishing_plan_id,idempotency_key,action_type,request_fingerprint,first_execution_snapshot_fingerprint,result,created_at) values(p_creator_id,p_publishing_plan_id,v_key,p_action_type,v_request_fingerprint,v_snapshot_fingerprint,v_request_canonical,v_now); return v_request_canonical;
end; $$;

create or replace function public.creator_publishing_cancel_schedule(p_creator_id uuid,p_publishing_plan_id uuid,p_platform_job_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict error
declare
  v_now timestamptz:=now(); v_plan public.creator_publishing_plans%rowtype; job_rec record; v_count int:=0; v_events_changed int:=0; v_results jsonb:='[]'::jsonb; v_audit bigint; v_event_audit bigint; v_event_ids jsonb; v_event_rows int; v_plan_changed boolean:=false; v_audit_created boolean:=false; terminal_states constant text[]:=array['published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived'];
begin
 if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'CANCELLATION_REASON_REQUIRED'; end if;
 select * into v_plan from public.creator_publishing_plans where id=p_publishing_plan_id and creator_id=p_creator_id for update; if not found then raise exception 'PLAN_NOT_FOUND'; end if;
 drop table if exists pg_temp.cancel_locked_events,pg_temp.cancel_locked_jobs;
 perform 1 from public.creator_publishing_platform_jobs as job_source where job_source.publishing_plan_id=p_publishing_plan_id and job_source.creator_id=p_creator_id and (p_platform_job_id is null or job_source.id=p_platform_job_id) order by job_source.id for update of job_source;
 create temp table cancel_locked_jobs on commit drop as select job_source.* from public.creator_publishing_platform_jobs as job_source where job_source.publishing_plan_id=p_publishing_plan_id and job_source.creator_id=p_creator_id and (p_platform_job_id is null or job_source.id=p_platform_job_id) order by job_source.id;
 if p_platform_job_id is not null and not exists(select 1 from pg_temp.cancel_locked_jobs) then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND','planId',p_publishing_plan_id,'jobId',p_platform_job_id,'results','[]'::jsonb); end if;
 perform 1 from public.creator_publishing_scheduler_events as event_source join pg_temp.cancel_locked_jobs as locked_job on locked_job.id=event_source.platform_job_id where event_source.event_status in ('pending','processing') order by event_source.id for update of event_source;
 create temp table cancel_locked_events on commit drop as select event_source.* from public.creator_publishing_scheduler_events as event_source join pg_temp.cancel_locked_jobs as locked_job on locked_job.id=event_source.platform_job_id where event_source.event_status in ('pending','processing') order by event_source.id;
 if p_platform_job_id is null and v_plan.status <> 'cancelled' then
   update public.creator_publishing_plans set status='cancelled',cancelled_at=v_now,cancelled_by=p_creator_id,cancellation_reason=btrim(p_reason),updated_at=v_now where id=p_publishing_plan_id;
   v_plan_changed:=true;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,after_state,created_at) values('creator_publishing_plan',p_publishing_plan_id,p_creator_id,'creator','creator_publishing_plan_cancelled',jsonb_build_object('reason','redacted'),v_now);
   v_audit_created:=true;
 end if;
 for job_rec in select locked_job.* from pg_temp.cancel_locked_jobs as locked_job order by locked_job.id loop
   select coalesce(jsonb_agg(event_snapshot.id order by event_snapshot.id),'[]'::jsonb) into v_event_ids from pg_temp.cancel_locked_events as event_snapshot where event_snapshot.platform_job_id=job_rec.id;
   if jsonb_array_length(v_event_ids)>0 then
     update public.creator_publishing_scheduler_events set event_status='cancelled',cancelled_at=v_now,lock_token=null,locked_at=null,last_error_code='CANCELLED_BY_CREATOR' where platform_job_id=job_rec.id and event_status in ('pending','processing');
     get diagnostics v_event_rows = row_count; v_events_changed:=v_events_changed+v_event_rows;
     insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_platform_job',job_rec.id,p_creator_id,'creator','creator_publishing_scheduler_events_cancelled',jsonb_build_object('scheduler_event_ids',v_event_ids),jsonb_build_object('scheduler_event_ids',v_event_ids,'reason','redacted'),v_now) returning id into v_event_audit;
     v_audit_created:=true;
   else
     v_event_audit:=null;
   end if;
   if job_rec.cancelled_at is not null then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'outcome','already_cancelled','jobState',job_rec.job_state,'scheduleRevision',coalesce(job_rec.schedule_revision,0),'closedSchedulerEventIds',v_event_ids,'eventAuditEventId',case when v_event_audit is null then null else v_event_audit::text end)); continue; end if;
   if job_rec.job_state = any(terminal_states) then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'outcome','already_terminal','jobState',job_rec.job_state,'scheduleRevision',coalesce(job_rec.schedule_revision,0),'closedSchedulerEventIds',v_event_ids,'eventAuditEventId',case when v_event_audit is null then null else v_event_audit::text end)); continue; end if;
   update public.creator_publishing_platform_jobs set job_state='archived',cancelled_at=v_now,cancelled_by=p_creator_id,cancellation_reason=btrim(p_reason),updated_at=v_now where id=job_rec.id;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_platform_job',job_rec.id,p_creator_id,'creator','creator_publishing_job_cancelled',jsonb_build_object('job_state',job_rec.job_state),jsonb_build_object('job_state','archived','scheduler_event_ids',v_event_ids),v_now) returning id into v_audit;
   v_audit_created:=true; v_count:=v_count+1; v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',job_rec.id,'outcome','archived','jobState','archived','scheduleRevision',coalesce(job_rec.schedule_revision,0),'auditEventId',v_audit::text,'closedSchedulerEventIds',v_event_ids,'eventAuditEventId',case when v_event_audit is null then null else v_event_audit::text end));
 end loop;
 if p_platform_job_id is not null and v_plan.status <> 'cancelled' then perform public.creator_publishing_recalculate_plan_status(p_publishing_plan_id); end if;
 return jsonb_build_object('ok',true,'planId',p_publishing_plan_id,'jobId',p_platform_job_id,'cancelledJobs',v_count,'closedSchedulerEvents',v_events_changed,'results',v_results,'idempotent',(not v_plan_changed and v_count=0 and v_events_changed=0 and not v_audit_created));
end; $$;


create or replace function public.creator_publishing_claim_due_scheduler_events(p_limit integer default 25,p_lock_minutes integer default 15)
returns table(id uuid, lock_token uuid) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return query with due as (
   select event_sourcevent_source.id,event_source.platform_job_id,event_sourcevent_source.due_at,event_source.event_type,event_source.event_status as prior_event_status,event_source.processing_attempts as prior_processing_attempts,event_source.schedule_revision,case when event_sourcevent_source.event_type='operator_due' then 0 else 1 end as event_order
   from public.creator_publishing_scheduler_events as event_source
   where ((event_source.event_status='pending' and event_sourcevent_source.due_at<=now())
      or (event_source.event_status='processing' and event_source.locked_at < now() - make_interval(mins=>least(greatest(coalesce(p_lock_minutes,15),1),60))))
     and not exists (
       select 1 from public.creator_publishing_scheduler_events prior
       where prior.platform_job_id=event_source.platform_job_id
         and prior.event_status in ('pending','processing')
         and (prior.due_at,case when prior.event_type='operator_due' then 0 else 1 end,prior.id) < (event_source.due_at,case when event_source.event_type='operator_due' then 0 else 1 end,event_source.id)
     )
   order by event_source.due_at,case when event_source.event_type='operator_due' then 0 else 1 end,event_source.id
   limit least(greatest(coalesce(p_limit,25),1),50)
   for update of event_source skip locked
 ), claimed as (
   update public.creator_publishing_scheduler_events as event_update
   set event_status='processing',lock_token=gen_random_uuid(),locked_at=now(),processing_attempts=event_update.processing_attempts+1
   from due where event_source.id=duevent_source.id
   returning event_source.id,e.lock_token,e.event_status,e.processing_attempts,e.schedule_revision,duevent_source.due_at,due.event_type,due.prior_event_status,due.prior_processing_attempts,due.event_order
 ), claim_audits as (
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at)
   select 'creator_publishing_scheduler_event',claimed_event.id,'system','creator_publishing_scheduler_event_claimed',jsonb_build_object('event_status',claimed_event.prior_event_status,'processing_attempts',claimed_event.prior_processing_attempts,'event_type',claimed_event.event_type,'due_at',claimed_event.due_at,'schedule_revision',claimed_event.schedule_revision),jsonb_build_object('event_status',claimed_event.event_status,'processing_attempts',claimed_event.processing_attempts,'event_type',claimed_event.event_type,'due_at',claimed_event.due_at,'schedule_revision',claimed_event.schedule_revision),now()
   from claimed as claimed_event
   returning id
 ) select claimed.id,claimed.lock_token from claimed order by claimed.due_at,claimed.event_order,claimed.id;
end; $$;

create or replace function public.creator_publishing_process_scheduler_event(p_event_id uuid,p_lock_token uuid,p_expected_ai_twin_consent_version text,p_expected_ai_twin_consent_text_sha256 text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict error
declare
  event_identity record;
  event_rec public.creator_publishing_scheduler_events%rowtype;
  job_rec public.creator_publishing_platform_jobs%rowtype;
  plan_rec public.creator_publishing_plans%rowtype;
  capability_rec public.creator_publishing_platform_capabilities%rowtype;
  v_now timestamptz:=now();
  v_gate jsonb;
  v_state text;
  v_audit bigint;
  v_job_rows int;
  v_event_rows int;
  v_superseded_event_ids uuid[]:=array[]::uuid[];
  terminal_states constant text[]:=array['published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived'];
begin
 select event_source.id, event_source.platform_job_id, event_source.publishing_plan_id, event_source.creator_id, event_source.schedule_revision
 into event_identity
 from public.creator_publishing_scheduler_events as event_source
 where event_source.id=p_event_id;
 if not found then return jsonb_build_object('ok',false,'skipped',true,'code','EVENT_NOT_FOUND'); end if;

 -- Task 15 global lock order for processors: plan, platform job, scheduler event, supporting facts.
 select plan_source.* into plan_rec
 from public.creator_publishing_plans as plan_source
 where plan_source.id=event_identity.publishing_plan_id and plan_source.creator_id=event_identity.creator_id
 for update of plan_source;
 select job_source.* into job_rec
 from public.creator_publishing_platform_jobs as job_source
 where job_source.id=event_identity.platform_job_id and job_source.publishing_plan_id=event_identity.publishing_plan_id and job_source.creator_id=event_identity.creator_id
 for update of job_source;
 select event_source.* into event_rec
 from public.creator_publishing_scheduler_events as event_source
 where event_source.id=event_identity.id and event_source.platform_job_id=event_identity.platform_job_id and event_source.publishing_plan_id=event_identity.publishing_plan_id and event_source.creator_id=event_identity.creator_id
 for update of event_source;

 if event_rec.id is null or event_rec.event_status <> 'processing' or event_rec.lock_token is distinct from p_lock_token then
   return jsonb_build_object('ok',true,'skipped',true,'code','NOT_CLAIMED');
 end if;
 if plan_rec.id is null or plan_rec.status='cancelled' then
   update public.creator_publishing_scheduler_events set event_status='cancelled',cancelled_at=v_now,lock_token=null,locked_at=null,last_error_code='PLAN_CANCELLED' where id=event_rec.id and event_status='processing' and lock_token is not distinct from p_lock_token;
   get diagnostics v_event_rows = row_count; if v_event_rows<>1 then raise exception 'PROTECTED_UPDATE_MISSED'; end if;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,'system','creator_publishing_scheduler_event_cancelled',jsonb_build_object('event_status','processing'),jsonb_build_object('event_status','cancelled','code','PLAN_CANCELLED','schedule_revision',event_rec.schedule_revision),v_now);
   return jsonb_build_object('ok',true,'skipped',true,'code','PLAN_CANCELLED');
 end if;
 if job_rec.id is null then
   update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now,lock_token=null,locked_at=null,last_error_code='JOB_NOT_FOUND' where id=event_rec.id and event_status='processing' and lock_token is not distinct from p_lock_token;
   get diagnostics v_event_rows = row_count; if v_event_rows<>1 then raise exception 'PROTECTED_UPDATE_MISSED'; end if;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,'system','creator_publishing_scheduler_event_superseded',jsonb_build_object('event_status','processing'),jsonb_build_object('event_status','superseded','code','JOB_NOT_FOUND','schedule_revision',event_rec.schedule_revision),v_now);
   return jsonb_build_object('ok',true,'skipped',true,'code','JOB_NOT_FOUND');
 end if;
 if job_rec.schedule_revision<>event_rec.schedule_revision then
   update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now,lock_token=null,locked_at=null,last_error_code='REVISION_SUPERSEDED' where id=event_rec.id and event_status='processing' and lock_token is not distinct from p_lock_token;
   get diagnostics v_event_rows = row_count; if v_event_rows<>1 then raise exception 'PROTECTED_UPDATE_MISSED'; end if;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,'system','creator_publishing_scheduler_event_superseded',jsonb_build_object('event_status','processing'),jsonb_build_object('event_status','superseded','code','REVISION_SUPERSEDED','schedule_revision',event_rec.schedule_revision),v_now);
   return jsonb_build_object('ok',true,'skipped',true,'code','REVISION_SUPERSEDED');
 end if;
 if job_rec.cancelled_at is not null or event_rec.cancelled_at is not null or event_rec.event_status in ('cancelled','superseded') then
   update public.creator_publishing_scheduler_events set event_status='cancelled',cancelled_at=coalesce(cancelled_at,v_now),lock_token=null,locked_at=null,last_error_code='CANCELLED' where id=event_rec.id and event_status='processing' and lock_token is not distinct from p_lock_token;
   get diagnostics v_event_rows = row_count; if v_event_rows<>1 then raise exception 'PROTECTED_UPDATE_MISSED'; end if;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,'system','creator_publishing_scheduler_event_cancelled',jsonb_build_object('event_status','processing'),jsonb_build_object('event_status','cancelled','code','CANCELLED','schedule_revision',event_rec.schedule_revision),v_now);
   return jsonb_build_object('ok',true,'skipped',true,'code','CANCELLED');
 end if;
 if job_rec.job_state = any(terminal_states) then
   update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now,lock_token=null,locked_at=null,last_error_code='TERMINAL_JOB' where id=event_rec.id and event_status='processing' and lock_token is not distinct from p_lock_token;
   get diagnostics v_event_rows = row_count; if v_event_rows<>1 then raise exception 'PROTECTED_UPDATE_MISSED'; end if;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,'system','creator_publishing_scheduler_event_superseded',jsonb_build_object('event_status','processing'),jsonb_build_object('event_status','superseded','code','TERMINAL_JOB','schedule_revision',event_rec.schedule_revision),v_now);
   return jsonb_build_object('ok',true,'skipped',true,'code','TERMINAL_JOB');
 end if;
 if event_rec.event_type='operator_due' and job_rec.publishing_mode='assisted' and job_rec.job_state='due_now' then
   update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now,lock_token=null,locked_at=null,last_error_code='OBSOLETE_OPERATOR_DUE' where id=event_rec.id and event_status='processing' and lock_token is not distinct from p_lock_token;
   get diagnostics v_event_rows = row_count; if v_event_rows<>1 then raise exception 'PROTECTED_UPDATE_MISSED'; end if;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_scheduler_event',event_rec.id,'system','creator_publishing_scheduler_event_superseded',jsonb_build_object('event_status','processing'),jsonb_build_object('event_status','superseded','code','OBSOLETE_OPERATOR_DUE','schedule_revision',event_rec.schedule_revision),v_now);
   return jsonb_build_object('ok',true,'skipped',true,'code','OBSOLETE_OPERATOR_DUE');
 end if;

 drop table if exists pg_temp.process_locked_publication_conflicts,pg_temp.process_locked_queue_conflicts,pg_temp.process_locked_generations,pg_temp.process_locked_media,pg_temp.process_locked_coperformers,pg_temp.process_locked_reviews,pg_temp.process_locked_ai_consents,pg_temp.process_locked_creator_verifications,pg_temp.process_locked_accounts,pg_temp.process_locked_packages,pg_temp.process_locked_capabilities;
 perform 1 from public.creator_publishing_platform_capabilities as capability_source where capability_source.platform=job_rec.target_platform order by capability_source.platform for update of capability_source;
 create temp table process_locked_capabilities on commit drop as select capability_source.* from public.creator_publishing_platform_capabilities as capability_source where capability_source.platform=job_rec.target_platform order by capability_source.platform;
 perform 1 from public.creator_publishing_content_packages as package_source where package_source.id=job_rec.content_package_id order by package_source.id for update of package_source;
 create temp table process_locked_packages on commit drop as select package_source.* from public.creator_publishing_content_packages as package_source where package_source.id=job_rec.content_package_id order by package_source.id;
 perform 1 from public.creator_platform_accounts as account_source where account_source.id=job_rec.platform_account_id order by account_source.id for update of account_source;
 create temp table process_locked_accounts on commit drop as select account_source.* from public.creator_platform_accounts as account_source where account_source.id=job_rec.platform_account_id order by account_source.id;
 perform 1 from public.creator_publishing_creator_verifications as verification_source where verification_source.creator_id=job_rec.creator_id order by verification_source.id for update of verification_source;
 create temp table process_locked_creator_verifications on commit drop as select verification_source.* from public.creator_publishing_creator_verifications as verification_source where verification_source.creator_id=job_rec.creator_id order by verification_source.id;
 perform 1 from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=job_rec.creator_id order by consent_source.id for update of consent_source;
 create temp table process_locked_ai_consents on commit drop as select consent_source.* from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=job_rec.creator_id order by consent_source.id;
 perform 1 from public.creator_publishing_compliance_reviews as review_source where review_source.content_package_id=job_rec.content_package_id order by review_source.created_at, review_source.id for update of review_source;
 create temp table process_locked_reviews on commit drop as select review_source.* from public.creator_publishing_compliance_reviews as review_source where review_source.content_package_id=job_rec.content_package_id order by review_source.created_at, review_source.id;
 perform 1 from public.creator_publishing_co_performer_records as coperformer_source where coperformer_source.content_package_id=job_rec.content_package_id order by coperformer_source.id for update of coperformer_source;
 create temp table process_locked_coperformers on commit drop as select coperformer_source.* from public.creator_publishing_co_performer_records as coperformer_source where coperformer_source.content_package_id=job_rec.content_package_id order by coperformer_source.id;
 perform 1 from public.creator_publishing_media_assets as media_source where media_source.content_package_id=job_rec.content_package_id order by media_source.id for update of media_source;
 create temp table process_locked_media on commit drop as select media_source.* from public.creator_publishing_media_assets as media_source where media_source.content_package_id=job_rec.content_package_id order by media_source.id;
 perform 1 from public.generations as generation_source join public.creator_publishing_media_assets as media_source on media_source.generation_id=generation_source.id where media_source.content_package_id=job_rec.content_package_id order by generation_source.id for update of generation_source;
 create temp table process_locked_generations on commit drop as select generation_source.* from public.generations as generation_source join public.creator_publishing_media_assets as media_source on media_source.generation_id=generation_source.id where media_source.content_package_id=job_rec.content_package_id order by generation_source.id;
 perform 1 from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id order by queue_source.id for update of queue_source;
 create temp table process_locked_queue_conflicts on commit drop as select queue_source.* from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id order by queue_source.id;
 perform 1 from public.creator_publishing_platform_jobs as publication_source where publication_source.content_package_id=job_rec.content_package_id and publication_source.id<>job_rec.id order by publication_source.id for update of publication_source;
 create temp table process_locked_publication_conflicts on commit drop as select publication_source.* from public.creator_publishing_platform_jobs as publication_source where publication_source.content_package_id=job_rec.content_package_id and publication_source.id<>job_rec.id order by publication_source.id;

 v_gate:=public.creator_publishing_scheduler_gate(job_rec.id,p_expected_ai_twin_consent_version,p_expected_ai_twin_consent_text_sha256);
 if (v_gate->>'ok')::boolean is not true then
   update public.creator_publishing_platform_jobs set job_state=case when coalesce((v_gate->>'hard')::boolean,false) then 'blocked' else 'needs_fix' end, updated_at=v_now where id=job_rec.id and not (job_state = any(terminal_states));
   get diagnostics v_job_rows = row_count;
   update public.creator_publishing_scheduler_events set event_status='blocked',processed_at=v_now,lock_token=null,locked_at=null,last_error_code=v_gate->>'code' where id=event_rec.id and event_status='processing' and lock_token is not distinct from p_lock_token;
   get diagnostics v_event_rows = row_count;
   if v_job_rows<>1 or v_event_rows<>1 then raise exception 'PROTECTED_UPDATE_MISSED'; end if;
   with superseded as (update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now,lock_token=null,locked_at=null where platform_job_id=job_rec.id and schedule_revision=event_rec.schedule_revision and event_status in ('pending','processing') and id<>event_rec.id returning id)
   select coalesce(array_agg(superseded.id),array[]::uuid[]) into v_superseded_event_ids from superseded;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_platform_job',job_rec.id,'system','creator_publishing_due_state_transition_blocked',jsonb_build_object('job_state',job_rec.job_state),jsonb_build_object('event_id',event_rec.id,'code',v_gate->>'code','superseded_event_ids',v_superseded_event_ids),v_now) returning id into v_audit;
   perform public.creator_publishing_recalculate_plan_status(job_rec.publishing_plan_id);
   return jsonb_build_object('ok',false,'blocked',true,'code',v_gate->>'code','auditEventId',v_audit::text);
 end if;
 select capability_snapshot.* into capability_rec from pg_temp.process_locked_capabilities as capability_snapshot where capability_snapshot.platform=job_rec.target_platform;
 v_state:=case when event_rec.event_type='operator_due' and job_rec.publishing_mode='assisted' and job_rec.job_state='scheduled_internally' then 'awaiting_operator' when event_rec.event_type='publish_due' and job_rec.publishing_mode='assisted' and job_rec.job_state in ('scheduled_internally','awaiting_operator') then 'due_now' when event_rec.event_type='publish_due' and job_rec.publishing_mode='direct' and job_rec.job_state='ready_to_publish' and capability_rec.publishing_mode='direct' and capability_rec.availability_status='available' and capability_rec.connector_can_publish_immediately then 'direct_publish_queued' when event_rec.event_type='publish_due' and job_rec.publishing_mode='planner' and job_rec.job_state='package_ready' then 'ready_for_export' else null end;
 if v_state is null then
   update public.creator_publishing_platform_jobs set job_state=case when job_rec.publishing_mode='direct' then 'blocked' else job_rec.job_state end, updated_at=v_now where id=job_rec.id and not (job_state = any(terminal_states));
   get diagnostics v_job_rows = row_count;
   update public.creator_publishing_scheduler_events set event_status='blocked',processed_at=v_now,lock_token=null,locked_at=null,last_error_code='UNSUPPORTED_DUE_TRANSITION' where id=event_rec.id and event_status='processing' and lock_token is not distinct from p_lock_token;
   get diagnostics v_event_rows = row_count;
   if v_job_rows<>1 or v_event_rows<>1 then raise exception 'PROTECTED_UPDATE_MISSED'; end if;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_platform_job',job_rec.id,'system','creator_publishing_due_state_transition_blocked',jsonb_build_object('job_state',job_rec.job_state),jsonb_build_object('event_id',event_rec.id,'code','UNSUPPORTED_DUE_TRANSITION'),v_now) returning id into v_audit;
   perform public.creator_publishing_recalculate_plan_status(job_rec.publishing_plan_id);
   return jsonb_build_object('ok',false,'blocked',true,'code','UNSUPPORTED_DUE_TRANSITION','auditEventId',v_audit::text);
 end if;
 update public.creator_publishing_platform_jobs set job_state=v_state,updated_at=v_now where id=job_rec.id and job_state=job_rec.job_state and not (job_state = any(terminal_states));
 get diagnostics v_job_rows = row_count;
 update public.creator_publishing_scheduler_events set event_status='processed',processed_at=v_now,lock_token=null,locked_at=null where id=event_rec.id and event_status='processing' and lock_token is not distinct from p_lock_token;
 get diagnostics v_event_rows = row_count;
 if v_job_rows<>1 or v_event_rows<>1 then raise exception 'PROTECTED_UPDATE_MISSED'; end if;
 if event_rec.event_type='publish_due' and job_rec.publishing_mode='assisted' and v_state='due_now' then
   with superseded as (update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now,lock_token=null,locked_at=null,last_error_code='OBSOLETE_OPERATOR_DUE' where platform_job_id=job_rec.id and schedule_revision=event_rec.schedule_revision and event_type='operator_due' and event_status in ('pending','processing') and id<>event_rec.id returning id)
   select coalesce(array_agg(superseded.id),array[]::uuid[]) into v_superseded_event_ids from superseded;
 end if;
 insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_platform_job',job_rec.id,'system','creator_publishing_due_state_transition_completed',jsonb_build_object('job_state',job_rec.job_state),jsonb_build_object('job_state',v_state,'event_id',event_rec.id,'superseded_event_ids',v_superseded_event_ids),v_now) returning id into v_audit;
 perform public.creator_publishing_recalculate_plan_status(job_rec.publishing_plan_id);
 return jsonb_build_object('ok',true,'processed',true,'jobState',v_state,'auditEventId',v_audit::text);
end; $$;

revoke all on function public.creator_publishing_recalculate_plan_status(uuid) from public, anon, authenticated;
revoke all on function public.creator_publishing_scheduler_queue_gate(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.creator_publishing_scheduler_fact_snapshot(uuid,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_scheduler_gate(uuid,text,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_cancel_schedule(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_claim_due_scheduler_events(integer,integer) from public, anon, authenticated;
revoke all on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.creator_publishing_recalculate_plan_status(uuid) to service_role;
grant execute on function public.creator_publishing_scheduler_queue_gate(uuid,uuid,text,uuid) to service_role;
grant execute on function public.creator_publishing_scheduler_fact_snapshot(uuid,text,text) to service_role;
grant execute on function public.creator_publishing_scheduler_gate(uuid,text,text) to service_role;
grant execute on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) to service_role;
grant execute on function public.creator_publishing_cancel_schedule(uuid,uuid,uuid,text) to service_role;
grant execute on function public.creator_publishing_claim_due_scheduler_events(integer,integer) to service_role;
grant execute on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) to service_role;
