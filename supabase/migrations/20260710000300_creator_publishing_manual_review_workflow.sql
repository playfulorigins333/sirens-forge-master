-- Creator Publishing Queue Task 4: trusted human manual-review workflow.
-- No queue task creation, platform posting, Fanvue routing, credentials, sessions, or creator approval completion.

alter table public.creator_publishing_compliance_reviews
  add column if not exists review_source text not null default 'automated'
  check (review_source in ('automated','human'));

alter table public.creator_publishing_compliance_reviews
  add column if not exists review_metadata jsonb not null default '{}'::jsonb;

alter table public.creator_publishing_audit_events
  add column if not exists idempotency_key text;

create unique index if not exists creator_publishing_audit_review_idempotency_uidx
  on public.creator_publishing_audit_events(entity_type, entity_id, action, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.creator_publishing_trusted_reviewers (
  reviewer_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','operator','reviewer','service_reviewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.creator_publishing_trusted_reviewers enable row level security;

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

comment on table public.creator_publishing_trusted_reviewers is 'Narrow Task 4 reviewer allowlist; no broad admin system. Used only by service-role trusted manual-review workflow.';
comment on function public.creator_publishing_apply_manual_review_decision(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text) is 'Atomic trusted human manual-review transition. Creates exactly one human review and one append-only audit event; never creates queue tasks or approves creator content.';
