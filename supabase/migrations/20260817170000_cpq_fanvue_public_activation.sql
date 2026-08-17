-- Final Fanvue public activation foundation.
-- This migration does not invoke Fanvue, schedule work, or execute provider calls.
-- It publishes a coherent capability registry release, backfills the existing
-- OAuth-owned CPQ destination without touching credentials, and adds a narrow
-- service-role-only Fanvue draft-plan creator.

-- Publish one coherent registry version across every platform row.
update public.creator_publishing_platform_capabilities
set registry_version = 'task14.20260817.002',
    updated_at = clock_timestamp();

update public.creator_publishing_platform_capabilities
set publishing_mode = 'direct',
    availability_status = 'available',
    connector_can_upload_media = true,
    connector_can_publish_immediately = true,
    connector_can_schedule_directly = false,
    connector_can_fetch_publication_status = false,
    connector_can_fetch_analytics = false,
    human_operator_queue_supported = false,
    human_publishing_required = false,
    safe_label = 'Direct scheduled publishing',
    safe_description = 'Sirens Forge can prepare and publish approved Fanvue text, image, or video packages at the scheduled time through the connected Fanvue account.',
    updated_at = clock_timestamp()
where platform = 'fanvue';

-- Existing Fanvue OAuth connections created before the ownership bridge did not
-- receive creator_platform_accounts rows. Backfill only missing connected rows;
-- credentials/tokens in autopost_accounts are never modified here.
with candidates as (
  select a.id oauth_account_id, a.user_id creator_id, a.provider_username
  from public.autopost_accounts a
  where a.platform = 'fanvue'
    and a.connection_status = 'CONNECTED'
    and nullif(btrim(coalesce(a.provider_account_id,'')),'') is not null
    and not exists (
      select 1 from public.creator_platform_accounts d
      where d.oauth_account_id = a.id
    )
), inserted as (
  insert into public.creator_platform_accounts (
    creator_id, platform, platform_username, profile_url, verification_status,
    verification_attested_at, is_virtual_entity, verification_reviewed_by,
    verification_reviewed_at, verification_evidence_reference,
    verification_reason, verification_legacy_revoked, oauth_account_id
  )
  select creator_id, 'fanvue', nullif(btrim(coalesce(provider_username,'')),''),
         null, 'unattested', null, false, null, null, null, null, false,
         oauth_account_id
  from candidates
  returning id, creator_id, oauth_account_id
)
insert into public.creator_publishing_audit_events (
  entity_type, entity_id, actor_id, actor_role, action, before_state,
  after_state, created_at
)
select 'creator_platform_account', i.id, i.creator_id, 'system',
       'fanvue_oauth_destination_activation_backfill', null,
       jsonb_build_object(
         'creator_id', i.creator_id,
         'platform', 'fanvue',
         'oauth_account_id', i.oauth_account_id,
         'connection_status', 'CONNECTED',
         'credentials_mutated', false
       ), clock_timestamp()
from inserted i;

