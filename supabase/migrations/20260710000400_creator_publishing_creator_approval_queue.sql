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

alter table public.creator_publishing_compliance_reviews
  add column if not exists compliance_policy_version text;

-- Forward-only Task 5 redefinition of the already-deployed Task 4 trusted review RPC.
-- This preserves Task 4 behavior while ensuring future human evidence records carry the package policy version.
update public.creator_publishing_compliance_reviews r
set compliance_policy_version = p.compliance_policy_version
from public.creator_publishing_content_packages p
where r.content_package_id = p.id
  and r.compliance_policy_version is null
  and p.compliance_policy_version is not null
  and p.compliance_policy_version <> 'unassigned';

create or replace function public.creator_publishing_apply_manual_review_decision(
  p_content_package_id uuid,
  p_reviewer_id uuid,
  p_decision text,
  p_reason text,
  p_reviewer_notes text,
  p_expected_current_status text,
  p_expected_policy_version text,
  p_rule_hits jsonb default '[]'::jsonb,
  p_review_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_package public.creator_publishing_content_packages%rowtype;
  v_reviewer public.creator_publishing_trusted_reviewers%rowtype;
  v_review_id uuid;
  v_audit_id bigint;
  v_outcome text;
  v_action text;
  v_result_status text;
  v_before jsonb;
  v_after jsonb;
  v_reviewed_at timestamptz := clock_timestamp();
  v_latest_automated public.creator_publishing_compliance_reviews%rowtype;
  v_later_block public.creator_publishing_compliance_reviews%rowtype;
begin
  if p_decision not in ('approve_escalation','reject','block','request_changes') then
    raise exception 'REVIEW_INVALID_DECISION';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'REVIEW_REASON_REQUIRED';
  end if;

  select * into v_reviewer from public.creator_publishing_trusted_reviewers where reviewer_id = p_reviewer_id and active is true;
  if not found then raise exception 'REVIEW_UNAUTHORIZED'; end if;

  select * into v_package from public.creator_publishing_content_packages where id = p_content_package_id for update;
  if not found then raise exception 'REVIEW_PACKAGE_NOT_FOUND'; end if;
  if v_package.creator_id = p_reviewer_id then raise exception 'REVIEW_SELF_REVIEW_FORBIDDEN'; end if;
  if v_package.target_platform = 'fanvue' then raise exception 'REVIEW_FANVUE_NOT_SUPPORTED'; end if;
  if v_package.compliance_status = 'blocked' then raise exception 'REVIEW_BLOCKED_NOT_ESCALATABLE'; end if;
  if v_package.compliance_status <> 'manual_review' or p_expected_current_status <> 'manual_review' then raise exception 'REVIEW_INVALID_CURRENT_STATUS'; end if;
  if v_package.compliance_policy_version is null or v_package.compliance_policy_version = 'unassigned' then raise exception 'REVIEW_POLICY_VERSION_UNASSIGNED'; end if;
  if v_package.compliance_policy_version <> p_expected_policy_version then raise exception 'REVIEW_STALE_POLICY_VERSION'; end if;

  select * into v_latest_automated
  from public.creator_publishing_compliance_reviews
  where content_package_id = p_content_package_id and review_source = 'automated'
  order by created_at desc, id desc
  limit 1;
  if not found or v_latest_automated.outcome <> 'manual_review' then
    raise exception 'REVIEW_AUTOMATED_REVIEW_REQUIRED';
  end if;

  select * into v_later_block
  from public.creator_publishing_compliance_reviews
  where content_package_id = p_content_package_id and outcome = 'block' and created_at > v_latest_automated.created_at
  order by created_at desc, id desc
  limit 1;
  if found then raise exception 'REVIEW_BLOCKED_NOT_ESCALATABLE'; end if;

  if p_idempotency_key is not null and exists (select 1 from public.creator_publishing_audit_events where entity_type = 'creator_publishing_content_package' and entity_id = p_content_package_id and idempotency_key = p_idempotency_key) then
    raise exception 'REVIEW_DUPLICATE';
  end if;

  v_outcome := case p_decision when 'approve_escalation' then 'escalate' when 'block' then 'block' else 'manual_review' end;
  v_action := case p_decision when 'approve_escalation' then 'manual_review_approved_for_escalation' when 'reject' then 'manual_review_rejected' when 'block' then 'manual_review_blocked' else 'manual_review_changes_requested' end;
  v_result_status := case p_decision when 'approve_escalation' then 'escalated_approved' when 'reject' then 'manual_review' when 'block' then 'blocked' else 'pending' end;

  v_before := jsonb_build_object('compliance_status', v_package.compliance_status, 'compliance_policy_version', v_package.compliance_policy_version, 'forced_disclosure_text', v_package.forced_disclosure_text, 'creator_approval_status', v_package.creator_approval_status);

  insert into public.creator_publishing_compliance_reviews(content_package_id, reviewer_id, outcome, review_source, notes, escalated_approval_reason, rule_hits, review_metadata, compliance_policy_version, created_at)
  values (p_content_package_id, p_reviewer_id, v_outcome, 'human', concat_ws(E'\n\n', btrim(p_reason), nullif(btrim(coalesce(p_reviewer_notes, '')), '')), case when p_decision = 'approve_escalation' then btrim(p_reason) else null end, coalesce(p_rule_hits, '[]'::jsonb), coalesce(p_review_metadata, '{}'::jsonb) || jsonb_build_object('decision', p_decision, 'idempotency_key', p_idempotency_key, 'policy_version', v_package.compliance_policy_version), v_package.compliance_policy_version, v_reviewed_at)
  returning id into v_review_id;

  if p_decision = 'request_changes' then
    update public.creator_publishing_content_packages set compliance_status = 'pending', compliance_policy_version = 'unassigned', forced_disclosure_text = null, creator_approval_status = 'pending', creator_approved_by = null, creator_approved_at = null where id = p_content_package_id and compliance_status = 'manual_review';
  else
    update public.creator_publishing_content_packages set compliance_status = v_result_status where id = p_content_package_id and compliance_status = 'manual_review';
  end if;
  if not found then raise exception 'REVIEW_CONFLICT'; end if;

  v_after := v_before || jsonb_build_object('decision', p_decision, 'reviewer_id', p_reviewer_id, 'resulting_compliance_status', v_result_status, 'policy_version', v_package.compliance_policy_version, 'review_record_id', v_review_id, 'rule_hits', coalesce(p_rule_hits, '[]'::jsonb), 'idempotency_key', p_idempotency_key, 'timestamp', v_reviewed_at);
  insert into public.creator_publishing_audit_events(entity_type, entity_id, actor_id, actor_role, action, before_state, after_state, idempotency_key, created_at)
  values ('creator_publishing_content_package', p_content_package_id, p_reviewer_id, v_reviewer.role, v_action, v_before, v_after, p_idempotency_key, v_reviewed_at)
  returning id into v_audit_id;

  return jsonb_build_object('content_package_id', p_content_package_id, 'creator_id', v_package.creator_id, 'reviewer_id', p_reviewer_id, 'decision', p_decision, 'prior_compliance_status', 'manual_review', 'resulting_compliance_status', v_result_status, 'policy_version', v_package.compliance_policy_version, 'review_record_id', v_review_id, 'audit_event_ids', jsonb_build_array(v_audit_id), 'creator_approval_allowed', p_decision = 'approve_escalation', 'queue_creation_allowed', false, 'reviewed_at', v_reviewed_at);
end;
$$;


revoke all on function public.creator_publishing_apply_manual_review_decision(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text) from PUBLIC;
revoke all on function public.creator_publishing_apply_manual_review_decision(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text) from anon;
revoke all on function public.creator_publishing_apply_manual_review_decision(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text) from authenticated;
grant execute on function public.creator_publishing_apply_manual_review_decision(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text) to service_role;

create or replace function public.creator_publishing_apply_creator_approval_decision(
  p_content_package_id uuid,
  p_creator_id uuid,
  p_decision text,
  p_expected_compliance_status text,
  p_expected_policy_version text,
  p_expected_package_updated_at timestamptz,
  p_snapshot_hash text,
  p_media_manifest jsonb,
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
  v_current_evidence public.creator_publishing_compliance_reviews%rowtype;
  v_later_blocking_review public.creator_publishing_compliance_reviews%rowtype;
  v_current_media_manifest jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'storage_key', storage_key, 'mime_type', mime_type, 'sha256', sha256, 'source', source, 'ai_generation_metadata', coalesce(ai_generation_metadata, '{}'::jsonb)) order by id), '[]'::jsonb)
  into v_current_media_manifest
  from (select id, storage_key, mime_type, sha256, source, ai_generation_metadata from public.creator_publishing_media_assets where content_package_id = p_content_package_id order by id for update) locked_media;
  if v_current_media_manifest is distinct from coalesce(p_media_manifest, '[]'::jsonb) then raise exception 'APPROVAL_STALE_PACKAGE'; end if;

  if v_package.compliance_status not in ('passed','escalated_approved') or p_expected_compliance_status <> v_package.compliance_status then raise exception 'APPROVAL_INVALID_COMPLIANCE_STATUS'; end if;
  if v_package.compliance_policy_version is null or v_package.compliance_policy_version = 'unassigned' or v_package.compliance_policy_version <> p_expected_policy_version then raise exception 'APPROVAL_STALE_POLICY_VERSION'; end if;

  if v_package.compliance_status = 'passed' then
    select * into v_current_evidence from public.creator_publishing_compliance_reviews
    where content_package_id = p_content_package_id and review_source = 'automated' and outcome = 'pass' and compliance_policy_version = v_package.compliance_policy_version
    order by created_at desc, id desc limit 1;
  else
    select * into v_current_evidence from public.creator_publishing_compliance_reviews
    where content_package_id = p_content_package_id and review_source = 'human' and outcome = 'escalate' and length(btrim(coalesce(escalated_approval_reason, ''))) > 0 and compliance_policy_version = v_package.compliance_policy_version
    order by created_at desc, id desc limit 1;
  end if;
  if not found then raise exception 'APPROVAL_CURRENT_COMPLIANCE_EVIDENCE_REQUIRED'; end if;

  select * into v_later_blocking_review from public.creator_publishing_compliance_reviews
  where content_package_id = p_content_package_id
    and outcome in ('block','manual_review')
    and (created_at > v_current_evidence.created_at or (created_at = v_current_evidence.created_at and id > v_current_evidence.id))
  order by created_at desc, id desc limit 1;
  if found then raise exception 'APPROVAL_BLOCKING_REVIEW_EXISTS'; end if;

  if p_decision = 'approve' then
    if length(btrim(coalesce(v_package.caption_body, ''))) = 0 then raise exception 'APPROVAL_FINAL_CAPTION_MISSING'; end if;
    if v_package.target_platform = 'onlyfans' and length(btrim(coalesce(v_package.forced_disclosure_text, ''))) = 0 then raise exception 'APPROVAL_DISCLOSURE_MISSING'; end if;
    select count(*) into v_media_count from public.creator_publishing_media_assets where content_package_id = p_content_package_id;
    if v_media_count < 1 then raise exception 'APPROVAL_MEDIA_MISSING'; end if;
    select * into v_existing_task from public.creator_publishing_queue_tasks where content_package_id = p_content_package_id and target_platform = v_package.target_platform and status <> 'archived' limit 1;
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


