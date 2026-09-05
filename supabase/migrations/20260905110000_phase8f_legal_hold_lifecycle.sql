-- Generated manually because the Supabase CLI is unavailable in this environment.
-- Phase 8F: legal-hold preservation, review, release, expiry reconciliation, and audited admin reads.
-- Production application requires separate explicit authorization.
--
-- Boundaries:
-- - legal holds remain Founder/Admin only and require a fresh TOTP authentication <= 10 minutes;
-- - holds remain finite and subject-scoped; review may extend but never shorten preservation;
-- - an account-scoped hold preserves all resource types for that subject without expanding creator access;
-- - release is explicit and audited; time-expired holds are reconciled by a bounded service-role runner;
-- - direct service-role reads of hold evidence are removed in favor of an audited admin read RPC;
-- - retention, billing, Auth, and notification delivery are not otherwise changed here;
-- - Phase 9 notification delivery remains intentionally untouched.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.governance_legal_hold_reviews (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references public.governance_legal_holds(id) on delete restrict,
  actor_user_id uuid not null,
  review_reason text not null,
  previous_review_due_at timestamptz not null,
  next_review_due_at timestamptz not null,
  previous_expires_at timestamptz not null,
  new_expires_at timestamptz not null,
  fresh_auth_at timestamptz not null,
  fresh_auth_method text not null,
  policy_version text not null,
  correlation_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  audit_event_id uuid not null unique references public.governance_audit_events(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint governance_legal_hold_review_reason_check check (
    char_length(review_reason) between 3 and 1000 and review_reason !~ '[[:cntrl:]]'
  ),
  constraint governance_legal_hold_review_window_check check (
    isfinite(previous_review_due_at) and isfinite(next_review_due_at)
    and isfinite(previous_expires_at) and isfinite(new_expires_at)
    and new_expires_at >= previous_expires_at
    and new_expires_at >= next_review_due_at
  ),
  constraint governance_legal_hold_review_fresh_auth_check check (
    isfinite(fresh_auth_at) and fresh_auth_method='totp'
  ),
  constraint governance_legal_hold_review_policy_version_check check (
    char_length(policy_version) between 3 and 120
  ),
  constraint governance_legal_hold_review_idempotency_check check (
    idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'
  ),
  constraint governance_legal_hold_review_fingerprint_check check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  unique(hold_id,actor_user_id,idempotency_key)
);

create index governance_legal_hold_reviews_hold_idx
  on public.governance_legal_hold_reviews(hold_id,created_at desc);

alter table public.governance_legal_hold_reviews enable row level security;
alter table public.governance_legal_hold_reviews force row level security;
revoke all on table public.governance_legal_hold_reviews from public,anon,authenticated,service_role;

create trigger governance_legal_hold_reviews_reject_update_delete
before update or delete on public.governance_legal_hold_reviews
for each row execute function public.governance_reject_immutable_mutation();

-- Phase 8F replaces the foundation's direct service-role evidence reads with an
-- audited Founder/Admin read contract below. Internal SECURITY DEFINER helpers are
-- unaffected by these table ACLs.
revoke select on table public.governance_legal_holds from service_role;
revoke select on table public.governance_legal_hold_targets from service_role;

create or replace function public.phase8f_assert_founder_admin_fresh_totp(
  p_actor_user_id uuid,
  p_fresh_auth_at timestamptz,
  p_fresh_auth_method text
) returns void
language plpgsql
stable
security definer
set search_path=pg_catalog
as $$
declare
  v_now timestamptz := statement_timestamp();
begin
  if p_actor_user_id is null or not public.governance_actor_is_founder_admin(p_actor_user_id) then
    raise exception 'GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED';
  end if;
  if p_fresh_auth_method<>'totp' or p_fresh_auth_at is null or not isfinite(p_fresh_auth_at)
     or p_fresh_auth_at < v_now-interval '10 minutes'
     or p_fresh_auth_at > v_now+interval '5 seconds' then
    raise exception 'GOVERNANCE_LEGAL_HOLD_FRESH_AUTH_REQUIRED';
  end if;
end;
$$;
revoke all on function public.phase8f_assert_founder_admin_fresh_totp(uuid,timestamptz,text)
  from public,anon,authenticated,service_role;

-- Account targets must use the subject UUID as the target ID so account-wide
-- preservation cannot silently fail because of an arbitrary identifier.
create or replace function public.phase8f_validate_legal_hold_target()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.target_type='account' and new.target_id is distinct from new.subject_user_id::text then
    raise exception 'GOVERNANCE_LEGAL_HOLD_ACCOUNT_TARGET_INVALID';
  end if;
  return new;
end;
$$;
revoke all on function public.phase8f_validate_legal_hold_target()
  from public,anon,authenticated,service_role;

drop trigger if exists phase8f_validate_legal_hold_target on public.governance_legal_hold_targets;
create trigger phase8f_validate_legal_hold_target
before insert on public.governance_legal_hold_targets
for each row execute function public.phase8f_validate_legal_hold_target();

-- Preserve exact-target semantics while making an account hold authoritative for
-- every existing resource-specific hold check for the same subject.
create or replace function public.governance_target_has_active_legal_hold(
  p_target_type text,
  p_target_id text,
  p_subject_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path=pg_catalog
as $$
  select p_subject_user_id is not null and exists(
    select 1
    from public.governance_legal_hold_targets t
    join public.governance_legal_holds h on h.id=t.hold_id
    where t.subject_user_id=p_subject_user_id
      and h.status='active'
      and h.expires_at>statement_timestamp()
      and (
        (t.target_type=p_target_type and t.target_id=p_target_id)
        or (t.target_type='account' and t.target_id=p_subject_user_id::text)
      )
  )
$$;
revoke all on function public.governance_target_has_active_legal_hold(text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.governance_target_has_active_legal_hold(text,text,uuid) to service_role;

create or replace function public.review_governance_legal_hold(
  p_hold_id uuid,
  p_actor_user_id uuid,
  p_review_reason text,
  p_next_review_due_at timestamptz,
  p_new_expires_at timestamptz,
  p_fresh_auth_at timestamptz,
  p_fresh_auth_method text,
  p_policy_version text,
  p_correlation_id uuid,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  v_hold public.governance_legal_holds%rowtype;
  v_existing public.governance_legal_hold_reviews%rowtype;
  v_now timestamptz := statement_timestamp();
  v_review_id uuid := gen_random_uuid();
  v_fingerprint text;
  v_audit_id uuid;
begin
  perform public.phase8f_assert_founder_admin_fresh_totp(p_actor_user_id,p_fresh_auth_at,p_fresh_auth_method);
  if p_hold_id is null then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;
  if char_length(coalesce(p_review_reason,'')) not between 3 and 1000 or p_review_reason ~ '[[:cntrl:]]' then
    raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID';
  end if;
  if p_next_review_due_at is null or p_new_expires_at is null
     or not isfinite(p_next_review_due_at) or not isfinite(p_new_expires_at)
     or p_next_review_due_at<=v_now or p_new_expires_at<p_next_review_due_at then
    raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID';
  end if;
  if char_length(coalesce(p_policy_version,'')) not between 3 and 120 then
    raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID';
  end if;
  if p_correlation_id is null or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID';
  end if;

  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'hold_id',p_hold_id,'actor_user_id',p_actor_user_id,'review_reason',p_review_reason,
    'next_review_due_at',p_next_review_due_at,'new_expires_at',p_new_expires_at,
    'fresh_auth_at',p_fresh_auth_at,'fresh_auth_method',p_fresh_auth_method,
    'policy_version',p_policy_version,'correlation_id',p_correlation_id
  )::text,'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase8f_legal_hold_review:' || p_hold_id::text,0)
  );

  select * into v_existing
    from public.governance_legal_hold_reviews
   where hold_id=p_hold_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'GOVERNANCE_LEGAL_HOLD_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing.id;
  end if;

  select * into v_hold from public.governance_legal_holds where id=p_hold_id for update;
  if not found then raise exception 'GOVERNANCE_LEGAL_HOLD_NOT_FOUND'; end if;
  if v_hold.status<>'active' then raise exception 'GOVERNANCE_LEGAL_HOLD_NOT_ACTIVE'; end if;
  if v_hold.expires_at<=v_now then raise exception 'GOVERNANCE_LEGAL_HOLD_EXPIRED'; end if;
  if p_new_expires_at<v_hold.expires_at then raise exception 'GOVERNANCE_LEGAL_HOLD_REVIEW_CANNOT_SHORTEN'; end if;

  v_audit_id := public.append_governance_audit_event(
    p_actor_user_id,'founder_admin','legal_hold_reviewed','legal_hold',p_hold_id::text,
    v_hold.category,p_review_reason,'continued',p_policy_version,'legal-hold-review-v1',p_correlation_id,null,
    jsonb_build_object(
      'previous_review_due_at',v_hold.review_due_at,
      'next_review_due_at',p_next_review_due_at,
      'previous_expires_at',v_hold.expires_at,
      'new_expires_at',p_new_expires_at
    ),
    '{}'::jsonb,null
  );

  insert into public.governance_legal_hold_reviews(
    id,hold_id,actor_user_id,review_reason,previous_review_due_at,next_review_due_at,
    previous_expires_at,new_expires_at,fresh_auth_at,fresh_auth_method,policy_version,
    correlation_id,idempotency_key,request_fingerprint,audit_event_id,created_at
  ) values (
    v_review_id,p_hold_id,p_actor_user_id,p_review_reason,v_hold.review_due_at,p_next_review_due_at,
    v_hold.expires_at,p_new_expires_at,p_fresh_auth_at,p_fresh_auth_method,p_policy_version,
    p_correlation_id,p_idempotency_key,v_fingerprint,v_audit_id,v_now
  );

  update public.governance_legal_holds
     set review_due_at=p_next_review_due_at,
         expires_at=p_new_expires_at,
         updated_at=v_now
   where id=p_hold_id;

  return v_review_id;
end;
$$;
revoke all on function public.review_governance_legal_hold(uuid,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.review_governance_legal_hold(uuid,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid,text)
  to service_role;

-- Keep the foundation signature stable for callers, but do not misattribute a
-- time-expired hold as an explicit Founder/Admin release.
create or replace function public.release_governance_legal_hold(
  p_hold_id uuid,
  p_actor_user_id uuid,
  p_release_reason text,
  p_fresh_auth_at timestamptz,
  p_fresh_auth_method text,
  p_correlation_id uuid,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  v_hold public.governance_legal_holds%rowtype;
  v_now timestamptz := statement_timestamp();
  v_fingerprint text;
  v_audit_id uuid;
begin
  perform public.phase8f_assert_founder_admin_fresh_totp(p_actor_user_id,p_fresh_auth_at,p_fresh_auth_method);
  if p_hold_id is null then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;
  if char_length(coalesce(p_release_reason,'')) not between 3 and 1000 or p_release_reason ~ '[[:cntrl:]]' then
    raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID';
  end if;
  if p_correlation_id is null or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID';
  end if;

  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'hold_id',p_hold_id,'actor_user_id',p_actor_user_id,'release_reason',p_release_reason,
    'fresh_auth_at',p_fresh_auth_at,'fresh_auth_method',p_fresh_auth_method,'correlation_id',p_correlation_id
  )::text,'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase8_legal_hold_release:' || p_hold_id::text,0));
  select * into v_hold from public.governance_legal_holds where id=p_hold_id for update;
  if not found then raise exception 'GOVERNANCE_LEGAL_HOLD_NOT_FOUND'; end if;
  if v_hold.status='released' then
    if v_hold.released_by=p_actor_user_id and v_hold.release_idempotency_key=p_idempotency_key
       and v_hold.release_request_fingerprint=v_fingerprint then return v_hold.id; end if;
    raise exception 'GOVERNANCE_LEGAL_HOLD_IDEMPOTENCY_CONFLICT';
  end if;
  if v_hold.status<>'active' then raise exception 'GOVERNANCE_LEGAL_HOLD_NOT_ACTIVE'; end if;
  if v_hold.expires_at<=v_now then raise exception 'GOVERNANCE_LEGAL_HOLD_EXPIRED'; end if;

  v_audit_id := public.append_governance_audit_event(
    p_actor_user_id,'founder_admin','legal_hold_released','legal_hold',p_hold_id::text,
    v_hold.category,p_release_reason,'released',v_hold.policy_version,'legal-hold-release-v1',p_correlation_id,null,
    jsonb_build_object('opened_at',v_hold.opened_at,'review_due_at',v_hold.review_due_at,'expires_at',v_hold.expires_at),
    '{}'::jsonb,null
  );

  update public.governance_legal_holds
     set status='released',released_by=p_actor_user_id,released_at=v_now,release_reason=p_release_reason,
         release_fresh_auth_at=p_fresh_auth_at,release_idempotency_key=p_idempotency_key,
         release_request_fingerprint=v_fingerprint,released_audit_event_id=v_audit_id,updated_at=v_now
   where id=p_hold_id;
  return p_hold_id;
