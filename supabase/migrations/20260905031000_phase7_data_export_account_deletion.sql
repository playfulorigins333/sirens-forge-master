begin;

-- Phase 7: creator data export + voluntary account deletion application lifecycle.
-- Phase 8 remains authoritative for central retention scheduling, legal holds,
-- ordered irreversible purge, tamper-resistant audit, and final action receipts.
-- Phase 9 remains authoritative for delivery of notification events.

create table if not exists public.creator_data_exports (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'requested',
  export_version text not null default 'creator-export-v1',
  requested_at timestamptz not null default clock_timestamp(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  downloaded_at timestamptz,
  expires_at timestamptz,
  purge_after timestamptz,
  storage_bucket text,
  storage_object_key text,
  size_bytes bigint,
  sha256 text,
  claim_token uuid,
  retry_count integer not null default 0,
  error_code text,
  ready_notification_due_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint creator_data_exports_status_check check (status in ('requested','processing','completed','failed','downloaded','expired')),
  constraint creator_data_exports_retry_count_check check (retry_count >= 0 and retry_count <= 20),
  constraint creator_data_exports_size_check check (size_bytes is null or size_bytes > 0),
  constraint creator_data_exports_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint creator_data_exports_object_pair_check check ((storage_bucket is null) = (storage_object_key is null)),
  constraint creator_data_exports_completion_check check (
    (status in ('requested','processing','failed') and completed_at is null and storage_bucket is null and storage_object_key is null and size_bytes is null and sha256 is null and expires_at is null and purge_after is null)
    or
    (status in ('completed','downloaded','expired') and completed_at is not null and storage_bucket is not null and storage_object_key is not null and size_bytes is not null and sha256 is not null and expires_at is not null and purge_after is not null)
  ),
  constraint creator_data_exports_claim_check check (
    (status = 'processing' and claim_token is not null and processing_started_at is not null)
    or status <> 'processing'
  )
);

create index if not exists creator_data_exports_owner_requested_idx
  on public.creator_data_exports(auth_user_id, requested_at desc);
create index if not exists creator_data_exports_due_idx
  on public.creator_data_exports(purge_after)
  where status in ('completed','downloaded','expired');

alter table public.creator_data_exports enable row level security;
alter table public.creator_data_exports force row level security;
revoke all on table public.creator_data_exports from public, anon, authenticated;
grant select, insert, update, delete on table public.creator_data_exports to service_role;

create table if not exists public.account_deletion_protected_subjects (
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint account_deletion_protected_reason_check check (length(reason) between 1 and 160 and reason !~ '[\x00-\x1f\x7f]')
);

alter table public.account_deletion_protected_subjects enable row level security;
alter table public.account_deletion_protected_subjects force row level security;
revoke all on table public.account_deletion_protected_subjects from public, anon, authenticated;
grant select, insert, update, delete on table public.account_deletion_protected_subjects to service_role;

-- Preserve the pre-launch sole Production account as an absolute deletion guard.
-- If an environment has more than one auth user, no account is guessed or auto-protected.
do $$
declare v_user_id uuid;
begin
  if (select count(*) from auth.users) = 1 then
    select id into v_user_id from auth.users limit 1;
    insert into public.account_deletion_protected_subjects(auth_user_id, reason)
    values (v_user_id, 'sole_production_admin_guard')
    on conflict (auth_user_id) do nothing;
  end if;
end $$;

alter table public.profiles
  add column if not exists account_lifecycle_state text not null default 'active',
  add column if not exists account_lifecycle_updated_at timestamptz not null default clock_timestamp();

alter table public.profiles
  drop constraint if exists profiles_account_lifecycle_state_check,
  add constraint profiles_account_lifecycle_state_check
    check (account_lifecycle_state in ('active','voluntary_deletion_pending','purge_pending','purged'));

create index if not exists profiles_account_lifecycle_idx
  on public.profiles(user_id, account_lifecycle_state);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending',
  export_choice text not null,
  export_job_id uuid references public.creator_data_exports(id) on delete set null,
  confirmation_version text not null,
  policy_version text not null default 'voluntary-account-deletion-v1',
  request_action_id uuid not null unique,
  requested_at timestamptz not null default clock_timestamp(),
  recovery_deadline timestamptz not null,
  reactivated_at timestamptz,
  reactivation_action_id uuid unique,
  purge_claimed_at timestamptz,
  purge_claim_token uuid,
  purge_completed_at timestamptz,
  completion_action_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint account_deletion_status_check check (status in ('pending','reactivated','purge_pending','completed')),
  constraint account_deletion_export_choice_check check (export_choice in ('export_before_deletion','skip_export')),
  constraint account_deletion_export_reference_check check (
    (export_choice='export_before_deletion' and export_job_id is not null)
    or (export_choice='skip_export' and export_job_id is null)
  ),
  constraint account_deletion_recovery_window_check check (recovery_deadline > requested_at),
  constraint account_deletion_reactivation_check check (
    (status='reactivated' and reactivated_at is not null and reactivation_action_id is not null)
    or status <> 'reactivated'
  ),
  constraint account_deletion_purge_claim_check check (
    (status='purge_pending' and purge_claimed_at is not null and purge_claim_token is not null)
    or status <> 'purge_pending'
  ),
  constraint account_deletion_completion_check check (
    (status='completed' and purge_completed_at is not null and completion_action_id is not null)
    or status <> 'completed'
  )
);

