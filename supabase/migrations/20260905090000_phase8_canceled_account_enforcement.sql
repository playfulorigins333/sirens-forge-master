-- Generated manually because the Supabase CLI is unavailable in this environment.
-- Phase 8D: canceled-account enforcement for the cancellation-retained creator workspace.
-- Production application requires separate explicit authorization.
--
-- Boundaries:
-- - central subscription-cancellation retention policy remains authoritative;
-- - the locked cancellation window is never shorter than 60 days;
-- - paid creator read access ends at retention_until even when a legal hold preserves data;
-- - newer billing lifecycles supersede older cancellation purge authority;
-- - purge is bounded, claim-tokened, retryable, audited, and legal-hold aware;
-- - destructive work is limited to creator working data created on/before that lifecycle's retention deadline;
-- - nullable or post-deadline working data fails closed as a blocker rather than being guessed into old purge scope;
-- - creator Library/Twin working data is purged while Auth, billing, receipts, governance,
--   and other compliance evidence remain intact;
-- - legacy generation binaries without a managed generation_asset remain a blocker rather
--   than having their storage pointer silently discarded;
-- - Phase 8E delinquency, Phase 8G deletion/billing/export completeness, and Phase 9
--   notification delivery are intentionally untouched.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.subscription_cancellation_retentions
  add column if not exists purge_claimed_at timestamptz,
  add column if not exists purge_claim_token uuid,
  add column if not exists purge_completed_at timestamptz,
  add column if not exists purge_attempt_count integer not null default 0;

alter table public.subscription_cancellation_retentions
  drop constraint if exists subscription_cancellation_retentions_state_check,
  drop constraint if exists subscription_cancellation_retentions_check1,
  drop constraint if exists subscription_cancellation_retention_window_check,
  drop constraint if exists subscription_cancellation_purge_state_check,
  drop constraint if exists subscription_cancellation_purge_attempt_count_check;

alter table public.subscription_cancellation_retentions
  add constraint subscription_cancellation_retentions_state_check
    check (state in ('pending_paid_access_end','retained_read_only','reactivated','superseded','expired','purge_pending','purged')),
  add constraint subscription_cancellation_retention_window_check
    check (retention_until >= paid_access_ends_at + interval '60 days'),
  add constraint subscription_cancellation_purge_state_check
    check (
      (state='purge_pending' and purge_claimed_at is not null and purge_claim_token is not null and purge_completed_at is null)
      or (state='purged' and purge_claimed_at is not null and purge_claim_token is null and purge_completed_at is not null)
      or state not in ('purge_pending','purged')
    ),
  add constraint subscription_cancellation_purge_attempt_count_check check (purge_attempt_count >= 0);

drop index if exists public.subscription_cancellation_due_lookup;
create index subscription_cancellation_due_lookup
  on public.subscription_cancellation_retentions(retention_until,state,id)
  where state in ('pending_paid_access_end','retained_read_only','expired','purge_pending');

drop index if exists public.subscription_cancellation_one_open_lifecycle;
create unique index subscription_cancellation_one_open_lifecycle
  on public.subscription_cancellation_retentions(subscription_id)
  where state in ('pending_paid_access_end','retained_read_only','expired','purge_pending');

create or replace function public.sync_subscription_cancellation_retention()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_auth_user_id uuid;
  v_boundary timestamptz;
  v_duration interval;
  v_retention_until timestamptz;
  v_state text;