create or replace function public.creator_publishing_create_fanvue_autopost_plan(
  p_creator_id uuid,
  p_content_package_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := btrim(coalesce(p_idempotency_key,''));
  v_now timestamptz := clock_timestamp();
  v_registry_version text;
  v_package public.creator_publishing_content_packages%rowtype;
  v_destination public.creator_platform_accounts%rowtype;
  v_oauth public.autopost_accounts%rowtype;
  v_capability public.creator_publishing_platform_capabilities%rowtype;
  v_source_fingerprint text;
  v_request jsonb;
  v_request_fingerprint text;
  v_existing public.creator_publishing_plans%rowtype;
  v_plan public.creator_publishing_plans%rowtype;
  v_job public.creator_publishing_platform_jobs%rowtype;
  v_media public.creator_publishing_media_assets%rowtype;
  v_media_count integer;
  v_generation public.generations%rowtype;
  v_profile_id uuid;
  v_publication_type text;
  v_server_key text;
  v_plan_audit_id bigint;
  v_job_audit_id bigint;
begin
  if p_creator_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_content_package_id is null then raise exception 'CONTENT_PACKAGE_NOT_FOUND'; end if;
  if v_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_creator_id::text || ':fanvue-autopost:' || v_key, 0)
  );

  select count(distinct registry_version), min(registry_version)
    into v_media_count, v_registry_version
  from public.creator_publishing_platform_capabilities;
  if v_media_count <> 1 then raise exception 'CAPABILITY_REGISTRY_INCONSISTENT'; end if;

  select * into v_capability
  from public.creator_publishing_platform_capabilities
  where platform='fanvue'
  for update;
  if not found
     or v_capability.registry_version <> v_registry_version
     or v_capability.publishing_mode <> 'direct'
     or v_capability.availability_status <> 'available'
     or v_capability.connector_can_publish_immediately is distinct from true
     or v_capability.human_publishing_required is distinct from false then
    raise exception 'PLATFORM_UNAVAILABLE';
  end if;

  select * into v_package
  from public.creator_publishing_content_packages
  where id=p_content_package_id
  for update;
  if not found or v_package.creator_id <> p_creator_id or v_package.target_platform <> 'fanvue' then
    raise exception 'CONTENT_PACKAGE_NOT_FOUND';
  end if;

  select * into v_destination
  from public.creator_platform_accounts
  where id=v_package.platform_account_id
  for update;
  if not found
     or v_destination.creator_id <> p_creator_id
     or v_destination.platform <> 'fanvue'
     or v_destination.oauth_account_id is null then
    raise exception 'DESTINATION_ACCOUNT_NOT_VERIFIED';
  end if;

  select * into v_oauth
  from public.autopost_accounts
  where id=v_destination.oauth_account_id
  for update;
  if not found
     or v_oauth.user_id <> p_creator_id
     or v_oauth.platform <> 'fanvue'
     or v_oauth.connection_status <> 'CONNECTED'
     or nullif(btrim(coalesce(v_oauth.provider_account_id,'')),'') is null
     or nullif(btrim(coalesce(v_oauth.encrypted_access_token,'')),'') is null then
    raise exception 'DESTINATION_ACCOUNT_NOT_VERIFIED';
  end if;

  if not (coalesce(v_oauth.scopes,'[]'::jsonb) ? 'write:post') then
    raise exception 'FANVUE_PUBLICATION_SCOPE_MISSING';
  end if;

  if exists (
    select 1 from public.creator_publishing_platform_jobs j
    where j.content_package_id=v_package.id
      and j.job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived','cancelled')
  ) then raise exception 'ACTIVE_PUBLICATION_JOB_CONFLICT'; end if;

  select count(*) into v_media_count
  from public.creator_publishing_media_assets
  where content_package_id=v_package.id;
  if v_media_count > 1 then raise exception 'FANVUE_MEDIA_COUNT_INVALID'; end if;

  if v_media_count = 0 then
    if nullif(btrim(coalesce(v_package.caption_body,'')),'') is null then
      raise exception 'FANVUE_TEXT_REQUIRED';
    end if;
    v_publication_type := 'text';
  else
    select * into v_media
    from public.creator_publishing_media_assets
    where content_package_id=v_package.id
    for update;
    if v_media.source <> 'ai_pipeline'
       or nullif(btrim(coalesce(v_media.storage_key,'')),'') is null
       or nullif(btrim(coalesce(v_media.mime_type,'')),'') is null
       or coalesce(v_media.sha256,'') !~* '^[a-f0-9]{64}$'
       or coalesce(v_media.ai_generation_metadata->>'generation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'GENERATED_MEDIA_PROVENANCE_REQUIRED';
    end if;
    select id into v_profile_id from public.profiles where user_id=p_creator_id;
    select * into v_generation
    from public.generations
    where id=(v_media.ai_generation_metadata->>'generation_id')::uuid
      and (user_id=p_creator_id or user_id=v_profile_id)
    for update;
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
      raise exception 'GENERATED_MEDIA_PROVENANCE_REQUIRED';
    end if;
    if v_media.mime_type like 'image/%' then v_publication_type := 'image';
    elsif v_media.mime_type like 'video/%' then v_publication_type := 'video';
    else raise exception 'FANVUE_MEDIA_TYPE_UNSUPPORTED'; end if;
    if not (coalesce(v_oauth.scopes,'[]'::jsonb) ?& array['read:media','write:media','write:creator']) then
      raise exception 'FANVUE_PUBLICATION_SCOPE_MISSING';
    end if;
  end if;

  v_source_fingerprint := public.creator_publishing_autopost_source_fingerprint(v_package.id);
  if nullif(v_source_fingerprint,'') is null then raise exception 'GENERATED_MEDIA_PROVENANCE_REQUIRED'; end if;

  v_request := jsonb_build_object(
    'creator_id',p_creator_id,
    'content_package_id',v_package.id,
    'platform_account_id',v_destination.id,
    'oauth_account_id',v_oauth.id,
    'target_platform','fanvue',
    'publication_type',v_publication_type,
    'source_package_updated_at',v_package.updated_at,
    'source_package_fingerprint',v_source_fingerprint,
    'registry_version',v_registry_version
  );
  v_request_fingerprint := encode(extensions.digest(v_request::text,'sha256'),'hex');

  select * into v_existing
  from public.creator_publishing_plans
  where creator_id=p_creator_id and idempotency_key=v_key
  for update;
  if found then
    if v_existing.request_fingerprint <> v_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select * into v_job from public.creator_publishing_platform_jobs where publishing_plan_id=v_existing.id and target_platform='fanvue';
    if not found then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object(
      'plan',to_jsonb(v_existing) || jsonb_build_object('original_plan_audit_event_id',v_existing.original_plan_audit_event_id::text,'original_job_audit_event_ids',jsonb_build_array(v_job.original_job_audit_event_id::text)),
      'jobs',jsonb_build_array(to_jsonb(v_job) || jsonb_build_object('original_job_audit_event_id',v_job.original_job_audit_event_id::text,'platform_label','Fanvue')),
      'audit_event_ids',jsonb_build_object('plan',v_existing.original_plan_audit_event_id::text,'jobs',jsonb_build_array(v_job.original_job_audit_event_id::text)),
      'registry_version',v_existing.registry_version,
      'idempotent',true
    );
  end if;

  insert into public.creator_publishing_plans(
    creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at
  ) values(
    p_creator_id,'draft',v_key,v_request_fingerprint,v_registry_version,v_now,v_now
  ) returning * into v_plan;

  v_server_key := encode(extensions.digest((p_creator_id::text||':'||v_package.id::text||':'||v_key)::text,'sha256'),'hex');

  insert into public.creator_publishing_platform_jobs(
    publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,
    publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,
    capability_registry_version,original_request_fingerprint,oauth_account_id,
    publication_type,server_idempotency_key,created_at,updated_at
  ) values(
    v_plan.id,p_creator_id,v_package.id,v_destination.id,'fanvue','direct','draft',
    v_package.updated_at,v_source_fingerprint,v_registry_version,v_request_fingerprint,
    v_oauth.id,v_publication_type,v_server_key,v_now,v_now
  ) returning * into v_job;

  insert into public.creator_publishing_audit_events(
    entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,
    idempotency_key,created_at
  ) values(
    'creator_publishing_plan',v_plan.id,p_creator_id,'creator',
    'creator_publishing_plan_created',null,
    jsonb_build_object('plan_id',v_plan.id,'creator_id',p_creator_id,'status','draft','request_canonical',v_request,'request_fingerprint',v_request_fingerprint,'registry_version',v_registry_version),
    v_key,v_now
  ) returning id into v_plan_audit_id;

  insert into public.creator_publishing_audit_events(
    entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,
    idempotency_key,created_at
  ) values(
    'creator_publishing_platform_job',v_job.id,p_creator_id,'creator',
    'creator_publishing_platform_job_created',null,
    jsonb_build_object('job_id',v_job.id,'publishing_plan_id',v_plan.id,'content_package_id',v_package.id,'platform_account_id',v_destination.id,'target_platform','fanvue','publishing_mode','direct','job_state','draft','publication_type',v_publication_type,'registry_version',v_registry_version,'request_fingerprint',v_request_fingerprint),
    v_key,v_now
  ) returning id into v_job_audit_id;

  update public.creator_publishing_platform_jobs
  set original_job_audit_event_id=v_job_audit_id
  where id=v_job.id returning * into v_job;
  update public.creator_publishing_plans
  set original_plan_audit_event_id=v_plan_audit_id,
      original_job_audit_event_ids=array[v_job_audit_id]
  where id=v_plan.id returning * into v_plan;

  return jsonb_build_object(
    'plan',to_jsonb(v_plan) || jsonb_build_object('original_plan_audit_event_id',v_plan.original_plan_audit_event_id::text,'original_job_audit_event_ids',jsonb_build_array(v_job_audit_id::text)),
    'jobs',jsonb_build_array(to_jsonb(v_job) || jsonb_build_object('original_job_audit_event_id',v_job_audit_id::text,'platform_label','Fanvue')),
    'audit_event_ids',jsonb_build_object('plan',v_plan_audit_id::text,'jobs',jsonb_build_array(v_job_audit_id::text)),
    'registry_version',v_registry_version,
    'idempotent',false
  );
end;
$$;

revoke all on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from PUBLIC;
revoke execute on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from anon;
revoke execute on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from authenticated;
grant execute on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) to service_role;
