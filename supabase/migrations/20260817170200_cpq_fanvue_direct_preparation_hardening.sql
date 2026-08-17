-- Harden Fanvue direct preparation without changing legacy OnlyFans/Fansly RPCs.
-- No provider calls, scheduling, dispatch, OAuth mutation, or posting occurs here.

create or replace function public.creator_publishing_apply_fanvue_direct_compliance(
  p_creator_id uuid,
  p_content_package_id uuid,
  p_expected_package_updated_at timestamptz,
  p_facts_fingerprint text,
  p_media_manifest_hash text,
  p_policy_version text,
  p_outcome text,
  p_normalized_caption text,
  p_ai_flag text,
  p_ai_detail jsonb,
  p_rule_hits jsonb,
  p_reasons jsonb,
  p_review_requirements jsonb,
  p_evaluator_metadata jsonb,
  p_effective_ai_twin_consent_status text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := transaction_timestamp();
  v_package public.creator_publishing_content_packages%rowtype;
  v_destination public.creator_platform_accounts%rowtype;
  v_oauth public.autopost_accounts%rowtype;
  v_creator_verification public.creator_publishing_creator_verifications%rowtype;
  v_facts jsonb;
  v_has_block boolean;
  v_has_review boolean;
  v_review_id uuid;
  v_audit_id bigint;
  v_request jsonb;
  v_request_fingerprint text;
  v_existing public.creator_publishing_audit_events%rowtype;
  v_stored_updated_at timestamptz;
  v_prior_status text;
begin
  if p_creator_id is null or p_content_package_id is null or p_expected_package_updated_at is null
     or coalesce(p_facts_fingerprint,'') !~ '^[0-9a-f]{64}$'
     or coalesce(p_media_manifest_hash,'') !~ '^[0-9a-f]{64}$'
     or p_policy_version <> 'fanvue-reference-2026-07-10-v1'
     or p_outcome not in ('passed','manual_review','blocked')
     or p_ai_flag not in ('none','ai_generated')
     or jsonb_typeof(p_ai_detail) is distinct from 'object'
     or jsonb_typeof(p_rule_hits) is distinct from 'array'
     or jsonb_typeof(p_reasons) is distinct from 'array'
     or jsonb_typeof(p_review_requirements) is distinct from 'array'
     or jsonb_typeof(p_evaluator_metadata) is distinct from 'object'
     or p_evaluator_metadata->>'evaluator' is distinct from 'creator_publishing_queue_compliance_v1'
     or p_evaluator_metadata->>'policy_mode' is distinct from 'direct_api'
     or jsonb_typeof(p_evaluator_metadata->'queue_enabled') is distinct from 'boolean'
     or (p_evaluator_metadata->>'queue_enabled')::boolean is distinct from false
     or p_effective_ai_twin_consent_status not in ('granted','missing','not_applicable')
     or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$'
     or p_normalized_caption is null or length(p_normalized_caption)>12000
     or public.creator_publishing_queue_jsonb_has_forbidden_credential_key(p_ai_detail)
     or public.creator_publishing_queue_jsonb_has_forbidden_credential_key(p_evaluator_metadata)
  then raise exception 'FANVUE_COMPLIANCE_INVALID_EVALUATION'; end if;
  if jsonb_array_length(p_rule_hits)>200 or jsonb_array_length(p_reasons)>200 or jsonb_array_length(p_review_requirements)>200 then raise exception 'FANVUE_COMPLIANCE_INVALID_EVALUATION'; end if;
  if exists(select 1 from jsonb_array_elements(p_rule_hits) h where jsonb_typeof(h) is distinct from 'object' or h->>'severity' not in ('allow','review','block') or nullif(btrim(coalesce(h->>'rule_id','')),'') is null or public.creator_publishing_queue_jsonb_has_forbidden_credential_key(h)) then raise exception 'FANVUE_COMPLIANCE_INVALID_EVALUATION'; end if;
  select exists(select 1 from jsonb_array_elements(p_rule_hits) h where h->>'severity'='block'), exists(select 1 from jsonb_array_elements(p_rule_hits) h where h->>'severity'='review') into v_has_block,v_has_review;
  if (v_has_block and p_outcome<>'blocked') or (not v_has_block and v_has_review and p_outcome<>'manual_review') or (not v_has_block and not v_has_review and p_outcome<>'passed') then raise exception 'FANVUE_COMPLIANCE_INVALID_EVALUATION'; end if;

  v_request:=jsonb_build_object('creator_id',p_creator_id,'content_package_id',p_content_package_id,'expected_updated_at',p_expected_package_updated_at,'facts_fingerprint',p_facts_fingerprint,'media_manifest_hash',p_media_manifest_hash,'policy_version',p_policy_version,'outcome',p_outcome,'normalized_caption',p_normalized_caption,'ai_flag',p_ai_flag,'ai_detail',p_ai_detail,'rule_hits',p_rule_hits,'reasons',p_reasons,'review_requirements',p_review_requirements,'evaluator_metadata',p_evaluator_metadata,'effective_ai_twin_consent_status',p_effective_ai_twin_consent_status);
  v_request_fingerprint:=encode(extensions.digest(v_request::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fanvue_compliance_key:'||p_creator_id::text||':'||p_idempotency_key,0));

  select * into v_existing from public.creator_publishing_audit_events where actor_id=p_creator_id and idempotency_key=p_idempotency_key and action='fanvue_direct_compliance_evaluated' limit 1;
  if found then
    if v_existing.after_state->>'request_fingerprint' is distinct from v_request_fingerprint then raise exception 'FANVUE_COMPLIANCE_IDEMPOTENCY_CONFLICT'; end if;
    begin v_stored_updated_at:=(v_existing.after_state->>'resulting_updated_at')::timestamptz; exception when others then raise exception 'FANVUE_COMPLIANCE_IDEMPOTENCY_CONFLICT'; end;
    select * into v_package from public.creator_publishing_content_packages where id=p_content_package_id;
    if not found or v_package.creator_id<>p_creator_id or v_package.updated_at is distinct from v_stored_updated_at then raise exception 'FANVUE_COMPLIANCE_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('content_package_id',v_package.id,'creator_id',p_creator_id,'resulting_compliance_status',v_package.compliance_status,'policy_version',v_package.compliance_policy_version,'idempotent',true,'updated_at',v_package.updated_at,'audit_event_ids',jsonb_build_array(v_existing.id::text));
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fanvue_compliance_package:'||p_content_package_id::text,0));
  select * into v_package from public.creator_publishing_content_packages where id=p_content_package_id for update;
  if not found or v_package.creator_id<>p_creator_id or v_package.target_platform<>'fanvue' or v_package.creator_approval_status='approved' or v_package.updated_at is distinct from p_expected_package_updated_at then raise exception 'FANVUE_COMPLIANCE_STALE'; end if;
  if exists(select 1 from public.creator_publishing_queue_tasks where content_package_id=v_package.id and status<>'archived') or exists(select 1 from public.creator_publishing_platform_jobs where content_package_id=v_package.id and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived')) then raise exception 'FANVUE_COMPLIANCE_STALE'; end if;
  if p_normalized_caption is distinct from coalesce(v_package.caption_body,'') then raise exception 'FANVUE_COMPLIANCE_INVALID_EVALUATION'; end if;

  select * into v_destination from public.creator_platform_accounts where id=v_package.platform_account_id for update;
  if not found or v_destination.creator_id<>p_creator_id or v_destination.platform<>'fanvue' or v_destination.oauth_account_id is null then raise exception 'FANVUE_COMPLIANCE_DESTINATION_INVALID'; end if;
  select * into v_oauth from public.autopost_accounts where id=v_destination.oauth_account_id for update;
  if not found or v_oauth.user_id<>p_creator_id or v_oauth.platform<>'fanvue' or v_oauth.connection_status<>'CONNECTED' or nullif(btrim(coalesce(v_oauth.provider_account_id,'')),'') is null or nullif(btrim(coalesce(v_oauth.encrypted_access_token,'')),'') is null then raise exception 'FANVUE_COMPLIANCE_DESTINATION_INVALID'; end if;
  select * into v_creator_verification from public.creator_publishing_creator_verifications where creator_id=p_creator_id for update;
  if not found or v_creator_verification.status<>'verified' then raise exception 'FANVUE_COMPLIANCE_CREATOR_NOT_VERIFIED'; end if;

  v_facts:=public.creator_publishing_build_fanvue_direct_compliance_facts(p_creator_id,p_content_package_id);
  if coalesce((v_facts->'human_review_lock'->>'locked')::boolean,false) then raise exception 'FANVUE_COMPLIANCE_HUMAN_REVIEW_LOCKED'; end if;
  if encode(extensions.digest(v_facts::text,'sha256'),'hex')<>p_facts_fingerprint or encode(extensions.digest((v_facts->'media_manifest')::text,'sha256'),'hex')<>p_media_manifest_hash then raise exception 'FANVUE_COMPLIANCE_STALE'; end if;

  v_prior_status:=v_package.compliance_status;
  update public.creator_publishing_content_packages set compliance_status=p_outcome,compliance_policy_version=p_policy_version,forced_disclosure_text=null,ai_flag=p_ai_flag,ai_detail=p_ai_detail,creator_approval_status='pending',creator_approved_by=null,creator_approved_at=null,updated_at=v_now where id=v_package.id returning * into v_package;
  insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,notes,escalated_approval_reason,rule_hits,compliance_policy_version,created_at,review_metadata)
  values(v_package.id,null,case p_outcome when 'passed' then 'pass' when 'manual_review' then 'manual_review' else 'block' end,'automated',nullif(array_to_string(array(select jsonb_array_elements_text(p_reasons)),E'\n'),''),null,p_rule_hits,p_policy_version,v_now,jsonb_build_object('schema_version','fanvue-direct-compliance-v1','facts_fingerprint',p_facts_fingerprint,'media_manifest_hash',p_media_manifest_hash,'normalized_caption',p_normalized_caption,'reasons',p_reasons,'review_requirements',p_review_requirements,'evaluator_metadata',p_evaluator_metadata,'effective_ai_twin_consent_status',p_effective_ai_twin_consent_status,'idempotency_key',p_idempotency_key)) returning id into v_review_id;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at)
  values('creator_publishing_content_package',v_package.id,p_creator_id,'creator_publishing_compliance_service','fanvue_direct_compliance_evaluated',jsonb_build_object('compliance_status',v_prior_status),jsonb_build_object('resulting_compliance_status',p_outcome,'policy_version',p_policy_version,'review_record_id',v_review_id,'request_fingerprint',v_request_fingerprint,'facts_fingerprint',p_facts_fingerprint,'media_manifest_hash',p_media_manifest_hash,'resulting_updated_at',v_package.updated_at),p_idempotency_key,v_now) returning id into v_audit_id;
  return jsonb_build_object('content_package_id',v_package.id,'creator_id',p_creator_id,'resulting_compliance_status',v_package.compliance_status,'policy_version',v_package.compliance_policy_version,'idempotent',false,'updated_at',v_package.updated_at,'audit_event_ids',jsonb_build_array(v_audit_id::text));
end;
$$;

revoke all on function public.creator_publishing_apply_fanvue_direct_compliance(uuid,uuid,timestamptz,text,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text) from PUBLIC;
revoke execute on function public.creator_publishing_apply_fanvue_direct_compliance(uuid,uuid,timestamptz,text,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text) from anon,authenticated;
grant execute on function public.creator_publishing_apply_fanvue_direct_compliance(uuid,uuid,timestamptz,text,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text) to service_role;

create or replace function public.creator_publishing_fanvue_job_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.creator_publishing_content_packages%rowtype;
  v_destination public.creator_platform_accounts%rowtype;
  v_oauth public.autopost_accounts%rowtype;
  v_verification public.creator_publishing_creator_verifications%rowtype;
  v_consent public.creator_publishing_ai_twin_consents%rowtype;
begin
  if new.target_platform<>'fanvue' then return new; end if;
  if new.publishing_mode<>'direct' or new.oauth_account_id is null or new.publication_type not in ('text','image','video') or nullif(btrim(coalesce(new.server_idempotency_key,'')),'') is null then raise exception 'FANVUE_JOB_TRUST_GATE_FAILED'; end if;
  select * into v_package from public.creator_publishing_content_packages where id=new.content_package_id;
  if not found or v_package.creator_id<>new.creator_id or v_package.platform_account_id<>new.platform_account_id or v_package.target_platform<>'fanvue' or v_package.creator_approval_status<>'approved' or v_package.creator_approved_at is null or v_package.compliance_status<>'passed' or v_package.compliance_policy_version<>'fanvue-reference-2026-07-10-v1' then raise exception 'FANVUE_JOB_TRUST_GATE_FAILED'; end if;
  if not exists(select 1 from public.creator_publishing_compliance_reviews r where r.content_package_id=v_package.id and r.review_source='automated' and r.outcome='pass' and r.compliance_policy_version=v_package.compliance_policy_version) then raise exception 'FANVUE_JOB_TRUST_GATE_FAILED'; end if;
  select * into v_destination from public.creator_platform_accounts where id=new.platform_account_id;
  if not found or v_destination.creator_id<>new.creator_id or v_destination.platform<>'fanvue' or v_destination.oauth_account_id<>new.oauth_account_id then raise exception 'FANVUE_JOB_TRUST_GATE_FAILED'; end if;
  select * into v_oauth from public.autopost_accounts where id=new.oauth_account_id;
  if not found or v_oauth.user_id<>new.creator_id or v_oauth.platform<>'fanvue' or v_oauth.connection_status<>'CONNECTED' or nullif(btrim(coalesce(v_oauth.provider_account_id,'')),'') is null or not (coalesce(v_oauth.scopes,'[]'::jsonb) ? 'write:post') then raise exception 'FANVUE_JOB_TRUST_GATE_FAILED'; end if;
  select * into v_verification from public.creator_publishing_creator_verifications where creator_id=new.creator_id;
  if not found or v_verification.status<>'verified' then raise exception 'FANVUE_JOB_TRUST_GATE_FAILED'; end if;
  select * into v_consent from public.creator_publishing_ai_twin_consents where creator_id=new.creator_id;
  if not found or v_consent.status<>'granted' or v_consent.revoked_at is not null or v_consent.attestation_version<>'creator-ai-twin-consent-v1' or v_consent.attestation_text_sha256<>'0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12' then raise exception 'FANVUE_JOB_TRUST_GATE_FAILED'; end if;
  return new;
end;
$$;

drop trigger if exists trg_creator_publishing_fanvue_job_insert_guard on public.creator_publishing_platform_jobs;
create trigger trg_creator_publishing_fanvue_job_insert_guard
before insert on public.creator_publishing_platform_jobs
for each row execute function public.creator_publishing_fanvue_job_insert_guard();

revoke all on function public.creator_publishing_fanvue_job_insert_guard() from PUBLIC;
revoke execute on function public.creator_publishing_fanvue_job_insert_guard() from anon,authenticated;
grant execute on function public.creator_publishing_fanvue_job_insert_guard() to service_role;
