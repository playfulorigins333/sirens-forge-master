-- Creator Publishing Queue Task 5: creator approval and OnlyFans manual-handoff queue creation.
-- No platform posting, browser automation, credentials, cookies, sessions, or Fanvue routing.

alter table public.creator_publishing_queue_tasks
  add column if not exists creator_id uuid references auth.users(id) on delete cascade,
  add column if not exists target_platform text check (target_platform in ('onlyfans','fansly','fanvue')),
  add column if not exists platform_account_id uuid;

update public.creator_publishing_queue_tasks q
set creator_id = p.creator_id,
    target_platform = p.target_platform,
    platform_account_id = p.platform_account_id
from public.creator_publishing_content_packages p
where q.content_package_id = p.id
  and (q.creator_id is null or q.target_platform is null or q.platform_account_id is null);

create unique index if not exists creator_publishing_queue_one_task_per_package_platform_uidx
  on public.creator_publishing_queue_tasks(content_package_id, target_platform)
  where target_platform is not null and status <> 'archived';

create unique index if not exists creator_publishing_audit_creator_approval_idempotency_uidx
  on public.creator_publishing_audit_events(entity_type, entity_id, action, idempotency_key)
  where idempotency_key is not null and action in ('creator_publishing_creator_approved','creator_publishing_creator_rejected');

