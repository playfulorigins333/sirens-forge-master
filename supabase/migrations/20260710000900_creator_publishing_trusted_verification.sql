-- Task 11: Trusted creator and platform verification workflow.
create extension if not exists pgcrypto with schema extensions;

alter table public.creator_platform_accounts
  add column if not exists verification_reviewed_by uuid references auth.users(id),
  add column if not exists verification_reviewed_at timestamptz,
  add column if not exists verification_evidence_reference text,
  add column if not exists verification_reason text,
  add column if not exists verification_legacy_revoked boolean not null default false;

-- Preserve deployed pre-Task-11 revoked rows without fabricating a reviewer identity.
update public.creator_platform_accounts
  set verification_legacy_revoked = true
  where verification_status = 'revoked'
    and verification_reviewed_by is null
    and verification_reviewed_at is null
    and verification_reason is null;

alter table public.creator_platform_accounts drop constraint if exists creator_platform_accounts_verification_status_check;
alter table public.creator_platform_accounts add constraint creator_platform_accounts_verification_status_check
  check (verification_status in ('unattested','creator_attested','verified','revoked'));

alter table public.creator_platform_accounts drop constraint if exists creator_platform_accounts_trusted_metadata_check;
alter table public.creator_platform_accounts add constraint creator_platform_accounts_trusted_metadata_check check (
  (verification_status = 'verified' and verification_legacy_revoked is false and verification_reviewed_by is not null and verification_reviewed_at is not null and length(btrim(coalesce(verification_evidence_reference,''))) > 0 and length(btrim(coalesce(verification_reason,''))) > 0)
  or (verification_status = 'revoked' and verification_legacy_revoked is false and verification_reviewed_by is not null and verification_reviewed_at is not null and length(btrim(coalesce(verification_reason,''))) > 0)
  or (verification_status = 'revoked' and verification_legacy_revoked is true and verification_reviewed_by is null and verification_reviewed_at is null and verification_evidence_reference is null and verification_reason is null)
  or (verification_status in ('unattested','creator_attested') and verification_legacy_revoked is false and verification_reviewed_by is null and verification_reviewed_at is null and verification_evidence_reference is null and verification_reason is null)
);

create table if not exists public.creator_publishing_creator_verifications (
  creator_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'unverified',
  evidence_reference text,
  reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_creator_verifications_status_check check (status in ('unverified','verified','revoked')),
  constraint creator_publishing_creator_verifications_metadata_check check (
    (status = 'verified' and reviewed_by is not null and reviewed_at is not null and length(btrim(coalesce(evidence_reference,''))) > 0 and length(btrim(coalesce(reason,''))) > 0)
    or (status = 'revoked' and reviewed_by is not null and reviewed_at is not null and length(btrim(coalesce(reason,''))) > 0)
    or (status = 'unverified')
  )
);

drop trigger if exists trg_creator_publishing_creator_verifications_updated_at on public.creator_publishing_creator_verifications;
create trigger trg_creator_publishing_creator_verifications_updated_at before update on public.creator_publishing_creator_verifications for each row execute function public.set_updated_at();

alter table public.creator_publishing_creator_verifications enable row level security;
drop policy if exists "creator_publishing_creator_verifications_select_own" on public.creator_publishing_creator_verifications;
create policy "creator_publishing_creator_verifications_select_own" on public.creator_publishing_creator_verifications for select using (auth.uid() = creator_id);
-- No authenticated insert/update/delete policies exist; trusted writes occur only through service_role RPC.

