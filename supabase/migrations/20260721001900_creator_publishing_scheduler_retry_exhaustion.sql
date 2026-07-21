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
), exhausted as (
  update public.creator_publishing_scheduler_events as event_update
  set status='blocked', safe_error_code='SCHEDULER_RETRY_EXHAUSTED', processed_at=(select db_now from bounds), lock_token=null, locked_at=null, updated_at=(select db_now from bounds)
  from eligible
  where event_update.id=eligible.id
    and eligible.prior_status='processing'
    and eligible.prior_processing_attempts >= 3
  returning event_update.id, event_update.status as new_status, event_update.safe_error_code,
            eligible.prior_status, eligible.prior_processing_attempts, eligible.due_at, eligible.event_type, eligible.schedule_revision
), exhausted_audits as (
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at)
  select 'creator_publishing_scheduler_event', exhausted.id, null, 'scheduler', 'creator_publishing_scheduler_gate_failed',
         jsonb_build_object('status',exhausted.prior_status,'processing_attempts',exhausted.prior_processing_attempts,'event_type',exhausted.event_type,'due_at',exhausted.due_at,'schedule_revision',exhausted.schedule_revision),
         jsonb_build_object('status',exhausted.new_status,'safe_error_code',exhausted.safe_error_code,'processing_attempts',exhausted.prior_processing_attempts,'event_type',exhausted.event_type,'due_at',exhausted.due_at,'schedule_revision',exhausted.schedule_revision),
         (select db_now from bounds)
  from exhausted
  returning id
), claimed as (
  update public.creator_publishing_scheduler_events as event_update
  set status='processing', lock_token=gen_random_uuid(), locked_at=(select db_now from bounds), processing_attempts=event_update.processing_attempts+1, updated_at=(select db_now from bounds)
  from eligible
  where event_update.id=eligible.id and event_update.status in ('pending','processing')
    and not exists (select 1 from exhausted where exhausted.id=eligible.id)
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

revoke all on function public.creator_publishing_claim_due_scheduler_events(integer,integer)
from public, anon, authenticated;

grant execute on function public.creator_publishing_claim_due_scheduler_events(integer,integer)
to service_role;
