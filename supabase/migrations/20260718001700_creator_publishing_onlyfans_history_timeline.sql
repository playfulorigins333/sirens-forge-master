begin;

-- Task 20: OnlyFans manual-publishing history/audit timeline.
-- No backfill is performed here. Historical completion proof is reconstructed read-only by application loaders.

create unique index if not exists task20_onlyfans_completion_audit_once_uidx
  on public.creator_publishing_audit_events(action, entity_type, entity_id, actor_id, idempotency_key)
  where action in ('operator_onlyfans_manual_completion_proof_recorded','operator_onlyfans_manual_completion_rejected')
    and entity_type = 'creator_publishing_platform_job'
    and actor_id is not null
    and idempotency_key is not null;

alter table public.creator_publishing_operator_action_idempotency
  drop constraint if exists task18_operator_action_type_check;
alter table public.creator_publishing_operator_action_idempotency
  add constraint task18_operator_action_type_check check (
    action_type in (
      'claim',
      'release',
      'progress_update',
      'expired_claim_recovery',
      'manual_completion',
      'manual_completion_rejection'
    )
  );

create or replace function public.task20_onlyfans_completion_rejection_code(p_sqlstate text, p_message text)
returns text
language plpgsql
immutable
set search_path=public,pg_catalog
as $$
begin
  if p_sqlstate is distinct from 'P0001' then return null; end if;
  case upper(coalesce(p_message,''))
    when 'CURRENT_CLAIM_REQUIRED' then return 'current_claim_required';
    when 'WORK_NOT_COMPLETABLE' then return 'work_not_completable';
    when 'ACCOUNT_NOT_VERIFIED' then return 'account_not_verified';
    when 'PACKAGE_NOT_APPROVED' then return 'package_not_approved';
    when 'CAPABILITY_UNAVAILABLE' then return 'capability_unavailable';
    when 'SOURCE_CHANGED' then return 'source_changed';
    when 'EVIDENCE_MISMATCH' then return 'evidence_mismatch';
    when 'INVALID_ONLYFANS_URL' then return 'url_or_reason_required';
    when 'URL_OR_REASON_REQUIRED' then return 'url_or_reason_required';
    when 'IDEMPOTENCY_CONFLICT' then return 'idempotency_conflict';
    else return null;
  end case;
end $$;

create or replace function public.task20_safe_completion_failure_result(p_platform_job_id uuid, p_code text, p_replayed boolean)
returns jsonb
language sql
immutable
set search_path=public,pg_catalog
as $$
  select jsonb_build_object(
    'ok', false,
    'platform_job_id', p_platform_job_id,
    'status', 'completion_rejected',
    'code', p_code,
    'replayed', p_replayed,
    'idempotent', p_replayed
  )
$$;