create or replace function public.creator_publishing_platform_account_clear_trusted_metadata()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := now();
begin
  if tg_op = 'UPDATE' and old.verification_status in ('verified','revoked') and (
    old.platform_username is distinct from new.platform_username or old.profile_url is distinct from new.profile_url or old.is_virtual_entity is distinct from new.is_virtual_entity or old.verification_attested_at is distinct from new.verification_attested_at
  ) then
    new.verification_status := case when new.verification_attested_at is not null then 'creator_attested' else 'unattested' end;
    new.verification_reviewed_by := null; new.verification_reviewed_at := null; new.verification_evidence_reference := null; new.verification_reason := null; new.verification_legacy_revoked := false;
    insert into public.creator_publishing_audit_events(entity_type, entity_id, actor_id, actor_role, action, before_state, after_state, created_at)
    values ('creator_platform_account', old.id, new.creator_id, 'creator', 'trusted_platform_account_verification_invalidated_by_creator_edit', jsonb_build_object('prior_status', old.verification_status), jsonb_build_object('resulting_status', new.verification_status, 'reason', 'creator account edit invalidated trusted verification'), v_now);
  end if;
  if new.verification_status in ('unattested','creator_attested') then
    new.verification_reviewed_by := null; new.verification_reviewed_at := null; new.verification_evidence_reference := null; new.verification_reason := null; new.verification_legacy_revoked := false;
  end if;
  if new.verification_status = 'verified' then
    new.verification_legacy_revoked := false;
  end if;
  return new;
end; $$;

drop trigger if exists trg_creator_platform_accounts_clear_trusted_metadata on public.creator_platform_accounts;
create trigger trg_creator_platform_accounts_clear_trusted_metadata before update on public.creator_platform_accounts for each row execute function public.creator_publishing_platform_account_clear_trusted_metadata();

create unique index if not exists creator_publishing_verification_audit_reviewer_key_uidx
  on public.creator_publishing_audit_events(actor_id, idempotency_key)
  where actor_id is not null and idempotency_key is not null and action in ('trusted_creator_verified','trusted_creator_verification_revoked','trusted_creator_marked_unverified','trusted_platform_account_verified','trusted_platform_account_verification_revoked','trusted_platform_account_marked_unverified');

