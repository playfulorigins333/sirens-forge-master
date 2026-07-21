-- Gate 21C-1: require trusted-verified destination accounts for new publishing state.
-- Forward-only RPC override only; intentionally no historical data mutation.

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
    if ((v_existing_audit.after_state->'request_canonical') - 'target_platform'::text) is distinct from v_retry_probe_canonical
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
  if v_account.verification_status is distinct from 'verified' then raise exception 'DESTINATION_ACCOUNT_NOT_VERIFIED'; end if;

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

create or replace function public.creator_publishing_create_autopost_plan(p_creator_id uuid, p_content_package_ids uuid[], p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := btrim(coalesce(p_idempotency_key,''));
  v_now timestamptz := now();
  v_ids uuid[];
  v_registry_version text;
  v_canonical jsonb;
  v_fingerprint text;
  v_existing public.creator_publishing_plans%rowtype;
  v_plan public.creator_publishing_plans%rowtype;
  v_plan_audit_id bigint;
  v_job_audit_id bigint;
  v_job_audits bigint[] := '{}'::bigint[];
  v_jobs jsonb := '[]'::jsonb;
  r record;
  v_job public.creator_publishing_platform_jobs%rowtype;
  v_count int;
begin
  if p_creator_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select array_agg(distinct x order by x) into v_ids from unnest(coalesce(p_content_package_ids,'{}'::uuid[])) as x;
  if v_ids is null or array_length(v_ids,1)=0 then raise exception 'NO_CONTENT_PACKAGES_SELECTED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_creator_id::text || ':autopost:' || v_key, 0));

  create temp table autopost_locked_capabilities (like public.creator_publishing_platform_capabilities including defaults) on commit drop;
  -- Lock the canonical capability registry release in deterministic platform order so plan and job routing use one transaction-stable version.
  insert into pg_temp.autopost_locked_capabilities
  select * from public.creator_publishing_platform_capabilities order by platform for update;
  if (select count(distinct registry_version) from pg_temp.autopost_locked_capabilities) <> 1 then raise exception 'CAPABILITY_REGISTRY_INCONSISTENT'; end if;
  select registry_version into v_registry_version from pg_temp.autopost_locked_capabilities limit 1;

  create temp table autopost_selected_packages (
    content_package_id uuid not null,
    creator_id uuid not null,
    platform_account_id uuid not null,
    target_platform text not null,
    source_package_updated_at timestamptz not null,
    source_package_fingerprint text,
    publishing_mode text not null,
    registry_version text not null,
    availability_status text not null,
    platform_label text not null,
    account_verification_status text not null
  ) on commit drop;

  -- Deterministically lock authoritative content packages in package-ID order. Trusted composer/media RPCs also lock the package row, so new media association writes are blocked while this transaction captures source facts.
  insert into pg_temp.autopost_selected_packages(content_package_id,creator_id,platform_account_id,target_platform,source_package_updated_at,source_package_fingerprint,publishing_mode,registry_version,availability_status,platform_label,account_verification_status)
  with locked_packages as (
    select p.* from public.creator_publishing_content_packages p where p.id = any(v_ids) order by p.id for update
  )
  select p.id,p.creator_id,p.platform_account_id,p.target_platform,p.updated_at,null,c.publishing_mode,c.registry_version,c.availability_status,c.display_name,a.verification_status
  from locked_packages p
  join public.creator_platform_accounts a on a.id=p.platform_account_id and a.creator_id=p.creator_id and a.platform=p.target_platform
  join pg_temp.autopost_locked_capabilities c on c.platform=p.target_platform
  order by p.id;
  get diagnostics v_count = row_count;
  if v_count <> array_length(v_ids,1) then raise exception 'CONTENT_PACKAGE_NOT_FOUND'; end if;
  if exists(select 1 from pg_temp.autopost_selected_packages where creator_id <> p_creator_id) then raise exception 'CONTENT_PACKAGE_NOT_FOUND'; end if;

  create temp table autopost_locked_destination_accounts (like public.creator_platform_accounts including defaults) on commit drop;
  insert into pg_temp.autopost_locked_destination_accounts
  select a.*
  from public.creator_platform_accounts a
  where a.id in (select platform_account_id from pg_temp.autopost_selected_packages)
  order by a.id for update;

  if exists(
    select 1
    from pg_temp.autopost_selected_packages s
    left join pg_temp.autopost_locked_destination_accounts a on a.id=s.platform_account_id
    where a.id is null
       or a.creator_id <> s.creator_id
       or a.creator_id <> p_creator_id
       or a.platform <> s.target_platform
       or a.verification_status is distinct from s.account_verification_status
  ) then raise exception 'CONTENT_PACKAGE_NOT_FOUND'; end if;

  create temp table autopost_locked_media on commit drop as
  select m.*, (m.ai_generation_metadata ->> 'generation_id') generation_id_text
  from public.creator_publishing_media_assets m
  join pg_temp.autopost_selected_packages s on s.content_package_id=m.content_package_id
  order by m.id for update;

  create temp table autopost_locked_generations (like public.generations including defaults) on commit drop;
  insert into pg_temp.autopost_locked_generations
  select g.*
  from public.generations g
  where g.id in (
    select generation_id_text::uuid
    from pg_temp.autopost_locked_media
    where coalesce(generation_id_text,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  order by g.id for update;

  -- Compute source fingerprints only after package, media, and linked generation rows are locked.
  update pg_temp.autopost_selected_packages s set source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(s.content_package_id);

  v_canonical := jsonb_build_object(
    'creator_id',p_creator_id,
    'content_package_ids',(select jsonb_agg(content_package_id order by content_package_id) from pg_temp.autopost_selected_packages),
    'platform_account_ids',(select jsonb_agg(platform_account_id order by content_package_id) from pg_temp.autopost_selected_packages),
    'target_platforms',(select jsonb_agg(target_platform order by content_package_id) from pg_temp.autopost_selected_packages),
    'source_package_versions',(select jsonb_agg(source_package_updated_at order by content_package_id) from pg_temp.autopost_selected_packages),
    'source_package_fingerprints',(select jsonb_agg(source_package_fingerprint order by content_package_id) from pg_temp.autopost_selected_packages),
    'publishing_modes',(select jsonb_agg(publishing_mode order by content_package_id) from pg_temp.autopost_selected_packages),
    'availability_statuses',(select jsonb_agg(availability_status order by content_package_id) from pg_temp.autopost_selected_packages),
    'registry_versions',(select jsonb_agg(registry_version order by content_package_id) from pg_temp.autopost_selected_packages),
    'registry_version',v_registry_version
  );
  v_fingerprint := encode(extensions.digest(v_canonical::text,'sha256'),'hex');

  select * into v_existing from public.creator_publishing_plans where creator_id=p_creator_id and idempotency_key=v_key for update;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select coalesce(jsonb_agg(to_jsonb(j) || jsonb_build_object('original_job_audit_event_id', j.original_job_audit_event_id::text, 'platform_label', c.display_name) order by j.created_at,j.id),'[]'::jsonb) into v_jobs from public.creator_publishing_platform_jobs j join public.creator_publishing_platform_capabilities c on c.platform=j.target_platform where j.publishing_plan_id=v_existing.id;
    return jsonb_build_object('plan',to_jsonb(v_existing) || jsonb_build_object('original_plan_audit_event_id',v_existing.original_plan_audit_event_id::text,'original_job_audit_event_ids',(select jsonb_agg(x::text order by ord) from unnest(v_existing.original_job_audit_event_ids) with ordinality as t(x,ord))), 'jobs',v_jobs, 'audit_event_ids',jsonb_build_object('plan',v_existing.original_plan_audit_event_id::text,'jobs',(select jsonb_agg(x::text order by ord) from unnest(v_existing.original_job_audit_event_ids) with ordinality as t(x,ord))), 'registry_version',v_existing.registry_version,'idempotent',true);
  end if;

  -- Only genuinely new requests perform business-validation and active-workflow conflict checks, so changed retries return IDEMPOTENCY_CONFLICT first.
  if exists(select 1 from pg_temp.autopost_selected_packages where target_platform='fanvue') then raise exception 'FANVUE_NOT_AVAILABLE'; end if;
  if exists(select 1 from pg_temp.autopost_selected_packages where publishing_mode='disabled' or availability_status <> 'available') then raise exception 'PLATFORM_UNAVAILABLE'; end if;
  if exists(select 1 from pg_temp.autopost_locked_destination_accounts where verification_status = 'revoked') then raise exception 'DESTINATION_ACCOUNT_REVOKED'; end if;
  if exists(select 1 from pg_temp.autopost_locked_destination_accounts where verification_status is distinct from 'verified') then raise exception 'DESTINATION_ACCOUNT_NOT_VERIFIED'; end if;
  if exists(select 1 from pg_temp.autopost_selected_packages group by platform_account_id having count(*) > 1) then raise exception 'DUPLICATE_DESTINATION_ACCOUNT'; end if;

  if exists(
    select 1
    from pg_temp.autopost_selected_packages s
    left join pg_temp.autopost_locked_media m on m.content_package_id=s.content_package_id
    left join pg_temp.autopost_locked_generations g on g.id::text = m.generation_id_text
    left join public.profiles pr on pr.user_id=s.creator_id and pr.id=g.user_id
    group by s.content_package_id
    having count(m.id)=0
      or coalesce(bool_or(m.source <> 'ai_pipeline'), false)
      or coalesce(bool_or(coalesce(m.generation_id_text,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'), false)
      or coalesce(bool_or(g.id is null), false)
      or coalesce(bool_or(g.user_id is null), false)
      or coalesce(bool_or(not (g.user_id = s.creator_id or pr.id is not null)), false)
      or coalesce(bool_or(g.status is distinct from 'completed'), false)
      or coalesce(bool_or(length(btrim(coalesce(g.r2_bucket,''))) = 0), false)
      or coalesce(bool_or(length(btrim(coalesce(g.r2_key,''))) = 0), false)
      or coalesce(bool_or(jsonb_typeof(g.metadata -> 'placeholder') = 'boolean' and g.metadata -> 'placeholder' = 'true'::jsonb), false)
      or coalesce(bool_or(jsonb_typeof(g.metadata -> 'is_placeholder') = 'boolean' and g.metadata -> 'is_placeholder' = 'true'::jsonb), false)
      or coalesce(bool_or(jsonb_typeof(g.metadata -> 'test') = 'boolean' and g.metadata -> 'test' = 'true'::jsonb), false)
      or coalesce(bool_or(jsonb_typeof(g.metadata -> 'is_test') = 'boolean' and g.metadata -> 'is_test' = 'true'::jsonb), false)
      or coalesce(bool_or(jsonb_typeof(g.metadata -> 'unsafe') = 'boolean' and g.metadata -> 'unsafe' = 'true'::jsonb), false)
      or coalesce(bool_or(lower(btrim(coalesce(g.metadata ->> 'safety', g.metadata ->> 'safety_classification', ''))) = 'unsafe'), false)
      or coalesce(bool_or(length(btrim(m.storage_key)) = 0 or length(btrim(m.mime_type)) = 0 or m.sha256 !~* '^[a-f0-9]{64}$'), false)
  ) then raise exception 'GENERATED_MEDIA_PROVENANCE_REQUIRED'; end if;

  if exists(select 1 from pg_temp.autopost_selected_packages s where public.creator_publishing_autopost_source_fingerprint(s.content_package_id) <> s.source_package_fingerprint) then raise exception 'GENERATED_MEDIA_PROVENANCE_REQUIRED'; end if;

  if exists(select 1 from public.creator_publishing_platform_jobs j join pg_temp.autopost_selected_packages s on s.content_package_id=j.content_package_id where j.job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected','archived')) then raise exception 'ACTIVE_PUBLICATION_JOB_CONFLICT'; end if;

  insert into public.creator_publishing_plans(creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at) values(p_creator_id,'draft',v_key,v_fingerprint,v_registry_version,v_now,v_now) returning * into v_plan;
  insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_plan',v_plan.id,p_creator_id,'creator','creator_publishing_plan_created',null,jsonb_build_object('plan_id',v_plan.id,'creator_id',p_creator_id,'status','draft','request_canonical',v_canonical,'request_fingerprint',v_fingerprint,'registry_version',v_registry_version),v_key,v_now) returning id into v_plan_audit_id;
  for r in select * from pg_temp.autopost_selected_packages order by content_package_id loop
    insert into public.creator_publishing_platform_jobs(publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
    values(v_plan.id,p_creator_id,r.content_package_id,r.platform_account_id,r.target_platform,r.publishing_mode,'draft',r.source_package_updated_at,r.source_package_fingerprint,r.registry_version,v_fingerprint,v_now,v_now) returning * into v_job;
    insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_platform_job',v_job.id,p_creator_id,'creator','creator_publishing_platform_job_created',null,jsonb_build_object('job_id',v_job.id,'publishing_plan_id',v_plan.id,'content_package_id',r.content_package_id,'platform_account_id',r.platform_account_id,'target_platform',r.target_platform,'publishing_mode',r.publishing_mode,'job_state','draft','source_package_updated_at',r.source_package_updated_at,'source_package_fingerprint',r.source_package_fingerprint,'registry_version',r.registry_version,'request_fingerprint',v_fingerprint),v_key,v_now) returning id into v_job_audit_id;
    update public.creator_publishing_platform_jobs set original_job_audit_event_id=v_job_audit_id where id=v_job.id returning * into v_job;
    v_job_audits := array_append(v_job_audits,v_job_audit_id);
    v_jobs := v_jobs || (to_jsonb(v_job) || jsonb_build_object('original_job_audit_event_id',v_job.original_job_audit_event_id::text,'platform_label',r.platform_label));
  end loop;
  update public.creator_publishing_plans set original_plan_audit_event_id=v_plan_audit_id, original_job_audit_event_ids=v_job_audits where id=v_plan.id returning * into v_plan;
  return jsonb_build_object('plan',to_jsonb(v_plan) || jsonb_build_object('original_plan_audit_event_id',v_plan.original_plan_audit_event_id::text,'original_job_audit_event_ids',(select jsonb_agg(x::text order by ord) from unnest(v_plan.original_job_audit_event_ids) with ordinality as t(x,ord))), 'jobs',v_jobs, 'audit_event_ids',jsonb_build_object('plan',v_plan.original_plan_audit_event_id::text,'jobs',(select jsonb_agg(x::text order by ord) from unnest(v_plan.original_job_audit_event_ids) with ordinality as t(x,ord))), 'registry_version',v_registry_version,'idempotent',false);
end;
$$;

revoke execute on function public.creator_publishing_create_autopost_plan(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.creator_publishing_create_autopost_plan(uuid, uuid[], text) to service_role;