create or replace function public.task20_record_onlyfans_completion_rejection(
  p_actor_id uuid,
  p_creator_id uuid,
  p_queue_task_id uuid,
  p_platform_job_id uuid,
  p_evidence_intent_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_rejection_code text,
  p_job_state text,
  p_recorded_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_existing public.creator_publishing_operator_action_idempotency%rowtype;
  v_result jsonb;
begin
  if p_rejection_code not in (
    'current_claim_required','work_not_completable','account_not_verified',
    'package_not_approved','capability_unavailable','source_changed',
    'evidence_mismatch','url_or_reason_required','idempotency_conflict'
  ) then
    raise exception 'TASK20_REJECTION_CODE_INVALID';
  end if;

  select * into v_existing
  from public.creator_publishing_operator_action_idempotency
  where actor_id=p_actor_id
    and action_type='manual_completion_rejection'
    and idempotency_key=p_idempotency_key
  for update;

  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint then
      return public.task20_safe_completion_failure_result(p_platform_job_id,'idempotency_conflict',false);
    end if;
    return v_existing.stored_result || jsonb_build_object('replayed',true,'idempotent',true);
  end if;

  v_result := public.task20_safe_completion_failure_result(p_platform_job_id,p_rejection_code,false);

  insert into public.creator_publishing_operator_action_idempotency(
    actor_id,creator_id,queue_task_id,platform_job_id,action_type,
    idempotency_key,request_fingerprint,stored_result,internal_request_snapshot,created_at
  ) values (
    p_actor_id,p_creator_id,p_queue_task_id,p_platform_job_id,'manual_completion_rejection',
    p_idempotency_key,p_request_fingerprint,v_result,null,p_recorded_at
  );

  insert into public.creator_publishing_audit_events(
    entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at
  ) values (
    'creator_publishing_platform_job',p_platform_job_id,p_actor_id,'operator',
    'operator_onlyfans_manual_completion_rejected',
    jsonb_build_object('job_state',p_job_state),
    jsonb_build_object(
      'platform_job_id',p_platform_job_id,
      'queue_task_id',p_queue_task_id,
      'evidence_intent_id',p_evidence_intent_id,
      'rejection_code',p_rejection_code,
      'trusted_timestamp',p_recorded_at
    ),
    p_idempotency_key,p_recorded_at
  )
  on conflict (action,entity_type,entity_id,actor_id,idempotency_key)
  where action in ('operator_onlyfans_manual_completion_proof_recorded','operator_onlyfans_manual_completion_rejected')
    and entity_type='creator_publishing_platform_job'
    and actor_id is not null
    and idempotency_key is not null
  do nothing;

  return v_result;
end $$;

create or replace function public.creator_publishing_complete_onlyfans_manual_post_audited(
  p_mode text,
  p_actor_id uuid,
  p_platform_job_id uuid,
  p_idempotency_key text,
  p_evidence_intent_id uuid,
  p_final_post_url text default null,
  p_final_post_url_skip_reason text default null,
  p_verified_sha256 text default null,
  p_actual_size_bytes int default null,
  p_normalized_mime_type text default null,
  p_claim_token uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  plan_rec public.creator_publishing_plans%rowtype;
  job public.creator_publishing_platform_jobs%rowtype;
  task public.creator_publishing_queue_tasks%rowtype;
  acct public.creator_platform_accounts%rowtype;
  pkg public.creator_publishing_content_packages%rowtype;
  cap public.creator_publishing_platform_capabilities%rowtype;
  ev public.creator_publishing_operator_completion_evidence_intents%rowtype;
  success_idem public.creator_publishing_operator_action_idempotency%rowtype;
  rejection_idem public.creator_publishing_operator_action_idempotency%rowtype;
  v_result jsonb;
  v_rejection_code text;
  v_request_fingerprint text;
  v_now timestamptz := now();
begin
  if p_mode not in ('replay_probe','complete')
    or p_actor_id is null
    or p_platform_job_id is null
    or p_evidence_intent_id is null then
    raise exception 'TASK20_INVALID_TRUSTED_INPUT';
  end if;
  perform public.creator_publishing_operator_validate_idempotency_key(p_idempotency_key);

  perform pg_advisory_xact_lock(hashtextextended('task20-complete-audit:'||p_actor_id||':'||p_idempotency_key,0));

  select * into job
  from public.creator_publishing_platform_jobs
  where id=p_platform_job_id
  for update;
  if not found then raise exception 'TASK20_TARGET_NOT_FOUND'; end if;

  select * into ev
  from public.creator_publishing_operator_completion_evidence_intents
  where id=p_evidence_intent_id
  for update;
  if not found then raise exception 'TASK20_RELATIONSHIP_INVALID'; end if;

  select * into task
  from public.creator_publishing_queue_tasks
  where id=ev.queue_task_id
  for update;
  if not found then raise exception 'TASK20_RELATIONSHIP_INVALID'; end if;

  select * into plan_rec
  from public.creator_publishing_plans
  where id=job.publishing_plan_id
  for update;
  if not found or plan_rec.creator_id is distinct from job.creator_id then
    raise exception 'TASK20_RELATIONSHIP_INVALID';
  end if;

  select * into pkg
  from public.creator_publishing_content_packages
  where id=job.content_package_id
  for update;
  if not found
    or pkg.creator_id is distinct from job.creator_id
    or pkg.platform_account_id is distinct from job.platform_account_id
    or pkg.target_platform <> 'onlyfans' then
    raise exception 'TASK20_RELATIONSHIP_INVALID';
  end if;

  select * into acct
  from public.creator_platform_accounts
  where id=job.platform_account_id
  for update;
  if not found
    or acct.creator_id is distinct from job.creator_id
    or acct.platform <> 'onlyfans' then
    raise exception 'TASK20_RELATIONSHIP_INVALID';
  end if;

  select * into cap
  from public.creator_publishing_platform_capabilities
  where platform=job.target_platform
  for update;
  if not found then raise exception 'TASK20_RELATIONSHIP_INVALID'; end if;

  if ev.actor_id is distinct from p_actor_id
    or ev.creator_id is distinct from job.creator_id
    or ev.platform_job_id is distinct from job.id
    or ev.queue_task_id is distinct from task.id
    or ev.content_package_id is distinct from job.content_package_id
    or ev.platform_account_id is distinct from job.platform_account_id
    or task.creator_id is distinct from job.creator_id
    or task.content_package_id is distinct from job.content_package_id
    or task.platform_account_id is distinct from job.platform_account_id
    or task.target_platform is distinct from job.target_platform then
    raise exception 'TASK20_RELATIONSHIP_INVALID';
  end if;

  if job.target_platform <> 'onlyfans'
    or job.publishing_mode <> 'assisted'
    or cap.publishing_mode <> 'assisted'
    or cap.human_publishing_required is not true then
    raise exception 'TASK20_NOT_ONLYFANS_ASSISTED';
  end if;

  if not exists (select 1 from auth.users u where u.id=p_actor_id) then
    raise exception 'TASK20_ACTOR_INVALID';
  end if;
  if p_actor_id <> job.creator_id and not exists (
    select 1
    from public.creator_publishing_operator_authorizations oa
    where oa.creator_id=job.creator_id
      and oa.operator_id=p_actor_id
      and oa.platform='onlyfans'
      and oa.status='active'
      and oa.revoked_at is null
  ) then
    raise exception 'TASK20_ACTOR_UNAUTHORIZED';
  end if;

  v_request_fingerprint := encode(extensions.digest(jsonb_build_object(
    'actor',p_actor_id,
    'job',p_platform_job_id,
    'url',p_final_post_url,
    'reason',p_final_post_url_skip_reason,
    'evidence',p_evidence_intent_id
  )::text,'sha256'),'hex');

  select * into success_idem
  from public.creator_publishing_operator_action_idempotency
  where actor_id=p_actor_id
    and action_type='manual_completion'
    and idempotency_key=p_idempotency_key
  for update;

  if found then
    if success_idem.request_fingerprint is distinct from v_request_fingerprint
      or (p_mode='complete' and success_idem.internal_request_snapshot is not null and (
        success_idem.internal_request_snapshot->>'verified_sha256' is distinct from p_verified_sha256
        or (success_idem.internal_request_snapshot->>'actual_size_bytes')::int is distinct from p_actual_size_bytes
        or success_idem.internal_request_snapshot->>'normalized_mime_type' is distinct from p_normalized_mime_type
      )) then
      return public.task20_record_onlyfans_completion_rejection(
        p_actor_id,job.creator_id,task.id,job.id,ev.id,p_idempotency_key,
        v_request_fingerprint,'idempotency_conflict',job.job_state,v_now
      );
    end if;
    return success_idem.stored_result || jsonb_build_object('replayed',true,'idempotent',true);
  end if;

  select * into rejection_idem
  from public.creator_publishing_operator_action_idempotency
  where actor_id=p_actor_id
    and action_type='manual_completion_rejection'
    and idempotency_key=p_idempotency_key
  for update;

  if found then
    if rejection_idem.request_fingerprint is distinct from v_request_fingerprint then
      return public.task20_safe_completion_failure_result(job.id,'idempotency_conflict',false);
    end if;
    return rejection_idem.stored_result || jsonb_build_object('replayed',true,'idempotent',true);
  end if;

  if p_mode='replay_probe' then
    return jsonb_build_object('replayed',false,'idempotent',false);
  end if;

  begin
    v_result := public.creator_publishing_complete_onlyfans_manual_post(
      p_mode,p_actor_id,p_platform_job_id,p_idempotency_key,p_evidence_intent_id,
      p_final_post_url,p_final_post_url_skip_reason,p_verified_sha256,
      p_actual_size_bytes,p_normalized_mime_type,p_claim_token
    );
  exception when others then
    v_rejection_code := public.task20_onlyfans_completion_rejection_code(sqlstate,sqlerrm);
    if v_rejection_code is null then raise; end if;
    return public.task20_record_onlyfans_completion_rejection(
      p_actor_id,job.creator_id,task.id,job.id,ev.id,p_idempotency_key,
      v_request_fingerprint,v_rejection_code,job.job_state,v_now
    );
  end;

  if coalesce((v_result->>'replayed')::boolean,false) is true then
    -- A replay without an existing Task 20 proof event may be a pre-Task-20 completion.
    -- Do not fabricate or backdate an append-only proof event.
    return v_result;
  end if;

  select * into task from public.creator_publishing_queue_tasks where id=task.id;
  select * into ev from public.creator_publishing_operator_completion_evidence_intents where id=p_evidence_intent_id;

  if task.status <> 'confirmed_posted_manual'
    or task.posted_by is distinct from p_actor_id
    or task.posted_at is null
    or ev.status <> 'consumed'
    or ev.consumed_at is null then
    raise exception 'TASK20_COMPLETION_PROOF_STATE_INVALID';
  end if;

  insert into public.creator_publishing_audit_events(
    entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at
  ) values (
    'creator_publishing_platform_job',job.id,p_actor_id,'operator',
    'operator_onlyfans_manual_completion_proof_recorded',
    jsonb_build_object('job_state',job.job_state),
    jsonb_build_object(
      'platform_job_id',job.id,
      'queue_task_id',task.id,
      'evidence_intent_id',ev.id,
      'final_post_url',task.final_post_url,
      'final_post_url_skip_reason',task.final_post_url_skip_reason,
      'verified_sha256',ev.verified_sha256,
      'actual_size_bytes',ev.actual_size_bytes,
      'normalized_mime_type',ev.normalized_mime_type,
      'completed_at',task.posted_at,
      'operator_actor_id',p_actor_id,
      'idempotency_key',p_idempotency_key
    ),
    p_idempotency_key,task.posted_at
  )
  on conflict (action,entity_type,entity_id,actor_id,idempotency_key)
  where action in ('operator_onlyfans_manual_completion_proof_recorded','operator_onlyfans_manual_completion_rejected')
    and entity_type='creator_publishing_platform_job'
    and actor_id is not null
    and idempotency_key is not null
  do nothing;

  return v_result;
end $$;

revoke execute on function public.task20_onlyfans_completion_rejection_code(text,text) from public, anon, authenticated, service_role;
revoke execute on function public.task20_safe_completion_failure_result(uuid,text,boolean) from public, anon, authenticated, service_role;
revoke execute on function public.task20_record_onlyfans_completion_rejection(uuid,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;
revoke execute on function public.creator_publishing_complete_onlyfans_manual_post_audited(text,uuid,uuid,text,uuid,text,text,text,int,text,uuid) from public, anon, authenticated;
grant execute on function public.creator_publishing_complete_onlyfans_manual_post_audited(text,uuid,uuid,text,uuid,text,text,text,int,text,uuid) to service_role;

commit;
