begin;

alter table public.account_deletion_requests
  add column if not exists requested_notification_due_at timestamptz,
  add column if not exists reactivated_notification_due_at timestamptz,
  add column if not exists completed_notification_due_at timestamptz;

create or replace function public.claim_creator_data_export(
  p_export_id uuid,
  p_auth_user_id uuid,
  p_claim_token uuid
)
returns table(export_id uuid, export_status text, claim_token uuid)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_export public.creator_data_exports;
begin
  if p_claim_token is null then raise exception 'EXPORT_CLAIM_INVALID'; end if;
  select * into v_export from public.creator_data_exports
  where id=p_export_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'EXPORT_NOT_FOUND'; end if;

  if v_export.status='processing' then
    if v_export.claim_token=p_claim_token then
      return query select v_export.id,v_export.status,v_export.claim_token;
      return;
    end if;
    if v_export.processing_started_at is null or v_export.processing_started_at>clock_timestamp()-interval '15 minutes' then
      raise exception 'EXPORT_ALREADY_CLAIMED';
    end if;
    update public.creator_data_exports
    set claim_token=p_claim_token,processing_started_at=clock_timestamp(),retry_count=retry_count+1,updated_at=clock_timestamp()
    where id=v_export.id
    returning * into v_export;
    return query select v_export.id,v_export.status,v_export.claim_token;
    return;
  end if;

  if v_export.status not in ('requested','failed') then raise exception 'EXPORT_STATE_CONFLICT'; end if;
  if v_export.retry_count>=20 then raise exception 'EXPORT_RETRY_LIMIT'; end if;

  update public.creator_data_exports
  set status='processing',processing_started_at=clock_timestamp(),failed_at=null,error_code=null,
      claim_token=p_claim_token,retry_count=retry_count+case when status='failed' then 1 else 0 end,
      updated_at=clock_timestamp()
  where id=v_export.id
  returning * into v_export;

  return query select v_export.id,v_export.status,v_export.claim_token;
end $$;

create or replace function public.request_voluntary_account_deletion(
  p_auth_user_id uuid,
  p_profile_id uuid,
  p_export_choice text,
  p_export_job_id uuid,
  p_confirmation_version text,
  p_request_action_id uuid
)
returns table(request_id uuid, request_status text, recovery_deadline timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_profile public.profiles;
  v_export public.creator_data_exports;
  v_request public.account_deletion_requests;
begin
  if p_request_action_id is null then raise exception 'ACCOUNT_DELETION_ACTION_INVALID'; end if;
  if p_confirmation_version <> 'delete-my-account-v1' then raise exception 'ACCOUNT_DELETION_CONFIRMATION_INVALID'; end if;
  if p_export_choice not in ('export_before_deletion','skip_export') then raise exception 'ACCOUNT_DELETION_EXPORT_CHOICE_INVALID'; end if;

  select * into v_profile from public.profiles
  where id=p_profile_id and user_id=p_auth_user_id for update;
  if not found then raise exception 'ACCOUNT_DELETION_OWNER_NOT_FOUND'; end if;

  if exists(select 1 from public.account_deletion_protected_subjects where auth_user_id=p_auth_user_id) then
    raise exception 'ACCOUNT_DELETION_PROTECTED_ACCOUNT';
  end if;

  if v_profile.account_lifecycle_state='voluntary_deletion_pending' then
    select * into v_request from public.account_deletion_requests
    where auth_user_id=p_auth_user_id and status='pending'
    order by requested_at desc limit 1;
    if found then return query select v_request.id,v_request.status,v_request.recovery_deadline; return; end if;
    raise exception 'ACCOUNT_DELETION_STATE_CONFLICT';
  end if;
  if v_profile.account_lifecycle_state<>'active' then raise exception 'ACCOUNT_DELETION_STATE_CONFLICT'; end if;

  if exists(
    select 1 from public.user_subscriptions s
    where s.user_id=p_profile_id
      and lower(btrim(s.status)) in ('active','trialing')
      and coalesce(s.cancel_at_period_end,false)=false
  ) then raise exception 'ACCOUNT_DELETION_BILLING_ACTIVE'; end if;

  if p_export_choice='export_before_deletion' then
    if p_export_job_id is null then raise exception 'ACCOUNT_DELETION_EXPORT_REQUIRED'; end if;
    select * into v_export from public.creator_data_exports
    where id=p_export_job_id and auth_user_id=p_auth_user_id;
    if not found or v_export.status not in ('completed','downloaded') or v_export.expires_at is null or v_export.expires_at<=clock_timestamp() then
      raise exception 'ACCOUNT_DELETION_EXPORT_NOT_READY';
    end if;
  elsif p_export_job_id is not null then
    raise exception 'ACCOUNT_DELETION_EXPORT_CHOICE_INVALID';
  end if;

  insert into public.account_deletion_requests(
    auth_user_id,profile_id,status,export_choice,export_job_id,confirmation_version,request_action_id,recovery_deadline,requested_notification_due_at
  ) values (
    p_auth_user_id,p_profile_id,'pending',p_export_choice,p_export_job_id,p_confirmation_version,p_request_action_id,clock_timestamp()+interval '60 days',clock_timestamp()
  ) returning * into v_request;

  update public.profiles
  set account_lifecycle_state='voluntary_deletion_pending',account_lifecycle_updated_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_profile_id;

  return query select v_request.id,v_request.status,v_request.recovery_deadline;
end $$;

create or replace function public.reactivate_voluntary_account_deletion(
  p_auth_user_id uuid,
  p_profile_id uuid,
  p_reactivation_action_id uuid
)
returns table(request_id uuid, request_status text, account_lifecycle_state text)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_profile public.profiles; v_request public.account_deletion_requests;
begin
  if p_reactivation_action_id is null then raise exception 'ACCOUNT_REACTIVATION_ACTION_INVALID'; end if;
  select * into v_profile from public.profiles where id=p_profile_id and user_id=p_auth_user_id for update;
  if not found then raise exception 'ACCOUNT_DELETION_OWNER_NOT_FOUND'; end if;
  if v_profile.account_lifecycle_state<>'voluntary_deletion_pending' then raise exception 'ACCOUNT_REACTIVATION_STATE_CONFLICT'; end if;

  select * into v_request from public.account_deletion_requests
  where auth_user_id=p_auth_user_id and profile_id=p_profile_id and status='pending'
  order by requested_at desc limit 1 for update;
  if not found then raise exception 'ACCOUNT_REACTIVATION_STATE_CONFLICT'; end if;
  if v_request.recovery_deadline<=clock_timestamp() then raise exception 'ACCOUNT_REACTIVATION_WINDOW_EXPIRED'; end if;

  update public.account_deletion_requests
  set status='reactivated',reactivated_at=clock_timestamp(),reactivation_action_id=p_reactivation_action_id,
      reactivated_notification_due_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=v_request.id returning * into v_request;
  update public.profiles
  set account_lifecycle_state='active',account_lifecycle_updated_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_profile_id returning * into v_profile;

  return query select v_request.id,v_request.status,v_profile.account_lifecycle_state;
end $$;

revoke all on function public.claim_creator_data_export(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.request_voluntary_account_deletion(uuid,uuid,text,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.reactivate_voluntary_account_deletion(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_creator_data_export(uuid,uuid,uuid) to service_role;
grant execute on function public.request_voluntary_account_deletion(uuid,uuid,text,uuid,text,uuid) to service_role;
grant execute on function public.reactivate_voluntary_account_deletion(uuid,uuid,uuid) to service_role;

commit;
