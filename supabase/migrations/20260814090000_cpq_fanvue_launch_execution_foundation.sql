-- ADR Gates 7-13: extend canonical CPQ jobs and publish_due scheduler events for dormant Fanvue execution.
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_no_fanvue;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_platform_jobs_job_state_check;
alter table public.creator_publishing_platform_jobs add constraint creator_publishing_platform_jobs_job_state_check check(job_state in('draft','ready_to_publish','direct_publish_queued','publishing_direct','published_direct','direct_publish_failed','retry_scheduled','authentication_required','platform_rejected','scheduled_internally','awaiting_operator','due_now','claimed','scheduled_on_platform','awaiting_post_confirmation','confirmed_posted_manual','failed_manual_upload','needs_fix','skipped','blocked','archived','package_ready','ready_for_export','exported','reconnect_required','uncertain','cancelled'));
alter table public.creator_publishing_platform_jobs add constraint creator_publishing_jobs_id_creator_unique unique(id,creator_id), add column oauth_account_id uuid, add column publication_type text, add column server_idempotency_key text, add column attempt_count integer not null default 0, add column next_attempt_at timestamptz, add column lease_token uuid, add column leased_at timestamptz, add column posted_at timestamptz, add column terminal_classification text, add column safe_error_code text, add column provider_post_uuid uuid,
 add constraint creator_publishing_fanvue_oauth_owner_fk foreign key(oauth_account_id,creator_id,target_platform) references public.autopost_accounts(id,user_id,platform) on delete restrict,
 add constraint creator_publishing_fanvue_execution_shape_check check(target_platform<>'fanvue' or(oauth_account_id is not null and publication_type in('text','image','video') and server_idempotency_key is not null)), add constraint creator_publishing_fanvue_attempt_count_check check(attempt_count between 0 and 3);
create unique index creator_publishing_fanvue_server_idempotency_uidx on public.creator_publishing_platform_jobs(creator_id,server_idempotency_key) where target_platform='fanvue';
create unique index creator_publishing_fanvue_provider_proof_uidx on public.creator_publishing_platform_jobs(provider_post_uuid) where provider_post_uuid is not null;
create table public.creator_publishing_fanvue_attempts(id uuid primary key default gen_random_uuid(),job_id uuid not null,creator_id uuid not null,attempt_ordinal integer not null check(attempt_ordinal between 1 and 3),lease_token uuid not null,started_at timestamptz not null default clock_timestamp(),provider_create_dispatched_at timestamptz,finished_at timestamptz,outcome_class text check(outcome_class in('success','retryable_pre_create','permanent','reconnect_required','uncertain')),provider_create_attempted boolean not null default false,upload_attempted boolean not null default false,refresh_attempted boolean not null default false,safe_error_code text,status_class text,provider_post_uuid uuid,uncertainty_classification text,created_at timestamptz not null default clock_timestamp(),constraint creator_publishing_fanvue_attempt_job_owner_fk foreign key(job_id,creator_id) references public.creator_publishing_platform_jobs(id,creator_id) on delete cascade,constraint creator_publishing_fanvue_attempt_ordinal_unique unique(job_id,attempt_ordinal),constraint creator_publishing_fanvue_attempt_proof_check check(provider_post_uuid is null or outcome_class='success'));
create unique index creator_publishing_fanvue_attempt_provider_proof_uidx on public.creator_publishing_fanvue_attempts(provider_post_uuid) where provider_post_uuid is not null;
alter table public.creator_publishing_fanvue_attempts enable row level security; create policy creator_publishing_fanvue_attempts_select_own on public.creator_publishing_fanvue_attempts for select to authenticated using(creator_id=auth.uid()); grant select on public.creator_publishing_fanvue_attempts to authenticated; revoke insert,update,delete,truncate,references,trigger on public.creator_publishing_fanvue_attempts from anon,authenticated;

