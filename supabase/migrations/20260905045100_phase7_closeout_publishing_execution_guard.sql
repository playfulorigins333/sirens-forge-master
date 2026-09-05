-- Phase 7 closeout: re-check durable account/payment lifecycle immediately
-- before background publishing can reach a provider create operation.
-- Phase 8 and Phase 9 responsibilities are unchanged.

begin;

create or replace function public.phase7_creator_lifecycle_execution_allowed(p_auth_user_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_profile_id uuid;
  v_subscription_id uuid;
  v_status text;
  v_tier_name text;
  v_stripe_subscription_id text;
  v_current_period_end timestamptz;
  v_lifetime boolean;
begin
  if p_auth_user_id is null then return false; end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.user_id = p_auth_user_id
    and coalesce(p.account_lifecycle_state,'active') = 'active'
  limit 1;
  if v_profile_id is null then return false; end if;

  select s.id,lower(btrim(s.status)),s.tier_name,s.stripe_subscription_id,s.current_period_end
    into v_subscription_id,v_status,v_tier_name,v_stripe_subscription_id,v_current_period_end
  from public.user_subscriptions s
  where s.user_id = v_profile_id
    and lower(btrim(s.status)) in ('active','trialing','past_due','unpaid','canceled')
  order by s.current_period_end desc nulls last, s.id desc
  limit 1;
  if v_subscription_id is null then return false; end if;

  v_lifetime := v_tier_name = 'og_throne' and v_stripe_subscription_id is null;

  if v_stripe_subscription_id is not null and exists (
    select 1
    from public.subscription_payment_delinquencies d
    where d.auth_user_id = p_auth_user_id
      and d.profile_id = v_profile_id
      and d.subscription_id = v_subscription_id
      and d.state in ('first_miss_frozen','retention_countdown')
  ) then
    return false;
  end if;

  if v_lifetime then
    return v_status in ('active','trialing');
  end if;

  if v_stripe_subscription_id is null or v_current_period_end is null or v_current_period_end <= now() then
    return false;
  end if;

  return v_status in ('active','trialing','canceled');
end $$;

revoke all on function public.phase7_creator_lifecycle_execution_allowed(uuid) from public, anon, authenticated;

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
  if not public.phase7_creator_lifecycle_execution_allowed(p_user_id) then
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
revoke all on function public.autopost_begin_x_dispatch(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.autopost_begin_x_dispatch(uuid,uuid,text) to service_role;

create or replace function public.creator_publishing_claim_scheduled_fanvue_jobs(p_limit integer default 1,p_lease_minutes integer default 15)
returns table(job_id uuid,attempt_id uuid,lease_token uuid,attempt_ordinal integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_recovered integer;begin
 if p_limit not between 1 and 10 or p_lease_minutes not between 1 and 30 then raise exception 'FANVUE_CLAIM_ARGUMENT_INVALID';end if;
 with ambiguous as(select j.id job_id,a.id attempt_id from public.creator_publishing_platform_jobs j join public.creator_publishing_fanvue_attempts a on a.job_id=j.id and a.attempt_ordinal=j.attempt_count where j.target_platform='fanvue' and j.job_state='publishing_direct' and j.leased_at<clock_timestamp()-make_interval(mins=>p_lease_minutes) and a.finished_at is null and a.provider_create_dispatched_at is not null for update of j,a),finish_a as(update public.creator_publishing_fanvue_attempts a set finished_at=clock_timestamp(),outcome_class='uncertain',provider_create_attempted=true,safe_error_code='FANVUE_CREATE_DISPATCH_CRASH_UNCERTAIN',uncertainty_classification='lease_expired_after_create_dispatch' from ambiguous x where a.id=x.attempt_id),finish_j as(update public.creator_publishing_platform_jobs j set job_state='uncertain',terminal_classification='uncertain',safe_error_code='FANVUE_CREATE_DISPATCH_CRASH_UNCERTAIN',next_attempt_at=null,lease_token=null,leased_at=null,updated_at=clock_timestamp() from ambiguous x where j.id=x.job_id returning j.id) select count(*) into v_recovered from finish_j;
 return query with eligible as(
  select j.id,coalesce(a.id,gen_random_uuid()) attempt_id,coalesce(a.attempt_ordinal,j.attempt_count+1) ordinal
  from public.creator_publishing_platform_jobs j join public.creator_publishing_scheduler_events e on e.platform_job_id=j.id and e.event_type='publish_due' and e.schedule_revision=j.schedule_revision and e.status='processed' and e.due_at=j.intended_publish_at
  left join public.creator_publishing_fanvue_attempts a on a.job_id=j.id and a.attempt_ordinal=j.attempt_count and a.finished_at is null and a.provider_create_dispatched_at is null
  where j.target_platform='fanvue'
    and public.phase7_creator_lifecycle_execution_allowed(j.creator_id)
    and j.cancelled_at is null and j.attempt_count<3 and j.intended_publish_at<=clock_timestamp() and(j.next_attempt_at is null or j.next_attempt_at<=clock_timestamp()) and(j.job_state in('direct_publish_queued','retry_scheduled') or(j.job_state='publishing_direct' and j.leased_at<clock_timestamp()-make_interval(mins=>p_lease_minutes))) order by j.intended_publish_at,j.id for update of j skip locked limit p_limit),claimed as(update public.creator_publishing_platform_jobs j set job_state='publishing_direct',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),attempt_count=e.ordinal,updated_at=clock_timestamp() from eligible e where j.id=e.id returning j.id,e.attempt_id,j.lease_token,e.ordinal),attempts as(insert into public.creator_publishing_fanvue_attempts(id,job_id,creator_id,attempt_ordinal,lease_token) select c.attempt_id,c.id,j.creator_id,c.ordinal,c.lease_token from claimed c join public.creator_publishing_platform_jobs j on j.id=c.id on conflict(id) do update set lease_token=excluded.lease_token,started_at=clock_timestamp() returning id)
 select c.id,c.attempt_id,c.lease_token,c.ordinal from claimed c join attempts a on a.id=c.attempt_id;
end$$;
revoke all on function public.creator_publishing_claim_scheduled_fanvue_jobs(integer,integer) from public,anon,authenticated;
grant execute on function public.creator_publishing_claim_scheduled_fanvue_jobs(integer,integer) to service_role;

create or replace function public.creator_publishing_mark_fanvue_create_dispatched(p_attempt_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;begin
 update public.creator_publishing_fanvue_attempts a set provider_create_dispatched_at=clock_timestamp()
 where a.id=p_attempt_id and a.lease_token=p_lease_token and a.finished_at is null and a.provider_create_dispatched_at is null
   and exists(select 1 from public.creator_publishing_platform_jobs j where j.id=a.job_id and j.lease_token=p_lease_token and j.job_state='publishing_direct' and public.phase7_creator_lifecycle_execution_allowed(j.creator_id));
 get diagnostics n=row_count;return n=1;end$$;
revoke all on function public.creator_publishing_mark_fanvue_create_dispatched(uuid,uuid) from public,anon,authenticated;
grant execute on function public.creator_publishing_mark_fanvue_create_dispatched(uuid,uuid) to service_role;

commit;