begin
  if new.stripe_subscription_id is null or new.current_period_end is null or new.tier_name='og_throne' then return new; end if;

  if lower(new.status) in ('active','trialing') and not coalesce(new.cancel_at_period_end,false) then
    update public.subscription_cancellation_retentions
       set state='reactivated',reactivated_at=statement_timestamp(),updated_at=statement_timestamp()
     where subscription_id=new.id and state in ('pending_paid_access_end','retained_read_only','expired');
    return new;
  end if;

  if not ((lower(new.status) in ('active','trialing') and coalesce(new.cancel_at_period_end,false)) or lower(new.status)='canceled') then return new; end if;

  select p.user_id into v_auth_user_id from public.profiles p where p.id=new.user_id;
  if v_auth_user_id is null then return new; end if;

  select retention_duration into v_duration
  from public.current_retention_policy('subscription_cancellation',statement_timestamp());
  if v_duration is null or v_duration < interval '60 days' then raise exception 'PHASE8D_CANCELLATION_RETENTION_POLICY_INVALID'; end if;

  v_boundary := new.current_period_end;
  v_retention_until := v_boundary + v_duration;
  v_state := case
    when statement_timestamp()<v_boundary then 'pending_paid_access_end'
    when statement_timestamp()<v_retention_until then 'retained_read_only'
    else 'expired'
  end;

  insert into public.subscription_cancellation_retentions(
    auth_user_id,profile_id,subscription_id,state,paid_access_ends_at,retention_started_at,retention_until,
    cancellation_observed_at,day_0_notification_due_at,day_30_notification_due_at,day_45_notification_due_at,day_55_notification_due_at
  ) values (
    v_auth_user_id,new.user_id,new.id,v_state,v_boundary,v_boundary,v_retention_until,statement_timestamp(),
    v_boundary,v_boundary+interval '30 days',v_boundary+interval '45 days',v_boundary+interval '55 days'
  )
  on conflict (subscription_id) where state in ('pending_paid_access_end','retained_read_only','expired','purge_pending')
  do update set
    paid_access_ends_at=greatest(public.subscription_cancellation_retentions.paid_access_ends_at,excluded.paid_access_ends_at),
    retention_started_at=greatest(public.subscription_cancellation_retentions.paid_access_ends_at,excluded.paid_access_ends_at),
    retention_until=greatest(public.subscription_cancellation_retentions.retention_until,excluded.retention_until),
    day_0_notification_due_at=greatest(public.subscription_cancellation_retentions.paid_access_ends_at,excluded.paid_access_ends_at),
    day_30_notification_due_at=greatest(public.subscription_cancellation_retentions.paid_access_ends_at,excluded.paid_access_ends_at)+interval '30 days',
    day_45_notification_due_at=greatest(public.subscription_cancellation_retentions.paid_access_ends_at,excluded.paid_access_ends_at)+interval '45 days',
    day_55_notification_due_at=greatest(public.subscription_cancellation_retentions.paid_access_ends_at,excluded.paid_access_ends_at)+interval '55 days',
    state=case
      when statement_timestamp()<greatest(public.subscription_cancellation_retentions.paid_access_ends_at,excluded.paid_access_ends_at) then 'pending_paid_access_end'
      when statement_timestamp()<greatest(public.subscription_cancellation_retentions.retention_until,excluded.retention_until) then 'retained_read_only'
      else 'expired'
    end,
    updated_at=statement_timestamp()
  where public.subscription_cancellation_retentions.state<>'purge_pending';
  return new;
end;
$$;
revoke all on function public.sync_subscription_cancellation_retention() from public,anon,authenticated,service_role;

