-- Phase 8 foundation: centralized retention policy versions, append-only governance
-- audit evidence, durable action receipts, and finite scoped legal holds.
--
-- This migration intentionally does NOT schedule or execute purges and does NOT
-- deliver notifications. Retention execution is added in later Phase 8 work;
-- notification delivery remains Phase 9.

begin;

create table public.retention_policy_versions (
  policy_key text not null,
  policy_version integer not null,
  subject_type text not null,
  retention_duration interval not null,
  purge_mode text not null,
  policy_document_version text not null,
  effective_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (policy_key, policy_version),
  constraint retention_policy_key_check check (policy_key ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  constraint retention_policy_version_check check (policy_version > 0),
  constraint retention_policy_subject_type_check check (subject_type ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  constraint retention_policy_duration_check check (retention_duration >= interval '0 seconds'),
  constraint retention_policy_purge_mode_check check (purge_mode in ('automatic','manual_or_automatic','manual_only')),
  constraint retention_policy_document_version_check check (char_length(policy_document_version) between 3 and 120),
  constraint retention_policy_effective_check check (isfinite(effective_at) and effective_at <= created_at + interval '5 seconds')
);

create index retention_policy_current_lookup_idx
  on public.retention_policy_versions(policy_key, effective_at desc, policy_version desc);

alter table public.retention_policy_versions enable row level security;
alter table public.retention_policy_versions force row level security;
revoke all on table public.retention_policy_versions from public, anon, authenticated, service_role;
grant select on table public.retention_policy_versions to service_role;

create or replace function public.governance_jsonb_has_forbidden_private_key(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  object_key text;
  object_value jsonb;
  array_value jsonb;
begin
  if value is null then return false; end if;
  if jsonb_typeof(value) = 'object' then
    for object_key, object_value in select key, val from jsonb_each(value) as e(key,val) loop
      if lower(object_key) in (
        'password','password_hash','access_token','refresh_token','auth_token','authorization',
        'cookie','cookies','secret','secret_key','api_key','private_key','recovery_code',
        'prompt','caption','caption_body','content','content_body','raw_content','raw_prompt',
        'image_base64','binary','file_bytes','vault_text','system_prompt'
      ) then
        return true;
      end if;
      if public.governance_jsonb_has_forbidden_private_key(object_value) then return true; end if;
    end loop;
    return false;
  end if;
  if jsonb_typeof(value) = 'array' then
    for array_value in select val from jsonb_array_elements(value) as e(val) loop
      if public.governance_jsonb_has_forbidden_private_key(array_value) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;
revoke all on function public.governance_jsonb_has_forbidden_private_key(jsonb) from public, anon, authenticated, service_role;

do $$
begin
  if to_regprocedure('public.governance_reject_immutable_mutation()') is null then
    execute $fn$
      create function public.governance_reject_immutable_mutation()
      returns trigger
      language plpgsql
      set search_path = pg_catalog
      as $body$
      begin
        raise exception 'GOVERNANCE_RECORD_IMMUTABLE';
      end
      $body$
    $fn$;
  end if;
end
$$;
revoke all on function public.governance_reject_immutable_mutation() from public, anon, authenticated, service_role;

-- Phase 8 requires Founder/Admin-only legal holds before Phase 10's broader admin
-- role system exists. Bridge only the current protected sole-Production-admin record;
-- Phase 10 may replace this authority source without Phase 8 guessing a future schema.
create or replace function public.governance_actor_is_founder_admin(p_actor_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p_actor_user_id is not null and exists(
    select 1 from public.account_deletion_protected_subjects s
    where s.auth_user_id=p_actor_user_id and s.reason='sole_production_admin_guard'
  )
$$;
revoke all on function public.governance_actor_is_founder_admin(uuid) from public, anon, authenticated, service_role;

create trigger retention_policy_versions_reject_update_delete
before update or delete on public.retention_policy_versions
for each row execute function public.governance_reject_immutable_mutation();

insert into public.retention_policy_versions(
  policy_key, policy_version, subject_type, retention_duration,
  purge_mode, policy_document_version, effective_at
) values
  ('private_generation_asset_trash',1,'private_generation_asset',interval '30 days','automatic','retention-policy-2026-09-05-r1',statement_timestamp()),
  ('twin_trash',1,'twin',interval '30 days','automatic','retention-policy-2026-09-05-r1',statement_timestamp()),
  ('voluntary_account_deletion',1,'account',interval '60 days','automatic','retention-policy-2026-09-05-r1',statement_timestamp()),
  ('subscription_cancellation',1,'subscription_cancellation',interval '60 days','automatic','retention-policy-2026-09-05-r1',statement_timestamp()),
  ('subscription_delinquency_after_second_miss',1,'subscription_delinquency',interval '60 days','automatic','retention-policy-2026-09-05-r1',statement_timestamp());

create or replace function public.current_retention_policy(
  p_policy_key text,
  p_at timestamptz
) returns table(
  policy_key text,
  policy_version integer,
  subject_type text,
  retention_duration interval,
  purge_mode text,
  policy_document_version text,
  effective_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select p.policy_key,p.policy_version,p.subject_type,p.retention_duration,
         p.purge_mode,p.policy_document_version,p.effective_at
  from public.retention_policy_versions p
  where p.policy_key=p_policy_key and p.effective_at<=p_at
  order by p.effective_at desc, p.policy_version desc
  limit 1
$$;
revoke all on function public.current_retention_policy(text,timestamptz) from public, anon, authenticated;
grant execute on function public.current_retention_policy(text,timestamptz) to service_role;

create table public.governance_audit_events (
  sequence_no bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  -- Deliberately not an FK to auth.users. Audit evidence must survive final Auth
  -- deletion without keeping or resurrecting the deleted Auth row.
  actor_user_id uuid,
  actor_type text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  occurred_at timestamptz not null,
  reason_category text,
  reason text,
  result text not null,
  policy_version text,
  form_version text,
  correlation_id uuid not null,
  request_id text,
  facts jsonb not null default '{}'::jsonb,
  reference_hashes jsonb not null default '{}'::jsonb,
  correction_of uuid references public.governance_audit_events(id) on delete restrict,
  previous_event_hash text,
  event_hash text not null unique,
  created_at timestamptz not null,
  constraint governance_audit_actor_type_check check (actor_type in ('creator','founder_admin','system','service')),
  constraint governance_audit_actor_identity_check check (actor_type in ('system','service') or actor_user_id is not null),
  constraint governance_audit_action_check check (action ~ '^[a-z0-9][a-z0-9_.:-]{2,119}$'),
  constraint governance_audit_target_type_check check (target_type ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  constraint governance_audit_target_id_check check (char_length(target_id) between 1 and 200 and target_id !~ '[[:cntrl:]]'),
  constraint governance_audit_reason_category_check check (reason_category is null or (char_length(reason_category) between 1 and 80 and reason_category !~ '[[:cntrl:]]')),
  constraint governance_audit_reason_check check (reason is null or (char_length(reason) between 1 and 1000 and reason !~ '[[:cntrl:]]')),
  constraint governance_audit_result_check check (char_length(result) between 1 and 80 and result !~ '[[:cntrl:]]'),
  constraint governance_audit_policy_version_check check (policy_version is null or char_length(policy_version) between 1 and 120),
  constraint governance_audit_form_version_check check (form_version is null or char_length(form_version) between 1 and 120),
  constraint governance_audit_request_id_check check (request_id is null or (char_length(request_id) between 1 and 200 and request_id !~ '[[:cntrl:]]')),
  constraint governance_audit_facts_check check (
    jsonb_typeof(facts)='object'
    and octet_length(facts::text) <= 8192
    and not public.governance_jsonb_has_forbidden_private_key(facts)
  ),
  constraint governance_audit_reference_hashes_check check (
    jsonb_typeof(reference_hashes)='object'
    and octet_length(reference_hashes::text) <= 8192
    and not public.governance_jsonb_has_forbidden_private_key(reference_hashes)
  ),
  constraint governance_audit_previous_hash_check check (previous_event_hash is null or previous_event_hash ~ '^[0-9a-f]{64}$'),
  constraint governance_audit_event_hash_check check (event_hash ~ '^[0-9a-f]{64}$'),
  constraint governance_audit_timestamp_check check (occurred_at=created_at)
);

create index governance_audit_target_idx on public.governance_audit_events(target_type,target_id,sequence_no desc);
create index governance_audit_actor_idx on public.governance_audit_events(actor_user_id,sequence_no desc) where actor_user_id is not null;
create index governance_audit_correlation_idx on public.governance_audit_events(correlation_id,sequence_no desc);

alter table public.governance_audit_events enable row level security;
alter table public.governance_audit_events force row level security;
revoke all on table public.governance_audit_events from public, anon, authenticated, service_role;
-- Intentionally no direct service_role SELECT. Phase 8 audit reads must go through
-- a permissioned/audited read contract added with the consuming admin surface.

create trigger governance_audit_events_reject_update_delete
before update or delete on public.governance_audit_events
for each row execute function public.governance_reject_immutable_mutation();

create or replace function public.append_governance_audit_event(
  p_actor_user_id uuid,
  p_actor_type text,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason_category text,
  p_reason text,
  p_result text,
  p_policy_version text,
  p_form_version text,
  p_correlation_id uuid,
  p_request_id text,
  p_facts jsonb,
  p_reference_hashes jsonb,
  p_correction_of uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_now timestamptz := statement_timestamp();
  v_previous_hash text;
  v_event_hash text;
  v_payload jsonb;
begin
  if p_actor_type not in ('creator','founder_admin','system','service') then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_actor_type in ('creator','founder_admin') and p_actor_user_id is null then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_actor_user_id is not null and not exists(select 1 from auth.users where id=p_actor_user_id) then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_actor_type='founder_admin' and not public.governance_actor_is_founder_admin(p_actor_user_id) then raise exception 'GOVERNANCE_AUDIT_ADMIN_REQUIRED'; end if;
  if coalesce(p_action,'') !~ '^[a-z0-9][a-z0-9_.:-]{2,119}$' then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if coalesce(p_target_type,'') !~ '^[a-z0-9][a-z0-9_]{2,79}$' then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if char_length(coalesce(p_target_id,'')) not between 1 and 200 or p_target_id ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if char_length(coalesce(p_result,'')) not between 1 and 80 or p_result ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_correlation_id is null then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_reason_category is not null and (char_length(p_reason_category) not between 1 and 80 or p_reason_category ~ '[[:cntrl:]]') then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_reason is not null and (char_length(p_reason) not between 1 and 1000 or p_reason ~ '[[:cntrl:]]') then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_request_id is not null and (char_length(p_request_id) not between 1 and 200 or p_request_id ~ '[[:cntrl:]]') then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_policy_version is not null and char_length(p_policy_version) not between 1 and 120 then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_form_version is not null and char_length(p_form_version) not between 1 and 120 then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_facts,'{}'::jsonb))<>'object'
     or octet_length(coalesce(p_facts,'{}'::jsonb)::text)>8192
     or public.governance_jsonb_has_forbidden_private_key(coalesce(p_facts,'{}'::jsonb)) then
    raise exception 'GOVERNANCE_AUDIT_PRIVATE_CONTENT_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_reference_hashes,'{}'::jsonb))<>'object'
     or octet_length(coalesce(p_reference_hashes,'{}'::jsonb)::text)>8192
     or public.governance_jsonb_has_forbidden_private_key(coalesce(p_reference_hashes,'{}'::jsonb)) then
    raise exception 'GOVERNANCE_AUDIT_PRIVATE_CONTENT_FORBIDDEN';
  end if;
  if p_correction_of is not null and not exists(select 1 from public.governance_audit_events where id=p_correction_of) then raise exception 'GOVERNANCE_AUDIT_CORRECTION_TARGET_NOT_FOUND'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase8_governance_audit_chain_v1',0));
  select event_hash into v_previous_hash from public.governance_audit_events order by sequence_no desc limit 1;

  v_payload := jsonb_build_object(
    'id',v_id,'actor_user_id',p_actor_user_id,'actor_type',p_actor_type,'action',p_action,
    'target_type',p_target_type,'target_id',p_target_id,'occurred_at',v_now,
    'reason_category',p_reason_category,'reason',p_reason,'result',p_result,
    'policy_version',p_policy_version,'form_version',p_form_version,
    'correlation_id',p_correlation_id,'request_id',p_request_id,
    'facts',coalesce(p_facts,'{}'::jsonb),'reference_hashes',coalesce(p_reference_hashes,'{}'::jsonb),
    'correction_of',p_correction_of,'previous_event_hash',v_previous_hash
  );
  v_event_hash := encode(extensions.digest(coalesce(v_previous_hash,'') || '|' || v_payload::text,'sha256'),'hex');

  insert into public.governance_audit_events(
    id,actor_user_id,actor_type,action,target_type,target_id,occurred_at,
    reason_category,reason,result,policy_version,form_version,correlation_id,
    request_id,facts,reference_hashes,correction_of,previous_event_hash,event_hash,created_at
  ) values (
    v_id,p_actor_user_id,p_actor_type,p_action,p_target_type,p_target_id,v_now,
    p_reason_category,p_reason,p_result,p_policy_version,p_form_version,p_correlation_id,
    p_request_id,coalesce(p_facts,'{}'::jsonb),coalesce(p_reference_hashes,'{}'::jsonb),
    p_correction_of,v_previous_hash,v_event_hash,v_now
  );
  return v_id;
end;
$$;
revoke all on function public.append_governance_audit_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.append_governance_audit_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb,jsonb,uuid) to service_role;

create table public.governance_action_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_type text not null,
  -- UUID evidence intentionally survives final Auth deletion; no auth.users FK.
  actor_user_id uuid not null,
  actor_type text not null,
  subject_user_id uuid not null,
  target_type text not null,
  target_id text not null,
  action text not null,
  decision text not null,
  form_version text not null,
  policy_version text,
  statement_sha256 text not null,
  facts jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  audit_event_id uuid not null unique references public.governance_audit_events(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint governance_receipt_type_check check (receipt_type in (
    'ai_likeness_identity_consent','onlyfans_publishing_1to1_declaration','dataset_doctor_train_anyway',
    'account_deletion','creator_export_choice','material_policy_acceptance','platform_connect',
    'platform_disconnect','admin_private_content_access'
  )),
  constraint governance_receipt_actor_type_check check (actor_type in ('creator','founder_admin')),
  constraint governance_receipt_actor_scope_check check (
    (actor_type='creator' and actor_user_id=subject_user_id and receipt_type<>'admin_private_content_access')
    or (actor_type='founder_admin' and receipt_type='admin_private_content_access')
  ),
  constraint governance_receipt_target_type_check check (target_type ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  constraint governance_receipt_target_id_check check (char_length(target_id) between 1 and 200 and target_id !~ '[[:cntrl:]]'),
  constraint governance_receipt_action_check check (char_length(action) between 1 and 120 and action !~ '[[:cntrl:]]'),
  constraint governance_receipt_decision_check check (char_length(decision) between 1 and 120 and decision !~ '[[:cntrl:]]'),
  constraint governance_receipt_form_version_check check (char_length(form_version) between 1 and 120),
  constraint governance_receipt_policy_version_check check (policy_version is null or char_length(policy_version) between 1 and 120),
  constraint governance_receipt_statement_hash_check check (statement_sha256 ~ '^[0-9a-f]{64}$'),
  constraint governance_receipt_facts_check check (
    jsonb_typeof(facts)='object'
    and octet_length(facts::text)<=8192
    and not public.governance_jsonb_has_forbidden_private_key(facts)
  ),
  constraint governance_receipt_idempotency_check check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint governance_receipt_request_fingerprint_check check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  unique(actor_user_id,receipt_type,idempotency_key)
);

create index governance_action_receipts_subject_idx on public.governance_action_receipts(subject_user_id,created_at desc);
create index governance_action_receipts_target_idx on public.governance_action_receipts(target_type,target_id,created_at desc);

alter table public.governance_action_receipts enable row level security;
alter table public.governance_action_receipts force row level security;
revoke all on table public.governance_action_receipts from public, anon, authenticated, service_role;
grant select on table public.governance_action_receipts to service_role;

create trigger governance_action_receipts_reject_update_delete
before update or delete on public.governance_action_receipts
for each row execute function public.governance_reject_immutable_mutation();

create or replace function public.record_governance_action_receipt(
  p_receipt_type text,
  p_actor_user_id uuid,
  p_actor_type text,
  p_subject_user_id uuid,
  p_target_type text,
  p_target_id text,
  p_action text,
  p_decision text,
  p_form_version text,
  p_policy_version text,
  p_statement_sha256 text,
  p_facts jsonb,
  p_correlation_id uuid,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_existing public.governance_action_receipts%rowtype;
  v_fingerprint text;
  v_audit_id uuid;
  v_id uuid := gen_random_uuid();
begin
  if p_receipt_type not in (
    'ai_likeness_identity_consent','onlyfans_publishing_1to1_declaration','dataset_doctor_train_anyway',
    'account_deletion','creator_export_choice','material_policy_acceptance','platform_connect',
    'platform_disconnect','admin_private_content_access'
  ) then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if p_actor_type not in ('creator','founder_admin') or p_actor_user_id is null or p_subject_user_id is null then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if not exists(select 1 from auth.users where id=p_actor_user_id) or not exists(select 1 from auth.users where id=p_subject_user_id) then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if p_actor_type='creator' and (p_actor_user_id<>p_subject_user_id or p_receipt_type='admin_private_content_access') then raise exception 'GOVERNANCE_RECEIPT_ACTOR_SCOPE_INVALID'; end if;
  if p_actor_type='founder_admin' and (p_receipt_type<>'admin_private_content_access' or not public.governance_actor_is_founder_admin(p_actor_user_id)) then raise exception 'GOVERNANCE_RECEIPT_ADMIN_REQUIRED'; end if;
  if coalesce(p_target_type,'') !~ '^[a-z0-9][a-z0-9_]{2,79}$' then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if char_length(coalesce(p_target_id,'')) not between 1 and 200 or p_target_id ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if char_length(coalesce(p_action,'')) not between 1 and 120 or p_action ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if char_length(coalesce(p_decision,'')) not between 1 and 120 or p_decision ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if char_length(coalesce(p_form_version,'')) not between 1 and 120 then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if p_policy_version is not null and char_length(p_policy_version) not between 1 and 120 then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if coalesce(p_statement_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_facts,'{}'::jsonb))<>'object'
     or octet_length(coalesce(p_facts,'{}'::jsonb)::text)>8192
     or public.governance_jsonb_has_forbidden_private_key(coalesce(p_facts,'{}'::jsonb)) then raise exception 'GOVERNANCE_RECEIPT_PRIVATE_CONTENT_FORBIDDEN'; end if;
  if p_correlation_id is null or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'GOVERNANCE_RECEIPT_INVALID'; end if;

  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'receipt_type',p_receipt_type,'actor_user_id',p_actor_user_id,'actor_type',p_actor_type,
    'subject_user_id',p_subject_user_id,'target_type',p_target_type,'target_id',p_target_id,
    'action',p_action,'decision',p_decision,'form_version',p_form_version,
    'policy_version',p_policy_version,'statement_sha256',p_statement_sha256,
    'facts',coalesce(p_facts,'{}'::jsonb),'correlation_id',p_correlation_id
  )::text,'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase8_governance_receipt:' || p_actor_user_id::text || ':' || p_receipt_type || ':' || p_idempotency_key,0));
  select * into v_existing from public.governance_action_receipts
  where actor_user_id=p_actor_user_id and receipt_type=p_receipt_type and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then raise exception 'GOVERNANCE_RECEIPT_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.id;
  end if;

  v_audit_id := public.append_governance_audit_event(
    p_actor_user_id,p_actor_type,'action_receipt_recorded',p_target_type,p_target_id,
    'consent_action_receipt',null,'recorded',p_policy_version,p_form_version,p_correlation_id,null,
    jsonb_build_object('receipt_type',p_receipt_type,'action',p_action,'decision',p_decision),
    jsonb_build_object('statement_sha256',p_statement_sha256),null
  );

  insert into public.governance_action_receipts(
    id,receipt_type,actor_user_id,actor_type,subject_user_id,target_type,target_id,
    action,decision,form_version,policy_version,statement_sha256,facts,correlation_id,
    idempotency_key,request_fingerprint,audit_event_id
  ) values (
    v_id,p_receipt_type,p_actor_user_id,p_actor_type,p_subject_user_id,p_target_type,p_target_id,
    p_action,p_decision,p_form_version,p_policy_version,p_statement_sha256,coalesce(p_facts,'{}'::jsonb),
    p_correlation_id,p_idempotency_key,v_fingerprint,v_audit_id
  );
  return v_id;
end;
$$;
revoke all on function public.record_governance_action_receipt(text,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.record_governance_action_receipt(text,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,uuid,text) to service_role;

create table public.governance_legal_holds (
  id uuid primary key default gen_random_uuid(),
  -- Actor UUIDs are retained evidence, not FKs that would block later Auth deletion.
  actor_user_id uuid not null,
  category text not null,
  reason text not null,
  case_reference text,
  status text not null default 'active',
  opened_at timestamptz not null,
  review_due_at timestamptz not null,
  expires_at timestamptz not null,
  fresh_auth_at timestamptz not null,
  fresh_auth_method text not null,
  policy_version text not null,
  correlation_id uuid not null,
  open_idempotency_key text not null,
  open_request_fingerprint text not null,
  opened_audit_event_id uuid not null unique references public.governance_audit_events(id) on delete restrict,
  released_by uuid,
  released_at timestamptz,
  release_reason text,
  release_fresh_auth_at timestamptz,
  release_idempotency_key text,
  release_request_fingerprint text,
  released_audit_event_id uuid unique references public.governance_audit_events(id) on delete restrict,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint governance_legal_hold_category_check check (char_length(category) between 3 and 80 and category !~ '[[:cntrl:]]'),
  constraint governance_legal_hold_reason_check check (char_length(reason) between 3 and 1000 and reason !~ '[[:cntrl:]]'),
  constraint governance_legal_hold_case_reference_check check (case_reference is null or (char_length(case_reference) between 1 and 200 and case_reference !~ '[[:cntrl:]]')),
  constraint governance_legal_hold_status_check check (status in ('active','released','expired')),
  constraint governance_legal_hold_window_check check (
    isfinite(opened_at) and isfinite(review_due_at) and isfinite(expires_at)
    and review_due_at > opened_at and expires_at >= review_due_at
  ),
  constraint governance_legal_hold_fresh_auth_check check (isfinite(fresh_auth_at) and fresh_auth_method='totp'),
  constraint governance_legal_hold_policy_version_check check (char_length(policy_version) between 3 and 120),
  constraint governance_legal_hold_open_idempotency_check check (open_idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint governance_legal_hold_open_fingerprint_check check (open_request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint governance_legal_hold_release_state_check check (
    (status='released' and released_by is not null and released_at is not null and release_reason is not null
      and release_fresh_auth_at is not null and release_idempotency_key is not null
      and release_request_fingerprint is not null and released_audit_event_id is not null)
    or status<>'released'
  ),
  constraint governance_legal_hold_release_auth_check check (release_fresh_auth_at is null or isfinite(release_fresh_auth_at)),
  constraint governance_legal_hold_release_idempotency_check check (release_idempotency_key is null or release_idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint governance_legal_hold_release_fingerprint_check check (release_request_fingerprint is null or release_request_fingerprint ~ '^[0-9a-f]{64}$'),
  unique(actor_user_id,open_idempotency_key)
);

create unique index governance_legal_hold_release_key_uidx
  on public.governance_legal_holds(released_by,release_idempotency_key)
  where release_idempotency_key is not null;
create index governance_legal_hold_active_review_idx
  on public.governance_legal_holds(review_due_at,expires_at)
  where status='active';

create table public.governance_legal_hold_targets (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references public.governance_legal_holds(id) on delete restrict,
  target_type text not null,
  target_id text not null,
  -- Preserve scoped evidence after a lawful final Auth deletion; no auth.users FK.
  subject_user_id uuid not null,
  preservation_scope text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint governance_legal_hold_target_type_check check (target_type ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  constraint governance_legal_hold_target_id_check check (char_length(target_id) between 1 and 200 and target_id !~ '[[:cntrl:]]'),
  constraint governance_legal_hold_scope_check check (char_length(preservation_scope) between 3 and 200 and preservation_scope !~ '[[:cntrl:]]'),
  unique(hold_id,target_type,target_id,subject_user_id,preservation_scope)
);

create index governance_legal_hold_targets_lookup_idx
  on public.governance_legal_hold_targets(target_type,target_id,subject_user_id);

alter table public.governance_legal_holds enable row level security;
alter table public.governance_legal_holds force row level security;
alter table public.governance_legal_hold_targets enable row level security;
alter table public.governance_legal_hold_targets force row level security;
revoke all on table public.governance_legal_holds, public.governance_legal_hold_targets from public, anon, authenticated, service_role;
grant select on table public.governance_legal_holds, public.governance_legal_hold_targets to service_role;

create trigger governance_legal_hold_targets_reject_update_delete
before update or delete on public.governance_legal_hold_targets
for each row execute function public.governance_reject_immutable_mutation();

create or replace function public.open_governance_legal_hold(
  p_actor_user_id uuid,
  p_category text,
  p_reason text,
  p_case_reference text,
  p_review_due_at timestamptz,
  p_expires_at timestamptz,
  p_fresh_auth_at timestamptz,
  p_fresh_auth_method text,
  p_policy_version text,
  p_targets jsonb,
  p_correlation_id uuid,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_existing public.governance_legal_holds%rowtype;
  v_hold_id uuid := gen_random_uuid();
  v_now timestamptz := statement_timestamp();
  v_fingerprint text;
  v_audit_id uuid;
  v_target jsonb;
  v_target_type text;
  v_target_id text;
  v_subject_user_id uuid;
  v_scope text;
  v_case_hash text;
begin
  if p_actor_user_id is null or not public.governance_actor_is_founder_admin(p_actor_user_id) then raise exception 'GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED'; end if;
  if char_length(coalesce(p_category,'')) not between 3 and 80 or p_category ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;
  if char_length(coalesce(p_reason,'')) not between 3 and 1000 or p_reason ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;
  if p_case_reference is not null and (char_length(p_case_reference) not between 1 and 200 or p_case_reference ~ '[[:cntrl:]]') then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;
  if p_review_due_at is null or p_expires_at is null or not isfinite(p_review_due_at) or not isfinite(p_expires_at)
     or p_review_due_at<=v_now or p_expires_at<p_review_due_at then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;
  if p_fresh_auth_method<>'totp' or p_fresh_auth_at is null or not isfinite(p_fresh_auth_at)
     or p_fresh_auth_at < v_now-interval '10 minutes' or p_fresh_auth_at > v_now+interval '5 seconds' then raise exception 'GOVERNANCE_LEGAL_HOLD_FRESH_AUTH_REQUIRED'; end if;
  if char_length(coalesce(p_policy_version,'')) not between 3 and 120 then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;
  if jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets)<1 or jsonb_array_length(p_targets)>100 then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;
  if p_correlation_id is null or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;

  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'actor_user_id',p_actor_user_id,'category',p_category,'reason',p_reason,'case_reference',p_case_reference,
    'review_due_at',p_review_due_at,'expires_at',p_expires_at,'fresh_auth_at',p_fresh_auth_at,
    'fresh_auth_method',p_fresh_auth_method,'policy_version',p_policy_version,
    'targets',p_targets,'correlation_id',p_correlation_id
  )::text,'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase8_legal_hold_open:' || p_actor_user_id::text || ':' || p_idempotency_key,0));
  select * into v_existing from public.governance_legal_holds
  where actor_user_id=p_actor_user_id and open_idempotency_key=p_idempotency_key;
  if found then
    if v_existing.open_request_fingerprint is distinct from v_fingerprint then raise exception 'GOVERNANCE_LEGAL_HOLD_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.id;
  end if;

  if p_case_reference is not null then v_case_hash := encode(extensions.digest(p_case_reference,'sha256'),'hex'); end if;
  v_audit_id := public.append_governance_audit_event(
    p_actor_user_id,'founder_admin','legal_hold_opened','legal_hold',v_hold_id::text,
    p_category,p_reason,'active',p_policy_version,'legal-hold-open-v1',p_correlation_id,null,
    jsonb_build_object('target_count',jsonb_array_length(p_targets),'review_due_at',p_review_due_at,'expires_at',p_expires_at),
    case when v_case_hash is null then '{}'::jsonb else jsonb_build_object('case_reference_sha256',v_case_hash) end,null
  );

  insert into public.governance_legal_holds(
    id,actor_user_id,category,reason,case_reference,status,opened_at,review_due_at,expires_at,
    fresh_auth_at,fresh_auth_method,policy_version,correlation_id,open_idempotency_key,
    open_request_fingerprint,opened_audit_event_id,created_at,updated_at
  ) values (
    v_hold_id,p_actor_user_id,p_category,p_reason,p_case_reference,'active',v_now,p_review_due_at,p_expires_at,
    p_fresh_auth_at,p_fresh_auth_method,p_policy_version,p_correlation_id,p_idempotency_key,
    v_fingerprint,v_audit_id,v_now,v_now
  );

  for v_target in select value from jsonb_array_elements(p_targets) loop
    if jsonb_typeof(v_target)<>'object' or exists(
      select 1 from jsonb_object_keys(v_target) k
      where k not in ('target_type','target_id','subject_user_id','preservation_scope')
    ) then raise exception 'GOVERNANCE_LEGAL_HOLD_TARGET_INVALID'; end if;
    v_target_type := v_target->>'target_type';
    v_target_id := v_target->>'target_id';
    v_scope := v_target->>'preservation_scope';
    begin v_subject_user_id := (v_target->>'subject_user_id')::uuid;
    exception when others then raise exception 'GOVERNANCE_LEGAL_HOLD_TARGET_INVALID'; end;
    if coalesce(v_target_type,'') !~ '^[a-z0-9][a-z0-9_]{2,79}$'
       or char_length(coalesce(v_target_id,'')) not between 1 and 200 or v_target_id ~ '[[:cntrl:]]'
       or char_length(coalesce(v_scope,'')) not between 3 and 200 or v_scope ~ '[[:cntrl:]]'
       or not exists(select 1 from auth.users where id=v_subject_user_id) then raise exception 'GOVERNANCE_LEGAL_HOLD_TARGET_INVALID'; end if;
    insert into public.governance_legal_hold_targets(hold_id,target_type,target_id,subject_user_id,preservation_scope)
    values(v_hold_id,v_target_type,v_target_id,v_subject_user_id,v_scope);
  end loop;
  return v_hold_id;
end;
$$;
revoke all on function public.open_governance_legal_hold(uuid,text,text,text,timestamptz,timestamptz,timestamptz,text,text,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.open_governance_legal_hold(uuid,text,text,text,timestamptz,timestamptz,timestamptz,text,text,jsonb,uuid,text) to service_role;

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
set search_path = pg_catalog, extensions
as $$
declare
  v_hold public.governance_legal_holds%rowtype;
  v_now timestamptz := statement_timestamp();
  v_fingerprint text;
  v_audit_id uuid;
begin
  if p_hold_id is null or p_actor_user_id is null or not public.governance_actor_is_founder_admin(p_actor_user_id) then raise exception 'GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED'; end if;
  if char_length(coalesce(p_release_reason,'')) not between 3 and 1000 or p_release_reason ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;
  if p_fresh_auth_method<>'totp' or p_fresh_auth_at is null or not isfinite(p_fresh_auth_at)
     or p_fresh_auth_at < v_now-interval '10 minutes' or p_fresh_auth_at > v_now+interval '5 seconds' then raise exception 'GOVERNANCE_LEGAL_HOLD_FRESH_AUTH_REQUIRED'; end if;
  if p_correlation_id is null or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'GOVERNANCE_LEGAL_HOLD_INVALID'; end if;

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
revoke all on function public.release_governance_legal_hold(uuid,uuid,text,timestamptz,text,uuid,text) from public, anon, authenticated;
grant execute on function public.release_governance_legal_hold(uuid,uuid,text,timestamptz,text,uuid,text) to service_role;

create or replace function public.governance_target_has_active_legal_hold(
  p_target_type text,
  p_target_id text,
  p_subject_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists(
    select 1
    from public.governance_legal_hold_targets t
    join public.governance_legal_holds h on h.id=t.hold_id
    where t.target_type=p_target_type and t.target_id=p_target_id and t.subject_user_id=p_subject_user_id
      and h.status='active' and h.expires_at>statement_timestamp()
  )
$$;
revoke all on function public.governance_target_has_active_legal_hold(text,text,uuid) from public, anon, authenticated;
grant execute on function public.governance_target_has_active_legal_hold(text,text,uuid) to service_role;

commit;