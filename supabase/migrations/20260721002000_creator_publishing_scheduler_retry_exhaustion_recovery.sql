-- Task 21 Gate 21C-5: controlled recovery for retry-exhausted scheduler events.
-- Forward-only dormant RPC addition. Applying this migration performs no data mutation.

create or replace function public.creator_publishing_requeue_retry_exhausted_scheduler_event(
  p_event_id uuid,
  p_idempotency_key text,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict error
declare
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_reason_code text := btrim(coalesce(p_reason_code, ''));
  v_now timestamptz := transaction_timestamp();
  v_identity record;
  v_plan public.creator_publishing_plans%rowtype;
  v_job public.creator_publishing_platform_jobs%rowtype;
  v_event public.creator_publishing_scheduler_events%rowtype;
  v_prior_audit public.creator_publishing_audit_events%rowtype;
begin
  if p_event_id is null then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_EVENT_REQUIRED');
  end if;

  if v_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_IDEMPOTENCY_KEY_INVALID');
  end if;

  if v_reason_code not in (
    'TRANSIENT_INFRASTRUCTURE_RECOVERED',
    'DEPENDENCY_RESTORED',
    'CONFIGURATION_CORRECTED',
    'MANUAL_RETRY_APPROVED'
  ) then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_REASON_INVALID');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator_scheduler_retry_recovery:' || p_event_id::text, 0)
  );

  select
    event_source.creator_id,
    event_source.publishing_plan_id,
    event_source.platform_job_id,
    event_source.schedule_revision
  into v_identity
  from public.creator_publishing_scheduler_events as event_source
  where event_source.id = p_event_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_EVENT_NOT_FOUND');
  end if;

  select * into v_plan
  from public.creator_publishing_plans as plan_source
  where plan_source.id = v_identity.publishing_plan_id
    and plan_source.creator_id = v_identity.creator_id
  for update of plan_source;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_NOT_ELIGIBLE');
  end if;

  select * into v_job
  from public.creator_publishing_platform_jobs as job_source
  where job_source.id = v_identity.platform_job_id
    and job_source.publishing_plan_id = v_identity.publishing_plan_id
    and job_source.creator_id = v_identity.creator_id
  for update of job_source;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_NOT_ELIGIBLE');
  end if;

  select * into v_event
  from public.creator_publishing_scheduler_events as event_source
  where event_source.id = p_event_id
  for update of event_source;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_EVENT_NOT_FOUND');
  end if;

  if v_event.creator_id is distinct from v_identity.creator_id
    or v_event.publishing_plan_id is distinct from v_identity.publishing_plan_id
    or v_event.platform_job_id is distinct from v_identity.platform_job_id
    or v_event.schedule_revision is distinct from v_identity.schedule_revision
    or v_event.publishing_plan_id is distinct from v_job.publishing_plan_id
    or v_event.creator_id is distinct from v_job.creator_id
    or v_event.platform_job_id is distinct from v_job.id
  then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_NOT_ELIGIBLE');
  end if;

  select * into v_prior_audit
  from public.creator_publishing_audit_events as audit_source
  where audit_source.entity_type = 'creator_publishing_scheduler_event'
    and audit_source.entity_id = p_event_id
    and audit_source.action = 'creator_publishing_scheduler_event_retry_requeued'
    and audit_source.idempotency_key = v_idempotency_key
  order by audit_source.id desc
  limit 1;

  if found then
    if coalesce(v_prior_audit.before_state ->> 'reason_code', '') <> v_reason_code then
      return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_IDEMPOTENCY_CONFLICT');
    end if;

    if v_event.status = 'blocked'
      and v_event.safe_error_code = 'SCHEDULER_RETRY_EXHAUSTED'
      and v_event.processed_at is not null
      and (v_prior_audit.before_state -> 'processed_at') is distinct from to_jsonb(v_event.processed_at)
    then
      return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_IDEMPOTENCY_KEY_STALE');
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'SCHEDULER_RETRY_RECOVERY_REQUEUED',
      'idempotent', true
    );
  end if;

  if v_event.status is distinct from 'blocked'
    or v_event.safe_error_code is distinct from 'SCHEDULER_RETRY_EXHAUSTED'
    or v_event.processing_attempts < 3
    or v_event.processed_at is null
    or v_event.lock_token is not null
    or v_event.locked_at is not null
    or v_event.due_at > v_now
    or v_plan.status = 'cancelled'
    or v_job.cancelled_at is not null
    or v_job.job_state in (
      'published_direct',
      'confirmed_posted_manual',
      'exported',
      'direct_publish_failed',
      'failed_manual_upload',
      'skipped',
      'blocked',
      'platform_rejected',
      'archived'
    )
    or v_event.schedule_revision is distinct from v_job.schedule_revision
  then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_NOT_ELIGIBLE');
  end if;

  if not (
    (
      v_event.event_type = 'operator_due'
      and v_job.publishing_mode = 'assisted'
      and v_job.job_state = 'scheduled_internally'
      and v_job.operator_due_at is not distinct from v_event.due_at
    )
    or (
      v_event.event_type = 'publish_due'
      and v_job.publishing_mode = 'assisted'
      and v_job.job_state in ('scheduled_internally', 'awaiting_operator')
      and v_job.intended_publish_at is not distinct from v_event.due_at
    )
    or (
      v_event.event_type = 'publish_due'
      and v_job.publishing_mode = 'direct'
      and v_job.job_state = 'ready_to_publish'
      and v_job.intended_publish_at is not distinct from v_event.due_at
    )
    or (
      v_event.event_type = 'publish_due'
      and v_job.publishing_mode = 'planner'
      and v_job.job_state = 'package_ready'
      and v_job.intended_publish_at is not distinct from v_event.due_at
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULER_RETRY_RECOVERY_NOT_ELIGIBLE');
  end if;

  update public.creator_publishing_scheduler_events as event_update
  set
    status = 'pending',
    processing_attempts = 0,
    processed_at = null,
    safe_error_code = null,
    lock_token = null,
    locked_at = null,
    updated_at = v_now
  where event_update.id = v_event.id;

  insert into public.creator_publishing_audit_events(
    entity_type,
    entity_id,
    actor_id,
    actor_role,
    action,
    before_state,
    after_state,
    idempotency_key,
    created_at
  )
  values(
    'creator_publishing_scheduler_event',
    v_event.id,
    null,
    'scheduler_operator',
    'creator_publishing_scheduler_event_retry_requeued',
    jsonb_build_object(
      'status', v_event.status,
      'processing_attempts', v_event.processing_attempts,
      'safe_error_code', v_event.safe_error_code,
      'processed_at', v_event.processed_at,
      'event_type', v_event.event_type,
      'due_at', v_event.due_at,
      'schedule_revision', v_event.schedule_revision,
      'reason_code', v_reason_code
    ),
    jsonb_build_object(
      'status', 'pending',
      'processing_attempts', 0,
      'safe_error_code', null,
      'event_type', v_event.event_type,
      'due_at', v_event.due_at,
      'schedule_revision', v_event.schedule_revision,
      'reason_code', v_reason_code
    ),
    v_idempotency_key,
    v_now
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'SCHEDULER_RETRY_RECOVERY_REQUEUED',
    'idempotent', false
  );
end;
$$;

revoke all on function public.creator_publishing_requeue_retry_exhausted_scheduler_event(uuid,text,text) from public, anon, authenticated;
grant execute on function public.creator_publishing_requeue_retry_exhausted_scheduler_event(uuid,text,text) to service_role;
