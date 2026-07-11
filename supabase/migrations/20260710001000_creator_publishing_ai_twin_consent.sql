create table if not exists public.creator_publishing_ai_twin_consents (
  creator_id uuid primary key references auth.users(id) on delete cascade,
  status text not null,
  attestation_version text not null,
  attestation_text_sha256 text not null,
  granted_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_ai_twin_consents_status_check check (status in ('granted','revoked')),
  constraint creator_publishing_ai_twin_consents_version_check check (btrim(attestation_version) <> ''),
  constraint creator_publishing_ai_twin_consents_hash_check check (attestation_text_sha256 ~ '^[0-9a-f]{64}$'),
  constraint creator_publishing_ai_twin_consents_state_check check ((status = 'granted' and granted_at is not null and revoked_at is null) or (status = 'revoked' and granted_at is not null and revoked_at is not null))
);
drop trigger if exists trg_creator_publishing_ai_twin_consents_updated_at on public.creator_publishing_ai_twin_consents;
create trigger trg_creator_publishing_ai_twin_consents_updated_at before update on public.creator_publishing_ai_twin_consents for each row execute function public.set_updated_at();
alter table public.creator_publishing_ai_twin_consents enable row level security;
drop policy if exists "creator_publishing_ai_twin_consents_select_own" on public.creator_publishing_ai_twin_consents;
create policy "creator_publishing_ai_twin_consents_select_own" on public.creator_publishing_ai_twin_consents for select using (auth.uid() = creator_id);

create unique index if not exists creator_publishing_ai_twin_consent_audit_actor_key_uidx
  on public.creator_publishing_audit_events(actor_id, idempotency_key)
  where action in ('creator_ai_twin_consent_granted','creator_ai_twin_consent_revoked','creator_ai_twin_consent_reattested') and idempotency_key is not null;