create or replace function public.creator_publishing_apply_creator_approval_decision(
  p_content_package_id uuid,
  p_creator_id uuid,
  p_decision text,
  p_expected_compliance_status text,
  p_expected_policy_version text,
  p_expected_package_updated_at timestamptz,
  p_snapshot_hash text,
  p_client_snapshot_hash text default null,
  p_idempotency_key text default null,
  p_rejection_reason text default null,
  p_creator_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_package public.creator_publishing_content_packages%rowtype;
  v_existing_audit public.creator_publishing_audit_events%rowtype;
  v_existing_task public.creator_publishing_queue_tasks%rowtype;
  v_queue_task_id uuid;
  v_queue_task_status text;
  v_audit_id bigint;
  v_now timestamptz := clock_timestamp();
  v_before jsonb;
  v_after jsonb;
  v_queue_allowed boolean := false;
  v_media_count integer := 0;
  v_latest_block public.creator_publishing_compliance_reviews%rowtype;
begin
  if p_decision not in ('approve','reject') then raise exception 'APPROVAL_INVALID_DECISION'; end if;
  if p_creator_id is null then raise exception 'APPROVAL_UNAUTHORIZED'; end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) = 0 then raise exception 'APPROVAL_DUPLICATE'; end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_rejection_reason, ''))) = 0 then raise exception 'APPROVAL_REJECTION_REASON_REQUIRED'; end if;
  if p_client_snapshot_hash is not null and p_client_snapshot_hash <> p_snapshot_hash then raise exception 'APPROVAL_STALE_PACKAGE'; end if;

  select * into v_existing_audit
  from public.creator_publishing_audit_events
  where entity_type = 'creator_publishing_content_package'
    and entity_id = p_content_package_id
    and idempotency_key = p_idempotency_key
    and action in ('creator_publishing_creator_approved','creator_publishing_creator_rejected')
  limit 1;
  if found then raise exception 'APPROVAL_DUPLICATE'; end if;

  select * into v_package from public.creator_publishing_content_packages where id = p_content_package_id for update;
  if not found then raise exception 'APPROVAL_PACKAGE_NOT_FOUND'; end if;
  if v_package.creator_id <> p_creator_id then raise exception 'APPROVAL_CREATOR_MISMATCH'; end if;
  if v_package.target_platform = 'fanvue' then raise exception 'APPROVAL_FANVUE_NOT_SUPPORTED'; end if;
  if v_package.creator_approval_status <> 'pending' then raise exception 'APPROVAL_ALREADY_DECIDED'; end if;
  if v_package.updated_at <> p_expected_package_updated_at then raise exception 'APPROVAL_STALE_PACKAGE'; end if;

  if p_decision = 'approve' then
    if v_package.compliance_status not in ('passed','escalated_approved') or p_expected_compliance_status <> v_package.compliance_status then raise exception 'APPROVAL_INVALID_COMPLIANCE_STATUS'; end if;
    if v_package.compliance_policy_version is null or v_package.compliance_policy_version = 'unassigned' or v_package.compliance_policy_version <> p_expected_policy_version then raise exception 'APPROVAL_STALE_POLICY_VERSION'; end if;
    if length(btrim(coalesce(v_package.caption_body, ''))) = 0 then raise exception 'APPROVAL_FINAL_CAPTION_MISSING'; end if;
    if v_package.target_platform = 'onlyfans' and length(btrim(coalesce(v_package.forced_disclosure_text, ''))) = 0 then raise exception 'APPROVAL_DISCLOSURE_MISSING'; end if;
    select count(*) into v_media_count from public.creator_publishing_media_assets where content_package_id = p_content_package_id;
    if v_media_count < 1 then raise exception 'APPROVAL_MEDIA_MISSING'; end if;
    select * into v_latest_block from public.creator_publishing_compliance_reviews where content_package_id = p_content_package_id and outcome = 'block' order by created_at desc, id desc limit 1;
    if found then raise exception 'APPROVAL_BLOCKING_REVIEW_EXISTS'; end if;
    select * into v_existing_task from public.creator_publishing_queue_tasks where content_package_id = p_content_package_id and coalesce(target_platform, v_package.target_platform) = v_package.target_platform and status <> 'archived' limit 1;
    if found then raise exception 'APPROVAL_DUPLICATE'; end if;
    v_queue_allowed := v_package.target_platform = 'onlyfans';
  end if;

  v_before := jsonb_build_object('creator_approval_status', v_package.creator_approval_status, 'compliance_status', v_package.compliance_status, 'policy_version', v_package.compliance_policy_version);
  update public.creator_publishing_content_packages
  set creator_approval_status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      creator_approved_by = p_creator_id,
      creator_approved_at = v_now
  where id = p_content_package_id and creator_approval_status = 'pending';
  if not found then raise exception 'APPROVAL_ALREADY_DECIDED'; end if;

  if p_decision = 'approve' and v_queue_allowed then
    v_queue_task_status := case when v_package.scheduled_for is not null then 'scheduled_internally' else 'ready_for_handoff' end;
    insert into public.creator_publishing_queue_tasks(content_package_id, creator_id, target_platform, platform_account_id, status, due_at, created_at, updated_at)
    values (p_content_package_id, p_creator_id, 'onlyfans', v_package.platform_account_id, v_queue_task_status, v_package.scheduled_for, v_now, v_now)
    returning id into v_queue_task_id;
  else
    v_queue_task_status := null;
  end if;

  v_after := v_before || jsonb_build_object('decision', p_decision, 'creator_id', p_creator_id, 'platform', v_package.target_platform, 'policy_version', v_package.compliance_policy_version, 'snapshot_hash', p_snapshot_hash, 'timestamp', v_now, 'queue_task_id', v_queue_task_id, 'idempotency_key', p_idempotency_key, 'rejection_reason', p_rejection_reason, 'creator_notes', p_creator_notes, 'queue_creation_allowed', v_queue_allowed);
  insert into public.creator_publishing_audit_events(entity_type, entity_id, actor_id, actor_role, action, before_state, after_state, idempotency_key, created_at)
  values ('creator_publishing_content_package', p_content_package_id, p_creator_id, 'creator', case when p_decision = 'approve' then 'creator_publishing_creator_approved' else 'creator_publishing_creator_rejected' end, v_before, v_after, p_idempotency_key, v_now)
  returning id into v_audit_id;

  return jsonb_build_object('content_package_id', p_content_package_id, 'creator_id', p_creator_id, 'target_platform', v_package.target_platform, 'decision', p_decision, 'prior_creator_approval_status', 'pending', 'resulting_creator_approval_status', case when p_decision = 'approve' then 'approved' else 'rejected' end, 'compliance_status', v_package.compliance_status, 'policy_version', v_package.compliance_policy_version, 'snapshot_hash', p_snapshot_hash, 'queue_task_created', v_queue_task_id is not null, 'queue_task_id', v_queue_task_id, 'queue_task_status', v_queue_task_status, 'queue_creation_allowed', v_queue_allowed, 'approved_at', case when p_decision = 'approve' then v_now else null end, 'rejected_at', case when p_decision = 'reject' then v_now else null end, 'audit_event_ids', jsonb_build_array(v_audit_id));
end;
$$;

revoke all on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, text, text, text, text) from PUBLIC;
revoke all on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, text, text, text, text) from anon;
revoke all on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, text, text, text, text) from authenticated;
grant execute on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, text, text, text, text) to service_role;

comment on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, text, text, text, text) is 'Atomic creator approval/rejection workflow. Only creates OnlyFans manual-handoff queue tasks after valid creator approval; never posts to platforms and never routes Fanvue.';
comment on index public.creator_publishing_queue_one_task_per_package_platform_uidx is 'Prevents duplicate active/final manual-handoff queue tasks for the same content package and platform.';