create or replace function public.phase8d_canceled_account_has_active_hold(p_retention_id uuid,p_subscription_id uuid,p_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select public.governance_target_has_active_legal_hold('subscription_cancellation_retention',p_retention_id::text,p_auth_user_id)
      or public.governance_target_has_active_legal_hold('subscription',p_subscription_id::text,p_auth_user_id)
      or public.governance_target_has_active_legal_hold('account',p_auth_user_id::text,p_auth_user_id)
$$;
revoke all on function public.phase8d_canceled_account_has_active_hold(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- An old cancellation lifecycle must never become purge authority over a newer/current billing lifecycle.
-- Delinquent states are deliberately treated as successors because Phase 8E owns their enforcement.
create or replace function public.phase8d_canceled_retention_has_successor(
  p_retention_id uuid,
  p_profile_id uuid,
  p_subscription_id uuid,
  p_paid_access_ends_at timestamptz
) returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select exists(
    select 1
    from public.user_subscriptions s
    where s.user_id=p_profile_id
      and (
        (s.id=p_subscription_id and (
          (lower(btrim(s.status)) in ('active','trialing') and not coalesce(s.cancel_at_period_end,false))
          or lower(btrim(s.status)) in ('past_due','unpaid')
        ))
        or (
          s.id<>p_subscription_id
          and lower(btrim(s.status)) in ('active','trialing','past_due','unpaid')
        )
      )
  ) or exists(
    select 1
    from public.subscription_cancellation_retentions newer
    where newer.profile_id=p_profile_id
      and newer.id<>p_retention_id
      and newer.paid_access_ends_at>p_paid_access_ends_at
      and newer.state not in ('reactivated','superseded')
  )
$$;
revoke all on function public.phase8d_canceled_retention_has_successor(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.phase8d_supersede_canceled_retention(p_retention_id uuid,p_auth_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  r public.subscription_cancellation_retentions%rowtype;
  v_prior_state text;
  v_audit_id uuid;
begin
  select * into r
  from public.subscription_cancellation_retentions
  where id=p_retention_id and auth_user_id=p_auth_user_id
  for update;
  if not found or r.state in ('reactivated','superseded','purged') then return false; end if;

  if not public.phase8d_canceled_retention_has_successor(r.id,r.profile_id,r.subscription_id,r.paid_access_ends_at) then
    return false;
  end if;

  v_prior_state:=r.state;
  update public.subscription_cancellation_retentions
     set state='superseded',purge_claim_token=null,purge_completed_at=null,updated_at=statement_timestamp()
   where id=r.id;

  v_audit_id:=public.append_governance_audit_event(
    null,'system','retention.subscription_cancellation_superseded','subscription_cancellation_retention',r.id::text,
    'newer_billing_lifecycle','newer billing lifecycle owns current retention authority','superseded','subscription_cancellation:v1',
    null,gen_random_uuid(),null,
    jsonb_build_object('subscription_id',r.subscription_id,'retention_until',r.retention_until,'prior_state',v_prior_state),
    '{}'::jsonb,null
  );
  return true;
end;
$$;
revoke all on function public.phase8d_supersede_canceled_retention(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.phase8d_canceled_resource_has_active_hold(p_target_type text,p_target_id text,p_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select public.governance_target_has_active_legal_hold(p_target_type,p_target_id,p_auth_user_id)
      or public.governance_target_has_active_legal_hold('account',p_auth_user_id::text,p_auth_user_id)
      or exists(
        select 1 from public.subscription_cancellation_retentions r
        where r.auth_user_id=p_auth_user_id and r.state='purge_pending'
          and public.phase8d_canceled_account_has_active_hold(r.id,r.subscription_id,p_auth_user_id)
      )
$$;
revoke all on function public.phase8d_canceled_resource_has_active_hold(text,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.phase8c_private_media_governance_hold(p_asset_id uuid,p_generation_id uuid,p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select public.phase8d_canceled_resource_has_active_hold('private_generation_asset',p_asset_id::text,p_owner_id)
      or public.governance_target_has_active_legal_hold('generation',p_generation_id::text,p_owner_id)
$$;
revoke all on function public.phase8c_private_media_governance_hold(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.phase8d_assert_twin_purge_allowed()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if ((new.lifecycle_state='purge_pending' and old.lifecycle_state is distinct from new.lifecycle_state)
      or (new.training_data_state='purge_pending' and old.training_data_state is distinct from new.training_data_state))
     and (public.phase8d_canceled_resource_has_active_hold('user_lora',new.id::text,new.user_id)
          or public.governance_target_has_active_legal_hold('twin',new.id::text,new.user_id)) then
    raise exception 'TWIN_LEGAL_HOLD';
  end if;
  return new;
end;
$$;
revoke all on function public.phase8d_assert_twin_purge_allowed() from public,anon,authenticated,service_role;

drop trigger if exists phase8d_twin_purge_hold_guard on public.user_loras;
create trigger phase8d_twin_purge_hold_guard
before update of lifecycle_state,training_data_state on public.user_loras
for each row execute function public.phase8d_assert_twin_purge_allowed();

create or replace function public.phase8d_claim_expired_canceled_accounts(p_limit integer default 10)
returns table(
  retention_id uuid,
  auth_user_id uuid,
  profile_id uuid,
  subscription_id uuid,
  claim_token uuid,
  claim_state text,
  retention_until timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  r public.subscription_cancellation_retentions%rowtype;
  v_token uuid;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'PHASE8D_PURGE_LIMIT_INVALID'; end if;
  for r in
    select scr.* from public.subscription_cancellation_retentions scr
    where scr.retention_until<=statement_timestamp()
      and scr.state in ('pending_paid_access_end','retained_read_only','expired','purge_pending')
    order by scr.retention_until,scr.id for update skip locked limit p_limit
  loop
    if public.phase8d_supersede_canceled_retention(r.id,r.auth_user_id) then
      return query select r.id,r.auth_user_id,r.profile_id,r.subscription_id,null::uuid,'superseded'::text,r.retention_until;
      continue;
    end if;

    if r.state in ('pending_paid_access_end','retained_read_only') then
      update public.subscription_cancellation_retentions set state='expired',updated_at=statement_timestamp() where id=r.id;
      r.state:='expired';
    end if;
    if public.phase8d_canceled_account_has_active_hold(r.id,r.subscription_id,r.auth_user_id) then
      return query select r.id,r.auth_user_id,r.profile_id,r.subscription_id,null::uuid,'held'::text,r.retention_until;
      continue;
    end if;
    if r.state='purge_pending' then
      if r.purge_claim_token is null then raise exception 'PHASE8D_PURGE_CLAIM_CORRUPT'; end if;
      return query select r.id,r.auth_user_id,r.profile_id,r.subscription_id,r.purge_claim_token,'claimed'::text,r.retention_until;
      continue;
    end if;
    v_token:=gen_random_uuid();
    update public.subscription_cancellation_retentions
       set state='purge_pending',purge_claimed_at=coalesce(purge_claimed_at,statement_timestamp()),
           purge_claim_token=v_token,purge_attempt_count=purge_attempt_count+1,updated_at=statement_timestamp()
     where id=r.id;
    return query select r.id,r.auth_user_id,r.profile_id,r.subscription_id,v_token,'claimed'::text,r.retention_until;
  end loop;
end;
$$;
revoke all on function public.phase8d_claim_expired_canceled_accounts(integer) from public,anon,authenticated;
grant execute on function public.phase8d_claim_expired_canceled_accounts(integer) to service_role;

create or replace function public.phase8d_validate_canceled_account_purge(
  p_retention_id uuid,
  p_auth_user_id uuid,
  p_claim_token uuid
) returns table(allowed boolean,retention_state text,retention_until timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  r public.subscription_cancellation_retentions%rowtype;
begin
  if p_retention_id is null or p_auth_user_id is null or p_claim_token is null then raise exception 'PHASE8D_PURGE_CLAIM_INVALID'; end if;
  select * into r
  from public.subscription_cancellation_retentions
  where id=p_retention_id and auth_user_id=p_auth_user_id
  for update;
  if not found then raise exception 'PHASE8D_RETENTION_NOT_FOUND'; end if;
  if r.state='superseded' then return query select false,r.state,r.retention_until; return; end if;
  if r.state<>'purge_pending' or r.purge_claim_token is distinct from p_claim_token then raise exception 'PHASE8D_PURGE_CLAIM_INVALID'; end if;

  if public.phase8d_supersede_canceled_retention(r.id,r.auth_user_id) then
    return query select false,'superseded'::text,r.retention_until;
    return;
  end if;
  if public.phase8d_canceled_account_has_active_hold(r.id,r.subscription_id,r.auth_user_id) then
    return query select false,'held'::text,r.retention_until;
    return;
  end if;
  return query select true,r.state,r.retention_until;
end;
$$;
revoke all on function public.phase8d_validate_canceled_account_purge(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase8d_validate_canceled_account_purge(uuid,uuid,uuid) to service_role;

create or replace function public.phase8d_finalize_canceled_account_purge(p_retention_id uuid,p_auth_user_id uuid,p_claim_token uuid)
returns table(retention_id uuid,retention_state text,finalized boolean,blocked_count integer)
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  r public.subscription_cancellation_retentions%rowtype;
  v_blocked integer:=0;
  v_audit_id uuid;
  v_correlation uuid:=gen_random_uuid();
begin
  if p_retention_id is null or p_auth_user_id is null or p_claim_token is null then raise exception 'PHASE8D_PURGE_CLAIM_INVALID'; end if;
  select * into r from public.subscription_cancellation_retentions
   where id=p_retention_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'PHASE8D_RETENTION_NOT_FOUND'; end if;
  if r.state='purged' then return query select r.id,r.state,true,0; return; end if;
  if r.state='superseded' then return query select r.id,r.state,false,0; return; end if;
  if r.state<>'purge_pending' or r.purge_claim_token is distinct from p_claim_token then raise exception 'PHASE8D_PURGE_CLAIM_INVALID'; end if;

  if public.phase8d_supersede_canceled_retention(r.id,r.auth_user_id) then
    return query select r.id,'superseded'::text,false,0;
    return;
  end if;
  if public.phase8d_canceled_account_has_active_hold(r.id,r.subscription_id,r.auth_user_id) then
    return query select r.id,r.state,false,1; return;
  end if;

  delete from public.content_posts p
   where p.user_id=r.auth_user_id
     and p.created_at<=r.retention_until
     and not public.phase8d_canceled_resource_has_active_hold('content_post',p.id::text,r.auth_user_id);

  delete from public.collections c
   where c.user_id=r.auth_user_id
     and c.created_at is not null
     and c.created_at<=r.retention_until
     and not public.phase8d_canceled_resource_has_active_hold('collection',c.id::text,r.auth_user_id);

  -- Scrub database-resident generation content, but retain legacy binary pointers until a
  -- physical storage authority has actually removed those bytes. Unknown or post-deadline
  -- creation timestamps are not guessed into the old lifecycle and remain blockers.
  update public.generations g
     set prompt=null,negative_prompt=null,lora_used=null,body_type=null,
         metadata=public.phase8_minimized_generation_metadata(coalesce(g.metadata,'{}'::jsonb)),
         runpod_job_id=null,error_message=null,updated_at=statement_timestamp()
   where g.user_id in (r.auth_user_id,r.profile_id)
     and g.created_at is not null
     and g.created_at<=(r.retention_until at time zone 'UTC')
     and not public.phase8d_canceled_resource_has_active_hold('generation',g.id::text,r.auth_user_id);

  select
    (select count(*) from public.generation_assets a
      where a.owner_id=r.auth_user_id and a.lifecycle_state<>'purged')
    +(select count(*) from public.user_loras l
      where l.user_id in (r.auth_user_id,r.profile_id) and l.lifecycle_state<>'purged')
    +(select count(*) from public.content_posts p where p.user_id=r.auth_user_id)
    +(select count(*) from public.collections c where c.user_id=r.auth_user_id)
    +(select count(*) from public.generations g
      where g.user_id in (r.auth_user_id,r.profile_id)
        and (
          g.created_at is null
          or g.created_at>(r.retention_until at time zone 'UTC')
          or (
            g.created_at<=(r.retention_until at time zone 'UTC')
            and (public.phase8d_canceled_resource_has_active_hold('generation',g.id::text,r.auth_user_id)
                 or g.r2_key is not null or g.image_url is not null)
          )
        ))
  into v_blocked;

  if v_blocked>0 then return query select r.id,r.state,false,v_blocked; return; end if;

  update public.subscription_cancellation_retentions
     set state='purged',purge_claim_token=null,purge_completed_at=statement_timestamp(),updated_at=statement_timestamp()
   where id=r.id returning * into r;

  v_audit_id:=public.append_governance_audit_event(
    null,'system','retention.subscription_cancellation_purged','subscription_cancellation_retention',r.id::text,
    'retention_expired','cancellation retention window elapsed','purged','subscription_cancellation:v1',
    null,v_correlation,null,jsonb_build_object('subscription_id',r.subscription_id,'retention_until',r.retention_until),'{}'::jsonb,null
  );
  return query select r.id,r.state,true,0;
end;
$$;
revoke all on function public.phase8d_finalize_canceled_account_purge(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase8d_finalize_canceled_account_purge(uuid,uuid,uuid) to service_role;

commit;
