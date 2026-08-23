-- Atomically disconnect a publishing provider and cancel its unpublished work.
-- This is forward-only repository schema; applying it to any environment remains a separate action.
create or replace function public.disconnect_publishing_provider(
  p_user_id uuid,
  p_provider text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_account public.autopost_accounts%rowtype;
  v_legacy_jobs integer := 0;
  v_cpq_jobs integer := 0;
  v_scheduler_events integer := 0;
  v_queue_tasks integer := 0;
  v_rules_updated integer := 0;
begin
  if p_user_id is null or p_provider not in ('fanvue', 'x') then
    raise exception 'PUBLISHING_DISCONNECT_ARGUMENT_INVALID';
  end if;

  select * into v_account
  from public.autopost_accounts
  where user_id = p_user_id and platform = p_provider
  for update;

  if not found then
    raise exception 'PUBLISHING_ACCOUNT_NOT_FOUND';
  end if;

  if v_account.connection_status = 'REVOKED'
     and v_account.access_token is null and v_account.refresh_token is null
     and v_account.encrypted_access_token is null and v_account.encrypted_refresh_token is null then
    raise exception 'PUBLISHING_ACCOUNT_ALREADY_DISCONNECTED';
  end if;

  -- Do not report a completed disconnect while a provider create request may be in flight.
  if p_provider = 'fanvue' and exists (
    select 1
    from public.creator_publishing_platform_jobs j
    join public.creator_publishing_fanvue_attempts a
      on a.job_id = j.id and a.finished_at is null
    where j.creator_id = p_user_id
      and j.oauth_account_id = v_account.id
      and a.provider_create_dispatched_at is not null
    for update of j, a
  ) then
    raise exception 'PUBLISHING_DISCONNECT_PROVIDER_CREATE_IN_FLIGHT';
  end if;

  if p_provider = 'x' and exists (
    select 1 from public.autopost_jobs j
    where j.user_id = p_user_id and j.platform = 'x' and j.state = 'RUNNING'
    for update
  ) then
    raise exception 'PUBLISHING_DISCONNECT_PROVIDER_CREATE_IN_FLIGHT';
  end if;

  update public.autopost_accounts
  set connection_status = 'REVOKED',
      access_token = null,
      refresh_token = null,
      encrypted_access_token = null,
      encrypted_refresh_token = null,
      token_expires_at = null,
      last_error = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'provider', p_provider,
        'disconnected_at', v_now,
        'disconnect_reason', 'user_requested'
      )
  where id = v_account.id;

  update public.autopost_jobs
  set state = 'SKIPPED',
      locked_at = null,
      lock_id = null,
      completed_at = v_now,
      error = null,
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'cancelled', true,
        'cancelled_at', v_now,
        'cancellation_reason', 'provider_disconnected'
      )
  where user_id = p_user_id
    and platform = p_provider
    and state = 'QUEUED';
  get diagnostics v_legacy_jobs = row_count;

  update public.autopost_rules
  set selected_platforms = selected_platforms - p_provider,
      enabled = case when jsonb_array_length(selected_platforms - p_provider) = 0 then false else enabled end,
      next_run_at = case when jsonb_array_length(selected_platforms - p_provider) = 0 then null else next_run_at end
  where user_id = p_user_id
    and selected_platforms ? p_provider;
  get diagnostics v_rules_updated = row_count;

  if p_provider = 'fanvue' then
    update public.creator_platform_accounts
    set verification_status = 'revoked',
        verification_legacy_revoked = true,
        verification_reviewed_by = null,
        verification_reviewed_at = null,
        verification_evidence_reference = null,
        verification_reason = null,
        updated_at = v_now
    where creator_id = p_user_id
      and platform = 'fanvue'
      and oauth_account_id = v_account.id;

    update public.creator_publishing_fanvue_attempts a
    set finished_at = v_now,
        outcome_class = 'permanent',
        safe_error_code = 'PROVIDER_DISCONNECTED'
    from public.creator_publishing_platform_jobs j
    where a.job_id = j.id
      and a.finished_at is null
      and a.provider_create_dispatched_at is null
      and j.creator_id = p_user_id
      and j.oauth_account_id = v_account.id;

    update public.creator_publishing_platform_jobs
    set job_state = 'cancelled',
        cancelled_at = v_now,
        cancelled_by = p_user_id,
        cancellation_reason = 'provider_disconnected',
        next_attempt_at = null,
        lease_token = null,
        leased_at = null,
        terminal_classification = 'cancelled',
        safe_error_code = 'PROVIDER_DISCONNECTED',
        updated_at = v_now
    where creator_id = p_user_id
      and oauth_account_id = v_account.id
      and target_platform = 'fanvue'
      and posted_at is null
      and cancelled_at is null
      and job_state not in ('published_direct', 'confirmed_posted_manual', 'exported');
    get diagnostics v_cpq_jobs = row_count;

    update public.creator_publishing_scheduler_events e
    set status = 'cancelled',
        cancelled_at = v_now,
        lock_token = null,
        locked_at = null,
        updated_at = v_now
    from public.creator_publishing_platform_jobs j
    where e.platform_job_id = j.id
      and j.creator_id = p_user_id
      and j.oauth_account_id = v_account.id
      and e.status in ('pending', 'processing');
    get diagnostics v_scheduler_events = row_count;

    update public.creator_publishing_queue_tasks q
    set status = 'archived', updated_at = v_now
    from public.creator_publishing_platform_jobs j
    where q.content_package_id = j.content_package_id
      and q.creator_id = j.creator_id
      and q.platform_account_id = j.platform_account_id
      and q.target_platform = j.target_platform
      and j.creator_id = p_user_id
      and j.oauth_account_id = v_account.id
      and j.job_state = 'cancelled'
      and j.cancellation_reason = 'provider_disconnected'
      and q.status not in ('confirmed_posted_manual', 'skipped', 'failed_manual_upload', 'blocked', 'archived');
    get diagnostics v_queue_tasks = row_count;

    update public.creator_publishing_plans p
    set status = public.creator_publishing_aggregate_plan_status(p.id), updated_at = v_now
    where exists (
      select 1 from public.creator_publishing_platform_jobs j
      where j.publishing_plan_id = p.id
        and j.creator_id = p_user_id
        and j.oauth_account_id = v_account.id
        and j.job_state = 'cancelled'
        and j.cancellation_reason = 'provider_disconnected'
    );
  end if;

  insert into public.creator_publishing_audit_events(
    entity_type, entity_id, actor_id, actor_role, action, before_state, after_state, created_at
  ) values (
    'autopost_account', v_account.id, p_user_id, 'creator', 'publishing_provider_disconnected',
    jsonb_build_object('provider', p_provider, 'connection_status', v_account.connection_status),
    jsonb_build_object(
      'provider', p_provider,
      'connection_status', 'REVOKED',
      'credentials_nullified', true,
      'legacy_unpublished_jobs_cancelled', v_legacy_jobs,
      'cpq_unpublished_jobs_cancelled', v_cpq_jobs,
      'scheduler_events_cancelled', v_scheduler_events,
      'queue_tasks_archived', v_queue_tasks,
      'rules_updated', v_rules_updated,
      'disconnected_at', v_now
    ),
    v_now
  );

  return jsonb_build_object(
    'provider', p_provider,
    'credentials_nullified', true,
    'unpublished_jobs_cancelled', v_legacy_jobs + v_cpq_jobs,
    'scheduler_events_cancelled', v_scheduler_events,
    'queue_tasks_archived', v_queue_tasks,
    'rules_updated', v_rules_updated,
    'disconnected_at', v_now
  );