create function public.creator_publishing_claim_scheduled_fanvue_jobs(p_limit integer default 1,p_lease_minutes integer default 15) returns table(job_id uuid,attempt_id uuid,lease_token uuid,attempt_ordinal integer) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_recovered integer;begin
 if p_limit not between 1 and 10 or p_lease_minutes not between 1 and 30 then raise exception 'FANVUE_CLAIM_ARGUMENT_INVALID';end if;
 -- A stale dispatched attempt is ambiguous: atomically fail closed before selecting executable work.
 with ambiguous as(select j.id job_id,a.id attempt_id from public.creator_publishing_platform_jobs j join public.creator_publishing_fanvue_attempts a on a.job_id=j.id and a.attempt_ordinal=j.attempt_count where j.target_platform='fanvue' and j.job_state='publishing_direct' and j.leased_at<clock_timestamp()-make_interval(mins=>p_lease_minutes) and a.finished_at is null and a.provider_create_dispatched_at is not null for update of j,a),finish_a as(update public.creator_publishing_fanvue_attempts a set finished_at=clock_timestamp(),outcome_class='uncertain',provider_create_attempted=true,safe_error_code='FANVUE_CREATE_DISPATCH_CRASH_UNCERTAIN',uncertainty_classification='lease_expired_after_create_dispatch' from ambiguous x where a.id=x.attempt_id),finish_j as(update public.creator_publishing_platform_jobs j set job_state='uncertain',terminal_classification='uncertain',safe_error_code='FANVUE_CREATE_DISPATCH_CRASH_UNCERTAIN',next_attempt_at=null,lease_token=null,leased_at=null,updated_at=clock_timestamp() from ambiguous x where j.id=x.job_id returning j.id) select count(*) into v_recovered from finish_j;
 return query with eligible as(
  select j.id,coalesce(a.id,gen_random_uuid()) attempt_id,coalesce(a.attempt_ordinal,j.attempt_count+1) ordinal
  from public.creator_publishing_platform_jobs j join public.creator_publishing_scheduler_events e on e.platform_job_id=j.id and e.event_type='publish_due' and e.schedule_revision=j.schedule_revision and e.status='processed' and e.due_at=j.intended_publish_at
  left join public.creator_publishing_fanvue_attempts a on a.job_id=j.id and a.attempt_ordinal=j.attempt_count and a.finished_at is null and a.provider_create_dispatched_at is null
  where j.target_platform='fanvue' and j.cancelled_at is null and j.attempt_count<3 and j.intended_publish_at<=clock_timestamp() and(j.next_attempt_at is null or j.next_attempt_at<=clock_timestamp()) and(j.job_state in('direct_publish_queued','retry_scheduled') or(j.job_state='publishing_direct' and j.leased_at<clock_timestamp()-make_interval(mins=>p_lease_minutes))) order by j.intended_publish_at,j.id for update of j skip locked limit p_limit),claimed as(update public.creator_publishing_platform_jobs j set job_state='publishing_direct',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),attempt_count=e.ordinal,updated_at=clock_timestamp() from eligible e where j.id=e.id returning j.id,e.attempt_id,j.lease_token,e.ordinal),attempts as(insert into public.creator_publishing_fanvue_attempts(id,job_id,creator_id,attempt_ordinal,lease_token) select c.attempt_id,c.id,j.creator_id,c.ordinal,c.lease_token from claimed c join public.creator_publishing_platform_jobs j on j.id=c.id on conflict(id) do update set lease_token=excluded.lease_token,started_at=clock_timestamp() returning id)
 select c.id,c.attempt_id,c.lease_token,c.ordinal from claimed c join attempts a on a.id=c.attempt_id;