create or replace function public.creator_publishing_set_ai_twin_consent(
  p_creator_id uuid,
  p_decision text,
  p_attestation_version text,
  p_attestation_text_sha256 text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := transaction_timestamp();
  v_existing public.creator_publishing_audit_events%rowtype;
  v_row public.creator_publishing_ai_twin_consents%rowtype;
  v_after public.creator_publishing_ai_twin_consents%rowtype;
  v_prior text;
  v_action text;
  v_outcome text;
  v_audit_id bigint;
  v_request_payload jsonb;
  v_request_fingerprint text;
  v_state_payload jsonb;
  v_state_fingerprint text;
  v_stored_updated_at timestamptz;
begin
  if p_creator_id is null then raise exception 'AI_TWIN_CONSENT_INVALID_FORM'; end if;
  if not exists (select 1 from auth.users where id = p_creator_id) then raise exception 'AI_TWIN_CONSENT_INVALID_FORM'; end if;
  if p_decision not in ('grant','revoke') then raise exception 'AI_TWIN_CONSENT_INVALID_FORM'; end if;
  if btrim(coalesce(p_attestation_version,'')) = '' then raise exception 'AI_TWIN_CONSENT_INVALID_FORM'; end if;
  if coalesce(p_attestation_text_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'AI_TWIN_CONSENT_INVALID_FORM'; end if;
  if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'AI_TWIN_CONSENT_INVALID_FORM'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai_twin_consent_key:' || p_creator_id::text || ':' || p_idempotency_key, 0));
  v_request_payload := jsonb_build_object('creator_id',p_creator_id,'decision',p_decision,'attestation_version',p_attestation_version,'attestation_text_sha256',p_attestation_text_sha256,'expected_updated_at',p_expected_updated_at);
  v_request_fingerprint := encode(extensions.digest(v_request_payload::text, 'sha256'), 'hex');
  select * into v_existing from public.creator_publishing_audit_events where actor_id=p_creator_id and idempotency_key=p_idempotency_key and action in ('creator_ai_twin_consent_granted','creator_ai_twin_consent_revoked','creator_ai_twin_consent_reattested') limit 1;
  if found then
    if coalesce(v_existing.after_state->>'request_fingerprint','') !~ '^[0-9a-f]{64}$' then raise exception 'AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT'; end if;
    if (v_existing.after_state->>'request_fingerprint') is distinct from v_request_fingerprint then raise exception 'AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai_twin_consent_subject:' || p_creator_id::text, 0));
    select * into v_row from public.creator_publishing_ai_twin_consents where creator_id=p_creator_id for update;
    if not found then raise exception 'AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT'; end if;
    if coalesce(v_existing.after_state->>'resulting_state_fingerprint','') !~ '^[0-9a-f]{64}$' then raise exception 'AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT'; end if;
    v_state_payload := jsonb_build_object('creator_id',v_row.creator_id,'status',v_row.status,'attestation_version',v_row.attestation_version,'attestation_text_sha256',v_row.attestation_text_sha256,'granted_at',v_row.granted_at,'revoked_at',v_row.revoked_at);
    v_state_fingerprint := encode(extensions.digest(v_state_payload::text, 'sha256'), 'hex');
    begin
      if nullif(v_existing.after_state->>'resulting_updated_at','') is null then raise exception 'bad'; end if;
      v_stored_updated_at := (v_existing.after_state->>'resulting_updated_at')::timestamptz;
    exception when others then raise exception 'AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT'; end;
    if v_state_fingerprint is distinct from v_existing.after_state->>'resulting_state_fingerprint' or v_row.updated_at is distinct from v_stored_updated_at then raise exception 'AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('creator_id',p_creator_id,'prior_status',v_existing.after_state->>'prior_status','resulting_status',v_row.status,'attestation_version',v_row.attestation_version,'attestation_text_sha256',v_row.attestation_text_sha256,'granted_at',v_row.granted_at,'revoked_at',v_row.revoked_at,'updated_at',v_row.updated_at,'idempotent',true,'outcome','idempotent','audit_event_ids',jsonb_build_array(v_existing.id::text));
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai_twin_consent_subject:' || p_creator_id::text, 0));
  select * into v_row from public.creator_publishing_ai_twin_consents where creator_id=p_creator_id for update;
  v_prior := case when found then v_row.status else null end;
  if p_decision='grant' and not exists (select 1 from public.creator_publishing_creator_verifications where creator_id=p_creator_id and status='verified') then raise exception 'AI_TWIN_CONSENT_CREATOR_NOT_VERIFIED'; end if;
  if v_prior is null then
    if p_decision='revoke' then raise exception 'AI_TWIN_CONSENT_NOT_FOUND'; end if;
    if p_expected_updated_at is not null then raise exception 'AI_TWIN_CONSENT_STALE'; end if;
    begin insert into public.creator_publishing_ai_twin_consents(creator_id,status,attestation_version,attestation_text_sha256,granted_at,revoked_at,created_at,updated_at) values (p_creator_id,'granted',p_attestation_version,p_attestation_text_sha256,v_now,null,v_now,v_now); exception when unique_violation then raise exception 'AI_TWIN_CONSENT_STALE'; end;
    v_action := 'creator_ai_twin_consent_granted'; v_outcome := 'granted';
  else
    if v_row.updated_at is distinct from p_expected_updated_at then raise exception 'AI_TWIN_CONSENT_STALE'; end if;
    if p_decision='revoke' then
      if v_row.status='revoked' then raise exception 'AI_TWIN_CONSENT_ALREADY_REVOKED'; end if;
      update public.creator_publishing_ai_twin_consents set status='revoked', revoked_at=v_now where creator_id=p_creator_id;
      v_action := 'creator_ai_twin_consent_revoked'; v_outcome := 'revoked';
    else
      if v_row.status='granted' and v_row.attestation_version=p_attestation_version and v_row.attestation_text_sha256=p_attestation_text_sha256 then raise exception 'AI_TWIN_CONSENT_ALREADY_GRANTED'; end if;
      update public.creator_publishing_ai_twin_consents set status='granted', attestation_version=p_attestation_version, attestation_text_sha256=p_attestation_text_sha256, granted_at=v_now, revoked_at=null where creator_id=p_creator_id;
      v_action := 'creator_ai_twin_consent_reattested'; v_outcome := 'reattested';
    end if;
  end if;
  select * into v_after from public.creator_publishing_ai_twin_consents where creator_id=p_creator_id;
  v_state_payload := jsonb_build_object('creator_id',v_after.creator_id,'status',v_after.status,'attestation_version',v_after.attestation_version,'attestation_text_sha256',v_after.attestation_text_sha256,'granted_at',v_after.granted_at,'revoked_at',v_after.revoked_at);
  v_state_fingerprint := encode(extensions.digest(v_state_payload::text, 'sha256'), 'hex');
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_ai_twin_consent',p_creator_id,p_creator_id,'creator',v_action,jsonb_build_object('prior_status',v_prior),jsonb_build_object('request_fingerprint',v_request_fingerprint,'resulting_state_fingerprint',v_state_fingerprint,'resulting_updated_at',v_after.updated_at,'prior_status',v_prior,'resulting_status',v_after.status,'attestation_version',v_after.attestation_version,'attestation_text_sha256',v_after.attestation_text_sha256,'granted_at',v_after.granted_at,'revoked_at',v_after.revoked_at),p_idempotency_key,v_now) returning id into v_audit_id;
  return jsonb_build_object('creator_id',p_creator_id,'prior_status',v_prior,'resulting_status',v_after.status,'attestation_version',v_after.attestation_version,'attestation_text_sha256',v_after.attestation_text_sha256,'granted_at',v_after.granted_at,'revoked_at',v_after.revoked_at,'updated_at',v_after.updated_at,'idempotent',false,'outcome',v_outcome,'audit_event_ids',jsonb_build_array(v_audit_id::text));
end;
$$;
revoke execute on function public.creator_publishing_set_ai_twin_consent(uuid,text,text,text,timestamptz,text) from PUBLIC;
revoke execute on function public.creator_publishing_set_ai_twin_consent(uuid,text,text,text,timestamptz,text) from anon;
revoke execute on function public.creator_publishing_set_ai_twin_consent(uuid,text,text,text,timestamptz,text) from authenticated;
grant execute on function public.creator_publishing_set_ai_twin_consent(uuid,text,text,text,timestamptz,text) to service_role;
