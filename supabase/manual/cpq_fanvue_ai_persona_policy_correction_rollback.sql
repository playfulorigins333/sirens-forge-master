-- Fail-closed manual rollback for the Fanvue AI-persona policy correction.
-- The previous consent semantics are known to be wrong, so this rollback does
-- not restore them. It freezes new Fanvue plan/job creation while preserving
-- users, OAuth destinations and tokens, consent records, packages, jobs,
-- attempts, compliance reviews, media, and audit history.
-- This script does not schedule, upload, post, dispatch, or call a provider.

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
    safe_description = 'Fanvue publishing is frozen pending AI-persona policy correction review.',
    updated_at = clock_timestamp()
where platform = 'fanvue';

-- Prevent creation of new Fanvue plans or jobs. Existing persisted records and
-- history remain intact and OAuth credentials are not modified or revoked.
revoke all on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from PUBLIC;
revoke execute on function public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text) from anon,authenticated,service_role;

drop trigger if exists trg_creator_publishing_fanvue_job_insert_guard on public.creator_publishing_platform_jobs;
revoke all on function public.creator_publishing_fanvue_job_insert_guard() from PUBLIC;
revoke execute on function public.creator_publishing_fanvue_job_insert_guard() from anon,authenticated,service_role;
drop function if exists public.creator_publishing_fanvue_job_insert_guard();

-- Approval is also disabled so no package can cross the known-wrong boundary.
revoke all on function public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text) from PUBLIC;
revoke execute on function public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text) from anon,authenticated,service_role;
drop function if exists public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text);
