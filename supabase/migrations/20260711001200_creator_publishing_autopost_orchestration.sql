-- Task 14: Creator Publishing Autopost Orchestration and capability registry.
-- Forward-only additive migration. It does not modify migrations 00100-01100,
-- does not create queue tasks, and does not touch Fanvue production posting.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.creator_publishing_platform_capabilities (
  platform text primary key,
  registry_version text not null,
  display_name text not null,
  publishing_mode text not null check (publishing_mode in ('direct','assisted','planner','disabled')),
  availability_status text not null check (availability_status in ('available','unassigned','disabled','frozen')),
  platform_supports_ppv boolean not null,
  platform_supports_visibility_controls boolean not null,
  platform_supports_native_scheduling boolean not null,
  platform_supports_drafts boolean not null,
  platform_requires_ai_disclosure boolean not null,
  platform_requires_creator_verification boolean not null,
  platform_requires_consent_records boolean not null,
  platform_blocks_fictional_personas boolean not null,
  connector_can_upload_media boolean not null,
  connector_can_publish_immediately boolean not null,
  connector_can_schedule_directly boolean not null,
  connector_can_fetch_publication_status boolean not null,
  connector_can_fetch_analytics boolean not null,
  human_operator_queue_supported boolean not null,
  human_publishing_required boolean not null,
  safe_label text not null,
  safe_description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_capabilities_mode_availability_consistent check (
    (availability_status = 'available' and publishing_mode <> 'disabled') or
    (availability_status in ('disabled','frozen','unassigned') and publishing_mode = 'disabled')
  ),
  constraint creator_publishing_capabilities_no_direct_human_conflict check (not (connector_can_publish_immediately and human_publishing_required)),
  constraint creator_publishing_capabilities_no_blank_platform check (length(btrim(platform)) > 0)
);
comment on table public.creator_publishing_platform_capabilities is 'Canonical Task 14 server-controlled Creator Publishing capability registry. It stores no credentials, tokens, cookies, sessions, or service-role details. Browser receives only safe read projection.';

insert into public.creator_publishing_platform_capabilities(platform,registry_version,display_name,publishing_mode,availability_status,platform_supports_ppv,platform_supports_visibility_controls,platform_supports_native_scheduling,platform_supports_drafts,platform_requires_ai_disclosure,platform_requires_creator_verification,platform_requires_consent_records,platform_blocks_fictional_personas,connector_can_upload_media,connector_can_publish_immediately,connector_can_schedule_directly,connector_can_fetch_publication_status,connector_can_fetch_analytics,human_operator_queue_supported,human_publishing_required,safe_label,safe_description)
values
('onlyfans','task14.20260711.001','OnlyFans','assisted','available',true,true,true,true,true,true,true,false,false,false,false,false,false,true,true,'Assisted publish required','Assisted publish required: Sirens Forge prepares and schedules the post package. Final publishing is completed manually by you or your authorized agency operator inside OnlyFans.'),
('fansly','task14.20260711.001','Fansly','disabled','unassigned',true,true,true,true,false,true,true,true,false,false,false,false,false,false,false,'Unavailable','Fansly routing is server-configurable but not yet assigned for active Autopost plan creation.'),
('fanvue','task14.20260711.001','Fanvue','disabled','frozen',true,true,true,true,false,true,true,false,false,false,false,false,false,false,false,'Unavailable','Fanvue is frozen for this Creator Publishing orchestration backbone and unavailable for new active plans.'),
('loyalfans','task14.20260711.001','LoyalFans','disabled','unassigned',false,false,false,false,false,true,true,false,false,false,false,false,false,false,false,'Unavailable','This destination is not yet assigned for active Autopost plan creation.'),
('justforfans','task14.20260711.001','JustForFans','disabled','unassigned',false,false,false,false,false,true,true,false,false,false,false,false,false,false,false,'Unavailable','This destination is not yet assigned for active Autopost plan creation.'),
('x','task14.20260711.001','X','disabled','unassigned',false,false,false,false,false,true,true,false,false,false,false,false,false,false,false,'Unavailable','This destination is not yet assigned for active Autopost plan creation.'),
('reddit','task14.20260711.001','Reddit','disabled','unassigned',false,false,false,false,false,true,true,false,false,false,false,false,false,false,false,'Unavailable','This destination is not yet assigned for active Autopost plan creation.')
on conflict (platform) do nothing;

-- Narrow additive composite key used only to enforce Task 14 job/package/account/platform consistency.
alter table public.creator_publishing_content_packages
  add constraint creator_publishing_content_id_creator_account_platform_unique
  unique (id, creator_id, platform_account_id, target_platform);

