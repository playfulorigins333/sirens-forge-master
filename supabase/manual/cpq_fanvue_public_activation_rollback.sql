-- Roll back 20260817170000_cpq_fanvue_public_activation.sql.
-- This freezes new Fanvue publishing-plan creation again.
-- The OAuth-backed creator_platform_accounts destination is intentionally kept;
-- deleting it could be destructive once referenced by packages/jobs.

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

revoke all on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from PUBLIC;
revoke execute on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from anon;
revoke execute on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from authenticated;
revoke execute on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from service_role;
drop function if exists public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text);
