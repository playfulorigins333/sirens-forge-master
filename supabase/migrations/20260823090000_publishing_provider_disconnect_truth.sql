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
    set verification_status = 'revoked', updated_at = v_now
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

revoke all on function public.disconnect_publishing_provider(uuid, text) from public, anon, authenticated;
grant execute on function public.disconnect_publishing_provider(uuid, text) to service_role;
