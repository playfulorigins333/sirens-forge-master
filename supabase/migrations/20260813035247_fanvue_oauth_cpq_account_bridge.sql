-- Gate 4B: canonical Fanvue OAuth account <-> CPQ destination ownership bridge.
-- This migration establishes ownership only. It does not backfill existing OAuth rows,
-- enable Fanvue in CPQ, schedule work, or execute provider operations.

alter table public.autopost_accounts
  add constraint autopost_accounts_id_user_platform_unique unique (id, user_id, platform);

create unique index autopost_accounts_fanvue_provider_account_uidx
  on public.autopost_accounts (provider_account_id)
  where platform = 'fanvue' and provider_account_id is not null;

alter table public.autopost_accounts
  add constraint autopost_accounts_connected_fanvue_identity_check
  check (platform <> 'fanvue' or connection_status <> 'CONNECTED' or provider_account_id is not null);

create or replace function public.autopost_accounts_preserve_fanvue_provider_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.platform = 'fanvue'
     and old.provider_account_id is not null
     and new.provider_account_id is distinct from old.provider_account_id then
    raise exception 'FANVUE_PROVIDER_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_autopost_accounts_preserve_fanvue_provider_identity on public.autopost_accounts;
create trigger trg_autopost_accounts_preserve_fanvue_provider_identity
before update of provider_account_id on public.autopost_accounts
for each row execute function public.autopost_accounts_preserve_fanvue_provider_identity();

-- Provider identity and credential state are server-authoritative. Safe connection
-- posture continues to be exposed through authenticated server routes.
drop policy if exists "autopost_accounts_select_own" on public.autopost_accounts;
drop policy if exists "autopost_accounts_insert_own" on public.autopost_accounts;
drop policy if exists "autopost_accounts_update_own" on public.autopost_accounts;
revoke select, insert, update, delete, truncate, references, trigger
  on table public.autopost_accounts from anon, authenticated;

alter table public.creator_platform_accounts
  add column oauth_account_id uuid;

create unique index creator_platform_accounts_oauth_account_uidx
  on public.creator_platform_accounts (oauth_account_id)
  where oauth_account_id is not null;

alter table public.creator_platform_accounts
  alter column platform_username drop not null;

alter table public.creator_platform_accounts
  drop constraint creator_platform_accounts_username_not_blank;

