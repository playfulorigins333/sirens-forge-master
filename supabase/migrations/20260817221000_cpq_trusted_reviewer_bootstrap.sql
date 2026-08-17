-- One-time trusted reviewer bootstrap for Creator Publishing Queue governance.
-- This migration creates a service-role-only bootstrap RPC. It does not seed reviewers,
-- verify creators, grant consent, schedule content, call providers, or alter Fanvue runtime flags.

create or replace function public.creator_publishing_bootstrap_first_trusted_reviewer(
  p_actor_id uuid,
  p_reviewer_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz := clock_timestamp();
  v_audit_id bigint;
  v_existing_count bigint;
begin
  if p_actor_id is null or p_reviewer_id is null then
    raise exception 'TRUSTED_REVIEWER_BOOTSTRAP_INVALID_USER';
  end if;

  if p_actor_id = p_reviewer_id then
    raise exception 'TRUSTED_REVIEWER_BOOTSTRAP_SELF_REVIEWER_FORBIDDEN';
  end if;

  if length(v_reason) < 8 or length(v_reason) > 500 then
    raise exception 'TRUSTED_REVIEWER_BOOTSTRAP_REASON_REQUIRED';
  end if;

  if not exists (select 1 from auth.users where id = p_actor_id) then
    raise exception 'TRUSTED_REVIEWER_BOOTSTRAP_ACTOR_NOT_FOUND';
  end if;

  if not exists (select 1 from auth.users where id = p_reviewer_id) then
    raise exception 'TRUSTED_REVIEWER_BOOTSTRAP_REVIEWER_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creator-publishing-first-trusted-reviewer', 0));

  select count(*) into v_existing_count
  from public.creator_publishing_trusted_reviewers;

  if v_existing_count <> 0 then
    raise exception 'TRUSTED_REVIEWER_BOOTSTRAP_ALREADY_INITIALIZED';
  end if;

  insert into public.creator_publishing_trusted_reviewers(
    reviewer_id,
    role,
    active,
    created_at,
    revoked_at
  ) values (
    p_reviewer_id,
    'reviewer',
    true,
    v_now,
    null
  );

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
    'creator_publishing_trusted_reviewer',
    p_reviewer_id,
    p_actor_id,
    'bootstrap_admin',
    'trusted_reviewer_bootstrapped',
    jsonb_build_object('reviewer_count', 0),
    jsonb_build_object(
      'reviewer_id', p_reviewer_id,
      'role', 'reviewer',
      'active', true,
      'reason', v_reason
    ),
    v_now
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'reviewer_id', p_reviewer_id,
    'role', 'reviewer',
    'active', true,
    'audit_event_id', v_audit_id::text,
    'bootstrapped_at', v_now
  );
end;
$$;

revoke all on function public.creator_publishing_bootstrap_first_trusted_reviewer(uuid, uuid, text) from PUBLIC;
revoke all on function public.creator_publishing_bootstrap_first_trusted_reviewer(uuid, uuid, text) from anon;
revoke all on function public.creator_publishing_bootstrap_first_trusted_reviewer(uuid, uuid, text) from authenticated;
grant execute on function public.creator_publishing_bootstrap_first_trusted_reviewer(uuid, uuid, text) to service_role;

comment on function public.creator_publishing_bootstrap_first_trusted_reviewer(uuid, uuid, text) is
  'One-time service-role-only governance bootstrap. Enrolls a separate real auth user as the first trusted reviewer only when the reviewer table is empty; never verifies a creator or permits self-review.';
