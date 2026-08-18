-- Correct the Fanvue AI-persona contract without changing registry identity or
-- activating any runtime flag. This migration only corrects capability metadata
-- and replaces existing database trust gates; it cannot schedule, upload, post,
-- dispatch, mutate OAuth credentials, or call a provider.

update public.creator_publishing_platform_capabilities
set platform_requires_ai_disclosure = true,
    platform_blocks_fictional_personas = false,
    updated_at = clock_timestamp()
where platform = 'fanvue';

create or replace function public.creator_publishing_approve_fanvue_direct_package(
  p_creator_id uuid,
  p_content_package_id uuid,
  p_expected_package_updated_at timestamptz,
  p_expected_policy_version text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_package public.creator_publishing_content_packages%rowtype;
  v_destination public.creator_platform_accounts%rowtype;
  v_oauth public.autopost_accounts%rowtype;
  v_consent public.creator_publishing_ai_twin_consents%rowtype;
  v_creator_verification public.creator_publishing_creator_verifications%rowtype;
  v_evidence public.creator_publishing_compliance_reviews%rowtype;
  v_existing public.creator_publishing_audit_events%rowtype;
  v_media_count integer;
  v_audit_id bigint;
begin
  if p_creator_id is null or p_content_package_id is null or p_expected_package_updated_at is null or p_expected_policy_version<>'fanvue-reference-2026-07-10-v1' or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'FANVUE_APPROVAL_INVALID_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fanvue_approval_key:'||p_creator_id::text||':'||p_idempotency_key,0));
  select * into v_existing from public.creator_publishing_audit_events where actor_id=p_creator_id and entity_id=p_content_package_id and idempotency_key=p_idempotency_key and action='fanvue_direct_creator_approved' limit 1;
  if found then
    select * into v_package from public.creator_publishing_content_packages where id=p_content_package_id;
    if not found or v_package.creator_id<>p_creator_id or v_package.creator_approval_status<>'approved' then raise exception 'FANVUE_APPROVAL_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('content_package_id',v_package.id,'creator_id',p_creator_id,'resulting_creator_approval_status','approved','idempotent',true,'updated_at',v_package.updated_at,'audit_event_ids',jsonb_build_array(v_existing.id::text));
  end if;
  select * into v_package from public.creator_publishing_content_packages where id=p_content_package_id for update;
  if not found or v_package.creator_id<>p_creator_id or v_package.target_platform<>'fanvue' or v_package.creator_approval_status<>'pending' or v_package.compliance_status<>'passed' or v_package.compliance_policy_version<>p_expected_policy_version or v_package.updated_at is distinct from p_expected_package_updated_at then raise exception 'FANVUE_APPROVAL_STALE'; end if;
  if exists(select 1 from public.creator_publishing_queue_tasks where content_package_id=v_package.id and status<>'archived') or exists(select 1 from public.creator_publishing_platform_jobs where content_package_id=v_package.id and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived','cancelled')) then raise exception 'FANVUE_APPROVAL_STALE'; end if;
  select * into v_evidence from public.creator_publishing_compliance_reviews where content_package_id=v_package.id and review_source='automated' and outcome='pass' and compliance_policy_version=v_package.compliance_policy_version order by created_at desc,id desc limit 1;
  if not found then raise exception 'FANVUE_APPROVAL_EVIDENCE_REQUIRED'; end if;
  if exists(select 1 from public.creator_publishing_compliance_reviews where content_package_id=v_package.id and outcome in ('block','manual_review') and (created_at>v_evidence.created_at or (created_at=v_evidence.created_at and id>v_evidence.id))) then raise exception 'FANVUE_APPROVAL_BLOCKING_REVIEW_EXISTS'; end if;
  select * into v_destination from public.creator_platform_accounts where id=v_package.platform_account_id for update;
  if not found or v_destination.creator_id<>p_creator_id or v_destination.platform<>'fanvue' or v_destination.oauth_account_id is null then raise exception 'FANVUE_APPROVAL_DESTINATION_INVALID'; end if;
  select * into v_oauth from public.autopost_accounts where id=v_destination.oauth_account_id for update;
  if not found or v_oauth.user_id<>p_creator_id or v_oauth.platform<>'fanvue' or v_oauth.connection_status<>'CONNECTED' or nullif(btrim(coalesce(v_oauth.provider_account_id,'')),'') is null or nullif(btrim(coalesce(v_oauth.encrypted_access_token,'')),'') is null or not (coalesce(v_oauth.scopes,'[]'::jsonb) ? 'write:post') then raise exception 'FANVUE_APPROVAL_DESTINATION_INVALID'; end if;
  select * into v_creator_verification from public.creator_publishing_creator_verifications where creator_id=p_creator_id for update;
  if not found or v_creator_verification.status<>'verified' then raise exception 'FANVUE_APPROVAL_CREATOR_NOT_VERIFIED'; end if;
  select * into v_consent from public.creator_publishing_ai_twin_consents where creator_id=p_creator_id for update;
  if not found or v_consent.status<>'granted' or v_consent.attestation_version<>'creator-ai-content-persona-consent-v2' or v_consent.attestation_text_sha256<>'b6c9ee005f1800b0cf41757592f846a97b4a28843bbee8abe0cb0997a47b760d' or v_consent.revoked_at is not null then raise exception 'FANVUE_APPROVAL_AI_TWIN_CONSENT_REQUIRED'; end if;
  select count(*) into v_media_count from public.creator_publishing_media_assets where content_package_id=v_package.id;
  if v_media_count>1 then raise exception 'FANVUE_APPROVAL_MEDIA_INVALID'; end if;
  if v_media_count=0 and nullif(btrim(coalesce(v_package.caption_body,'')),'') is null then raise exception 'FANVUE_APPROVAL_TEXT_REQUIRED'; end if;
  if v_media_count=1 and not exists(select 1 from public.creator_publishing_media_assets where content_package_id=v_package.id and source='ai_pipeline' and (mime_type like 'image/%' or mime_type like 'video/%')) then raise exception 'FANVUE_APPROVAL_MEDIA_INVALID'; end if;
  update public.creator_publishing_content_packages set creator_approval_status='approved',creator_approved_by=p_creator_id,creator_approved_at=v_now where id=v_package.id returning * into v_package;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at)
  values('creator_publishing_content_package',v_package.id,p_creator_id,'creator','fanvue_direct_creator_approved',jsonb_build_object('creator_approval_status','pending','compliance_status',v_package.compliance_status,'policy_version',v_package.compliance_policy_version),jsonb_build_object('creator_approval_status','approved','creator_id',p_creator_id,'platform','fanvue','policy_version',v_package.compliance_policy_version,'queue_task_created',false,'timestamp',v_now),p_idempotency_key,v_now) returning id into v_audit_id;
  return jsonb_build_object('content_package_id',v_package.id,'creator_id',p_creator_id,'resulting_creator_approval_status','approved','queue_task_created',false,'idempotent',false,'updated_at',v_package.updated_at,'audit_event_ids',jsonb_build_array(v_audit_id::text));
end;
$$;

revoke all on function public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text) from PUBLIC;
revoke execute on function public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text) from anon;
revoke execute on function public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text) from authenticated;
grant execute on function public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text) to service_role;

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
  if not found or v_consent.status<>'granted' or v_consent.revoked_at is not null or v_consent.attestation_version<>'creator-ai-content-persona-consent-v2' or v_consent.attestation_text_sha256<>'b6c9ee005f1800b0cf41757592f846a97b4a28843bbee8abe0cb0997a47b760d' then raise exception 'FANVUE_JOB_TRUST_GATE_FAILED'; end if;
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
