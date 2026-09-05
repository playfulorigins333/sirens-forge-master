-- Phase 8E: subscription delinquency retention enforcement.
-- Production application requires separate explicit authorization.
--
-- Boundaries:
-- - first missed cycle remains frozen under the Phase 7 runtime contract;
-- - the second consecutive missed cycle starts the locked 60-day retention clock;
-- - delinquency evidence, invoice evidence, Auth, profile, billing, governance, and receipts remain retained;
-- - only creator working data is purged after the retention deadline;
-- - recovery or a newer billing lifecycle supersedes old purge authority;
-- - legal holds fail closed and do not restore creator access;
-- - claim/finalize is bounded, retryable, audited, and service-role only;
-- - Phase 9 notification delivery is intentionally untouched.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.subscription_payment_delinquencies
  add column if not exists purge_claimed_at timestamptz,
  add column if not exists purge_claim_token uuid,
  add column if not exists purge_completed_at timestamptz,
  add column if not exists purge_attempt_count integer not null default 0;

alter table public.subscription_payment_delinquencies
  drop constraint if exists subscription_payment_delinquency_purge_attempt_count_check,
  drop constraint if exists subscription_payment_delinquency_purge_claim_check,
  drop constraint if exists subscription_payment_delinquency_purge_complete_check;

alter table public.subscription_payment_delinquencies
  add constraint subscription_payment_delinquency_purge_attempt_count_check
    check (purge_attempt_count >= 0),
  add constraint subscription_payment_delinquency_purge_claim_check
    check (purge_claim_token is null or (purge_claimed_at is not null and purge_completed_at is null)),
  add constraint subscription_payment_delinquency_purge_complete_check
    check (purge_completed_at is null or (purge_claimed_at is not null and purge_claim_token is null));

create index if not exists subscription_payment_delinquency_phase8e_due
  on public.subscription_payment_delinquencies(retention_until,id)
  where state='retention_countdown' and purge_completed_at is null;

create or replace function public.phase8e_delinquency_has_successor(
  p_delinquency_id uuid,
  p_profile_id uuid,
  p_subscription_id uuid,
  p_second_missed_at timestamptz
) returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select
    exists(
      select 1
      from public.user_subscriptions s
      where s.id=p_subscription_id
        and s.user_id=p_profile_id
        and lower(btrim(s.status)) in ('active','trialing')
        and s.current_period_start is not null
        and s.current_period_start >= coalesce(
          (select max(i.billing_period_end)
             from public.subscription_payment_delinquency_invoices i
            where i.delinquency_id=p_delinquency_id),
          p_second_missed_at
        )
    )
    or exists(
      select 1
      from public.user_subscriptions s
      where s.user_id=p_profile_id
        and s.id<>p_subscription_id
        and lower(btrim(s.status)) in ('active','trialing','past_due','unpaid','canceled')
        and coalesce(s.created_at,s.current_period_start,s.updated_at) > p_second_missed_at
    )
    or exists(
      select 1
      from public.subscription_payment_delinquencies newer
      where newer.profile_id=p_profile_id
        and newer.id<>p_delinquency_id
        and newer.second_missed_at is not null
        and newer.second_missed_at>p_second_missed_at
        and newer.state not in ('recovered','superseded')
    )
    or exists(
      select 1
      from public.subscription_cancellation_retentions c
      where c.profile_id=p_profile_id
        and c.paid_access_ends_at>p_second_missed_at
        and c.state not in ('reactivated','superseded','purged')
    )
