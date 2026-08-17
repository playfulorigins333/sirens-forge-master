-- Roll back the Fanvue public activation package.
-- This freezes new Fanvue publishing-plan creation again and removes only the
-- new activation RPC/trigger surface. Existing OAuth destinations, packages,
-- media, reviews, approvals, jobs, attempts, and audit history are preserved.

update public.creator_publishing_platform_capabilities
set registry_version = 'task14.20260711.001',
    updated_at = clock_timestamp();

update public.creator_publishing_platform_capabilities
set publishing_mode = 'disabled',
    availability_status = 'frozen',
    connector_can_upload_media = false,
    connector_can_publish_immediately = false,
    connector_can_schedule_directly = false,
    connector_can_fetch_publication_status = false,
    connector_can_fetch_analytics = false,
    human_operator_queue_supported = false,
    human_publishing_required = false,
    safe_label = 'Unavailable',
    safe_description = 'Fanvue is frozen for this Creator Publishing orchestration backbone and unavailable for new active plans.',
    updated_at = clock_timestamp()
where platform = 'fanvue';

drop trigger if exists trg_creator_publishing_fanvue_job_insert_guard on public.creator_publishing_platform_jobs;

revoke all on function public.creator_publishing_fanvue_job_insert_guard() from PUBLIC;
revoke execute on function public.creator_publishing_fanvue_job_insert_guard() from anon,authenticated,service_role;
drop function if exists public.creator_publishing_fanvue_job_insert_guard();

revoke all on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from PUBLIC;
revoke execute on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from anon,authenticated,service_role;
drop function if exists public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text);

revoke all on function public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text) from PUBLIC;
revoke execute on function public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text) from anon,authenticated,service_role;
drop function if exists public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text);

revoke all on function public.creator_publishing_apply_fanvue_direct_compliance(uuid,uuid,timestamptz,text,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text) from PUBLIC;
revoke execute on function public.creator_publishing_apply_fanvue_direct_compliance(uuid,uuid,timestamptz,text,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text) from anon,authenticated,service_role;
drop function if exists public.creator_publishing_apply_fanvue_direct_compliance(uuid,uuid,timestamptz,text,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text);

revoke all on function public.creator_publishing_load_fanvue_direct_compliance_facts(uuid,uuid) from PUBLIC;
revoke execute on function public.creator_publishing_load_fanvue_direct_compliance_facts(uuid,uuid) from anon,authenticated,service_role;
drop function if exists public.creator_publishing_load_fanvue_direct_compliance_facts(uuid,uuid);

revoke all on function public.creator_publishing_build_fanvue_direct_compliance_facts(uuid,uuid) from PUBLIC;
revoke execute on function public.creator_publishing_build_fanvue_direct_compliance_facts(uuid,uuid) from anon,authenticated,service_role;
drop function if exists public.creator_publishing_build_fanvue_direct_compliance_facts(uuid,uuid);