create unique index if not exists account_deletion_one_pending_per_user_idx
  on public.account_deletion_requests(auth_user_id)
  where status in ('pending','purge_pending');
create index if not exists account_deletion_recovery_due_idx
  on public.account_deletion_requests(recovery_deadline)
  where status='pending';

alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;
revoke all on table public.account_deletion_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.account_deletion_requests to service_role;

create or replace function public.request_creator_data_export(
  p_auth_user_id uuid,
  p_profile_id uuid
)
returns table(export_id uuid, export_status text, requested_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_profile public.profiles;
  v_export public.creator_data_exports;
begin
  select * into v_profile
  from public.profiles
  where id=p_profile_id and user_id=p_auth_user_id
  for share;
  if not found then raise exception 'EXPORT_OWNER_NOT_FOUND'; end if;
  if v_profile.account_lifecycle_state in ('purge_pending','purged') then raise exception 'EXPORT_ACCOUNT_UNAVAILABLE'; end if;

  select * into v_export
  from public.creator_data_exports
  where auth_user_id=p_auth_user_id and status in ('requested','processing')
  order by requested_at desc
  limit 1;

  if found then
    return query select v_export.id, v_export.status, v_export.requested_at;
    return;
  end if;

  insert into public.creator_data_exports(auth_user_id,profile_id,status,export_version)
  values (p_auth_user_id,p_profile_id,'requested','creator-export-v1')
  returning * into v_export;

  return query select v_export.id, v_export.status, v_export.requested_at;
end $$;

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
    if v_export.claim_token<>p_claim_token then raise exception 'EXPORT_ALREADY_CLAIMED'; end if;
    return query select v_export.id,v_export.status,v_export.claim_token;
    return;
  end if;
  if v_export.status not in ('requested','failed') then raise exception 'EXPORT_STATE_CONFLICT'; end if;

  update public.creator_data_exports
  set status='processing',processing_started_at=clock_timestamp(),failed_at=null,error_code=null,
      claim_token=p_claim_token,retry_count=retry_count+case when status='failed' then 1 else 0 end,
      updated_at=clock_timestamp()
  where id=v_export.id
  returning * into v_export;

  return query select v_export.id,v_export.status,v_export.claim_token;
end $$;

create or replace function public.complete_creator_data_export(
  p_export_id uuid,
  p_auth_user_id uuid,
  p_claim_token uuid,
  p_storage_bucket text,
  p_storage_object_key text,
  p_size_bytes bigint,
  p_sha256 text,
  p_expires_at timestamptz
)
returns table(export_id uuid, export_status text, completed_at timestamptz, expires_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_export public.creator_data_exports;
begin
  if p_storage_bucket is null or btrim(p_storage_bucket)='' or length(p_storage_bucket)>255 then raise exception 'EXPORT_STORAGE_INVALID'; end if;
  if p_storage_object_key is null or btrim(p_storage_object_key)='' or length(p_storage_object_key)>1024 or p_storage_object_key like '/%' or p_storage_object_key like '%..%' then raise exception 'EXPORT_STORAGE_INVALID'; end if;
  if p_size_bytes is null or p_size_bytes<=0 then raise exception 'EXPORT_STORAGE_INVALID'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'EXPORT_STORAGE_INVALID'; end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() then raise exception 'EXPORT_EXPIRY_INVALID'; end if;

  select * into v_export from public.creator_data_exports
  where id=p_export_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
  if v_export.status in ('completed','downloaded') then
    return query select v_export.id,v_export.status,v_export.completed_at,v_export.expires_at;
    return;
  end if;
  if v_export.status<>'processing' or v_export.claim_token<>p_claim_token then raise exception 'EXPORT_CLAIM_INVALID'; end if;

  update public.creator_data_exports
  set status='completed',completed_at=clock_timestamp(),claim_token=null,
      storage_bucket=p_storage_bucket,storage_object_key=p_storage_object_key,size_bytes=p_size_bytes,sha256=p_sha256,
      expires_at=p_expires_at,purge_after=p_expires_at,ready_notification_due_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=v_export.id
  returning * into v_export;

  return query select v_export.id,v_export.status,v_export.completed_at,v_export.expires_at;
end $$;

create or replace function public.fail_creator_data_export(
  p_export_id uuid,
  p_auth_user_id uuid,
  p_claim_token uuid,
  p_error_code text
)
returns table(export_id uuid, export_status text)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_export public.creator_data_exports;
begin
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{3,80}$' then raise exception 'EXPORT_ERROR_CODE_INVALID'; end if;
  select * into v_export from public.creator_data_exports
  where id=p_export_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
  if v_export.status='failed' then return query select v_export.id,v_export.status; return; end if;
  if v_export.status<>'processing' or v_export.claim_token<>p_claim_token then raise exception 'EXPORT_CLAIM_INVALID'; end if;
  update public.creator_data_exports
  set status='failed',failed_at=clock_timestamp(),claim_token=null,error_code=p_error_code,updated_at=clock_timestamp()
  where id=v_export.id returning * into v_export;
  return query select v_export.id,v_export.status;
end $$;

create or replace function public.mark_creator_data_export_downloaded(
  p_export_id uuid,
  p_auth_user_id uuid
)
returns table(export_id uuid, export_status text, downloaded_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_export public.creator_data_exports;
begin
  select * into v_export from public.creator_data_exports
  where id=p_export_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
  if v_export.expires_at is null or v_export.expires_at<=clock_timestamp() then
    update public.creator_data_exports set status='expired',updated_at=clock_timestamp() where id=v_export.id returning * into v_export;
    raise exception 'EXPORT_EXPIRED';
  end if;
  if v_export.status not in ('completed','downloaded') then raise exception 'EXPORT_NOT_READY'; end if;
  if v_export.status='completed' then
    update public.creator_data_exports set status='downloaded',downloaded_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_export.id returning * into v_export;
  end if;
  return query select v_export.id,v_export.status,v_export.downloaded_at;
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

  -- Do not mutate frozen Payment V2/Stripe from this phase. A renewable paid plan
  -- must already be set to cancel before deletion can begin.
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
    auth_user_id,profile_id,status,export_choice,export_job_id,confirmation_version,request_action_id,recovery_deadline
  ) values (
    p_auth_user_id,p_profile_id,'pending',p_export_choice,p_export_job_id,p_confirmation_version,p_request_action_id,clock_timestamp()+interval '60 days'
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
  set status='reactivated',reactivated_at=clock_timestamp(),reactivation_action_id=p_reactivation_action_id,updated_at=clock_timestamp()
  where id=v_request.id returning * into v_request;
  update public.profiles
  set account_lifecycle_state='active',account_lifecycle_updated_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_profile_id returning * into v_profile;

  return query select v_request.id,v_request.status,v_profile.account_lifecycle_state;
end $$;

revoke all on function public.request_creator_data_export(uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_creator_data_export(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.complete_creator_data_export(uuid,uuid,uuid,text,text,bigint,text,timestamptz) from public,anon,authenticated;
revoke all on function public.fail_creator_data_export(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.mark_creator_data_export_downloaded(uuid,uuid) from public,anon,authenticated;
revoke all on function public.request_voluntary_account_deletion(uuid,uuid,text,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.reactivate_voluntary_account_deletion(uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.request_creator_data_export(uuid,uuid) to service_role;
grant execute on function public.claim_creator_data_export(uuid,uuid,uuid) to service_role;
grant execute on function public.complete_creator_data_export(uuid,uuid,uuid,text,text,bigint,text,timestamptz) to service_role;
grant execute on function public.fail_creator_data_export(uuid,uuid,uuid,text) to service_role;
grant execute on function public.mark_creator_data_export_downloaded(uuid,uuid) to service_role;
grant execute on function public.request_voluntary_account_deletion(uuid,uuid,text,uuid,text,uuid) to service_role;
grant execute on function public.reactivate_voluntary_account_deletion(uuid,uuid,uuid) to service_role;

commit;
