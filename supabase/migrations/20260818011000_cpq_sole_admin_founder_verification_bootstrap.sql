-- One-time prelaunch founder verification bootstrap for a sole-admin Sirens Forge instance.
--
-- This does not weaken the normal trusted-review workflow. It is callable only by
-- service_role and only while exactly one auth user exists, zero trusted reviewers
-- exist, and that same sole auth user owns the currently connected Fanvue account.
-- It creates only the creator identity verification row plus an audit event.
-- It does not grant AI-twin consent, create a trusted reviewer, schedule content,
-- call providers, change OAuth state, or alter runtime flags.

create or replace function public.creator_publishing_bootstrap_sole_admin_founder_verification(
  p_creator_id uuid,
  p_reason text,
  p_evidence_reference text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_evidence text := btrim(coalesce(p_evidence_reference, ''));
  v_now timestamptz := clock_timestamp();
  v_auth_user_count bigint;
  v_reviewer_count bigint;
  v_connected_fanvue_count bigint;
  v_existing public.creator_publishing_creator_verifications%rowtype;
  v_saved public.creator_publishing_creator_verifications%rowtype;
  v_audit_id bigint;
begin
  if p_creator_id is null then
    raise exception 'SOLE_ADMIN_FOUNDER_BOOTSTRAP_INVALID_CREATOR';
  end if;

  if length(v_reason) < 8 or length(v_reason) > 500 then
    raise exception 'SOLE_ADMIN_FOUNDER_BOOTSTRAP_REASON_REQUIRED';
  end if;

  if length(v_evidence) < 8 or length(v_evidence) > 500 then
    raise exception 'SOLE_ADMIN_FOUNDER_BOOTSTRAP_EVIDENCE_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-publishing-sole-admin-founder-verification', 0)
  );

  select count(*) into v_auth_user_count from auth.users;
  if v_auth_user_count <> 1 then
    raise exception 'SOLE_ADMIN_FOUNDER_BOOTSTRAP_REQUIRES_SINGLE_AUTH_USER';
  end if;

  if not exists (select 1 from auth.users where id = p_creator_id) then
    raise exception 'SOLE_ADMIN_FOUNDER_BOOTSTRAP_CREATOR_NOT_FOUND';
  end if;

  select count(*) into v_reviewer_count
  from public.creator_publishing_trusted_reviewers;
  if v_reviewer_count <> 0 then
    raise exception 'SOLE_ADMIN_FOUNDER_BOOTSTRAP_REVIEWERS_ALREADY_INITIALIZED';
  end if;

  select count(*) into v_connected_fanvue_count
  from public.autopost_accounts
  where platform = 'fanvue'
    and connection_status = 'CONNECTED'
    and user_id = p_creator_id
    and nullif(btrim(coalesce(provider_account_id, '')), '') is not null;

  if v_connected_fanvue_count <> 1 then
    raise exception 'SOLE_ADMIN_FOUNDER_BOOTSTRAP_CONNECTED_FANVUE_REQUIRED';
  end if;

  if exists (
    select 1
    from public.autopost_accounts
    where platform = 'fanvue'
      and connection_status = 'CONNECTED'
      and user_id <> p_creator_id
  ) then
    raise exception 'SOLE_ADMIN_FOUNDER_BOOTSTRAP_FOREIGN_FANVUE_ACCOUNT';
  end if;

  select * into v_existing
  from public.creator_publishing_creator_verifications
  where creator_id = p_creator_id
  for update;

  if found and v_existing.status = 'verified' then
    return jsonb_build_object(
      'creator_id', v_existing.creator_id,
      'status', v_existing.status,
      'reviewed_by', v_existing.reviewed_by,
      'reviewed_at', v_existing.reviewed_at,
      'idempotent', true
    );
  end if;

  insert into public.creator_publishing_creator_verifications(
    creator_id,
    status,
    evidence_reference,
    reason,
    reviewed_by,
    reviewed_at,
    created_at,
    updated_at
  ) values (
    p_creator_id,
    'verified',
    v_evidence,
    v_reason,
    p_creator_id,
    v_now,
    v_now,
    v_now
  )
  on conflict (creator_id) do update
  set status = 'verified',
      evidence_reference = excluded.evidence_reference,
      reason = excluded.reason,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at,
      updated_at = excluded.updated_at
  returning * into v_saved;

  insert into public.creator_publishing_audit_events(
    entity_type,
    entity_id,
    actor_id,
    actor_role,
    action,
    before_state,
    after_state,
    created_at
  ) values (
    'creator_publishing_creator_verification',
    p_creator_id,
    p_creator_id,
    'sole_admin_founder_bootstrap',
    'creator_identity_verified_by_sole_admin_founder_bootstrap',
    case when v_existing.creator_id is null then null else to_jsonb(v_existing) end,
    jsonb_build_object(
      'creator_id', p_creator_id,
      'status', 'verified',
      'reviewed_by', p_creator_id,
      'reviewed_at', v_now,
      'reason', v_reason,
      'evidence_reference', v_evidence,
      'sole_admin_prelaunch_exception', true,
      'trusted_reviewer_created', false,
      'ai_twin_consent_granted', false
    ),
    v_now
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'creator_id', v_saved.creator_id,
    'status', v_saved.status,
    'reviewed_by', v_saved.reviewed_by,
    'reviewed_at', v_saved.reviewed_at,
    'audit_event_id', v_audit_id::text,
    'idempotent', false
  );
end;
$$;

revoke all on function public.creator_publishing_bootstrap_sole_admin_founder_verification(uuid, text, text) from PUBLIC;
revoke all on function public.creator_publishing_bootstrap_sole_admin_founder_verification(uuid, text, text) from anon;
revoke all on function public.creator_publishing_bootstrap_sole_admin_founder_verification(uuid, text, text) from authenticated;
grant execute on function public.creator_publishing_bootstrap_sole_admin_founder_verification(uuid, text, text) to service_role;

comment on function public.creator_publishing_bootstrap_sole_admin_founder_verification(uuid, text, text) is
  'One-time prelaunch sole-admin founder identity verification exception. Service-role only; requires exactly one auth user, zero trusted reviewers, and one connected Fanvue account owned by that creator. Does not grant AI-twin consent or create a trusted reviewer.';