alter table public.creator_platform_accounts
  add constraint creator_platform_accounts_username_required_check check (
    (platform in ('onlyfans', 'fansly') and platform_username is not null and length(btrim(platform_username)) > 0)
    or (platform = 'fanvue' and (platform_username is null or length(btrim(platform_username)) > 0))
  ),
  add constraint creator_platform_accounts_oauth_platform_check check (
    (platform = 'fanvue' and oauth_account_id is not null)
    or (platform in ('onlyfans', 'fansly') and oauth_account_id is null)
  ),
  add constraint creator_platform_accounts_oauth_owner_fk
    foreign key (oauth_account_id, creator_id, platform)
    references public.autopost_accounts (id, user_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred;

create or replace function public.creator_publishing_link_fanvue_oauth_account(
  p_user_id uuid,
  p_provider_account_id text,
  p_provider_username text,
  p_display_name text,
  p_token_type text,
  p_scopes jsonb,
  p_encrypted_access_token text,
  p_encrypted_refresh_token text,
  p_token_key_version integer,
  p_token_expires_at timestamptz,
  p_metadata jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider_account_id text := nullif(btrim(coalesce(p_provider_account_id, '')), '');
  v_provider_username text := nullif(btrim(coalesce(p_provider_username, '')), '');
  v_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_now timestamptz := now();
  v_account public.autopost_accounts%rowtype;
  v_destination public.creator_platform_accounts%rowtype;
  v_other_owner boolean;
  v_audit_id bigint;
begin
  if p_user_id is null then raise exception 'FANVUE_BRIDGE_UNAUTHENTICATED'; end if;
  if v_provider_account_id is null then raise exception 'FANVUE_PROVIDER_IDENTITY_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_encrypted_access_token, '')), '') is null then raise exception 'FANVUE_ENCRYPTED_ACCESS_TOKEN_REQUIRED'; end if;
  if p_token_key_version is null or p_token_key_version < 1 then raise exception 'FANVUE_TOKEN_KEY_VERSION_INVALID'; end if;

  -- Every caller takes locks in the same order. These serialize first-connect and
  -- reconnect races before either candidate key is inspected or written.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fanvue-oauth-user:' || p_user_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fanvue-provider:' || v_provider_account_id, 0));

  select exists(
    select 1 from public.autopost_accounts
    where platform = 'fanvue'
      and provider_account_id = v_provider_account_id
      and user_id <> p_user_id
  ) into v_other_owner;
  if v_other_owner then raise exception 'FANVUE_PROVIDER_IDENTITY_ALREADY_LINKED'; end if;

  select * into v_account
  from public.autopost_accounts
  where user_id = p_user_id and platform = 'fanvue'
  for update;

  if found and v_account.provider_account_id is not null
     and v_account.provider_account_id is distinct from v_provider_account_id then
    raise exception 'FANVUE_PROVIDER_IDENTITY_CHANGE_REQUIRES_EXPLICIT_RELINK';
  end if;

  if found then
    update public.autopost_accounts set
      provider_account_id = v_provider_account_id,
      provider_username = v_provider_username,
      display_name = coalesce(v_display_name, v_provider_username),
      token_type = coalesce(nullif(btrim(coalesce(p_token_type, '')), ''), 'bearer'),
      scopes = coalesce(p_scopes, '[]'::jsonb),
      encrypted_access_token = p_encrypted_access_token,
      encrypted_refresh_token = p_encrypted_refresh_token,
      token_key_version = p_token_key_version,
      token_expires_at = p_token_expires_at,
      connection_status = 'CONNECTED',
      connected_at = v_now,
      last_refresh_at = null,
      last_error = null,
      metadata = coalesce(p_metadata, '{}'::jsonb)
    where id = v_account.id
    returning * into v_account;
  else
    begin
      insert into public.autopost_accounts (
        user_id, platform, provider_account_id, provider_username, display_name,
        token_type, scopes, encrypted_access_token, encrypted_refresh_token,
        token_key_version, token_expires_at, connection_status, connected_at,
        last_refresh_at, last_error, metadata
      ) values (
        p_user_id, 'fanvue', v_provider_account_id, v_provider_username,
        coalesce(v_display_name, v_provider_username),
        coalesce(nullif(btrim(coalesce(p_token_type, '')), ''), 'bearer'),
        coalesce(p_scopes, '[]'::jsonb), p_encrypted_access_token,
        p_encrypted_refresh_token, p_token_key_version, p_token_expires_at,
        'CONNECTED', v_now, null, null, coalesce(p_metadata, '{}'::jsonb)
      ) returning * into v_account;
    exception when unique_violation then
      if exists(select 1 from public.autopost_accounts where platform='fanvue' and provider_account_id=v_provider_account_id and user_id<>p_user_id) then
        raise exception 'FANVUE_PROVIDER_IDENTITY_ALREADY_LINKED';
      end if;
      raise;
    end;
  end if;

  select * into v_destination
  from public.creator_platform_accounts
  where oauth_account_id = v_account.id
  for update;

  if not found then
    insert into public.creator_platform_accounts (
      creator_id, platform, platform_username, profile_url, verification_status,
      verification_attested_at, is_virtual_entity, verification_reviewed_by,
      verification_reviewed_at, verification_evidence_reference,
      verification_reason, verification_legacy_revoked, oauth_account_id
    ) values (
      p_user_id, 'fanvue', v_provider_username, null, 'unattested', null, false,
      null, null, null, null, false, v_account.id
    ) returning * into v_destination;
  else
    if v_destination.creator_id <> p_user_id or v_destination.platform <> 'fanvue' then
      raise exception 'FANVUE_BRIDGE_OWNERSHIP_CONFLICT';
    end if;
    update public.creator_platform_accounts
      set platform_username = v_provider_username
      where id = v_destination.id
      returning * into v_destination;
  end if;

  insert into public.creator_publishing_audit_events (
    entity_type, entity_id, actor_id, actor_role, action, before_state, after_state, created_at
  ) values (
    'creator_platform_account', v_destination.id, p_user_id, 'creator',
    'fanvue_oauth_destination_linked', null,
    jsonb_build_object(
      'creator_id', p_user_id,
      'platform', 'fanvue',
      'oauth_account_id', v_account.id,
      'provider_identity_present', true,
      'connection_status', 'CONNECTED'
    ), v_now
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'oauth_account_id', v_account.id,
    'destination_id', v_destination.id,
    'audit_event_id', v_audit_id,
    'connection_status', 'CONNECTED'
  );
end;
$$;

revoke execute on function public.creator_publishing_link_fanvue_oauth_account(uuid,text,text,text,text,jsonb,text,text,integer,timestamptz,jsonb) from public;
revoke execute on function public.creator_publishing_link_fanvue_oauth_account(uuid,text,text,text,text,jsonb,text,text,integer,timestamptz,jsonb) from anon;
revoke execute on function public.creator_publishing_link_fanvue_oauth_account(uuid,text,text,text,text,jsonb,text,text,integer,timestamptz,jsonb) from authenticated;
grant execute on function public.creator_publishing_link_fanvue_oauth_account(uuid,text,text,text,text,jsonb,text,text,integer,timestamptz,jsonb) to service_role;