create or replace function public.creator_publishing_apply_trusted_verification_decision(
  p_reviewer_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_decision text,
  p_reason text,
  p_evidence_reference text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reviewer public.creator_publishing_trusted_reviewers%rowtype;
  v_subject_type text := lower(btrim(coalesce(p_subject_type,'')));
  v_decision text := lower(btrim(coalesce(p_decision,'')));
  v_reason text := btrim(coalesce(p_reason,''));
  v_evidence text := nullif(btrim(coalesce(p_evidence_reference,'')), '');
  v_key text := btrim(coalesce(p_idempotency_key,''));
  v_now timestamptz := now();
  v_action text;
  v_prior text;
  v_resulting text;
  v_fingerprint text;
  v_existing public.creator_publishing_audit_events%rowtype;
  v_creator public.creator_publishing_creator_verifications%rowtype;
  v_account public.creator_platform_accounts%rowtype;
  v_audit_id bigint;
  v_creator_id uuid;
  v_resulting_state_fingerprint text;
  v_current_state_fingerprint text;
  v_resulting_updated_at timestamptz;
  v_stored_resulting_updated_at timestamptz;
  v_creator_exists boolean;
begin
  if p_reviewer_id is null then raise exception 'VERIFICATION_UNAUTHORIZED'; end if;
  select * into v_reviewer from public.creator_publishing_trusted_reviewers where reviewer_id = p_reviewer_id;
  if not found then raise exception 'VERIFICATION_UNAUTHORIZED'; end if;
  if v_reviewer.active is not true or v_reviewer.revoked_at is not null then raise exception 'VERIFICATION_REVIEWER_INACTIVE'; end if;
  if v_reviewer.role not in ('admin','reviewer','service_reviewer') then raise exception 'VERIFICATION_UNAUTHORIZED'; end if; -- operator role cannot verify
  if v_subject_type not in ('creator','platform_account') then raise exception 'VERIFICATION_INVALID_SUBJECT'; end if;
  if v_decision not in ('verify','revoke','mark_unverified') then raise exception 'VERIFICATION_INVALID_DECISION'; end if;
  if length(v_reason)=0 then raise exception 'VERIFICATION_REASON_REQUIRED'; end if;
  if v_decision='verify' and v_evidence is null then raise exception 'VERIFICATION_EVIDENCE_REQUIRED'; end if;
  if v_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'VERIFICATION_IDEMPOTENCY_CONFLICT'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_reviewer_id::text || ':' || v_key, 0)); -- serialize same-reviewer/same-key requests
  v_fingerprint := encode(extensions.digest(jsonb_build_object('reviewer_id',p_reviewer_id,'subject_type',v_subject_type,'subject_id',p_subject_id,'decision',v_decision,'reason',v_reason,'evidence_reference',v_evidence,'expected_updated_at',p_expected_updated_at)::text,'sha256'),'hex');

  select * into v_existing from public.creator_publishing_audit_events where actor_id=p_reviewer_id and idempotency_key=v_key and action in ('trusted_creator_verified','trusted_creator_verification_revoked','trusted_creator_marked_unverified','trusted_platform_account_verified','trusted_platform_account_verification_revoked','trusted_platform_account_marked_unverified') limit 1;
  if found then
    if v_existing.after_state->>'request_fingerprint' is distinct from v_fingerprint then raise exception 'VERIFICATION_IDEMPOTENCY_CONFLICT'; end if;
    begin
      if nullif(btrim(coalesce(v_existing.after_state->>'resulting_updated_at','')), '') is null then raise exception 'VERIFICATION_IDEMPOTENCY_CONFLICT'; end if;
      v_stored_resulting_updated_at := (v_existing.after_state->>'resulting_updated_at')::timestamptz;
    exception when others then
      raise exception 'VERIFICATION_IDEMPOTENCY_CONFLICT';
    end;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('verification-subject:' || v_subject_type || ':' || p_subject_id::text, 0)); -- serialize same subject mutations and exact retries
    if v_subject_type='creator' then
      select * into v_creator from public.creator_publishing_creator_verifications where creator_id=p_subject_id for update;
      if not found then raise exception 'VERIFICATION_IDEMPOTENCY_CONFLICT'; end if;
      v_current_state_fingerprint := encode(extensions.digest(jsonb_build_object('subject_type','creator','creator_id',v_creator.creator_id,'resulting_status',v_creator.status,'reviewed_by',v_creator.reviewed_by,'reviewed_at',v_creator.reviewed_at,'reason',v_creator.reason,'evidence_reference',v_creator.evidence_reference,'resulting_updated_at',v_creator.updated_at)::text,'sha256'),'hex');
      if v_current_state_fingerprint is distinct from v_existing.after_state->>'resulting_state_fingerprint' or v_creator.updated_at is distinct from v_stored_resulting_updated_at then raise exception 'VERIFICATION_IDEMPOTENCY_CONFLICT'; end if;
    else
      select * into v_account from public.creator_platform_accounts where id=p_subject_id for update;
      if not found then raise exception 'VERIFICATION_IDEMPOTENCY_CONFLICT'; end if;
      v_current_state_fingerprint := encode(extensions.digest(jsonb_build_object('subject_type','platform_account','account_id',v_account.id,'creator_id',v_account.creator_id,'platform',v_account.platform,'resulting_status',v_account.verification_status,'verification_reviewed_by',v_account.verification_reviewed_by,'verification_reviewed_at',v_account.verification_reviewed_at,'verification_reason',v_account.verification_reason,'verification_evidence_reference',v_account.verification_evidence_reference,'verification_attested_at',v_account.verification_attested_at,'verification_legacy_revoked',v_account.verification_legacy_revoked,'resulting_updated_at',v_account.updated_at)::text,'sha256'),'hex');
      if v_current_state_fingerprint is distinct from v_existing.after_state->>'resulting_state_fingerprint' or v_account.updated_at is distinct from v_stored_resulting_updated_at then raise exception 'VERIFICATION_IDEMPOTENCY_CONFLICT'; end if;
    end if;
    return jsonb_build_object('subject_type',v_subject_type,'subject',jsonb_build_object('id',p_subject_id),'prior_status',v_existing.after_state->>'prior_status','resulting_status',v_existing.after_state->>'resulting_status','idempotent',true,'outcome','idempotent','audit_event_ids',jsonb_build_array(v_existing.id::text),'reviewed_at',v_existing.created_at);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('verification-subject:' || v_subject_type || ':' || p_subject_id::text, 0)); -- serialize same subject mutations before first-use creator existence checks

  if v_subject_type='creator' then
    if p_reviewer_id = p_subject_id then raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN'; end if;
    select exists(select 1 from auth.users where id = p_subject_id) into v_creator_exists;
    if v_creator_exists is not true then raise exception 'VERIFICATION_SUBJECT_NOT_FOUND'; end if;
    select * into v_creator from public.creator_publishing_creator_verifications where creator_id=p_subject_id for update;
    if found then
      if p_expected_updated_at is null or v_creator.updated_at <> p_expected_updated_at then raise exception 'VERIFICATION_STALE'; end if;
      v_prior := v_creator.status;
    else
      if p_expected_updated_at is not null then raise exception 'VERIFICATION_STALE'; end if;
      v_prior := 'unverified';
    end if;
    v_resulting := case v_decision when 'verify' then 'verified' when 'revoke' then 'revoked' else 'unverified' end;
    if v_creator.creator_id is null then
      begin
        insert into public.creator_publishing_creator_verifications(creator_id,status,evidence_reference,reason,reviewed_by,reviewed_at,created_at,updated_at)
        values(p_subject_id,v_resulting,case when v_resulting='unverified' then null else v_evidence end,v_reason,p_reviewer_id,v_now,v_now,v_now)
        returning * into v_creator;
      exception when unique_violation then
        raise exception 'VERIFICATION_STALE';
      end;
    else
      update public.creator_publishing_creator_verifications
        set status=v_resulting,
            evidence_reference=case when v_resulting='unverified' then null else coalesce(v_evidence, case when v_decision='revoke' then v_creator.evidence_reference else null end) end,
            reason=v_reason,
            reviewed_by=p_reviewer_id,
            reviewed_at=v_now,
            updated_at=v_now
        where creator_id=p_subject_id
        returning * into v_creator;
    end if;
    v_resulting_updated_at := v_creator.updated_at;
    v_resulting_state_fingerprint := encode(extensions.digest(jsonb_build_object('subject_type','creator','creator_id',v_creator.creator_id,'resulting_status',v_creator.status,'reviewed_by',v_creator.reviewed_by,'reviewed_at',v_creator.reviewed_at,'reason',v_creator.reason,'evidence_reference',v_creator.evidence_reference,'resulting_updated_at',v_creator.updated_at)::text,'sha256'),'hex');
    v_action := case v_decision when 'verify' then 'trusted_creator_verified' when 'revoke' then 'trusted_creator_verification_revoked' else 'trusted_creator_marked_unverified' end; v_creator_id := p_subject_id;
  else
    select * into v_account from public.creator_platform_accounts where id=p_subject_id for update;
    if not found then raise exception 'VERIFICATION_SUBJECT_NOT_FOUND'; end if;
    if v_account.creator_id = p_reviewer_id then raise exception 'VERIFICATION_SELF_REVIEW_FORBIDDEN'; end if;
    if v_account.platform = 'fanvue' then raise exception 'VERIFICATION_FANVUE_NOT_SUPPORTED'; end if;
    if v_account.platform not in ('onlyfans','fansly') then raise exception 'VERIFICATION_INVALID_SUBJECT'; end if;
    if p_expected_updated_at is null or v_account.updated_at <> p_expected_updated_at then raise exception 'VERIFICATION_STALE'; end if;
    v_prior := v_account.verification_status;
    if v_decision='verify' and (v_account.verification_status not in ('creator_attested','verified') or v_account.verification_attested_at is null) then raise exception 'VERIFICATION_ATTESTATION_REQUIRED'; end if;
    v_resulting := case v_decision when 'verify' then 'verified' when 'revoke' then 'revoked' else case when v_account.verification_attested_at is not null then 'creator_attested' else 'unattested' end end;
    update public.creator_platform_accounts set verification_status=v_resulting, verification_legacy_revoked=false, verification_reviewed_by=case when v_resulting in ('verified','revoked') then p_reviewer_id else null end, verification_reviewed_at=case when v_resulting in ('verified','revoked') then v_now else null end, verification_evidence_reference=case when v_resulting='verified' then v_evidence else null end, verification_reason=case when v_resulting in ('verified','revoked') then v_reason else null end, updated_at=v_now where id=p_subject_id returning * into v_account;
    v_resulting_updated_at := v_account.updated_at;
    v_resulting_state_fingerprint := encode(extensions.digest(jsonb_build_object('subject_type','platform_account','account_id',v_account.id,'creator_id',v_account.creator_id,'platform',v_account.platform,'resulting_status',v_account.verification_status,'verification_reviewed_by',v_account.verification_reviewed_by,'verification_reviewed_at',v_account.verification_reviewed_at,'verification_reason',v_account.verification_reason,'verification_evidence_reference',v_account.verification_evidence_reference,'verification_attested_at',v_account.verification_attested_at,'verification_legacy_revoked',v_account.verification_legacy_revoked,'resulting_updated_at',v_account.updated_at)::text,'sha256'),'hex');
    v_action := case v_decision when 'verify' then 'trusted_platform_account_verified' when 'revoke' then 'trusted_platform_account_verification_revoked' else 'trusted_platform_account_marked_unverified' end; v_creator_id := v_account.creator_id;
  end if;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values (case when v_subject_type='creator' then 'creator_publishing_creator_verification' else 'creator_platform_account' end,p_subject_id,p_reviewer_id,v_reviewer.role,v_action,jsonb_build_object('prior_status',v_prior),jsonb_build_object('subject_type',v_subject_type,'subject_id',p_subject_id,'creator_id',v_creator_id,'platform',case when v_subject_type='platform_account' then v_account.platform else null end,'platform_username',case when v_subject_type='platform_account' then v_account.platform_username else null end,'prior_status',v_prior,'resulting_status',v_resulting,'evidence_reference_present',v_evidence is not null,'reason',v_reason,'reviewer_id',p_reviewer_id,'reviewer_role',v_reviewer.role,'request_fingerprint',v_fingerprint,'resulting_state_fingerprint',v_resulting_state_fingerprint,'resulting_updated_at',v_resulting_updated_at,'idempotency_key',v_key,'trusted_timestamp',v_now),v_key,v_now) returning id into v_audit_id;
  return jsonb_build_object('subject_type',v_subject_type,'subject',jsonb_build_object('id',p_subject_id,'creator_id',v_creator_id),'prior_status',v_prior,'resulting_status',v_resulting,'idempotent',false,'outcome',case v_decision when 'verify' then 'verified' when 'revoke' then 'revoked' else 'marked_unverified' end,'audit_event_ids',jsonb_build_array(v_audit_id::text),'reviewed_at',v_now);