create table if not exists public.creator_publishing_plans (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','scheduled','in_progress','partially_published','completed','completed_with_failures','cancelled')),
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  registry_version text not null,
  original_plan_audit_event_id bigint,
  original_job_audit_event_ids bigint[] not null default '{}'::bigint[],
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_plans_id_creator_unique unique (id, creator_id),
  constraint creator_publishing_plans_creator_key_unique unique (creator_id, idempotency_key),
  constraint creator_publishing_plans_cancelled_metadata check (status <> 'cancelled' or cancelled_at is not null)
);
comment on table public.creator_publishing_plans is 'Task 14 parent Publishing Plan. New plans begin draft. Trusted service-role RPC only mutates; creators have read-only RLS access.';

create table if not exists public.creator_publishing_platform_jobs (
  id uuid primary key default gen_random_uuid(),
  publishing_plan_id uuid not null,
  creator_id uuid not null,
  content_package_id uuid not null,
  platform_account_id uuid not null,
  target_platform text not null references public.creator_publishing_platform_capabilities(platform) on update restrict on delete restrict,
  publishing_mode text not null check (publishing_mode in ('direct','assisted','planner','disabled')),
  job_state text not null default 'draft' check (job_state in (
    'draft',
    'ready_to_publish','direct_publish_queued','publishing_direct','published_direct','direct_publish_failed','retry_scheduled','authentication_required','platform_rejected',
    'scheduled_internally','awaiting_operator','due_now','claimed','scheduled_on_platform','awaiting_post_confirmation','confirmed_posted_manual','failed_manual_upload','needs_fix','skipped','blocked','archived',
    'package_ready','ready_for_export','exported'
  )),
  source_package_updated_at timestamptz not null,
  source_package_fingerprint text not null check (source_package_fingerprint ~ '^[a-f0-9]{64}$'),
  capability_registry_version text not null,
  original_request_fingerprint text not null check (original_request_fingerprint ~ '^[a-f0-9]{64}$'),
  original_job_audit_event_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_jobs_plan_creator_fk foreign key (publishing_plan_id, creator_id) references public.creator_publishing_plans(id, creator_id) on delete cascade,
  constraint creator_publishing_jobs_package_creator_account_platform_fk foreign key (content_package_id, creator_id, platform_account_id, target_platform) references public.creator_publishing_content_packages(id, creator_id, platform_account_id, target_platform) on delete restrict,
  constraint creator_publishing_jobs_account_creator_platform_fk foreign key (platform_account_id, creator_id, target_platform) references public.creator_platform_accounts(id, creator_id, platform) on delete restrict,
  constraint creator_publishing_jobs_no_fanvue check (target_platform <> 'fanvue'),
  constraint creator_publishing_jobs_no_disabled_active check (publishing_mode <> 'disabled'),
  constraint creator_publishing_jobs_plan_package_unique unique (publishing_plan_id, content_package_id),
  constraint creator_publishing_jobs_plan_account_unique unique (publishing_plan_id, platform_account_id)
);
comment on column public.creator_publishing_platform_jobs.job_state is 'Task 14 only creates draft. Other constrained values are reserved for future Tasks 15-17/Planner aggregation; no Task 14 mutation path transitions into them. Canonical terminal success states are published_direct, confirmed_posted_manual, exported. Canonical terminal failure states are direct_publish_failed, failed_manual_upload, skipped, blocked, platform_rejected.';
comment on column public.creator_publishing_platform_jobs.source_package_fingerprint is 'Server-derived Task 14 source fingerprint over content package ID, package updated_at, destination account, platform, deterministic generated-media manifest, media IDs, storage keys, MIME types, SHA-256 values, trusted generation IDs, and deterministic ordering.';

create unique index if not exists creator_publishing_jobs_active_package_uidx on public.creator_publishing_platform_jobs(content_package_id) where job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected');
create index if not exists creator_publishing_jobs_plan_idx on public.creator_publishing_platform_jobs(publishing_plan_id);
create index if not exists creator_publishing_jobs_creator_idx on public.creator_publishing_platform_jobs(creator_id);

drop trigger if exists trg_creator_publishing_capabilities_updated_at on public.creator_publishing_platform_capabilities;
create trigger trg_creator_publishing_capabilities_updated_at before update on public.creator_publishing_platform_capabilities for each row execute function public.set_updated_at();
drop trigger if exists trg_creator_publishing_plans_updated_at on public.creator_publishing_plans;
create trigger trg_creator_publishing_plans_updated_at before update on public.creator_publishing_plans for each row execute function public.set_updated_at();
drop trigger if exists trg_creator_publishing_jobs_updated_at on public.creator_publishing_platform_jobs;
create trigger trg_creator_publishing_jobs_updated_at before update on public.creator_publishing_platform_jobs for each row execute function public.set_updated_at();