create or replace function public.creator_publishing_media_assets_invalidate_parent_package()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_content_package_id uuid;
  v_package public.creator_publishing_content_packages%rowtype;
  v_active_task_id uuid;
begin
  if tg_op = 'UPDATE' and new.content_package_id is distinct from old.content_package_id then
    raise exception 'APPROVAL_MEDIA_PACKAGE_MOVE_FORBIDDEN';
  end if;

  v_content_package_id := coalesce(new.content_package_id, old.content_package_id);
  select * into v_package from public.creator_publishing_content_packages where id = v_content_package_id for update;
  if not found then return coalesce(new, old); end if;

  if v_package.creator_approval_status = 'approved' then
    raise exception 'APPROVAL_STALE_PACKAGE';
  end if;

  select id into v_active_task_id
  from public.creator_publishing_queue_tasks
  where content_package_id = v_content_package_id and status <> 'archived'
  limit 1;
  if found then
    raise exception 'APPROVAL_DUPLICATE';
  end if;

  update public.creator_publishing_content_packages
  set compliance_status = 'pending',
      compliance_policy_version = 'unassigned',
      forced_disclosure_text = null,
      creator_approval_status = 'pending',
      creator_approved_by = null,
      creator_approved_at = null,
      updated_at = clock_timestamp()
  where id = v_content_package_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_creator_publishing_media_assets_invalidate_parent on public.creator_publishing_media_assets;