end; $$;

revoke execute on function public.creator_publishing_apply_trusted_verification_decision(uuid,text,uuid,text,text,text,timestamptz,text) from public;
revoke execute on function public.creator_publishing_apply_trusted_verification_decision(uuid,text,uuid,text,text,text,timestamptz,text) from anon;
revoke execute on function public.creator_publishing_apply_trusted_verification_decision(uuid,text,uuid,text,text,text,timestamptz,text) from authenticated;
grant execute on function public.creator_publishing_apply_trusted_verification_decision(uuid,text,uuid,text,text,text,timestamptz,text) to service_role;

-- Forward redefine Task 10 composer RPC: verified platform accounts are now eligible alongside creator_attested.
create or replace function public.creator_publishing_save_content_package(
  p_creator_id uuid,
  p_operation text,
  p_content_package_id uuid,
  p_platform_account_id uuid,
  p_title text,
  p_caption_body text,
  p_second_person_present boolean,
  p_price_notes text,
  p_visibility_notes text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation,'')));
  v_title text := btrim(coalesce(p_title,''));
  v_caption text := replace(replace(coalesce(p_caption_body,''), E'\r\n', E'\n'), E'\r', E'\n');
  v_price_notes text := nullif(btrim(coalesce(p_price_notes,'')), '');
  v_visibility_notes text := nullif(btrim(coalesce(p_visibility_notes,'')), '');
  v_idempotency_key text := btrim(coalesce(p_idempotency_key,''));
  v_now timestamptz := now();
  v_account public.creator_platform_accounts%rowtype;
  v_package public.creator_publishing_content_packages%rowtype;
  v_result public.creator_publishing_content_packages%rowtype;
  v_existing_audit public.creator_publishing_audit_events%rowtype;
  v_fingerprint text;
  v_retry_probe_fingerprint text;
  v_request_canonical jsonb;
  v_retry_probe_canonical jsonb;
  v_changed text[] := array[]::text[];
  v_before jsonb;
  v_after jsonb;
  v_action text;
  v_invalidates boolean := false;