create or replace view public.creator_publishing_platform_capability_public with (security_invoker = true) as
select platform, registry_version, display_name, publishing_mode, availability_status,
       platform_supports_ppv, platform_supports_visibility_controls, platform_supports_native_scheduling, platform_supports_drafts,
       platform_requires_ai_disclosure, platform_requires_creator_verification, platform_requires_consent_records, platform_blocks_fictional_personas,
       connector_can_upload_media, connector_can_publish_immediately, connector_can_schedule_directly, connector_can_fetch_publication_status,
       connector_can_fetch_analytics, human_operator_queue_supported, human_publishing_required, safe_label, safe_description
from public.creator_publishing_platform_capabilities;
comment on view public.creator_publishing_platform_capability_public is 'Safe creator-readable projection of the canonical Task 14 capability registry. It exposes no credentials, tokens, cookies, sessions, or mutable controls.';

create or replace function public.creator_publishing_autopost_source_fingerprint(p_content_package_id uuid)
returns text language sql stable set search_path = public, pg_temp as $$
  select encode(extensions.digest((jsonb_build_object(
    'content_package_id', p.id,
    'package_updated_at', p.updated_at,
    'platform_account_id', p.platform_account_id,
    'target_platform', p.target_platform,
    'media_manifest', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'storage_key', m.storage_key,
        'mime_type', m.mime_type,
        'sha256', lower(m.sha256),
        'source', m.source,
        'generation_id', m.ai_generation_metadata ->> 'generation_id'
      ) order by m.id)
      from public.creator_publishing_media_assets m
      where m.content_package_id = p.id
    ), '[]'::jsonb)
  ))::text, 'sha256'), 'hex')
  from public.creator_publishing_content_packages p
  where p.id = p_content_package_id;
$$;

