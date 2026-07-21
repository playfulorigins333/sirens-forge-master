-- Task 21 Gate 21C-4: bound scheduler claims to three successful attempts.
-- Forward-only function replacement. Applying this migration performs no data mutation.

create or replace function public.creator_publishing_claim_due_scheduler_events(
  p_limit integer default 25,
  p_lock_minutes integer default 15
)
returns table(event_id uuid, lock_token uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict error
declare
  v_claim_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_lock_ttl interval := make_interval(mins => least(greatest(coalesce(p_lock_minutes, 15), 1), 60));
  v_now timestamptz := transaction_timestamp();
  v_exhausted record;
begin
  -- Stage 1: terminalize a bounded, deterministic set of stale attempt-3 rows.
  for v_exhausted in
    select
      event_source.id,
      event_source.status as prior_status,
      event_source.processing_attempts as prior_processing_attempts,
      event_source.event_type,
      event_source.due_at,
      event_source.schedule_revision
    from public.creator_publishing_scheduler_events as event_source
    where event_source.status = 'processing'
      and event_source.processing_attempts >= 3
      and event_source.locked_at < v_now - v_lock_ttl
    order by
      event_source.due_at,
      case event_source.event_type when 'operator_due' then 0 else 1 end,
      event_source.id
    limit v_claim_limit
    for update of event_source skip locked
  loop
    update public.creator_publishing_scheduler_events as event_update
    set
      status = 'blocked',
      processed_at = v_now,
      safe_error_code = 'SCHEDULER_RETRY_EXHAUSTED',
      lock_token = null,
      locked_at = null,
      updated_at = v_now
    where event_update.id = v_exhausted.id
      and event_update.status = 'processing'
      and event_update.processing_attempts >= 3
      and event_update.locked_at < v_now - v_lock_ttl;

    if found then
      insert into public.creator_publishing_audit_events(
        entity_type,
        entity_id,
        actor_id,
        actor_role,
        action,
        before_state,
        after_state,
        created_at
      )
      values (
        'creator_publishing_scheduler_event',
        v_exhausted.id,
        null,
        'scheduler',
        'creator_publishing_scheduler_event_retry_exhausted',
        jsonb_build_object(
          'status', v_exhausted.prior_status,
          'processing_attempts', v_exhausted.prior_processing_attempts,
          'event_type', v_exhausted.event_type,
          'due_at', v_exhausted.due_at,
          'schedule_revision', v_exhausted.schedule_revision
        ),
        jsonb_build_object(
          'status', 'blocked',
          'processing_attempts', v_exhausted.prior_processing_attempts,
          'safe_error_code', 'SCHEDULER_RETRY_EXHAUSTED',
          'event_type', v_exhausted.event_type,
          'due_at', v_exhausted.due_at,
          'schedule_revision', v_exhausted.schedule_revision
        ),
        v_now
      );
    end if;
  end loop;

  -- Stage 2: perform the existing ordinary claim after exhaustion state is durable
  -- inside this transaction. Stale rows at attempt 3 are never claimed again.
  return query
  with eligible as (
    select
      event_source.id,
      event_source.platform_job_id,
      event_source.due_at,
      event_source.event_type,
      event_source.schedule_revision,
      event_source.status as prior_status,
      event_source.processing_attempts as prior_processing_attempts,
      case event_source.event_type when 'operator_due' then 0 else 1 end as event_order
    from public.creator_publishing_scheduler_events as event_source
    where (
      (event_source.status = 'pending' and event_source.due_at <= v_now)
      or
      (
        event_source.status = 'processing'
        and event_source.processing_attempts < 3
        and event_source.locked_at < v_now - v_lock_ttl
      )
    )
    and not exists (
      select 1
      from public.creator_publishing_scheduler_events as earlier_event_source
      where earlier_event_source.platform_job_id = event_source.platform_job_id
        and earlier_event_source.status in ('pending', 'processing')
        and earlier_event_source.id <> event_source.id
        and (
          earlier_event_source.due_at < event_source.due_at
          or (
            earlier_event_source.due_at = event_source.due_at
            and (case earlier_event_source.event_type when 'operator_due' then 0 else 1 end)
              < (case event_source.event_type when 'operator_due' then 0 else 1 end)
          )
          or (
            earlier_event_source.due_at = event_source.due_at
            and earlier_event_source.event_type = event_source.event_type
            and earlier_event_source.id < event_source.id
          )
        )
    )
    and not exists (
      select 1
      from public.creator_publishing_scheduler_events as processing_event_source
      where processing_event_source.platform_job_id = event_source.platform_job_id
        and processing_event_source.status = 'processing'
        and processing_event_source.id <> event_source.id
        and processing_event_source.locked_at >= v_now - v_lock_ttl
    )
    order by
      event_source.due_at,
      case event_source.event_type when 'operator_due' then 0 else 1 end,
      event_source.id
    limit v_claim_limit
    for update of event_source skip locked
  ), claimed as (
    update public.creator_publishing_scheduler_events as event_update
    set
      status = 'processing',
      lock_token = gen_random_uuid(),
      locked_at = v_now,
      processing_attempts = event_update.processing_attempts + 1,
      updated_at = v_now
    from eligible
    where event_update.id = eligible.id
      and (
        event_update.status = 'pending'
        or (event_update.status = 'processing' and event_update.processing_attempts < 3)
      )
    returning
      event_update.id,
      event_update.lock_token,
      event_update.status as new_status,
      event_update.processing_attempts as new_processing_attempts,
      eligible.prior_status,
      eligible.prior_processing_attempts,
      eligible.due_at,
      eligible.event_type,
      eligible.schedule_revision,
      eligible.event_order,
      eligible.platform_job_id
  ), claim_audits as (
    insert into public.creator_publishing_audit_events(
      entity_type,
      entity_id,
      actor_id,
      actor_role,
      action,
      before_state,
      after_state,
      created_at
    )
    select
      'creator_publishing_scheduler_event',
      claimed.id,
      null,
      'scheduler',
      'creator_publishing_scheduler_event_claimed',
      jsonb_build_object(
        'status', claimed.prior_status,
        'processing_attempts', claimed.prior_processing_attempts,
        'event_type', claimed.event_type,
        'due_at', claimed.due_at,
        'schedule_revision', claimed.schedule_revision
      ),
      jsonb_build_object(
        'status', claimed.new_status,
        'processing_attempts', claimed.new_processing_attempts,
        'event_type', claimed.event_type,
        'due_at', claimed.due_at,
        'schedule_revision', claimed.schedule_revision
      ),
      v_now
    from claimed
    returning id
  )
  select claimed.id as event_id, claimed.lock_token
  from claimed
  cross join (select count(*) from claim_audits) as audit_guard
  order by claimed.due_at, claimed.event_order, claimed.id;
end;
$$;

revoke all on function public.creator_publishing_claim_due_scheduler_events(integer,integer)
from public, anon, authenticated;

grant execute on function public.creator_publishing_claim_due_scheduler_events(integer,integer)
to service_role;