begin
  if p_creator_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_operation not in ('create','update') then raise exception 'INVALID_OPERATION'; end if;
  if v_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if length(v_title)=0 or length(v_title)>160 or length(v_caption)>5000 or coalesce(length(v_price_notes),0)>1000 or coalesce(length(v_visibility_notes),0)>1000 then raise exception 'INVALID_FORM'; end if;
  if v_operation='create' and (p_content_package_id is not null or p_expected_updated_at is not null) then raise exception 'INVALID_OPERATION'; end if;
  if v_operation='update' and (p_content_package_id is null or p_expected_updated_at is null) then raise exception 'INVALID_OPERATION'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_creator_id::text || ':' || v_idempotency_key, 0)); -- serialize same-key requests

  -- Existing creator/key records are checked before account-specific validation so key reuse cannot be obscured by account errors.
  v_retry_probe_canonical := jsonb_build_object('operation',v_operation,'content_package_id',p_content_package_id,'creator_id',p_creator_id,'platform_account_id',p_platform_account_id,'title',v_title,'caption_length',length(v_caption),'caption_sha256',encode(extensions.digest(v_caption,'sha256'),'hex'),'second_person_present',coalesce(p_second_person_present,false),'price_notes',v_price_notes,'visibility_notes',v_visibility_notes,'ai_flag','ai_generated','ai_detail','{}'::jsonb);
  v_retry_probe_fingerprint := encode(extensions.digest(v_retry_probe_canonical::text,'sha256'),'hex');

  select * into v_existing_audit from public.creator_publishing_audit_events where entity_type='creator_publishing_content_package' and actor_id=p_creator_id and idempotency_key=v_idempotency_key and action in ('creator_publishing_package_created','creator_publishing_package_updated','creator_publishing_package_noop') limit 1;
  if found then
    if (v_existing_audit.after_state->'request_canonical' - 'target_platform') is distinct from v_retry_probe_canonical
       or v_existing_audit.after_state->>'retry_probe_fingerprint' is distinct from v_retry_probe_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    select * into v_result from public.creator_publishing_content_packages where id = v_existing_audit.entity_id for update;
    if not found or v_result.creator_id <> p_creator_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if v_result.platform_account_id <> p_platform_account_id
       or v_result.target_platform is distinct from v_existing_audit.after_state->'request_canonical'->>'target_platform'
       or v_result.title <> v_title
       or length(coalesce(v_result.caption_body,'')) <> ((v_existing_audit.after_state->'request_canonical'->>'caption_length')::int)
       or encode(extensions.digest(coalesce(v_result.caption_body,''),'sha256'),'hex') is distinct from v_existing_audit.after_state->'request_canonical'->>'caption_sha256'
       or v_result.second_person_present is distinct from coalesce(p_second_person_present,false)
       or v_result.price_notes is distinct from v_price_notes
       or v_result.visibility_notes is distinct from v_visibility_notes
       or v_result.ai_flag <> 'ai_generated'
       or v_result.ai_detail <> '{}'::jsonb then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('package', to_jsonb(v_result), 'idempotent', true, 'outcome', 'idempotent');
  end if;

  select * into v_account from public.creator_platform_accounts where id = p_platform_account_id for update;
  if not found or v_account.creator_id <> p_creator_id then raise exception 'PLATFORM_ACCOUNT_NOT_FOUND'; end if;
  if v_account.platform = 'fanvue' then raise exception 'FANVUE_NOT_AVAILABLE'; end if;
  if v_account.platform not in ('onlyfans','fansly') then raise exception 'UNSUPPORTED_PLATFORM'; end if;
  if v_account.verification_status = 'revoked' then raise exception 'PLATFORM_ACCOUNT_REVOKED'; end if;
  if v_account.verification_status not in ('creator_attested','verified') then raise exception 'PLATFORM_ACCOUNT_ATTESTATION_REQUIRED'; end if;

  v_request_canonical := v_retry_probe_canonical || jsonb_build_object('target_platform',v_account.platform);
  v_fingerprint := encode(extensions.digest(v_request_canonical::text,'sha256'),'hex');

  if v_operation='create' then
    insert into public.creator_publishing_content_packages(creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,second_person_present,price_notes,visibility_notes,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_by,creator_approved_at,platform_meta,scheduled_for,schedule_timezone,created_at,updated_at)
    values(p_creator_id,p_platform_account_id,v_account.platform,v_title,v_caption,null,'ai_generated','{}'::jsonb,coalesce(p_second_person_present,false),v_price_notes,v_visibility_notes,'pending','unassigned','pending',null,null,'{}'::jsonb,null,null,v_now,v_now)
    returning * into v_result;
    v_action := 'creator_publishing_package_created'; v_before := null; v_changed := array['platform_account_id','target_platform','title','caption_body','ai_flag','ai_detail','second_person_present','price_notes','visibility_notes'];
  else
    select * into v_package from public.creator_publishing_content_packages where id = p_content_package_id for update;
    if not found or v_package.creator_id <> p_creator_id then raise exception 'PACKAGE_NOT_FOUND'; end if;
    if v_package.target_platform = 'fanvue' then raise exception 'FANVUE_NOT_AVAILABLE'; end if;
    if v_package.updated_at <> p_expected_updated_at then raise exception 'PACKAGE_STALE'; end if;
    if v_package.creator_approval_status = 'approved' then raise exception 'PACKAGE_LOCKED'; end if;
    if exists (select 1 from public.creator_publishing_queue_tasks where content_package_id = v_package.id and status <> 'archived') then raise exception 'PACKAGE_LOCKED'; end if;
    if v_package.platform_account_id is distinct from p_platform_account_id then v_changed := array_append(v_changed,'platform_account_id'); end if;
    if v_package.target_platform is distinct from v_account.platform then v_changed := array_append(v_changed,'target_platform'); end if;
    if v_package.title is distinct from v_title then v_changed := array_append(v_changed,'title'); end if;
    if coalesce(v_package.caption_body,'') is distinct from v_caption then v_changed := array_append(v_changed,'caption_body'); end if;
    if v_package.ai_flag is distinct from 'ai_generated' then v_changed := array_append(v_changed,'ai_flag'); end if;
    if v_package.ai_detail is distinct from '{}'::jsonb then v_changed := array_append(v_changed,'ai_detail'); end if;
    if v_package.second_person_present is distinct from coalesce(p_second_person_present,false) then v_changed := array_append(v_changed,'second_person_present'); end if;
    if v_package.price_notes is distinct from v_price_notes then v_changed := array_append(v_changed,'price_notes'); end if;
    if v_package.visibility_notes is distinct from v_visibility_notes then v_changed := array_append(v_changed,'visibility_notes'); end if;
    v_invalidates := coalesce(array_length(v_changed,1),0) > 0;
    v_before := jsonb_build_object('package_id',v_package.id,'creator_id',v_package.creator_id,'platform_account_id',v_package.platform_account_id,'target_platform',v_package.target_platform,'title',v_package.title,'caption_length',length(coalesce(v_package.caption_body,'')),'caption_sha256',encode(extensions.digest(coalesce(v_package.caption_body,''),'sha256'),'hex'),'second_person_present',v_package.second_person_present,'price_notes_present',v_package.price_notes is not null,'visibility_notes_present',v_package.visibility_notes is not null,'trusted_ai_flag',v_package.ai_flag,'prior_compliance_status',v_package.compliance_status,'prior_approval_status',v_package.creator_approval_status,'scheduled_for',v_package.scheduled_for,'schedule_timezone',v_package.schedule_timezone,'platform_meta_preserved',true);
    if v_invalidates then
      update public.creator_publishing_content_packages set platform_account_id=p_platform_account_id,target_platform=v_account.platform,title=v_title,caption_body=v_caption,ai_flag='ai_generated',ai_detail='{}'::jsonb,second_person_present=coalesce(p_second_person_present,false),price_notes=v_price_notes,visibility_notes=v_visibility_notes,compliance_status='pending',compliance_policy_version='unassigned',forced_disclosure_text=null,creator_approval_status='pending',creator_approved_by=null,creator_approved_at=null, updated_at=v_now where id=p_content_package_id returning * into v_result;
      v_action := 'creator_publishing_package_updated';
    else
      v_result := v_package; v_action := 'creator_publishing_package_noop';
    end if;
  end if;
  v_after := jsonb_build_object('package_id',v_result.id,'creator_id',v_result.creator_id,'platform_account_id',v_result.platform_account_id,'target_platform',v_result.target_platform,'title',v_result.title,'caption_length',length(coalesce(v_result.caption_body,'')),'caption_sha256',encode(extensions.digest(coalesce(v_result.caption_body,''),'sha256'),'hex'),'second_person_present',v_result.second_person_present,'price_notes_present',v_result.price_notes is not null,'visibility_notes_present',v_result.visibility_notes is not null,'trusted_ai_flag',v_result.ai_flag,'prior_compliance_status',coalesce(v_package.compliance_status,null),'resulting_compliance_status',v_result.compliance_status,'prior_approval_status',coalesce(v_package.creator_approval_status,null),'resulting_approval_status',v_result.creator_approval_status,'changed_fields',to_jsonb(v_changed),'request_canonical',v_request_canonical,'retry_probe_fingerprint',v_retry_probe_fingerprint,'request_fingerprint',v_fingerprint,'idempotency_key',v_idempotency_key,'timestamp',v_now);
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_content_package',v_result.id,p_creator_id,'creator',v_action,v_before,v_after,v_idempotency_key,v_now);
  return jsonb_build_object('package', to_jsonb(v_result), 'idempotent', false, 'outcome', case v_action when 'creator_publishing_package_created' then 'created' when 'creator_publishing_package_updated' then 'updated' else 'noop' end);
end;
$$;

revoke execute on function public.creator_publishing_save_content_package(uuid, text, uuid, uuid, text, text, boolean, text, text, timestamptz, text) from public;
revoke execute on function public.creator_publishing_save_content_package(uuid, text, uuid, uuid, text, text, boolean, text, text, timestamptz, text) from anon;
revoke execute on function public.creator_publishing_save_content_package(uuid, text, uuid, uuid, text, text, boolean, text, text, timestamptz, text) from authenticated;
grant execute on function public.creator_publishing_save_content_package(uuid, text, uuid, uuid, text, text, boolean, text, text, timestamptz, text) to service_role;

comment on function public.creator_publishing_save_content_package(uuid, text, uuid, uuid, text, text, boolean, text, text, timestamptz, text) is 'Trusted service-role-only Task 10 composer RPC returning JSONB package/idempotent/outcome. Does not insert media rows, compliance-review rows, or queue tasks.';
