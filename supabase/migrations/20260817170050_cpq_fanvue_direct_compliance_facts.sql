-- Fanvue-only trusted compliance facts for direct publishing.
-- This does not schedule, publish, upload, call Fanvue, or modify OAuth credentials.
-- The legacy OnlyFans/Fansly compliance facts RPC remains unchanged.

create or replace function public.creator_publishing_build_fanvue_direct_compliance_facts(
  p_creator_id uuid,
  p_content_package_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.creator_publishing_content_packages%rowtype;
  v_destination public.creator_platform_accounts%rowtype;
  v_oauth public.autopost_accounts%rowtype;
  v_creator_verification public.creator_publishing_creator_verifications%rowtype;
  v_consent public.creator_publishing_ai_twin_consents%rowtype;
  v_media public.creator_publishing_media_assets%rowtype;
  v_generation public.generations%rowtype;
  v_profile_id uuid;
  v_media_count integer;
  v_co_count integer;
  v_co_all boolean;
  v_media_manifest jsonb := '[]'::jsonb;
  v_generation_manifest jsonb := '[]'::jsonb;
  v_content_fingerprint text;
  v_human_lock jsonb;
begin
  select * into v_package
  from public.creator_publishing_content_packages
  where id=p_content_package_id;
  if not found or v_package.creator_id<>p_creator_id or v_package.target_platform<>'fanvue' then
    raise exception 'FANVUE_COMPLIANCE_PACKAGE_NOT_FOUND';
  end if;
  if v_package.creator_approval_status='approved' then raise exception 'FANVUE_COMPLIANCE_PACKAGE_LOCKED'; end if;
  if exists(select 1 from public.creator_publishing_queue_tasks where content_package_id=v_package.id and status<>'archived') then raise exception 'FANVUE_COMPLIANCE_PACKAGE_LOCKED'; end if;
  if exists(select 1 from public.creator_publishing_platform_jobs where content_package_id=v_package.id and job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived','cancelled')) then raise exception 'FANVUE_COMPLIANCE_PACKAGE_LOCKED'; end if;

  select * into v_destination from public.creator_platform_accounts where id=v_package.platform_account_id;
  if not found or v_destination.creator_id<>p_creator_id or v_destination.platform<>'fanvue' or v_destination.oauth_account_id is null then raise exception 'FANVUE_COMPLIANCE_DESTINATION_INVALID'; end if;
  select * into v_oauth from public.autopost_accounts where id=v_destination.oauth_account_id;
  if not found or v_oauth.user_id<>p_creator_id or v_oauth.platform<>'fanvue' or v_oauth.connection_status<>'CONNECTED' or nullif(btrim(coalesce(v_oauth.provider_account_id,'')),'') is null or nullif(btrim(coalesce(v_oauth.encrypted_access_token,'')),'') is null or not (coalesce(v_oauth.scopes,'[]'::jsonb) ? 'write:post') then raise exception 'FANVUE_COMPLIANCE_DESTINATION_INVALID'; end if;

  select * into v_creator_verification from public.creator_publishing_creator_verifications where creator_id=p_creator_id;
  select * into v_consent from public.creator_publishing_ai_twin_consents where creator_id=p_creator_id;

  select count(*) into v_media_count from public.creator_publishing_media_assets where content_package_id=v_package.id;
  if v_media_count>1 then raise exception 'FANVUE_COMPLIANCE_MEDIA_INVALID'; end if;
  if v_media_count=0 then
    if nullif(btrim(coalesce(v_package.caption_body,'')),'') is null then raise exception 'FANVUE_COMPLIANCE_TEXT_REQUIRED'; end if;
  else
    select * into v_media from public.creator_publishing_media_assets where content_package_id=v_package.id;
    if v_media.source<>'ai_pipeline'
       or nullif(btrim(coalesce(v_media.storage_key,'')),'') is null
       or nullif(btrim(coalesce(v_media.mime_type,'')),'') is null
       or coalesce(v_media.sha256,'') !~* '^[a-f0-9]{64}$'
       or coalesce(v_media.ai_generation_metadata->>'generation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or not (v_media.mime_type like 'image/%' or v_media.mime_type like 'video/%') then
      raise exception 'FANVUE_COMPLIANCE_MEDIA_INVALID';
    end if;
    if not (coalesce(v_oauth.scopes,'[]'::jsonb) ?& array['read:media','write:media','write:creator']) then raise exception 'FANVUE_COMPLIANCE_DESTINATION_INVALID'; end if;
    select id into v_profile_id from public.profiles where user_id=p_creator_id limit 1;
    select * into v_generation
    from public.generations
    where id=(v_media.ai_generation_metadata->>'generation_id')::uuid
      and (user_id=p_creator_id or user_id=v_profile_id);
    if not found
       or v_generation.status is distinct from 'completed'
       or nullif(btrim(coalesce(v_generation.r2_bucket,'')),'') is null
       or nullif(btrim(coalesce(v_generation.r2_key,'')),'') is null
       or coalesce(jsonb_typeof(v_generation.metadata->'placeholder')='boolean' and v_generation.metadata->'placeholder'='true'::jsonb,false)
       or coalesce(jsonb_typeof(v_generation.metadata->'is_placeholder')='boolean' and v_generation.metadata->'is_placeholder'='true'::jsonb,false)
       or coalesce(jsonb_typeof(v_generation.metadata->'test')='boolean' and v_generation.metadata->'test'='true'::jsonb,false)
       or coalesce(jsonb_typeof(v_generation.metadata->'is_test')='boolean' and v_generation.metadata->'is_test'='true'::jsonb,false)
       or coalesce(jsonb_typeof(v_generation.metadata->'unsafe')='boolean' and v_generation.metadata->'unsafe'='true'::jsonb,false)
       or lower(btrim(coalesce(v_generation.metadata->>'safety',v_generation.metadata->>'safety_classification','')))='unsafe' then
      raise exception 'FANVUE_COMPLIANCE_GENERATION_INVALID';
    end if;
    v_media_manifest:=jsonb_build_array(jsonb_build_object(
      'id',v_media.id,'storage_key',v_media.storage_key,'mime_type',v_media.mime_type,
      'sha256',lower(v_media.sha256),'source','ai_pipeline','ai_generation_metadata',v_media.ai_generation_metadata
    ));
    v_generation_manifest:=jsonb_build_array(jsonb_build_object(
      'generation_id',v_generation.id,'user_id',v_generation.user_id,'status',v_generation.status,
      'lora_used',v_generation.lora_used,'job_type',v_generation.job_type,'body_type',v_generation.body_type,
      'mode',v_generation.mode,'r2_bucket',v_generation.r2_bucket,'r2_key',v_generation.r2_key,
      'safe_classification_metadata',jsonb_strip_nulls(jsonb_build_object(
        'non_photorealistic',case when jsonb_typeof(v_generation.metadata->'non_photorealistic')='boolean' then v_generation.metadata->'non_photorealistic' end,
        'photorealistic',case when jsonb_typeof(v_generation.metadata->'photorealistic')='boolean' then v_generation.metadata->'photorealistic' end,
        'lifelike',case when jsonb_typeof(v_generation.metadata->'lifelike')='boolean' then v_generation.metadata->'lifelike' end,
        'deepfake',case when jsonb_typeof(v_generation.metadata->'deepfake')='boolean' then v_generation.metadata->'deepfake' end,
        'face_swap',case when jsonb_typeof(v_generation.metadata->'face_swap')='boolean' then v_generation.metadata->'face_swap' end,
        'unauthorized_face_swap',case when jsonb_typeof(v_generation.metadata->'unauthorized_face_swap')='boolean' then v_generation.metadata->'unauthorized_face_swap' end,
        'third_party_likeness',case when jsonb_typeof(v_generation.metadata->'third_party_likeness')='boolean' then v_generation.metadata->'third_party_likeness' end,
        'ai_background_edit',case when jsonb_typeof(v_generation.metadata->'ai_background_edit')='boolean' then v_generation.metadata->'ai_background_edit' end,
        'ai_outfit_edit',case when jsonb_typeof(v_generation.metadata->'ai_outfit_edit')='boolean' then v_generation.metadata->'ai_outfit_edit' end,
        'ai_lighting_edit',case when jsonb_typeof(v_generation.metadata->'ai_lighting_edit')='boolean' then v_generation.metadata->'ai_lighting_edit' end,
        'body_adjacent_edit',case when jsonb_typeof(v_generation.metadata->'body_adjacent_edit')='boolean' then v_generation.metadata->'body_adjacent_edit' end,
        'upscaled',case when jsonb_typeof(v_generation.metadata->'upscaled')='boolean' then v_generation.metadata->'upscaled' end,
        'creator_likeness_drift',case when jsonb_typeof(v_generation.metadata->'creator_likeness_drift')='boolean' then v_generation.metadata->'creator_likeness_drift' end,
        'heavy_alteration',case when jsonb_typeof(v_generation.metadata->'heavy_alteration')='boolean' then v_generation.metadata->'heavy_alteration' end,
        'synthetic_persona',case when jsonb_typeof(v_generation.metadata->'synthetic_persona')='boolean' then v_generation.metadata->'synthetic_persona' end,
        'fictional_persona',case when jsonb_typeof(v_generation.metadata->'fictional_persona')='boolean' then v_generation.metadata->'fictional_persona' end,
        'composite_persona',case when jsonb_typeof(v_generation.metadata->'composite_persona')='boolean' then v_generation.metadata->'composite_persona' end,
        'ai_contribution_more_than_cosmetic',case when jsonb_typeof(v_generation.metadata->'ai_contribution_more_than_cosmetic')='boolean' then v_generation.metadata->'ai_contribution_more_than_cosmetic' end,
        'borderline_lifelike_stylized',case when jsonb_typeof(v_generation.metadata->'borderline_lifelike_stylized')='boolean' then v_generation.metadata->'borderline_lifelike_stylized' end,
        'ambiguous_background_people',case when jsonb_typeof(v_generation.metadata->'ambiguous_background_people')='boolean' then v_generation.metadata->'ambiguous_background_people' end
      ))
    ));
  end if;

  select count(*),coalesce(bool_and(platform_release_confirmed),false)
  into v_co_count,v_co_all
  from public.creator_publishing_co_performer_records
  where content_package_id=v_package.id;

  v_content_fingerprint:=encode(extensions.digest(jsonb_build_object(
    'platform_account_id',v_package.platform_account_id,'target_platform','fanvue','title',v_package.title,
    'caption_body',v_package.caption_body,'second_person_present',v_package.second_person_present,
    'media_manifest',v_media_manifest
  )::text,'sha256'),'hex');
  select jsonb_build_object('locked',true,'reason','COMPLIANCE_HUMAN_REVIEW_LOCKED','latest_review_id',r.id,'latest_review_outcome',r.outcome,'latest_review_created_at',r.created_at,'content_fingerprint',v_content_fingerprint)
  into v_human_lock
  from public.creator_publishing_compliance_reviews r
  where r.content_package_id=v_package.id and r.review_source='human' and r.outcome in ('block','manual_review','escalate')
  order by r.created_at desc,r.id desc limit 1;
  v_human_lock:=coalesce(v_human_lock,jsonb_build_object('locked',false,'reason',null,'latest_review_id',null,'latest_review_outcome',null,'latest_review_created_at',null,'content_fingerprint',v_content_fingerprint));

  return jsonb_build_object(
    'schema_version','creator-publishing-fanvue-direct-compliance-facts-v1',
    'package',jsonb_build_object('id',v_package.id,'creator_id',v_package.creator_id,'platform_account_id',v_package.platform_account_id,'target_platform','fanvue','title',v_package.title,'caption_body',coalesce(v_package.caption_body,''),'second_person_present',v_package.second_person_present,'creator_approval_status',v_package.creator_approval_status,'compliance_status',v_package.compliance_status,'compliance_policy_version',v_package.compliance_policy_version,'updated_at',v_package.updated_at),
    'platform_account',jsonb_build_object('id',v_destination.id,'creator_id',v_destination.creator_id,'platform','fanvue','verification_status',v_destination.verification_status,'oauth_account_id',v_destination.oauth_account_id),
    'creator_verification',jsonb_build_object('status',coalesce(v_creator_verification.status,'unverified'),'updated_at',v_creator_verification.updated_at),
    'ai_twin_consent',jsonb_build_object('status',coalesce(v_consent.status,'missing'),'attestation_version',v_consent.attestation_version,'attestation_text_sha256',v_consent.attestation_text_sha256,'granted_at',v_consent.granted_at,'revoked_at',v_consent.revoked_at,'updated_at',v_consent.updated_at),
    'media_manifest',v_media_manifest,'generation_manifest',v_generation_manifest,
    'co_performer_summary',jsonb_build_object('record_count',v_co_count,'all_platform_release_confirmed',v_co_all),
    'active_queue_task',false,'oauth_destination_verified',true,'human_review_lock',v_human_lock
  );
end;
$$;

create or replace function public.creator_publishing_load_fanvue_direct_compliance_facts(
  p_creator_id uuid,
  p_content_package_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_facts jsonb;
begin
  v_facts:=public.creator_publishing_build_fanvue_direct_compliance_facts(p_creator_id,p_content_package_id);
  if coalesce((v_facts->'human_review_lock'->>'locked')::boolean,false) then raise exception 'FANVUE_COMPLIANCE_HUMAN_REVIEW_LOCKED'; end if;
  return jsonb_build_object(
    'facts',v_facts,
    'facts_fingerprint',encode(extensions.digest(v_facts::text,'sha256'),'hex'),
    'media_manifest_hash',encode(extensions.digest((v_facts->'media_manifest')::text,'sha256'),'hex')
  );
end;
$$;

revoke all on function public.creator_publishing_build_fanvue_direct_compliance_facts(uuid,uuid) from PUBLIC;
revoke execute on function public.creator_publishing_build_fanvue_direct_compliance_facts(uuid,uuid) from anon,authenticated;
grant execute on function public.creator_publishing_build_fanvue_direct_compliance_facts(uuid,uuid) to service_role;
revoke all on function public.creator_publishing_load_fanvue_direct_compliance_facts(uuid,uuid) from PUBLIC;
revoke execute on function public.creator_publishing_load_fanvue_direct_compliance_facts(uuid,uuid) from anon,authenticated;
grant execute on function public.creator_publishing_load_fanvue_direct_compliance_facts(uuid,uuid) to service_role;