$$;
revoke all on function public.phase8e_delinquency_has_successor(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.phase8e_supersede_delinquency(p_delinquency_id uuid,p_auth_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  d public.subscription_payment_delinquencies%rowtype;
  v_audit_id uuid;
begin
  select * into d
  from public.subscription_payment_delinquencies
  where id=p_delinquency_id and auth_user_id=p_auth_user_id
  for update;
  if not found or d.state in ('recovered','superseded') or d.second_missed_at is null then return false; end if;
  if not public.phase8e_delinquency_has_successor(d.id,d.profile_id,d.subscription_id,d.second_missed_at) then return false; end if;

  update public.subscription_payment_delinquencies
     set state='superseded',purge_claim_token=null,updated_at=statement_timestamp()
   where id=d.id;

  v_audit_id:=public.append_governance_audit_event(
    null,'system','retention.subscription_delinquency_superseded','subscription_payment_delinquency',d.id::text,
    'newer_billing_lifecycle','newer billing lifecycle owns current retention authority','superseded','subscription_delinquency:v1',
    null,gen_random_uuid(),null,
    jsonb_build_object('subscription_id',d.subscription_id,'retention_until',d.retention_until,'purge_completed_at',d.purge_completed_at),
    '{}'::jsonb,null
  );
  return true;
end;
$$;
revoke all on function public.phase8e_supersede_delinquency(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.phase8e_delinquent_account_has_active_hold(
  p_delinquency_id uuid,
  p_subscription_id uuid,
  p_auth_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select public.governance_target_has_active_legal_hold('subscription_payment_delinquency',p_delinquency_id::text,p_auth_user_id)
      or public.governance_target_has_active_legal_hold('subscription',p_subscription_id::text,p_auth_user_id)
      or public.governance_target_has_active_legal_hold('account',p_auth_user_id::text,p_auth_user_id)
$$;
revoke all on function public.phase8e_delinquent_account_has_active_hold(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.phase8e_delinquent_resource_has_active_hold(
  p_target_type text,
  p_target_id text,
  p_auth_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select public.governance_target_has_active_legal_hold(p_target_type,p_target_id,p_auth_user_id)
      or public.governance_target_has_active_legal_hold('account',p_auth_user_id::text,p_auth_user_id)
      or exists(
        select 1
        from public.subscription_payment_delinquencies d
        where d.auth_user_id=p_auth_user_id
          and d.state='retention_countdown'
          and d.purge_claim_token is not null
          and d.purge_completed_at is null
          and public.phase8e_delinquent_account_has_active_hold(d.id,d.subscription_id,p_auth_user_id)
      )
$$;
revoke all on function public.phase8e_delinquent_resource_has_active_hold(text,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.phase8_retention_resource_has_active_hold(
  p_target_type text,
  p_target_id text,
  p_auth_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select public.phase8d_canceled_resource_has_active_hold(p_target_type,p_target_id,p_auth_user_id)
      or public.phase8e_delinquent_resource_has_active_hold(p_target_type,p_target_id,p_auth_user_id)
$$;
revoke all on function public.phase8_retention_resource_has_active_hold(text,text,uuid) from public,anon,authenticated,service_role;

-- Extend the shared media/Twin legal-hold guard so either Phase 8D or 8E claim blocks physical deletion.
create or replace function public.phase8c_private_media_governance_hold(p_asset_id uuid,p_generation_id uuid,p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select public.phase8_retention_resource_has_active_hold('private_generation_asset',p_asset_id::text,p_owner_id)
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
     and (public.phase8_retention_resource_has_active_hold('user_lora',new.id::text,new.user_id)
          or public.governance_target_has_active_legal_hold('twin',new.id::text,new.user_id)) then
    raise exception 'TWIN_LEGAL_HOLD';
  end if;
  return new;
end;
$$;
revoke all on function public.phase8d_assert_twin_purge_allowed() from public,anon,authenticated,service_role;

-- Existing lifecycle helpers use creator_permanent_delete by default. During an active retention
-- claim, normalize that write to retention_expired so the persisted purge evidence is truthful.
create or replace function public.phase8_retention_purge_claim_active(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select exists(
    select 1 from public.subscription_cancellation_retentions c
    where (c.auth_user_id=p_owner_id or c.profile_id=p_owner_id)
      and c.state='purge_pending'
  ) or exists(
    select 1 from public.subscription_payment_delinquencies d
    where (d.auth_user_id=p_owner_id or d.profile_id=p_owner_id)
      and d.state='retention_countdown'
      and d.purge_claim_token is not null
      and d.purge_completed_at is null
  )
$$;
revoke all on function public.phase8_retention_purge_claim_active(uuid) from public,anon,authenticated,service_role;

create or replace function public.phase8_retention_normalize_generation_asset_purge_reason()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.purge_reason='creator_permanent_delete'
     and old.purge_reason is distinct from new.purge_reason
     and public.phase8_retention_purge_claim_active(new.owner_id) then
    new.purge_reason:='retention_expired';
  end if;
  return new;
end;
$$;
revoke all on function public.phase8_retention_normalize_generation_asset_purge_reason() from public,anon,authenticated,service_role;

drop trigger if exists phase8_retention_generation_asset_purge_reason on public.generation_assets;
create trigger phase8_retention_generation_asset_purge_reason
before update of purge_reason on public.generation_assets
for each row execute function public.phase8_retention_normalize_generation_asset_purge_reason();

create or replace function public.phase8_retention_normalize_twin_purge_reason()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.purge_reason='creator_permanent_delete'
     and old.purge_reason is distinct from new.purge_reason
     and public.phase8_retention_purge_claim_active(new.user_id) then
    new.purge_reason:='retention_expired';
  end if;
  return new;
end;
$$;
revoke all on function public.phase8_retention_normalize_twin_purge_reason() from public,anon,authenticated,service_role;

drop trigger if exists phase8_retention_twin_purge_reason on public.user_loras;
create trigger phase8_retention_twin_purge_reason
before update of purge_reason on public.user_loras
for each row execute function public.phase8_retention_normalize_twin_purge_reason();

create or replace function public.phase8e_claim_expired_delinquent_accounts(p_limit integer default 10)
returns table(
  delinquency_id uuid,
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
  d public.subscription_payment_delinquencies%rowtype;
  v_token uuid;
  v_duration interval;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'PHASE8E_PURGE_LIMIT_INVALID'; end if;
  select retention_duration into v_duration
    from public.current_retention_policy('subscription_delinquency_after_second_miss',statement_timestamp());
  if v_duration is null or v_duration<interval '60 days' then raise exception 'PHASE8E_DELINQUENCY_RETENTION_POLICY_INVALID'; end if;

  for d in
    select x.*
      from public.subscription_payment_delinquencies x
     where x.state='retention_countdown'
       and x.retention_until<=statement_timestamp()
       and x.purge_completed_at is null
     order by x.retention_until,x.id
     for update skip locked
     limit p_limit
  loop
    if d.retention_started_at is null or d.second_missed_at is null or d.retention_until<d.retention_started_at+interval '60 days' then
      raise exception 'PHASE8E_DELINQUENCY_RETENTION_ROW_INVALID';
    end if;
    if public.phase8e_supersede_delinquency(d.id,d.auth_user_id) then
      return query select d.id,d.auth_user_id,d.profile_id,d.subscription_id,null::uuid,'superseded'::text,d.retention_until;
      continue;
    end if;
    if public.phase8e_delinquent_account_has_active_hold(d.id,d.subscription_id,d.auth_user_id) then
      return query select d.id,d.auth_user_id,d.profile_id,d.subscription_id,null::uuid,'held'::text,d.retention_until;
      continue;
    end if;
    if d.purge_claim_token is not null then
      return query select d.id,d.auth_user_id,d.profile_id,d.subscription_id,d.purge_claim_token,'claimed'::text,d.retention_until;
      continue;
    end if;
    v_token:=gen_random_uuid();
    update public.subscription_payment_delinquencies
       set purge_claimed_at=coalesce(purge_claimed_at,statement_timestamp()),
           purge_claim_token=v_token,
           purge_attempt_count=purge_attempt_count+1,
           updated_at=statement_timestamp()
     where id=d.id;
    return query select d.id,d.auth_user_id,d.profile_id,d.subscription_id,v_token,'claimed'::text,d.retention_until;
  end loop;
end;
$$;
revoke all on function public.phase8e_claim_expired_delinquent_accounts(integer) from public,anon,authenticated;
grant execute on function public.phase8e_claim_expired_delinquent_accounts(integer) to service_role;

create or replace function public.phase8e_validate_delinquent_account_purge(
  p_delinquency_id uuid,
  p_auth_user_id uuid,
  p_claim_token uuid
) returns table(allowed boolean,delinquency_state text,retention_until timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  d public.subscription_payment_delinquencies%rowtype;
begin
  if p_delinquency_id is null or p_auth_user_id is null or p_claim_token is null then raise exception 'PHASE8E_PURGE_CLAIM_INVALID'; end if;
  select * into d
    from public.subscription_payment_delinquencies
   where id=p_delinquency_id and auth_user_id=p_auth_user_id
   for update;
  if not found then raise exception 'PHASE8E_DELINQUENCY_NOT_FOUND'; end if;
  if d.state='superseded' then return query select false,d.state,d.retention_until; return; end if;
  if d.state='recovered' then return query select false,d.state,d.retention_until; return; end if;
  if d.purge_completed_at is not null then return query select false,'purged'::text,d.retention_until; return; end if;
  if d.state<>'retention_countdown' or d.purge_claim_token is distinct from p_claim_token then raise exception 'PHASE8E_PURGE_CLAIM_INVALID'; end if;
  if public.phase8e_supersede_delinquency(d.id,d.auth_user_id) then
    return query select false,'superseded'::text,d.retention_until;
    return;
  end if;
  if public.phase8e_delinquent_account_has_active_hold(d.id,d.subscription_id,d.auth_user_id) then
    return query select false,'held'::text,d.retention_until;
    return;
  end if;
  return query select true,d.state,d.retention_until;
end;
$$;
revoke all on function public.phase8e_validate_delinquent_account_purge(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase8e_validate_delinquent_account_purge(uuid,uuid,uuid) to service_role;

create or replace function public.phase8e_finalize_delinquent_account_purge(
  p_delinquency_id uuid,
  p_auth_user_id uuid,
  p_claim_token uuid
) returns table(delinquency_id uuid,delinquency_state text,finalized boolean,blocked_count integer)
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  d public.subscription_payment_delinquencies%rowtype;
  v_blocked integer:=0;
  v_audit_id uuid;
  v_correlation uuid:=gen_random_uuid();
begin
  if p_delinquency_id is null or p_auth_user_id is null or p_claim_token is null then raise exception 'PHASE8E_PURGE_CLAIM_INVALID'; end if;
  select * into d from public.subscription_payment_delinquencies
   where id=p_delinquency_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'PHASE8E_DELINQUENCY_NOT_FOUND'; end if;
  if d.state='superseded' then return query select d.id,d.state,false,0; return; end if;
  if d.state='recovered' then return query select d.id,d.state,false,0; return; end if;
  if d.purge_completed_at is not null then return query select d.id,'purged'::text,true,0; return; end if;
  if d.state<>'retention_countdown' or d.purge_claim_token is distinct from p_claim_token then raise exception 'PHASE8E_PURGE_CLAIM_INVALID'; end if;

  if public.phase8e_supersede_delinquency(d.id,d.auth_user_id) then
    return query select d.id,'superseded'::text,false,0; return;
  end if;
  if public.phase8e_delinquent_account_has_active_hold(d.id,d.subscription_id,d.auth_user_id) then
    return query select d.id,d.state,false,1; return;
  end if;

  delete from public.content_posts p
   where p.user_id=d.auth_user_id
     and p.created_at<=d.retention_until
     and not public.phase8e_delinquent_resource_has_active_hold('content_post',p.id::text,d.auth_user_id);

  delete from public.collections c
   where c.user_id=d.auth_user_id
     and c.created_at is not null
     and c.created_at<=d.retention_until
     and not public.phase8e_delinquent_resource_has_active_hold('collection',c.id::text,d.auth_user_id);

  update public.generations g
     set prompt=null,negative_prompt=null,lora_used=null,body_type=null,
         metadata=public.phase8_minimized_generation_metadata(coalesce(g.metadata,'{}'::jsonb)),
         runpod_job_id=null,error_message=null,updated_at=statement_timestamp()
   where g.user_id in (d.auth_user_id,d.profile_id)
     and g.created_at is not null
     and g.created_at<=(d.retention_until at time zone 'UTC')
     and not public.phase8e_delinquent_resource_has_active_hold('generation',g.id::text,d.auth_user_id);

  select
    (select count(*) from public.generation_assets a
      where a.owner_id=d.auth_user_id and a.lifecycle_state<>'purged')
    +(select count(*) from public.user_loras l
      where l.user_id in (d.auth_user_id,d.profile_id) and l.lifecycle_state<>'purged')
    +(select count(*) from public.content_posts p where p.user_id=d.auth_user_id)
    +(select count(*) from public.collections c where c.user_id=d.auth_user_id)
    +(select count(*) from public.generations g
      where g.user_id in (d.auth_user_id,d.profile_id)
        and (
          g.created_at is null
          or g.created_at>(d.retention_until at time zone 'UTC')
          or (
            g.created_at<=(d.retention_until at time zone 'UTC')
            and (public.phase8e_delinquent_resource_has_active_hold('generation',g.id::text,d.auth_user_id)
                 or g.r2_key is not null or g.image_url is not null)
          )
        ))
  into v_blocked;

  if v_blocked>0 then return query select d.id,d.state,false,v_blocked; return; end if;

  update public.subscription_payment_delinquencies
     set purge_claim_token=null,purge_completed_at=statement_timestamp(),updated_at=statement_timestamp()
   where id=d.id returning * into d;

  v_audit_id:=public.append_governance_audit_event(
    null,'system','retention.subscription_delinquency_purged','subscription_payment_delinquency',d.id::text,
    'retention_expired','delinquency retention window elapsed','purged','subscription_delinquency:v1',
    null,v_correlation,null,
    jsonb_build_object('subscription_id',d.subscription_id,'retention_until',d.retention_until,'second_missed_at',d.second_missed_at),
    '{}'::jsonb,null
  );
  return query select d.id,'purged'::text,true,0;
end;
$$;
revoke all on function public.phase8e_finalize_delinquent_account_purge(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase8e_finalize_delinquent_account_purge(uuid,uuid,uuid) to service_role;

commit;