end$$;
revoke all on function public.creator_publishing_claim_scheduled_fanvue_jobs(integer,integer) from public,anon,authenticated;grant execute on function public.creator_publishing_claim_scheduled_fanvue_jobs(integer,integer) to service_role;
create function public.creator_publishing_mark_fanvue_create_dispatched(p_attempt_id uuid,p_lease_token uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$declare n integer;begin update public.creator_publishing_fanvue_attempts a set provider_create_dispatched_at=clock_timestamp() where a.id=p_attempt_id and a.lease_token=p_lease_token and a.finished_at is null and a.provider_create_dispatched_at is null and exists(select 1 from public.creator_publishing_platform_jobs j where j.id=a.job_id and j.lease_token=p_lease_token and j.job_state='publishing_direct');get diagnostics n=row_count;return n=1;end$$;
revoke all on function public.creator_publishing_mark_fanvue_create_dispatched(uuid,uuid) from public,anon,authenticated;grant execute on function public.creator_publishing_mark_fanvue_create_dispatched(uuid,uuid) to service_role;
create function public.creator_publishing_finish_fanvue_attempt(p_attempt_id uuid,p_lease_token uuid,p_outcome text,p_upload boolean,p_refresh boolean,p_safe_code text,p_status text,p_proof uuid default null,p_next timestamptz default null) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$declare a public.creator_publishing_fanvue_attempts%rowtype;j public.creator_publishing_platform_jobs%rowtype;s text;begin select * into a from public.creator_publishing_fanvue_attempts where id=p_attempt_id and lease_token=p_lease_token for update;if not found then return false;end if;select * into j from public.creator_publishing_platform_jobs where id=a.job_id and lease_token=p_lease_token for update;if not found then return false;end if;if p_outcome='success' and p_proof is null then raise exception 'FANVUE_PROVIDER_PROOF_REQUIRED';end if;if p_outcome='retryable_pre_create' and(a.provider_create_dispatched_at is not null or p_next is null or j.attempt_count>=3)then raise exception 'FANVUE_RETRY_INVALID';end if;s:=case p_outcome when'success'then'published_direct' when'retryable_pre_create'then'retry_scheduled' when'reconnect_required'then'reconnect_required' when'uncertain'then'uncertain' else'direct_publish_failed'end;update public.creator_publishing_fanvue_attempts set finished_at=clock_timestamp(),outcome_class=p_outcome,provider_create_attempted=provider_create_dispatched_at is not null,upload_attempted=p_upload,refresh_attempted=p_refresh,safe_error_code=p_safe_code,status_class=p_status,provider_post_uuid=p_proof where id=a.id;update public.creator_publishing_platform_jobs set job_state=s,next_attempt_at=case when p_outcome='retryable_pre_create'then p_next end,posted_at=case when p_outcome='success'then clock_timestamp()end,terminal_classification=case when p_outcome='retryable_pre_create'then null else p_outcome end,safe_error_code=p_safe_code,provider_post_uuid=p_proof,lease_token=null,leased_at=null,updated_at=clock_timestamp()where id=j.id;return true;end$$;
revoke all on function public.creator_publishing_finish_fanvue_attempt(uuid,uuid,text,boolean,boolean,text,text,uuid,timestamptz) from public,anon,authenticated;grant execute on function public.creator_publishing_finish_fanvue_attempt(uuid,uuid,text,boolean,boolean,text,text,uuid,timestamptz) to service_role;
create view public.creator_publishing_fanvue_history with(security_invoker=true) as select id,creator_id,content_package_id,platform_account_id destination_id,publication_type,intended_publish_at scheduled_at,job_state state,next_attempt_at,posted_at,safe_error_code,created_at,updated_at from public.creator_publishing_platform_jobs where target_platform='fanvue';grant select on public.creator_publishing_fanvue_history to authenticated;

-- Canonical scheduler overrides: latest Task 17A definitions with a narrow dormant direct-Fanvue exception.
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
  queue_rec public.creator_publishing_queue_tasks%rowtype;
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
  v_operator_claim_cleanup jsonb;
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
    if (not found or capability_rec.availability_status <> 'available' or capability_rec.publishing_mode <> job_rec.publishing_mode) and not (job_rec.target_platform='fanvue' and job_rec.publishing_mode='direct') then v_gate_code := 'PLATFORM_UNAVAILABLE'; end if;
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
      if v_queue_count <> 1 or not exists (
        select 1
        from public.creator_publishing_queue_tasks as queue_source
        where queue_source.content_package_id=job_rec.content_package_id
          and queue_source.creator_id=job_rec.creator_id
          and queue_source.target_platform='onlyfans'
          and queue_source.platform_account_id=job_rec.platform_account_id
          and (
            (
              ((v_action='schedule' and queue_source.status='ready_for_handoff')
                or (v_action='reschedule' and queue_source.status in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now')))
              and queue_source.claimed_by is null
              and queue_source.claimed_at is null
              and queue_source.claim_token is null
              and queue_source.claim_expires_at is null
            )
            or (
              queue_source.status='claimed'
              and queue_source.claimed_by is not null
              and queue_source.claimed_at is not null
              and queue_source.claim_token is not null
              and queue_source.claim_expires_at is not null
              and queue_source.claim_expires_at > v_now
              and public.creator_publishing_operator_is_authorized(job_rec.creator_id,queue_source.claimed_by,'onlyfans')
            )
          )
          and queue_source.posted_by is null
          and queue_source.posted_at is null
          and queue_source.posted_confirmation is false
          and queue_source.final_post_url is null
          and queue_source.final_post_url_skip_reason is null
          and queue_source.proof_screenshot_storage_key is null
          and queue_source.skip_or_fail_reason is null
      ) then v_gate_code := 'ACTIVE_QUEUE_TASK_CONFLICT'; end if;
    end if;

    if v_gate_code is null and not exists (select 1 from public.creator_publishing_creator_verifications as verification_source where verification_source.creator_id=p_creator_id and verification_source.status='verified') then v_gate_code := 'CREATOR_VERIFICATION_MISSING'; end if;
    if v_gate_code is null and job_rec.target_platform<>'fanvue' and exists (select 1 from public.creator_platform_accounts as account_source where account_source.id=job_rec.platform_account_id and account_source.creator_id=job_rec.creator_id and account_source.platform=job_rec.target_platform and account_source.verification_status='revoked') then v_gate_code := 'DESTINATION_ACCOUNT_REVOKED'; end if;
    if v_gate_code is null and not exists (select 1 from public.creator_platform_accounts account_source left join public.autopost_accounts oauth_source on oauth_source.id=account_source.oauth_account_id where account_source.id=job_rec.platform_account_id and account_source.creator_id=job_rec.creator_id and account_source.platform=job_rec.target_platform and ((job_rec.target_platform='fanvue' and account_source.oauth_account_id=job_rec.oauth_account_id and oauth_source.user_id=job_rec.creator_id and oauth_source.platform='fanvue' and oauth_source.connection_status='CONNECTED' and length(btrim(coalesce(oauth_source.provider_account_id,'')))>0) or (job_rec.target_platform<>'fanvue' and account_source.verification_status='verified'))) then v_gate_code := 'DESTINATION_ACCOUNT_NOT_VERIFIED'; end if;
    if v_gate_code is null and not exists (select 1 from public.creator_publishing_ai_twin_consents as consent_source where consent_source.creator_id=p_creator_id and consent_source.status='granted' and consent_source.revoked_at is null and consent_source.attestation_version=p_expected_ai_twin_consent_version and consent_source.attestation_text_sha256=p_expected_ai_twin_consent_text_sha256) then v_gate_code := 'AI_TWIN_CONSENT_MISSING'; end if;
    if v_gate_code is null and not exists (select 1 from public.creator_publishing_content_packages as package_source where package_source.id=job_rec.content_package_id and package_source.creator_approval_status='approved' and package_source.compliance_status in ('passed','escalated_approved')) then v_gate_code := 'CREATOR_APPROVAL_MISSING'; end if;
    if v_gate_code is null and public.creator_publishing_autopost_source_fingerprint(job_rec.content_package_id) <> job_rec.source_package_fingerprint then v_gate_code := 'SOURCE_FINGERPRINT_STALE'; end if;
    if v_gate_code is null and exists (select 1 from public.creator_publishing_platform_jobs as publication_source where publication_source.content_package_id=job_rec.content_package_id and publication_source.id <> job_rec.id and publication_source.job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived')) then v_gate_code := 'ACTIVE_PUBLICATION_JOB_CONFLICT'; end if;

    if v_gate_code is not null then
      v_failure_count := v_failure_count + 1;
      v_jobs := v_jobs || jsonb_build_object('job_id',job_rec.id,'status','failed','safe_error_code',v_gate_code,'mutated',false,'operator_claim_cleanup',jsonb_build_object('performed',false));
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
      v_operator_claim_cleanup := jsonb_build_object('performed',false);
      if v_action in ('schedule','reschedule')
         and job_rec.target_platform='onlyfans'
         and job_rec.publishing_mode='assisted'
         and (p_intended_publish_at - interval '60 minutes') > v_now then
        select * into queue_rec
        from public.creator_publishing_queue_tasks as queue_source
        where queue_source.content_package_id=job_rec.content_package_id
          and queue_source.creator_id=job_rec.creator_id
          and queue_source.target_platform='onlyfans'
          and queue_source.platform_account_id=job_rec.platform_account_id
          and queue_source.status='claimed'
          and queue_source.claimed_by is not null
          and queue_source.claimed_at is not null
          and queue_source.claim_token is not null
          and queue_source.claim_expires_at is not null
          and queue_source.claim_expires_at > v_now
          and public.creator_publishing_operator_is_authorized(job_rec.creator_id,queue_source.claimed_by,'onlyfans')
          and queue_source.posted_by is null
          and queue_source.posted_at is null
          and queue_source.posted_confirmation is false
          and queue_source.final_post_url is null
          and queue_source.final_post_url_skip_reason is null
          and queue_source.proof_screenshot_storage_key is null
          and queue_source.skip_or_fail_reason is null
        order by queue_source.id
        limit 1
        for update of queue_source;
        if found then
          update public.creator_publishing_queue_tasks
          set status='scheduled_internally',
              claimed_by=null,
              claimed_at=null,
              claim_token=null,
              claim_expires_at=null,
              updated_at=v_now
          where id=queue_rec.id;
          v_operator_claim_cleanup := jsonb_build_object(
            'performed',true,
            'queue_task_id',queue_rec.id,
            'previous_status',queue_rec.status,
            'resulting_status','scheduled_internally',
            'reason',case when v_action='schedule' then 'scheduled_before_operator_due' else 'rescheduled_before_operator_due' end
          );
          insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at)
          values(
            'creator_publishing_queue_task',queue_rec.id,p_creator_id,'creator',case when v_action='schedule' then 'operator_task_claim_cleared_by_schedule' else 'operator_task_claim_cleared_by_reschedule' end,
            jsonb_build_object(
              'queue_task_id',queue_rec.id,
              'platform_job_id',job_rec.id,
              'status',queue_rec.status,
              'claimed_by',queue_rec.claimed_by,
              'claimed_at',queue_rec.claimed_at,
              'claim_expires_at',queue_rec.claim_expires_at,
              'claim_attempt_count',queue_rec.claim_attempt_count,
              'operator_progress_state',queue_rec.operator_progress_state,
              'operator_progress_revision',queue_rec.operator_progress_revision,
              'operator_progress_updated_by',queue_rec.operator_progress_updated_by,
              'operator_progress_updated_at',queue_rec.operator_progress_updated_at,
              'assigned_operator_id',queue_rec.assigned_operator_id
            ),
            jsonb_build_object(
              'queue_task_id',queue_rec.id,
              'platform_job_id',job_rec.id,
              'resulting_status','scheduled_internally',
              'schedule_revision',v_new_revision,
              'operator_due_at',p_intended_publish_at - interval '60 minutes',
              'reason',case when v_action='schedule' then 'scheduled_before_operator_due' else 'rescheduled_before_operator_due' end
            ),
            p_idempotency_key,v_now
          );
        end if;
      end if;
      v_success_count := v_success_count + 1;
      v_jobs := v_jobs || jsonb_build_object('job_id',job_rec.id,'status','scheduled','schedule_revision',v_new_revision,'mutated',true,'operator_claim_cleanup',v_operator_claim_cleanup);
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
  v_failed_job_state text;
  v_claimed_task public.creator_publishing_queue_tasks%rowtype;
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
  if v_gate_code is null and (not found or capability_rec.availability_status <> 'available' or capability_rec.publishing_mode <> job_rec.publishing_mode) and not (job_rec.target_platform='fanvue' and job_rec.publishing_mode='direct') then v_gate_code := 'PLATFORM_UNAVAILABLE'; end if;
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
  if v_gate_code is null and not exists (select 1 from public.creator_platform_accounts account_source left join public.autopost_accounts oauth_source on oauth_source.id=account_source.oauth_account_id where account_source.id=job_rec.platform_account_id and account_source.creator_id=job_rec.creator_id and account_source.platform=job_rec.target_platform and ((job_rec.target_platform='fanvue' and account_source.oauth_account_id=job_rec.oauth_account_id and oauth_source.user_id=job_rec.creator_id and oauth_source.platform='fanvue' and oauth_source.connection_status='CONNECTED' and length(btrim(coalesce(oauth_source.provider_account_id,'')))>0) or (job_rec.target_platform<>'fanvue' and account_source.verification_status='verified'))) then v_gate_code := 'DESTINATION_ACCOUNT_NOT_VERIFIED'; end if;
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
  if v_gate_code is null and job_rec.publishing_mode='assisted' and (not exists (
    select 1
    from public.creator_publishing_queue_tasks as queue_source
    where queue_source.content_package_id=job_rec.content_package_id
      and queue_source.creator_id=job_rec.creator_id
      and queue_source.target_platform='onlyfans'
      and queue_source.platform_account_id=job_rec.platform_account_id
      and ((queue_source.status in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now')
            and queue_source.claimed_by is null
            and queue_source.claimed_at is null
            and queue_source.claim_token is null
            and queue_source.claim_expires_at is null)
        or (queue_source.status='claimed'
            and queue_source.claimed_by is not null
            and queue_source.claimed_at is not null
            and queue_source.claim_token is not null
            and queue_source.claim_expires_at is not null
            and queue_source.claim_expires_at > v_now
            and public.creator_publishing_operator_is_authorized(job_rec.creator_id,queue_source.claimed_by,'onlyfans')))
      and queue_source.posted_by is null
      and queue_source.posted_at is null
      and queue_source.posted_confirmation is false
      and queue_source.final_post_url is null
      and queue_source.final_post_url_skip_reason is null
      and queue_source.proof_screenshot_storage_key is null
      and queue_source.skip_or_fail_reason is null
  ) or (select count(*) from public.creator_publishing_queue_tasks as queue_source where queue_source.content_package_id=job_rec.content_package_id and queue_source.target_platform='onlyfans' and queue_source.status not in ('archived','blocked','needs_fix','skipped','failed_manual_upload','confirmed_posted_manual')) <> 1) then
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
    v_failed_job_state := case when v_gate_code in ('SOURCE_FINGERPRINT_STALE','AI_TWIN_CONSENT_MISSING','CREATOR_VERIFICATION_MISSING','SCHEDULER_STATE_TRANSITION_INVALID','CREATOR_APPROVAL_MISSING','COMPLIANCE_EVIDENCE_INVALID','CO_PERFORMER_RELEASE_MISSING') then 'needs_fix' else 'blocked' end;
    update public.creator_publishing_scheduler_events set status='blocked', processed_at=v_now, safe_error_code=v_gate_code, lock_token=null, locked_at=null, updated_at=v_now where id=event_rec.id and lock_token=p_lock_token;
    update public.creator_publishing_scheduler_events set status='superseded', superseded_at=v_now, lock_token=null, locked_at=null, updated_at=v_now where platform_job_id=job_rec.id and schedule_revision=event_rec.schedule_revision and id<>event_rec.id and status in ('pending','processing');
    update public.creator_publishing_platform_jobs set job_state=v_failed_job_state, updated_at=v_now where id=job_rec.id;
    if job_rec.target_platform='onlyfans' and job_rec.publishing_mode='assisted' then
      for v_claimed_task in
        select * from public.creator_publishing_queue_tasks q
        where q.content_package_id=job_rec.content_package_id
          and q.creator_id=job_rec.creator_id
          and q.target_platform=job_rec.target_platform
          and q.platform_account_id=job_rec.platform_account_id
          and q.status='claimed'
        order by q.id
        for update
      loop
        update public.creator_publishing_queue_tasks set status=v_failed_job_state, claimed_by=null, claimed_at=null, claim_token=null, claim_expires_at=null, updated_at=v_now where id=v_claimed_task.id;
        insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at)
        values('creator_publishing_queue_task',v_claimed_task.id,null,'scheduler','operator_task_claim_cleared_by_scheduler_gate',jsonb_build_object('status',v_claimed_task.status,'claimed_by',v_claimed_task.claimed_by,'claimed_at',v_claimed_task.claimed_at,'claim_expires_at',v_claimed_task.claim_expires_at,'progress_state',v_claimed_task.operator_progress_state,'progress_revision',v_claimed_task.operator_progress_revision,'assigned_operator_id',v_claimed_task.assigned_operator_id),jsonb_build_object('status',v_failed_job_state,'safe_error_code',v_gate_code,'platform_job_id',job_rec.id),v_now);
      end loop;
    end if;
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


revoke all on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) from public,anon,authenticated;
revoke all on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text) to service_role;
grant execute on function public.creator_publishing_process_scheduler_event(uuid,uuid,text,text) to service_role;