create trigger trg_creator_publishing_media_assets_invalidate_parent
after insert or update or delete on public.creator_publishing_media_assets
for each row execute function public.creator_publishing_media_assets_invalidate_parent_package();

revoke all on function public.creator_publishing_media_assets_invalidate_parent_package() from PUBLIC;
revoke all on function public.creator_publishing_media_assets_invalidate_parent_package() from anon;
revoke all on function public.creator_publishing_media_assets_invalidate_parent_package() from authenticated;
grant execute on function public.creator_publishing_media_assets_invalidate_parent_package() to service_role;

revoke all on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, jsonb, text, text, text, text) from PUBLIC;
revoke all on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, jsonb, text, text, text, text) from anon;
revoke all on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, jsonb, text, text, text, text) from authenticated;
grant execute on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, jsonb, text, text, text, text) to service_role;

comment on function public.creator_publishing_apply_creator_approval_decision(uuid, uuid, text, text, text, timestamptz, text, jsonb, text, text, text, text) is 'Atomic creator approval/rejection workflow. Only creates OnlyFans manual-handoff queue tasks after valid creator approval; never posts to platforms and never routes Fanvue.';
comment on index public.creator_publishing_queue_one_task_per_package_platform_uidx is 'Prevents duplicate active/final manual-handoff queue tasks for the same content package and platform.';