create or replace function public.creator_publishing_job_source_is_current(p_job_id uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select public.creator_publishing_autopost_source_fingerprint(j.content_package_id) = j.source_package_fingerprint
  from public.creator_publishing_platform_jobs j
  where j.id = p_job_id;
$$;

create or replace function public.creator_publishing_aggregate_plan_status(p_plan_id uuid)
returns text language sql stable set search_path = public, pg_temp as $$
  with jobs as (select job_state from public.creator_publishing_platform_jobs where publishing_plan_id = p_plan_id), counts as (
    select count(*) total,
      count(*) filter (where job_state in ('published_direct','confirmed_posted_manual','exported')) successes,
      count(*) filter (where job_state in ('direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected')) failures,
      count(*) filter (where job_state in ('scheduled_internally','scheduled_on_platform','retry_scheduled')) scheduled,
      count(*) filter (where job_state in ('publishing_direct','direct_publish_queued','awaiting_operator','due_now','claimed','awaiting_post_confirmation','ready_to_publish')) active
    from jobs)
  select case
    when p.status = 'cancelled' then 'cancelled'
    when c.total = 0 then 'draft'
    when c.successes = c.total then 'completed'
    when c.failures = c.total then 'completed_with_failures'
    when c.successes > 0 and c.failures > 0 and c.successes + c.failures = c.total then 'completed_with_failures'
    when c.successes > 0 then 'partially_published'
    when c.active > 0 then 'in_progress'
    when c.scheduled = c.total then 'scheduled'
    else 'draft' end
  from public.creator_publishing_plans p cross join counts c where p.id = p_plan_id;
$$;

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

  if (select count(distinct registry_version) from public.creator_publishing_platform_capabilities) <> 1 then raise exception 'CAPABILITY_REGISTRY_INCONSISTENT'; end if;
  select registry_version into v_registry_version from public.creator_publishing_platform_capabilities limit 1;

  create temp table if not exists pg_temp.autopost_selected_packages as
  select p.id content_package_id,p.creator_id,p.platform_account_id,p.target_platform,p.updated_at source_package_updated_at,public.creator_publishing_autopost_source_fingerprint(p.id) source_package_fingerprint,c.publishing_mode,c.registry_version,c.availability_status,c.display_name platform_label
  from public.creator_publishing_content_packages p join public.creator_publishing_platform_capabilities c on c.platform=p.target_platform where false;
  truncate table pg_temp.autopost_selected_packages;

  -- Deterministically lock authoritative content packages in package-ID order. Trusted composer/media RPCs also lock the package row, so source versions and media associations cannot change unnoticed while this transaction builds the fingerprint and jobs.
  insert into pg_temp.autopost_selected_packages
  with locked_packages as (
    select p.* from public.creator_publishing_content_packages p where p.id = any(v_ids) order by p.id for update
  )
  select p.id,p.creator_id,p.platform_account_id,p.target_platform,p.updated_at,public.creator_publishing_autopost_source_fingerprint(p.id),c.publishing_mode,c.registry_version,c.availability_status,c.display_name
  from locked_packages p
  join public.creator_platform_accounts a on a.id=p.platform_account_id and a.creator_id=p.creator_id and a.platform=p.target_platform
  join public.creator_publishing_platform_capabilities c on c.platform=p.target_platform
  order by p.id;
  get diagnostics v_count = row_count;
  if v_count <> array_length(v_ids,1) then raise exception 'CONTENT_PACKAGE_NOT_FOUND'; end if;
  if exists(select 1 from pg_temp.autopost_selected_packages where creator_id <> p_creator_id) then raise exception 'CONTENT_PACKAGE_NOT_FOUND'; end if;
  if exists(select 1 from pg_temp.autopost_selected_packages where target_platform='fanvue') then raise exception 'FANVUE_NOT_AVAILABLE'; end if;
  if exists(select 1 from pg_temp.autopost_selected_packages where publishing_mode='disabled' or availability_status <> 'available') then raise exception 'PLATFORM_UNAVAILABLE'; end if;
  if exists(select 1 from pg_temp.autopost_selected_packages group by platform_account_id having count(*) > 1) then raise exception 'DUPLICATE_DESTINATION_ACCOUNT'; end if;

  if exists(
    select 1
    from public.creator_publishing_media_assets m
    join pg_temp.autopost_selected_packages s on s.content_package_id=m.content_package_id
    left join public.generations g on g.id::text = m.ai_generation_metadata ->> 'generation_id'
    left join public.profiles pr on pr.user_id=s.creator_id and pr.id=g.user_id
    group by s.content_package_id
    having count(m.id)=0
      or bool_or(m.source <> 'ai_pipeline')
      or bool_or(coalesce(m.ai_generation_metadata ->> 'generation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or bool_or(g.id is null)
      or bool_or(not (g.user_id = s.creator_id or pr.id is not null))
      or bool_or(length(btrim(m.storage_key)) = 0 or length(btrim(m.mime_type)) = 0 or m.sha256 !~* '^[a-f0-9]{64}$')
  ) then raise exception 'GENERATED_MEDIA_PROVENANCE_REQUIRED'; end if;

  v_canonical := jsonb_build_object(
    'creator_id',p_creator_id,
    'content_package_ids',(select jsonb_agg(content_package_id order by content_package_id) from pg_temp.autopost_selected_packages),
    'platform_account_ids',(select jsonb_agg(platform_account_id order by content_package_id) from pg_temp.autopost_selected_packages),
    'target_platforms',(select jsonb_agg(target_platform order by content_package_id) from pg_temp.autopost_selected_packages),
    'source_package_versions',(select jsonb_agg(source_package_updated_at order by content_package_id) from pg_temp.autopost_selected_packages),
    'source_package_fingerprints',(select jsonb_agg(source_package_fingerprint order by content_package_id) from pg_temp.autopost_selected_packages),
    'publishing_modes',(select jsonb_agg(publishing_mode order by content_package_id) from pg_temp.autopost_selected_packages),
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

  -- Only genuinely new requests perform active-workflow conflict checks, so exact idempotent retries are not blocked by their own active draft jobs.
  if exists(select 1 from public.creator_publishing_platform_jobs j join pg_temp.autopost_selected_packages s on s.content_package_id=j.content_package_id where j.job_state not in ('published_direct','confirmed_posted_manual','exported','failed_manual_upload','direct_publish_failed','skipped','blocked','platform_rejected')) then raise exception 'ACTIVE_PUBLICATION_JOB_CONFLICT'; end if;

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

alter table public.creator_publishing_platform_capabilities enable row level security;
alter table public.creator_publishing_plans enable row level security;
alter table public.creator_publishing_platform_jobs enable row level security;
drop policy if exists "creator_publishing_capabilities_safe_select" on public.creator_publishing_platform_capabilities;
create policy "creator_publishing_capabilities_safe_select" on public.creator_publishing_platform_capabilities for select using (auth.role() = 'authenticated');
create policy "creator_publishing_plans_select_own" on public.creator_publishing_plans for select using (auth.uid() = creator_id);
create policy "creator_publishing_jobs_select_own" on public.creator_publishing_platform_jobs for select using (auth.uid() = creator_id);
revoke all on table public.creator_publishing_platform_capabilities from public, anon, authenticated;
revoke all on table public.creator_publishing_platform_capability_public from public, anon;
grant select on public.creator_publishing_platform_capability_public to authenticated;
