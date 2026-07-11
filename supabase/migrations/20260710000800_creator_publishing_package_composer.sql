-- Task 10: Creator Publishing Package Composer.
create extension if not exists pgcrypto with schema extensions;

-- Preserve creator_publishing_content_select_own and remove direct authenticated browser writes.
drop policy if exists "creator_publishing_content_insert_own" on public.creator_publishing_content_packages;
drop policy if exists "creator_publishing_content_update_own" on public.creator_publishing_content_packages;

create unique index if not exists creator_publishing_package_composer_audit_creator_key_uidx
  on public.creator_publishing_audit_events(actor_id, idempotency_key)
  where entity_type = 'creator_publishing_content_package'
    and actor_id is not null
    and idempotency_key is not null
    and action in ('creator_publishing_package_created','creator_publishing_package_updated','creator_publishing_package_noop');

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
  if v_account.verification_status <> 'creator_attested' then raise exception 'PLATFORM_ACCOUNT_ATTESTATION_REQUIRED'; end if;

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
