-- Task 9: creator platform account setup through trusted server workflow only.

create extension if not exists pgcrypto with schema extensions;

-- Preserve creator_platform_accounts_select_own from the foundation migration and remove browser writes.
drop policy if exists "creator_platform_accounts_insert_own" on public.creator_platform_accounts;
drop policy if exists "creator_platform_accounts_update_own" on public.creator_platform_accounts;

drop index if exists public.creator_publishing_platform_account_audit_idempotency_uidx;
create unique index if not exists creator_publishing_platform_account_audit_creator_key_uidx
  on public.creator_publishing_audit_events(actor_id, idempotency_key)
  where entity_type = 'creator_platform_account' and actor_id is not null and idempotency_key is not null;

create or replace function public.creator_publishing_save_platform_account(
  p_creator_id uuid,
  p_account_id uuid,
  p_platform text,
  p_platform_username text,
  p_profile_url text,
  p_is_virtual_entity boolean,
  p_creator_attested boolean,
  p_idempotency_key text
)
returns public.creator_platform_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation text := case when p_account_id is null then 'create' else 'update' end;
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_username text := btrim(coalesce(p_platform_username, ''));
  v_profile_url text := nullif(btrim(coalesce(p_profile_url, '')), '');
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_now timestamptz := now();
  v_status text := case when coalesce(p_creator_attested, false) then 'creator_attested' else 'unattested' end;
  v_attested_at timestamptz := case when coalesce(p_creator_attested, false) then v_now else null end;
  v_existing public.creator_platform_accounts%rowtype;
  v_duplicate public.creator_platform_accounts%rowtype;
  v_result public.creator_platform_accounts%rowtype;
  v_existing_audit public.creator_publishing_audit_events%rowtype;
  v_action text;
  v_before jsonb;
  v_after jsonb;
  v_fingerprint text;
begin
  if p_creator_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_platform = 'fanvue' then raise exception 'FANVUE_NOT_AVAILABLE'; end if;
  if v_platform not in ('onlyfans','fansly') then raise exception 'UNSUPPORTED_PLATFORM'; end if;
  if length(v_username) = 0 or length(v_username) > 80 then raise exception 'INVALID_USERNAME'; end if;
  if v_profile_url is not null and length(v_profile_url) > 300 then raise exception 'INVALID_PROFILE_URL'; end if;
  if v_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;

  -- Same creator/key requests are serialized before any account mutation or audit insert.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_creator_id::text || ':' || v_idempotency_key, 0));

  -- same canonical request with the same idempotency key returns idempotent success; different payload raises IDEMPOTENCY_CONFLICT.
  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'operation', v_operation,
    'account_id', p_account_id,
    'creator_id', p_creator_id,
    'platform', v_platform,
    'platform_username', v_username,
    'profile_url', v_profile_url,
    'is_virtual_entity', coalesce(p_is_virtual_entity, false),
    'desired_verification_status', v_status
  )::text, 'sha256'), 'hex');

  select * into v_existing_audit from public.creator_publishing_audit_events
    where entity_type = 'creator_platform_account'
      and actor_id = p_creator_id
      and idempotency_key = v_idempotency_key
    limit 1;

  if found then
    if v_existing_audit.after_state->>'request_fingerprint' is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    select * into v_result from public.creator_platform_accounts where id = v_existing_audit.entity_id for update;
    if not found or v_result.creator_id <> p_creator_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if v_result.id is distinct from coalesce(p_account_id, v_result.id)
       or v_result.platform <> v_platform
       or v_result.platform_username <> v_username
       or v_result.profile_url is distinct from v_profile_url
       or v_result.is_virtual_entity is distinct from coalesce(p_is_virtual_entity, false)
       or v_result.verification_status <> v_status then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_result;
  end if;

  if p_account_id is null then
    select * into v_duplicate from public.creator_platform_accounts
      where creator_id = p_creator_id and platform = v_platform and lower(platform_username) = lower(v_username)
      limit 1;
    if found then raise exception 'ACCOUNT_CONFLICT'; end if;
    begin
      insert into public.creator_platform_accounts(creator_id, platform, platform_username, profile_url, verification_status, verification_attested_at, is_virtual_entity, created_at, updated_at)
      values (p_creator_id, v_platform, v_username, v_profile_url, v_status, v_attested_at, coalesce(p_is_virtual_entity, false), v_now, v_now)
      returning * into v_result;
    exception when unique_violation then
      select * into v_duplicate from public.creator_platform_accounts
        where creator_id = p_creator_id and platform = v_platform and lower(platform_username) = lower(v_username)
        limit 1;
      raise exception 'ACCOUNT_CONFLICT';
    end;
    v_action := 'creator_platform_account_created';
    v_before := null;
  else
    select * into v_existing from public.creator_platform_accounts where id = p_account_id for update;
    if not found or v_existing.creator_id <> p_creator_id then raise exception 'ACCOUNT_NOT_FOUND'; end if;
    if v_existing.platform <> v_platform then raise exception 'ACCOUNT_CONFLICT'; end if;
    if v_existing.verification_status = 'revoked' then raise exception 'ACCOUNT_REVOKED'; end if;
    select * into v_duplicate from public.creator_platform_accounts
      where creator_id = p_creator_id and platform = v_platform and lower(platform_username) = lower(v_username) and id <> p_account_id
      limit 1;
    if found then raise exception 'ACCOUNT_CONFLICT'; end if;
    v_before := jsonb_build_object('account_id', v_existing.id, 'platform', v_existing.platform, 'platform_username', v_existing.platform_username, 'profile_url_present', v_existing.profile_url is not null, 'is_virtual_entity', v_existing.is_virtual_entity, 'verification_status', v_existing.verification_status, 'verification_attested_at', v_existing.verification_attested_at, 'creator_id', v_existing.creator_id);
    update public.creator_platform_accounts
      set platform_username = v_username, profile_url = v_profile_url, is_virtual_entity = coalesce(p_is_virtual_entity, false), verification_status = v_status, verification_attested_at = v_attested_at, updated_at = v_now
      where id = p_account_id and creator_id = p_creator_id
      returning * into v_result;
    v_action := case when v_existing.verification_status is distinct from v_status then 'creator_platform_account_attestation_changed' else 'creator_platform_account_updated' end;
  end if;

  v_after := jsonb_build_object('account_id', v_result.id, 'platform', v_result.platform, 'platform_username', v_result.platform_username, 'profile_url_present', v_result.profile_url is not null, 'is_virtual_entity', v_result.is_virtual_entity, 'prior_verification_status', coalesce(v_existing.verification_status, null), 'resulting_verification_status', v_result.verification_status, 'verification_attested_at', v_result.verification_attested_at, 'creator_id', v_result.creator_id, 'idempotency_key', v_idempotency_key, 'request_fingerprint', v_fingerprint);
  insert into public.creator_publishing_audit_events(entity_type, entity_id, actor_id, actor_role, action, before_state, after_state, idempotency_key, created_at)
  values ('creator_platform_account', v_result.id, p_creator_id, 'creator', v_action, v_before, v_after, v_idempotency_key, v_now);
  return v_result;
end;
$$;

revoke execute on function public.creator_publishing_save_platform_account(uuid, uuid, text, text, text, boolean, boolean, text) from public;
revoke execute on function public.creator_publishing_save_platform_account(uuid, uuid, text, text, text, boolean, boolean, text) from anon;
revoke execute on function public.creator_publishing_save_platform_account(uuid, uuid, text, text, text, boolean, boolean, text) from authenticated;
grant execute on function public.creator_publishing_save_platform_account(uuid, uuid, text, text, text, boolean, boolean, text) to service_role;