end;
$$;

-- The original aggregate predates the Fanvue `cancelled` job state. Treat a
-- cancelled destination as a terminal non-success while preserving other jobs.
create or replace function public.creator_publishing_aggregate_plan_status(p_plan_id uuid)
returns text language sql stable set search_path = public, pg_temp as $$
  with jobs as (select job_state from public.creator_publishing_platform_jobs where publishing_plan_id = p_plan_id), counts as (
    select count(*) total,
      count(*) filter (where job_state in ('published_direct','confirmed_posted_manual','exported')) successes,
      count(*) filter (where job_state in ('direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived','cancelled')) failures,
      count(*) filter (where job_state in ('scheduled_internally','scheduled_on_platform','retry_scheduled')) scheduled,
      count(*) filter (where job_state in ('publishing_direct','direct_publish_queued','awaiting_operator','due_now','claimed','awaiting_post_confirmation','ready_to_publish')) active,
      count(*) filter (where job_state in ('draft','package_ready','ready_for_export','authentication_required','needs_fix')) draftish
    from jobs)
  select case
    when p.status = 'cancelled' then 'cancelled'
    when c.total = 0 then 'draft'
    when c.successes = c.total then 'completed'
    when c.successes + c.failures = c.total and c.failures > 0 then 'completed_with_failures'
    when c.successes > 0 then 'partially_published'
    when c.active > 0 then 'in_progress'
    when c.scheduled = c.total then 'scheduled'
    when c.scheduled > 0 then 'in_progress'
    when c.failures > 0 then 'in_progress'
    when c.draftish = c.total then 'draft'
    else 'in_progress' end
  from public.creator_publishing_plans p cross join counts c where p.id = p_plan_id;
$$;

create or replace function public.autopost_begin_x_dispatch(
  p_user_id uuid, p_job_id uuid, p_lock_id text
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_account public.autopost_accounts%rowtype;
  v_updated integer;
begin
  if p_user_id is null or p_job_id is null or nullif(btrim(coalesce(p_lock_id, '')), '') is null then
    return false;
  end if;
  select * into v_account from public.autopost_accounts
  where user_id=p_user_id and platform='x' for update;
  if not found or v_account.connection_status<>'CONNECTED'
     or nullif(btrim(coalesce(v_account.encrypted_access_token,'')),'') is null then
    return false;
  end if;
  update public.autopost_jobs set state='RUNNING', updated_at=clock_timestamp()
  where id=p_job_id and user_id=p_user_id and platform='x' and state='QUEUED'
    and completed_at is null and lock_id=p_lock_id and locked_at is not null;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;

revoke all on function public.disconnect_publishing_provider(uuid, text) from public, anon, authenticated;
grant execute on function public.disconnect_publishing_provider(uuid, text) to service_role;
revoke all on function public.autopost_begin_x_dispatch(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.autopost_begin_x_dispatch(uuid, uuid, text) to service_role;