end;
$$;
revoke all on function public.release_governance_legal_hold(uuid,uuid,text,timestamptz,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.release_governance_legal_hold(uuid,uuid,text,timestamptz,text,uuid,text)
  to service_role;

create or replace function public.phase8f_expire_governance_legal_holds(p_limit integer default 50)
returns table(hold_id uuid,expired_at timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  v_hold public.governance_legal_holds%rowtype;
  v_now timestamptz := statement_timestamp();
  v_audit_id uuid;
  v_correlation uuid;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'GOVERNANCE_LEGAL_HOLD_EXPIRY_LIMIT_INVALID';
  end if;

  for v_hold in
    select h.*
      from public.governance_legal_holds h
     where h.status='active' and h.expires_at<=v_now
     order by h.expires_at,h.id
     for update skip locked
     limit p_limit
  loop
    v_correlation := gen_random_uuid();
    v_audit_id := public.append_governance_audit_event(
      null,'system','legal_hold_expired','legal_hold',v_hold.id::text,
      v_hold.category,'finite legal-hold window elapsed','expired',v_hold.policy_version,'legal-hold-expiry-v1',
      v_correlation,null,
      jsonb_build_object('opened_at',v_hold.opened_at,'review_due_at',v_hold.review_due_at,'expires_at',v_hold.expires_at),
      '{}'::jsonb,null
    );

    update public.governance_legal_holds
       set status='expired',updated_at=v_now
     where id=v_hold.id;

    return query select v_hold.id,v_now;
  end loop;
end;
$$;
revoke all on function public.phase8f_expire_governance_legal_holds(integer)
  from public,anon,authenticated;
grant execute on function public.phase8f_expire_governance_legal_holds(integer) to service_role;

create or replace function public.list_governance_legal_holds_for_admin(
  p_actor_user_id uuid,
  p_fresh_auth_at timestamptz,
  p_fresh_auth_method text,
  p_status text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  v_result jsonb;
  v_count integer;
  v_correlation uuid := gen_random_uuid();
  v_audit_id uuid;
begin
  perform public.phase8f_assert_founder_admin_fresh_totp(p_actor_user_id,p_fresh_auth_at,p_fresh_auth_method);
  if p_status is not null and p_status not in ('active','released','expired') then
    raise exception 'GOVERNANCE_LEGAL_HOLD_STATUS_FILTER_INVALID';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'GOVERNANCE_LEGAL_HOLD_LIST_LIMIT_INVALID';
  end if;

  with selected as (
    select h.*
      from public.governance_legal_holds h
     where p_status is null or h.status=p_status
     order by
       case when h.status='active' then 0 else 1 end,
       h.review_due_at asc,
       h.opened_at desc,
       h.id
     limit p_limit
  ), shaped as (
    select jsonb_build_object(
      'id',h.id,
      'category',h.category,
      'reason',h.reason,
      'case_reference',h.case_reference,
      'status',h.status,
      'opened_at',h.opened_at,
      'review_due_at',h.review_due_at,
      'expires_at',h.expires_at,
      'released_at',h.released_at,
      'release_reason',h.release_reason,
      'policy_version',h.policy_version,
      'review_due',h.status='active' and h.review_due_at<=statement_timestamp(),
      'time_expired',h.status='active' and h.expires_at<=statement_timestamp(),
      'targets',coalesce((
        select jsonb_agg(jsonb_build_object(
          'target_type',t.target_type,
          'target_id',t.target_id,
          'subject_user_id',t.subject_user_id,
          'preservation_scope',t.preservation_scope,
          'created_at',t.created_at
        ) order by t.created_at,t.id)
        from public.governance_legal_hold_targets t where t.hold_id=h.id
      ),'[]'::jsonb),
      'reviews',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',r.id,
          'actor_user_id',r.actor_user_id,
          'review_reason',r.review_reason,
          'previous_review_due_at',r.previous_review_due_at,
          'next_review_due_at',r.next_review_due_at,
          'previous_expires_at',r.previous_expires_at,
          'new_expires_at',r.new_expires_at,
          'policy_version',r.policy_version,
          'created_at',r.created_at
        ) order by r.created_at,r.id)
        from public.governance_legal_hold_reviews r where r.hold_id=h.id
      ),'[]'::jsonb)
    ) as value
    from selected h
  )
  select coalesce(jsonb_agg(value),'[]'::jsonb),count(*)::integer into v_result,v_count from shaped;

  v_audit_id := public.append_governance_audit_event(
    p_actor_user_id,'founder_admin','legal_hold_register_read','legal_hold_register','all',
    'legal_hold_review','Founder/Admin reviewed legal-hold register','read','legal-hold-v1','legal-hold-register-read-v1',
    v_correlation,null,
    jsonb_build_object('status_filter',p_status,'limit',p_limit,'returned_count',v_count),
    '{}'::jsonb,null
  );

  return jsonb_build_object('holds',v_result,'count',v_count,'audited',true);
end;
$$;
revoke all on function public.list_governance_legal_holds_for_admin(uuid,timestamptz,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.list_governance_legal_holds_for_admin(uuid,timestamptz,text,text,integer)
  to service_role;

commit;
