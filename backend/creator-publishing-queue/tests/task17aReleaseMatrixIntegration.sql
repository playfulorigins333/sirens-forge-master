\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql

create temporary table if not exists task17a_release_rejections(label text primary key, key text not null, task_id uuid, job_id uuid) on commit preserve rows;

create or replace function task17a_test.release_preserved_snapshot(p_task_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'claim_attempt_count', q.claim_attempt_count,
    'operator_progress_state', q.operator_progress_state,
    'operator_progress_revision', q.operator_progress_revision,
    'operator_progress_updated_by', q.operator_progress_updated_by,
    'operator_progress_updated_at', q.operator_progress_updated_at,
    'assigned_operator_id', q.assigned_operator_id,
    'posted_by', q.posted_by,
    'posted_at', q.posted_at,
    'posted_confirmation', q.posted_confirmation,
    'final_post_url', q.final_post_url,
    'final_post_url_skip_reason', q.final_post_url_skip_reason,
    'proof_screenshot_storage_key', q.proof_screenshot_storage_key,
    'skip_or_fail_reason', q.skip_or_fail_reason
  ) from public.creator_publishing_queue_tasks q where q.id=p_task_id
$$;

create or replace function task17a_test.assert_release_claimable_setup(p_label text,p_task_id uuid,p_job_id uuid,p_actor_id uuid,p_consent_version text,p_consent_hash text,p_scheduled boolean)
returns void language plpgsql as $$
declare
  task public.creator_publishing_queue_tasks%rowtype;
  job public.creator_publishing_platform_jobs%rowtype;
  restore text;
begin
  select * into task from public.creator_publishing_queue_tasks where id=p_task_id;
  select * into job from public.creator_publishing_platform_jobs where id=p_job_id;
  perform task17a_test.assert(task.id is not null and job.id is not null and task.content_package_id=job.content_package_id and task.creator_id=job.creator_id and task.platform_account_id=job.platform_account_id and task.target_platform=job.target_platform, p_label || ' job task identities match');
  perform task17a_test.assert(task.target_platform='onlyfans' and job.publishing_mode='assisted', p_label || ' onlyfans assisted');
  perform task17a_test.assert(public.creator_publishing_operator_current_safety_gate(job,task,p_actor_id,p_consent_version,p_consent_hash) is null, p_label || ' safety gates valid');
  perform task17a_test.assert(public.creator_publishing_operator_queue_is_clean(task), p_label || ' queue clean');
  perform task17a_test.assert(task.status in ('ready_for_handoff','scheduled_internally','awaiting_operator','due_now'), p_label || ' queue status eligible');
  if p_scheduled then
    restore := public.creator_publishing_operator_restore_queue_status(job, clock_timestamp());
    perform task17a_test.assert(restore in ('awaiting_operator','due_now') and clock_timestamp() >= job.operator_due_at and job.operator_due_at = job.intended_publish_at - interval '60 minutes', p_label || ' scheduled work is claimable');
  end if;
end $$;

create or replace function task17a_test.assert_release_claimed_setup(p_label text,p_task_id uuid,p_actor_id uuid,p_attempts_before integer)
returns void language plpgsql as $$
begin
  perform task17a_test.assert((select status='claimed' and claimed_by=p_actor_id and claimed_at is not null and claim_token is not null and claim_expires_at is not null and claim_expires_at > claimed_at and claim_attempt_count=p_attempts_before+1 from public.creator_publishing_queue_tasks where id=p_task_id), p_label || ' claim succeeded with complete ownership');
end $$;

create or replace function task17a_test.assert_release_rejected(p_label text,p_expected_error text,p_actor_id uuid,p_task_id uuid,p_job_id uuid,p_claim_token uuid,p_idempotency_key text)
returns void language plpgsql as $$
declare before_task jsonb; after_task jsonb; before_job jsonb; after_job jsonb; before_audits integer; after_audits integer; before_idem integer; after_idem integer;
begin
  select to_jsonb(q) into before_task from public.creator_publishing_queue_tasks q where id=p_task_id;
  select to_jsonb(j) into before_job from public.creator_publishing_platform_jobs j where id=p_job_id;
  select count(*) into before_audits from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key=p_idempotency_key;
  select count(*) into before_idem from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key=p_idempotency_key;
  begin
    perform public.creator_publishing_release_onlyfans_operator_task(p_actor_id,p_task_id,p_job_id,p_claim_token,p_idempotency_key);
    raise exception 'TASK17A_EXPECTED_RELEASE_REJECTION_NOT_RAISED:%', p_label;
  exception when others then
    if sqlerrm not like '%' || p_expected_error || '%' then
      raise exception 'TASK17A_UNEXPECTED_RELEASE_ERROR:% expected:% actual:%', p_label, p_expected_error, sqlerrm;
    end if;
  end;
  select to_jsonb(q) into after_task from public.creator_publishing_queue_tasks q where id=p_task_id;
  select to_jsonb(j) into after_job from public.creator_publishing_platform_jobs j where id=p_job_id;
  select count(*) into after_audits from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key=p_idempotency_key;
  select count(*) into after_idem from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key=p_idempotency_key;
  perform task17a_test.assert(before_task is not distinct from after_task, p_label || ' queue unchanged');
  perform task17a_test.assert(before_job is not distinct from after_job, p_label || ' job unchanged');
  perform task17a_test.assert(before_audits=after_audits, p_label || ' no release audit');
  perform task17a_test.assert(before_idem=after_idem, p_label || ' no release idempotency');
  if after_task is not null then
    perform task17a_test.assert(
      before_task->>'posted_by' is not distinct from after_task->>'posted_by'
      and before_task->>'posted_at' is not distinct from after_task->>'posted_at'
      and before_task->>'posted_confirmation' is not distinct from after_task->>'posted_confirmation'
      and before_task->>'final_post_url' is not distinct from after_task->>'final_post_url'
      and before_task->>'final_post_url_skip_reason' is not distinct from after_task->>'final_post_url_skip_reason'
      and before_task->>'proof_screenshot_storage_key' is not distinct from after_task->>'proof_screenshot_storage_key'
      and before_task->>'skip_or_fail_reason' is not distinct from after_task->>'skip_or_fail_reason',
      p_label || ' manual-result fields unchanged'
    );
  end if;
  insert into task17a_release_rejections(label,key,task_id,job_id) values(p_label,p_idempotency_key,p_task_id,p_job_id) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;
end $$;

create or replace function task17a_test.assert_release_success(p_label text,p_expected_status text,p_actor_id uuid,p_task_id uuid,p_job_id uuid,p_claim_token uuid,p_idempotency_key text,p_preserved_baseline jsonb,p_job_snapshot jsonb)
returns void language plpgsql as $$
declare result jsonb; prior_task public.creator_publishing_queue_tasks%rowtype;
begin
  select * into prior_task from public.creator_publishing_queue_tasks where id=p_task_id;
  result := public.creator_publishing_release_onlyfans_operator_task(p_actor_id,p_task_id,p_job_id,p_claim_token,p_idempotency_key);
  perform task17a_test.assert(result->>'ok'='true' and result->>'action'='release' and (result->>'queue_task_id')::uuid=p_task_id and (result->>'platform_job_id')::uuid=p_job_id and result->>'status'=p_expected_status, p_label || ' release result');
  perform task17a_test.assert((select status=p_expected_status and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and task17a_test.release_preserved_snapshot(id)=p_preserved_baseline from public.creator_publishing_queue_tasks where id=p_task_id), p_label || ' restored status cleared ownership and preserved baseline');
  perform task17a_test.assert((select to_jsonb(j)=p_job_snapshot from public.creator_publishing_platform_jobs j where id=p_job_id), p_label || ' job unchanged');
  perform task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key=p_idempotency_key)=1, p_label || ' one release audit');
  perform task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key=p_idempotency_key)=1, p_label || ' one release idempotency');
  perform task17a_test.assert((select before_state->>'status'='claimed' and (before_state->>'claimed_by')::uuid=prior_task.claimed_by and (before_state->>'claimed_at')::timestamptz=prior_task.claimed_at and (before_state->>'claim_expires_at')::timestamptz=prior_task.claim_expires_at and (before_state->>'claim_attempt_count')::int=prior_task.claim_attempt_count and before_state->>'progress_state'=prior_task.operator_progress_state and (before_state->>'progress_revision')::int=prior_task.operator_progress_revision and (before_state->>'progress_updated_by')::uuid is not distinct from prior_task.operator_progress_updated_by and (before_state->>'assigned_operator_id')::uuid is not distinct from prior_task.assigned_operator_id and after_state->>'action'='release' and (after_state->>'queue_task_id')::uuid=p_task_id and (after_state->>'platform_job_id')::uuid=p_job_id and after_state->>'status'=p_expected_status and not (before_state ? 'claim_token') and not (after_state ? 'claim_token') from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key=p_idempotency_key), p_label || ' truthful release audit without token');
end $$;

create or replace function task17a_test.assert_release_conflict_preserved(p_label text,p_original_task_id uuid,p_original_job_id uuid,p_alternate_task_id uuid,p_alternate_job_id uuid,p_original_task_snapshot jsonb,p_original_job_snapshot jsonb,p_alternate_task_snapshot jsonb,p_alternate_job_snapshot jsonb,p_idempotency_snapshot jsonb,p_success_audit_count integer)
returns void language plpgsql as $$
begin
  perform task17a_test.assert((select to_jsonb(q)=p_original_task_snapshot from public.creator_publishing_queue_tasks q where id=p_original_task_id), p_label || ' original queue unchanged');
  perform task17a_test.assert((select to_jsonb(j)=p_original_job_snapshot from public.creator_publishing_platform_jobs j where id=p_original_job_id), p_label || ' original job unchanged');
  perform task17a_test.assert((select to_jsonb(q)=p_alternate_task_snapshot from public.creator_publishing_queue_tasks q where id=p_alternate_task_id), p_label || ' alternate queue unchanged');
  perform task17a_test.assert((select to_jsonb(j)=p_alternate_job_snapshot from public.creator_publishing_platform_jobs j where id=p_alternate_job_id), p_label || ' alternate job unchanged');
  perform task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='relconflict')=p_success_audit_count, p_label || ' release audit count unchanged');
  perform task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='relconflict')=1, p_label || ' one release idempotency remains');
  perform task17a_test.assert((select request_fingerprint=p_idempotency_snapshot->>'request_fingerprint' and stored_result=(p_idempotency_snapshot->'stored_result') and queue_task_id=(p_idempotency_snapshot->>'queue_task_id')::uuid and platform_job_id=(p_idempotency_snapshot->>'platform_job_id')::uuid and created_at=(p_idempotency_snapshot->>'created_at')::timestamptz from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='relconflict'), p_label || ' stored release idempotency unchanged');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_queue_tasks where id in (p_original_task_id,p_alternate_task_id) and (posted_by is not null or posted_at is not null or posted_confirmation is true or final_post_url is not null or final_post_url_skip_reason is not null or proof_screenshot_storage_key is not null or skip_or_fail_reason is not null)), p_label || ' no Task 18 fields');
end $$;

\echo TASK17A_SCENARIO_START: release_restore_unscheduled_ready
select task17a_test.reset_fixture(929001) as release_unscheduled_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_unscheduled_fixture'::jsonb->>'creator')::uuid,(:'release_unscheduled_fixture'::jsonb->>'task')::uuid,(:'release_unscheduled_fixture'::jsonb->>'job')::uuid,:'release_unscheduled_fixture'::jsonb->>'consent_version',:'release_unscheduled_fixture'::jsonb->>'consent_hash','relclaim01') as release_unscheduled_claim \gset
select claim_token as release_unscheduled_token from public.creator_publishing_queue_tasks where id=(:'release_unscheduled_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.release_preserved_snapshot((:'release_unscheduled_fixture'::jsonb->>'task')::uuid) as release_unscheduled_baseline \gset
select to_jsonb(j) as release_unscheduled_job_snapshot from public.creator_publishing_platform_jobs j where id=(:'release_unscheduled_fixture'::jsonb->>'job')::uuid \gset
select task17a_test.assert_release_success('release_restore_unscheduled_ready','ready_for_handoff',(:'release_unscheduled_fixture'::jsonb->>'creator')::uuid,(:'release_unscheduled_fixture'::jsonb->>'task')::uuid,(:'release_unscheduled_fixture'::jsonb->>'job')::uuid,:'release_unscheduled_token'::uuid,'relrestore01',(:'release_unscheduled_baseline')::jsonb,(:'release_unscheduled_job_snapshot')::jsonb);

\echo TASK17A_SCENARIO_START: release_restore_before_operator_due
select task17a_test.reset_fixture(929002,'scheduled_internally','scheduled_internally',true) as release_before_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_before_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_before_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_before_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_restore_before_operator_due',(:'release_before_fixture'::jsonb->>'task')::uuid,(:'release_before_fixture'::jsonb->>'job')::uuid,(:'release_before_fixture'::jsonb->>'creator')::uuid,:'release_before_fixture'::jsonb->>'consent_version',:'release_before_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_before_fixture'::jsonb->>'creator')::uuid,(:'release_before_fixture'::jsonb->>'task')::uuid,(:'release_before_fixture'::jsonb->>'job')::uuid,:'release_before_fixture'::jsonb->>'consent_version',:'release_before_fixture'::jsonb->>'consent_hash','relclaim02') as release_before_claim \gset
select task17a_test.assert_release_claimed_setup('release_restore_before_operator_due',(:'release_before_fixture'::jsonb->>'task')::uuid,(:'release_before_fixture'::jsonb->>'creator')::uuid,:'release_before_attempts_before'::int);
select claim_token as release_before_token from public.creator_publishing_queue_tasks where id=(:'release_before_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.set_valid_schedule_phase((:'release_before_fixture'::jsonb->>'job')::uuid,'before_operator_due');
select task17a_test.assert((select operator_due_at = intended_publish_at - interval '60 minutes' and schedule_revision is not null and schedule_timezone is not null and scheduled_at is not null and scheduled_by is not null from public.creator_publishing_platform_jobs where id=(:'release_before_fixture'::jsonb->>'job')::uuid), 'release before operator due schedule tuple valid after reschedule');
select task17a_test.release_preserved_snapshot((:'release_before_fixture'::jsonb->>'task')::uuid) as release_before_baseline \gset
select to_jsonb(j) as release_before_job_snapshot from public.creator_publishing_platform_jobs j where id=(:'release_before_fixture'::jsonb->>'job')::uuid \gset
select task17a_test.assert_release_success('release_restore_before_operator_due','scheduled_internally',(:'release_before_fixture'::jsonb->>'creator')::uuid,(:'release_before_fixture'::jsonb->>'task')::uuid,(:'release_before_fixture'::jsonb->>'job')::uuid,:'release_before_token'::uuid,'relrestore02',(:'release_before_baseline')::jsonb,(:'release_before_job_snapshot')::jsonb);

\echo TASK17A_SCENARIO_START: release_restore_after_operator_due
select task17a_test.reset_fixture(929003,'scheduled_internally','scheduled_internally',true) as release_after_operator_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_after_operator_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select task17a_test.assert((select operator_due_at = intended_publish_at - interval '60 minutes' and clock_timestamp() >= operator_due_at from public.creator_publishing_platform_jobs where id=(:'release_after_operator_fixture'::jsonb->>'job')::uuid), 'release after operator due schedule tuple claimable');
select claim_attempt_count as release_after_operator_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_after_operator_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_restore_after_operator_due',(:'release_after_operator_fixture'::jsonb->>'task')::uuid,(:'release_after_operator_fixture'::jsonb->>'job')::uuid,(:'release_after_operator_fixture'::jsonb->>'creator')::uuid,:'release_after_operator_fixture'::jsonb->>'consent_version',:'release_after_operator_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_after_operator_fixture'::jsonb->>'creator')::uuid,(:'release_after_operator_fixture'::jsonb->>'task')::uuid,(:'release_after_operator_fixture'::jsonb->>'job')::uuid,:'release_after_operator_fixture'::jsonb->>'consent_version',:'release_after_operator_fixture'::jsonb->>'consent_hash','relclaim03') as release_after_operator_claim \gset
select task17a_test.assert_release_claimed_setup('release_restore_after_operator_due',(:'release_after_operator_fixture'::jsonb->>'task')::uuid,(:'release_after_operator_fixture'::jsonb->>'creator')::uuid,:'release_after_operator_attempts_before'::int);
select claim_token as release_after_operator_token from public.creator_publishing_queue_tasks where id=(:'release_after_operator_fixture'::jsonb->>'task')::uuid \gset
select public.creator_publishing_update_onlyfans_operator_progress((:'release_after_operator_fixture'::jsonb->>'creator')::uuid,(:'release_after_operator_fixture'::jsonb->>'task')::uuid,(:'release_after_operator_fixture'::jsonb->>'job')::uuid,:'release_after_operator_token'::uuid,'not_started',0,'preparing',:'release_after_operator_fixture'::jsonb->>'consent_version',:'release_after_operator_fixture'::jsonb->>'consent_hash','relprog03') as release_after_operator_progress \gset
select task17a_test.release_preserved_snapshot((:'release_after_operator_fixture'::jsonb->>'task')::uuid) as release_after_operator_baseline \gset
select to_jsonb(j) as release_after_operator_job_snapshot from public.creator_publishing_platform_jobs j where id=(:'release_after_operator_fixture'::jsonb->>'job')::uuid \gset
select task17a_test.assert_release_success('release_restore_after_operator_due','awaiting_operator',(:'release_after_operator_fixture'::jsonb->>'creator')::uuid,(:'release_after_operator_fixture'::jsonb->>'task')::uuid,(:'release_after_operator_fixture'::jsonb->>'job')::uuid,:'release_after_operator_token'::uuid,'relrestore03',(:'release_after_operator_baseline')::jsonb,(:'release_after_operator_job_snapshot')::jsonb);

\echo TASK17A_SCENARIO_START: release_restore_after_publish_due
select task17a_test.reset_fixture(929004,'scheduled_internally','scheduled_internally',true) as release_after_publish_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_after_publish_fixture'::jsonb->>'job')::uuid,'after_publish_due');
select task17a_test.assert((select operator_due_at = intended_publish_at - interval '60 minutes' and clock_timestamp() >= operator_due_at from public.creator_publishing_platform_jobs where id=(:'release_after_publish_fixture'::jsonb->>'job')::uuid), 'release after publish due schedule tuple claimable');
select claim_attempt_count as release_after_publish_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_after_publish_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_restore_after_publish_due',(:'release_after_publish_fixture'::jsonb->>'task')::uuid,(:'release_after_publish_fixture'::jsonb->>'job')::uuid,(:'release_after_publish_fixture'::jsonb->>'creator')::uuid,:'release_after_publish_fixture'::jsonb->>'consent_version',:'release_after_publish_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_after_publish_fixture'::jsonb->>'creator')::uuid,(:'release_after_publish_fixture'::jsonb->>'task')::uuid,(:'release_after_publish_fixture'::jsonb->>'job')::uuid,:'release_after_publish_fixture'::jsonb->>'consent_version',:'release_after_publish_fixture'::jsonb->>'consent_hash','relclaim04') as release_after_publish_claim \gset
select task17a_test.assert_release_claimed_setup('release_restore_after_publish_due',(:'release_after_publish_fixture'::jsonb->>'task')::uuid,(:'release_after_publish_fixture'::jsonb->>'creator')::uuid,:'release_after_publish_attempts_before'::int);
select claim_token as release_after_publish_token from public.creator_publishing_queue_tasks where id=(:'release_after_publish_fixture'::jsonb->>'task')::uuid \gset
update public.creator_publishing_queue_tasks set assigned_operator_id=(:'release_after_publish_fixture'::jsonb->>'operator_a')::uuid where id=(:'release_after_publish_fixture'::jsonb->>'task')::uuid;
select public.creator_publishing_update_onlyfans_operator_progress((:'release_after_publish_fixture'::jsonb->>'creator')::uuid,(:'release_after_publish_fixture'::jsonb->>'task')::uuid,(:'release_after_publish_fixture'::jsonb->>'job')::uuid,:'release_after_publish_token'::uuid,'not_started',0,'preparing',:'release_after_publish_fixture'::jsonb->>'consent_version',:'release_after_publish_fixture'::jsonb->>'consent_hash','relprog04a') as release_after_publish_progress_a \gset
select public.creator_publishing_update_onlyfans_operator_progress((:'release_after_publish_fixture'::jsonb->>'creator')::uuid,(:'release_after_publish_fixture'::jsonb->>'task')::uuid,(:'release_after_publish_fixture'::jsonb->>'job')::uuid,:'release_after_publish_token'::uuid,'preparing',1,'prepared',:'release_after_publish_fixture'::jsonb->>'consent_version',:'release_after_publish_fixture'::jsonb->>'consent_hash','relprog04b') as release_after_publish_progress_b \gset
select task17a_test.release_preserved_snapshot((:'release_after_publish_fixture'::jsonb->>'task')::uuid) as release_after_publish_baseline \gset
select to_jsonb(j) as release_after_publish_job_snapshot from public.creator_publishing_platform_jobs j where id=(:'release_after_publish_fixture'::jsonb->>'job')::uuid \gset
select task17a_test.assert_release_success('release_restore_after_publish_due','due_now',(:'release_after_publish_fixture'::jsonb->>'creator')::uuid,(:'release_after_publish_fixture'::jsonb->>'task')::uuid,(:'release_after_publish_fixture'::jsonb->>'job')::uuid,:'release_after_publish_token'::uuid,'relrestore04',(:'release_after_publish_baseline')::jsonb,(:'release_after_publish_job_snapshot')::jsonb);

\echo TASK17A_SCENARIO_START: release_exact_replay
select task17a_test.reset_fixture(929005) as release_replay_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_replay_fixture'::jsonb->>'creator')::uuid,(:'release_replay_fixture'::jsonb->>'task')::uuid,(:'release_replay_fixture'::jsonb->>'job')::uuid,:'release_replay_fixture'::jsonb->>'consent_version',:'release_replay_fixture'::jsonb->>'consent_hash','relreplayclaim') as release_replay_claim \gset
select claim_token as release_replay_token from public.creator_publishing_queue_tasks where id=(:'release_replay_fixture'::jsonb->>'task')::uuid \gset
select public.creator_publishing_release_onlyfans_operator_task((:'release_replay_fixture'::jsonb->>'creator')::uuid,(:'release_replay_fixture'::jsonb->>'task')::uuid,(:'release_replay_fixture'::jsonb->>'job')::uuid,:'release_replay_token'::uuid,'relreplay01') as release_replay_first \gset
select to_jsonb(q) as release_replay_queue_snapshot from public.creator_publishing_queue_tasks q where id=(:'release_replay_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_replay_job_snapshot from public.creator_publishing_platform_jobs j where id=(:'release_replay_fixture'::jsonb->>'job')::uuid \gset
select to_jsonb(i) as release_replay_idem_snapshot from public.creator_publishing_operator_action_idempotency i where action_type='release' and idempotency_key='relreplay01' \gset
select count(*) as release_replay_audit_count from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='relreplay01' \gset
select public.creator_publishing_release_onlyfans_operator_task((:'release_replay_fixture'::jsonb->>'creator')::uuid,(:'release_replay_fixture'::jsonb->>'task')::uuid,(:'release_replay_fixture'::jsonb->>'job')::uuid,:'release_replay_token'::uuid,'relreplay01') as release_replay_second \gset
select task17a_test.assert((:'release_replay_second')::jsonb->>'idempotent'='true' and (select to_jsonb(q)=(:'release_replay_queue_snapshot')::jsonb from public.creator_publishing_queue_tasks q where id=(:'release_replay_fixture'::jsonb->>'task')::uuid), 'release replay returns stored result and queue unchanged');
select task17a_test.assert((select to_jsonb(j)=(:'release_replay_job_snapshot')::jsonb from public.creator_publishing_platform_jobs j where id=(:'release_replay_fixture'::jsonb->>'job')::uuid), 'release replay job unchanged');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='relreplay01')=:'release_replay_audit_count'::int and :'release_replay_audit_count'::int=1, 'release replay one audit');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='relreplay01')=1, 'release replay one idempotency');
select task17a_test.assert((select request_fingerprint=(:'release_replay_idem_snapshot')::jsonb->>'request_fingerprint' and stored_result=(:'release_replay_idem_snapshot')::jsonb->'stored_result' and created_at=((:'release_replay_idem_snapshot')::jsonb->>'created_at')::timestamptz and stored_result=((:'release_replay_second')::jsonb - 'idempotent') from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='relreplay01'), 'release replay idempotency fingerprint result created_at unchanged');

\echo TASK17A_SCENARIO_START: release_request_invalid
select task17a_test.reset_fixture(929006) as release_invalid_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_invalid_fixture'::jsonb->>'creator')::uuid,(:'release_invalid_fixture'::jsonb->>'task')::uuid,(:'release_invalid_fixture'::jsonb->>'job')::uuid,:'release_invalid_fixture'::jsonb->>'consent_version',:'release_invalid_fixture'::jsonb->>'consent_hash','relinvalidclaim') as release_invalid_claim \gset
select claim_token as release_invalid_token from public.creator_publishing_queue_tasks where id=(:'release_invalid_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_rejected('release_request_invalid','OPERATOR_REQUEST_INVALID',null,(:'release_invalid_fixture'::jsonb->>'task')::uuid,(:'release_invalid_fixture'::jsonb->>'job')::uuid,:'release_invalid_token'::uuid,'relreqbad');

\echo TASK17A_SCENARIO_START: release_missing_job
select task17a_test.assert_release_rejected('release_missing_job','OPERATOR_JOB_NOT_FOUND',(:'release_invalid_fixture'::jsonb->>'creator')::uuid,(:'release_invalid_fixture'::jsonb->>'task')::uuid,'19900000-0000-4000-8000-000000929007'::uuid,:'release_invalid_token'::uuid,'relmissjob');

\echo TASK17A_SCENARIO_START: release_missing_task
select task17a_test.assert_release_rejected('release_missing_task','OPERATOR_TASK_NOT_FOUND',(:'release_invalid_fixture'::jsonb->>'creator')::uuid,'19910000-0000-4000-8000-000000929008'::uuid,(:'release_invalid_fixture'::jsonb->>'job')::uuid,:'release_invalid_token'::uuid,'relmisstask');

\echo TASK17A_SCENARIO_START: release_task_job_mismatch
select task17a_test.reset_fixture(929009) as release_mismatch_a \gset
select task17a_test.create_additional_work(929909,(:'release_mismatch_a'::jsonb->>'creator')::uuid,null,'ready_for_handoff','draft',false) as release_mismatch_b \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_mismatch_a'::jsonb->>'creator')::uuid,(:'release_mismatch_a'::jsonb->>'task')::uuid,(:'release_mismatch_a'::jsonb->>'job')::uuid,:'release_mismatch_a'::jsonb->>'consent_version',:'release_mismatch_a'::jsonb->>'consent_hash','relmismatchclaim') as release_mismatch_claim \gset
select claim_token as release_mismatch_token from public.creator_publishing_queue_tasks where id=(:'release_mismatch_a'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_rejected('release_task_job_mismatch','OPERATOR_TASK_JOB_MISMATCH',(:'release_mismatch_a'::jsonb->>'creator')::uuid,(:'release_mismatch_b'::jsonb->>'task')::uuid,(:'release_mismatch_a'::jsonb->>'job')::uuid,:'release_mismatch_token'::uuid,'relmismatch');

\echo TASK17A_SCENARIO_START: release_unsupported_target_or_mode
select task17a_test.reset_fixture(929010) as release_unsupported_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_unsupported_fixture'::jsonb->>'creator')::uuid,(:'release_unsupported_fixture'::jsonb->>'task')::uuid,(:'release_unsupported_fixture'::jsonb->>'job')::uuid,:'release_unsupported_fixture'::jsonb->>'consent_version',:'release_unsupported_fixture'::jsonb->>'consent_hash','relunsupportedclaim') as release_unsupported_claim \gset
select claim_token as release_unsupported_token from public.creator_publishing_queue_tasks where id=(:'release_unsupported_fixture'::jsonb->>'task')::uuid \gset
update public.creator_publishing_platform_jobs set publishing_mode='direct' where id=(:'release_unsupported_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_unsupported_target_or_mode','OPERATOR_TARGET_NOT_SUPPORTED',(:'release_unsupported_fixture'::jsonb->>'creator')::uuid,(:'release_unsupported_fixture'::jsonb->>'task')::uuid,(:'release_unsupported_fixture'::jsonb->>'job')::uuid,:'release_unsupported_token'::uuid,'relunsupported');

\echo TASK17A_SCENARIO_START: release_cancelled_job
select task17a_test.reset_fixture(929011) as release_cancelled_fixture \gset
select claim_attempt_count as release_cancelled_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_cancelled_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_cancelled_job',(:'release_cancelled_fixture'::jsonb->>'task')::uuid,(:'release_cancelled_fixture'::jsonb->>'job')::uuid,(:'release_cancelled_fixture'::jsonb->>'creator')::uuid,:'release_cancelled_fixture'::jsonb->>'consent_version',:'release_cancelled_fixture'::jsonb->>'consent_hash',false);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_cancelled_fixture'::jsonb->>'creator')::uuid,(:'release_cancelled_fixture'::jsonb->>'task')::uuid,(:'release_cancelled_fixture'::jsonb->>'job')::uuid,:'release_cancelled_fixture'::jsonb->>'consent_version',:'release_cancelled_fixture'::jsonb->>'consent_hash','relcancelledclaim') as release_cancelled_claim \gset
select task17a_test.assert_release_claimed_setup('release_cancelled_job',(:'release_cancelled_fixture'::jsonb->>'task')::uuid,(:'release_cancelled_fixture'::jsonb->>'creator')::uuid,:'release_cancelled_attempts_before'::int);
select claim_token as release_cancelled_token from public.creator_publishing_queue_tasks where id=(:'release_cancelled_fixture'::jsonb->>'task')::uuid \gset
select clock_timestamp() as release_cancelled_at \gset
update public.creator_publishing_platform_jobs set job_state='archived', cancelled_at=:'release_cancelled_at'::timestamptz, cancelled_by=(:'release_cancelled_fixture'::jsonb->>'creator')::uuid, cancellation_reason='Task 17A Release cancelled-job fixture', updated_at=:'release_cancelled_at'::timestamptz where id=(:'release_cancelled_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert((select job_state='archived' and cancelled_at=:'release_cancelled_at'::timestamptz and cancelled_by=(:'release_cancelled_fixture'::jsonb->>'creator')::uuid and cancellation_reason='Task 17A Release cancelled-job fixture' and length(btrim(cancellation_reason)) between 1 and 500 from public.creator_publishing_platform_jobs where id=(:'release_cancelled_fixture'::jsonb->>'job')::uuid), 'release_cancelled_job schema-valid cancellation metadata');
select task17a_test.assert((select status='claimed' and claimed_by=(:'release_cancelled_fixture'::jsonb->>'creator')::uuid and claimed_at is not null and claim_token=:'release_cancelled_token'::uuid and claim_expires_at is not null and claim_expires_at > clock_timestamp() and posted_by is null and posted_at is null and posted_confirmation is false and final_post_url is null and final_post_url_skip_reason is null and proof_screenshot_storage_key is null and skip_or_fail_reason is null from public.creator_publishing_queue_tasks where id=(:'release_cancelled_fixture'::jsonb->>'task')::uuid), 'release_cancelled_job claimed queue preserved before release');
select task17a_test.assert_release_rejected('release_cancelled_job','OPERATOR_TASK_INELIGIBLE',(:'release_cancelled_fixture'::jsonb->>'creator')::uuid,(:'release_cancelled_fixture'::jsonb->>'task')::uuid,(:'release_cancelled_fixture'::jsonb->>'job')::uuid,:'release_cancelled_token'::uuid,'relcancelled');

\echo TASK17A_SCENARIO_START: release_ineligible_job_state
select task17a_test.reset_fixture(929012) as release_ineligible_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_ineligible_fixture'::jsonb->>'creator')::uuid,(:'release_ineligible_fixture'::jsonb->>'task')::uuid,(:'release_ineligible_fixture'::jsonb->>'job')::uuid,:'release_ineligible_fixture'::jsonb->>'consent_version',:'release_ineligible_fixture'::jsonb->>'consent_hash','relineligibleclaim') as release_ineligible_claim \gset
select claim_token as release_ineligible_token from public.creator_publishing_queue_tasks where id=(:'release_ineligible_fixture'::jsonb->>'task')::uuid \gset
update public.creator_publishing_platform_jobs set job_state='needs_fix' where id=(:'release_ineligible_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_ineligible_job_state','OPERATOR_TASK_INELIGIBLE',(:'release_ineligible_fixture'::jsonb->>'creator')::uuid,(:'release_ineligible_fixture'::jsonb->>'task')::uuid,(:'release_ineligible_fixture'::jsonb->>'job')::uuid,:'release_ineligible_token'::uuid,'relineligible');

\echo TASK17A_SCENARIO_START: release_not_claimed
select task17a_test.reset_fixture(929013) as release_not_claimed_fixture \gset
select task17a_test.assert_release_rejected('release_not_claimed','OPERATOR_CLAIM_TOKEN_MISMATCH',(:'release_not_claimed_fixture'::jsonb->>'creator')::uuid,(:'release_not_claimed_fixture'::jsonb->>'task')::uuid,(:'release_not_claimed_fixture'::jsonb->>'job')::uuid,'19920000-0000-4000-8000-000000929013'::uuid,'relnotclaimed');

\echo TASK17A_SCENARIO_START: release_unauthorized_actor
select task17a_test.reset_fixture(929014) as release_unauth_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_unauth_fixture'::jsonb->>'creator')::uuid,(:'release_unauth_fixture'::jsonb->>'task')::uuid,(:'release_unauth_fixture'::jsonb->>'job')::uuid,:'release_unauth_fixture'::jsonb->>'consent_version',:'release_unauth_fixture'::jsonb->>'consent_hash','relunauthclaim') as release_unauth_claim \gset
select claim_token as release_unauth_token from public.creator_publishing_queue_tasks where id=(:'release_unauth_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_rejected('release_unauthorized_actor','OPERATOR_NOT_AUTHORIZED',(:'release_unauth_fixture'::jsonb->>'unauthorized')::uuid,(:'release_unauth_fixture'::jsonb->>'task')::uuid,(:'release_unauth_fixture'::jsonb->>'job')::uuid,:'release_unauth_token'::uuid,'relunauth');

\echo TASK17A_SCENARIO_START: release_revoked_authorization
select task17a_test.reset_fixture(929015) as release_revoked_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_revoked_fixture'::jsonb->>'operator_a')::uuid,(:'release_revoked_fixture'::jsonb->>'task')::uuid,(:'release_revoked_fixture'::jsonb->>'job')::uuid,:'release_revoked_fixture'::jsonb->>'consent_version',:'release_revoked_fixture'::jsonb->>'consent_hash','relrevokedclaim') as release_revoked_claim \gset
select claim_token as release_revoked_token from public.creator_publishing_queue_tasks where id=(:'release_revoked_fixture'::jsonb->>'task')::uuid \gset
select clock_timestamp() as release_revoked_at \gset
update public.creator_publishing_operator_authorizations set status='revoked', revoked_at=:'release_revoked_at'::timestamptz, updated_at=:'release_revoked_at'::timestamptz where creator_id=(:'release_revoked_fixture'::jsonb->>'creator')::uuid and operator_id=(:'release_revoked_fixture'::jsonb->>'operator_a')::uuid;
select task17a_test.assert((select status='revoked' and revoked_at is not null and revoked_at >= authorized_at and not public.creator_publishing_operator_is_authorized((:'release_revoked_fixture'::jsonb->>'creator')::uuid,(:'release_revoked_fixture'::jsonb->>'operator_a')::uuid,'onlyfans') from public.creator_publishing_operator_authorizations where creator_id=(:'release_revoked_fixture'::jsonb->>'creator')::uuid and operator_id=(:'release_revoked_fixture'::jsonb->>'operator_a')::uuid), 'release revoked authorization fixture valid and unauthorized');
select task17a_test.assert_release_rejected('release_revoked_authorization','OPERATOR_NOT_AUTHORIZED',(:'release_revoked_fixture'::jsonb->>'operator_a')::uuid,(:'release_revoked_fixture'::jsonb->>'task')::uuid,(:'release_revoked_fixture'::jsonb->>'job')::uuid,:'release_revoked_token'::uuid,'relrevoked');

\echo TASK17A_SCENARIO_START: release_wrong_owner
select task17a_test.reset_fixture(929016) as release_wrong_owner_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_wrong_owner_fixture'::jsonb->>'operator_b')::uuid,(:'release_wrong_owner_fixture'::jsonb->>'task')::uuid,(:'release_wrong_owner_fixture'::jsonb->>'job')::uuid,:'release_wrong_owner_fixture'::jsonb->>'consent_version',:'release_wrong_owner_fixture'::jsonb->>'consent_hash','relwrongownerclaim') as release_wrong_owner_claim \gset
select claim_token as release_wrong_owner_token from public.creator_publishing_queue_tasks where id=(:'release_wrong_owner_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_rejected('release_wrong_owner','OPERATOR_CLAIM_TOKEN_MISMATCH',(:'release_wrong_owner_fixture'::jsonb->>'operator_a')::uuid,(:'release_wrong_owner_fixture'::jsonb->>'task')::uuid,(:'release_wrong_owner_fixture'::jsonb->>'job')::uuid,:'release_wrong_owner_token'::uuid,'relwrongowner');

\echo TASK17A_SCENARIO_START: release_wrong_token
select task17a_test.reset_fixture(929017) as release_wrong_token_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_wrong_token_fixture'::jsonb->>'creator')::uuid,(:'release_wrong_token_fixture'::jsonb->>'task')::uuid,(:'release_wrong_token_fixture'::jsonb->>'job')::uuid,:'release_wrong_token_fixture'::jsonb->>'consent_version',:'release_wrong_token_fixture'::jsonb->>'consent_hash','relwrongtokenclaim') as release_wrong_token_claim \gset
select task17a_test.assert_release_rejected('release_wrong_token','OPERATOR_CLAIM_TOKEN_MISMATCH',(:'release_wrong_token_fixture'::jsonb->>'creator')::uuid,(:'release_wrong_token_fixture'::jsonb->>'task')::uuid,(:'release_wrong_token_fixture'::jsonb->>'job')::uuid,'19930000-0000-4000-8000-000000929017'::uuid,'relwrongtoken');

\echo TASK17A_SCENARIO_START: release_expired_token
select task17a_test.reset_fixture(929018) as release_expired_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_expired_fixture'::jsonb->>'creator')::uuid,(:'release_expired_fixture'::jsonb->>'task')::uuid,(:'release_expired_fixture'::jsonb->>'job')::uuid,:'release_expired_fixture'::jsonb->>'consent_version',:'release_expired_fixture'::jsonb->>'consent_hash','relexpiredclaim') as release_expired_claim \gset
select claim_token as release_expired_token from public.creator_publishing_queue_tasks where id=(:'release_expired_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.expire_claim((:'release_expired_fixture'::jsonb->>'task')::uuid);
select task17a_test.assert_release_rejected('release_expired_token','OPERATOR_CLAIM_TOKEN_MISMATCH',(:'release_expired_fixture'::jsonb->>'creator')::uuid,(:'release_expired_fixture'::jsonb->>'task')::uuid,(:'release_expired_fixture'::jsonb->>'job')::uuid,:'release_expired_token'::uuid,'relexpired');

\echo TASK17A_SCENARIO_START: release_manual_result_evidence_rejected
select task17a_test.reset_fixture(929019) as release_manual_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_manual_fixture'::jsonb->>'creator')::uuid,(:'release_manual_fixture'::jsonb->>'task')::uuid,(:'release_manual_fixture'::jsonb->>'job')::uuid,:'release_manual_fixture'::jsonb->>'consent_version',:'release_manual_fixture'::jsonb->>'consent_hash','relmanualclaim') as release_manual_claim \gset
select claim_token as release_manual_token from public.creator_publishing_queue_tasks where id=(:'release_manual_fixture'::jsonb->>'task')::uuid \gset
update public.creator_publishing_queue_tasks set posted_by=(:'release_manual_fixture'::jsonb->>'creator')::uuid where id=(:'release_manual_fixture'::jsonb->>'task')::uuid;
select task17a_test.assert_release_rejected('release_manual_result_evidence_rejected','OPERATOR_TASK_INELIGIBLE',(:'release_manual_fixture'::jsonb->>'creator')::uuid,(:'release_manual_fixture'::jsonb->>'task')::uuid,(:'release_manual_fixture'::jsonb->>'job')::uuid,:'release_manual_token'::uuid,'relmanual');

\echo TASK17A_SCENARIO_START: release_changed_task_idempotency_conflict
select task17a_test.reset_fixture(929020) as release_conflict_fixture \gset
select task17a_test.create_additional_work(929920,(:'release_conflict_fixture'::jsonb->>'creator')::uuid,null,'ready_for_handoff','draft',false) as release_conflict_alt \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_conflict_fixture'::jsonb->>'creator')::uuid,(:'release_conflict_fixture'::jsonb->>'task')::uuid,(:'release_conflict_fixture'::jsonb->>'job')::uuid,:'release_conflict_fixture'::jsonb->>'consent_version',:'release_conflict_fixture'::jsonb->>'consent_hash','relconfclaim') as release_conflict_claim \gset
select claim_token as release_conflict_token from public.creator_publishing_queue_tasks where id=(:'release_conflict_fixture'::jsonb->>'task')::uuid \gset
select public.creator_publishing_release_onlyfans_operator_task((:'release_conflict_fixture'::jsonb->>'creator')::uuid,(:'release_conflict_fixture'::jsonb->>'task')::uuid,(:'release_conflict_fixture'::jsonb->>'job')::uuid,:'release_conflict_token'::uuid,'relconflict') as release_conflict_first \gset
select to_jsonb(q) as release_conflict_original_queue_snapshot from public.creator_publishing_queue_tasks q where id=(:'release_conflict_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_conflict_original_job_snapshot from public.creator_publishing_platform_jobs j where id=(:'release_conflict_fixture'::jsonb->>'job')::uuid \gset
select to_jsonb(q) as release_conflict_alternate_queue_snapshot from public.creator_publishing_queue_tasks q where id=(:'release_conflict_alt'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_conflict_alternate_job_snapshot from public.creator_publishing_platform_jobs j where id=(:'release_conflict_alt'::jsonb->>'job')::uuid \gset
select to_jsonb(i) as release_conflict_idempotency_snapshot from public.creator_publishing_operator_action_idempotency i where action_type='release' and idempotency_key='relconflict' \gset
select count(*) as release_conflict_success_audit_count from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='relconflict' \gset
select task17a_test.expect_error('release changed task conflict','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_release_onlyfans_operator_task(%L,%L,%L,%L,%L)',(:'release_conflict_fixture'::jsonb->>'creator'),(:'release_conflict_alt'::jsonb->>'task'),(:'release_conflict_fixture'::jsonb->>'job'),:'release_conflict_token','relconflict'));
select task17a_test.assert_release_conflict_preserved('release changed task conflict',(:'release_conflict_fixture'::jsonb->>'task')::uuid,(:'release_conflict_fixture'::jsonb->>'job')::uuid,(:'release_conflict_alt'::jsonb->>'task')::uuid,(:'release_conflict_alt'::jsonb->>'job')::uuid,(:'release_conflict_original_queue_snapshot')::jsonb,(:'release_conflict_original_job_snapshot')::jsonb,(:'release_conflict_alternate_queue_snapshot')::jsonb,(:'release_conflict_alternate_job_snapshot')::jsonb,(:'release_conflict_idempotency_snapshot')::jsonb,:'release_conflict_success_audit_count'::int);

\echo TASK17A_SCENARIO_START: release_changed_job_idempotency_conflict
select task17a_test.expect_error('release changed job conflict','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_release_onlyfans_operator_task(%L,%L,%L,%L,%L)',(:'release_conflict_fixture'::jsonb->>'creator'),(:'release_conflict_fixture'::jsonb->>'task'),(:'release_conflict_alt'::jsonb->>'job'),:'release_conflict_token','relconflict'));
select task17a_test.assert_release_conflict_preserved('release changed job conflict',(:'release_conflict_fixture'::jsonb->>'task')::uuid,(:'release_conflict_fixture'::jsonb->>'job')::uuid,(:'release_conflict_alt'::jsonb->>'task')::uuid,(:'release_conflict_alt'::jsonb->>'job')::uuid,(:'release_conflict_original_queue_snapshot')::jsonb,(:'release_conflict_original_job_snapshot')::jsonb,(:'release_conflict_alternate_queue_snapshot')::jsonb,(:'release_conflict_alternate_job_snapshot')::jsonb,(:'release_conflict_idempotency_snapshot')::jsonb,:'release_conflict_success_audit_count'::int);

\echo TASK17A_SCENARIO_START: release_changed_token_idempotency_conflict
select task17a_test.expect_error('release changed token conflict','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_release_onlyfans_operator_task(%L,%L,%L,%L,%L)',(:'release_conflict_fixture'::jsonb->>'creator'),(:'release_conflict_fixture'::jsonb->>'task'),(:'release_conflict_fixture'::jsonb->>'job'),'19940000-0000-4000-8000-000000929020','relconflict'));
select task17a_test.assert_release_conflict_preserved('release changed token conflict',(:'release_conflict_fixture'::jsonb->>'task')::uuid,(:'release_conflict_fixture'::jsonb->>'job')::uuid,(:'release_conflict_alt'::jsonb->>'task')::uuid,(:'release_conflict_alt'::jsonb->>'job')::uuid,(:'release_conflict_original_queue_snapshot')::jsonb,(:'release_conflict_original_job_snapshot')::jsonb,(:'release_conflict_alternate_queue_snapshot')::jsonb,(:'release_conflict_alternate_job_snapshot')::jsonb,(:'release_conflict_idempotency_snapshot')::jsonb,:'release_conflict_success_audit_count'::int);

\echo TASK17A_SCENARIO_START: release_drift_missing_intended_publish_at
select task17a_test.reset_fixture(929031,'scheduled_internally','scheduled_internally',true) as release_drift_intended_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_intended_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_intended_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_intended_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_missing_intended_publish_at',(:'release_drift_intended_fixture'::jsonb->>'task')::uuid,(:'release_drift_intended_fixture'::jsonb->>'job')::uuid,(:'release_drift_intended_fixture'::jsonb->>'creator')::uuid,:'release_drift_intended_fixture'::jsonb->>'consent_version',:'release_drift_intended_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_intended_fixture'::jsonb->>'creator')::uuid,(:'release_drift_intended_fixture'::jsonb->>'task')::uuid,(:'release_drift_intended_fixture'::jsonb->>'job')::uuid,:'release_drift_intended_fixture'::jsonb->>'consent_version',:'release_drift_intended_fixture'::jsonb->>'consent_hash','reldriftclaim31') as release_drift_intended_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_missing_intended_publish_at',(:'release_drift_intended_fixture'::jsonb->>'task')::uuid,(:'release_drift_intended_fixture'::jsonb->>'creator')::uuid,:'release_drift_intended_fixture_attempts_before'::int);
select claim_token as release_drift_intended_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_intended_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(q) as release_drift_intended_fixture_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'release_drift_intended_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_drift_intended_fixture_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'release_drift_intended_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set intended_publish_at=null where id=(:'release_drift_intended_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_missing_intended_publish_at','OPERATOR_TASK_INELIGIBLE',(:'release_drift_intended_fixture'::jsonb->>'creator')::uuid,(:'release_drift_intended_fixture'::jsonb->>'task')::uuid,(:'release_drift_intended_fixture'::jsonb->>'job')::uuid,:'release_drift_intended_fixture_token'::uuid,'reldrift31');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'release_drift_missing_intended_publish_at constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'release_drift_intended_fixture_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'release_drift_intended_fixture'::jsonb->>'task')::uuid), 'release_drift_missing_intended_publish_at queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'release_drift_intended_fixture_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'release_drift_intended_fixture'::jsonb->>'job')::uuid), 'release_drift_missing_intended_publish_at job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='reldrift31')=0, 'release_drift_missing_intended_publish_at no release audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='reldrift31')=0, 'release_drift_missing_intended_publish_at no release idempotency escaped rollback');
insert into task17a_release_rejections(label,key,task_id,job_id) values('release_drift_missing_intended_publish_at','reldrift31',(:'release_drift_intended_fixture'::jsonb->>'task')::uuid,(:'release_drift_intended_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: release_drift_missing_operator_due_at
select task17a_test.reset_fixture(929032,'scheduled_internally','scheduled_internally',true) as release_drift_operator_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_operator_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_operator_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_operator_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_missing_operator_due_at',(:'release_drift_operator_fixture'::jsonb->>'task')::uuid,(:'release_drift_operator_fixture'::jsonb->>'job')::uuid,(:'release_drift_operator_fixture'::jsonb->>'creator')::uuid,:'release_drift_operator_fixture'::jsonb->>'consent_version',:'release_drift_operator_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_operator_fixture'::jsonb->>'creator')::uuid,(:'release_drift_operator_fixture'::jsonb->>'task')::uuid,(:'release_drift_operator_fixture'::jsonb->>'job')::uuid,:'release_drift_operator_fixture'::jsonb->>'consent_version',:'release_drift_operator_fixture'::jsonb->>'consent_hash','reldriftclaim32') as release_drift_operator_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_missing_operator_due_at',(:'release_drift_operator_fixture'::jsonb->>'task')::uuid,(:'release_drift_operator_fixture'::jsonb->>'creator')::uuid,:'release_drift_operator_fixture_attempts_before'::int);
select claim_token as release_drift_operator_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_operator_fixture'::jsonb->>'task')::uuid \gset
update public.creator_publishing_platform_jobs set operator_due_at=null where id=(:'release_drift_operator_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_missing_operator_due_at','OPERATOR_TASK_INELIGIBLE',(:'release_drift_operator_fixture'::jsonb->>'creator')::uuid,(:'release_drift_operator_fixture'::jsonb->>'task')::uuid,(:'release_drift_operator_fixture'::jsonb->>'job')::uuid,:'release_drift_operator_fixture_token'::uuid,'reldrift32');

\echo TASK17A_SCENARIO_START: release_drift_missing_timezone
select task17a_test.reset_fixture(929033,'scheduled_internally','scheduled_internally',true) as release_drift_timezone_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_timezone_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_timezone_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_timezone_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_missing_timezone',(:'release_drift_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_timezone_fixture'::jsonb->>'job')::uuid,(:'release_drift_timezone_fixture'::jsonb->>'creator')::uuid,:'release_drift_timezone_fixture'::jsonb->>'consent_version',:'release_drift_timezone_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_timezone_fixture'::jsonb->>'creator')::uuid,(:'release_drift_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_timezone_fixture'::jsonb->>'job')::uuid,:'release_drift_timezone_fixture'::jsonb->>'consent_version',:'release_drift_timezone_fixture'::jsonb->>'consent_hash','reldriftclaim33') as release_drift_timezone_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_missing_timezone',(:'release_drift_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_timezone_fixture'::jsonb->>'creator')::uuid,:'release_drift_timezone_fixture_attempts_before'::int);
select claim_token as release_drift_timezone_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_timezone_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(q) as release_drift_timezone_fixture_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'release_drift_timezone_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_drift_timezone_fixture_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'release_drift_timezone_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set schedule_timezone=null where id=(:'release_drift_timezone_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_missing_timezone','OPERATOR_TASK_INELIGIBLE',(:'release_drift_timezone_fixture'::jsonb->>'creator')::uuid,(:'release_drift_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_timezone_fixture'::jsonb->>'job')::uuid,:'release_drift_timezone_fixture_token'::uuid,'reldrift33');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'release_drift_missing_timezone constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'release_drift_timezone_fixture_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'release_drift_timezone_fixture'::jsonb->>'task')::uuid), 'release_drift_missing_timezone queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'release_drift_timezone_fixture_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'release_drift_timezone_fixture'::jsonb->>'job')::uuid), 'release_drift_missing_timezone job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='reldrift33')=0, 'release_drift_missing_timezone no release audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='reldrift33')=0, 'release_drift_missing_timezone no release idempotency escaped rollback');
insert into task17a_release_rejections(label,key,task_id,job_id) values('release_drift_missing_timezone','reldrift33',(:'release_drift_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_timezone_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: release_drift_blank_timezone
select task17a_test.reset_fixture(929034,'scheduled_internally','scheduled_internally',true) as release_drift_blank_timezone_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_blank_timezone_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_blank_timezone_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_blank_timezone_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_blank_timezone',(:'release_drift_blank_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_blank_timezone_fixture'::jsonb->>'job')::uuid,(:'release_drift_blank_timezone_fixture'::jsonb->>'creator')::uuid,:'release_drift_blank_timezone_fixture'::jsonb->>'consent_version',:'release_drift_blank_timezone_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_blank_timezone_fixture'::jsonb->>'creator')::uuid,(:'release_drift_blank_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_blank_timezone_fixture'::jsonb->>'job')::uuid,:'release_drift_blank_timezone_fixture'::jsonb->>'consent_version',:'release_drift_blank_timezone_fixture'::jsonb->>'consent_hash','reldriftclaim34') as release_drift_blank_timezone_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_blank_timezone',(:'release_drift_blank_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_blank_timezone_fixture'::jsonb->>'creator')::uuid,:'release_drift_blank_timezone_fixture_attempts_before'::int);
select claim_token as release_drift_blank_timezone_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_blank_timezone_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(q) as release_drift_blank_timezone_fixture_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'release_drift_blank_timezone_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_drift_blank_timezone_fixture_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'release_drift_blank_timezone_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set schedule_timezone='   ' where id=(:'release_drift_blank_timezone_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_blank_timezone','OPERATOR_TASK_INELIGIBLE',(:'release_drift_blank_timezone_fixture'::jsonb->>'creator')::uuid,(:'release_drift_blank_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_blank_timezone_fixture'::jsonb->>'job')::uuid,:'release_drift_blank_timezone_fixture_token'::uuid,'reldrift34');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'release_drift_blank_timezone constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'release_drift_blank_timezone_fixture_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'release_drift_blank_timezone_fixture'::jsonb->>'task')::uuid), 'release_drift_blank_timezone queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'release_drift_blank_timezone_fixture_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'release_drift_blank_timezone_fixture'::jsonb->>'job')::uuid), 'release_drift_blank_timezone job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='reldrift34')=0, 'release_drift_blank_timezone no release audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='reldrift34')=0, 'release_drift_blank_timezone no release idempotency escaped rollback');
insert into task17a_release_rejections(label,key,task_id,job_id) values('release_drift_blank_timezone','reldrift34',(:'release_drift_blank_timezone_fixture'::jsonb->>'task')::uuid,(:'release_drift_blank_timezone_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: release_drift_missing_scheduled_at
select task17a_test.reset_fixture(929035,'scheduled_internally','scheduled_internally',true) as release_drift_scheduled_at_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_scheduled_at_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_scheduled_at_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_scheduled_at_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_missing_scheduled_at',(:'release_drift_scheduled_at_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_at_fixture'::jsonb->>'job')::uuid,(:'release_drift_scheduled_at_fixture'::jsonb->>'creator')::uuid,:'release_drift_scheduled_at_fixture'::jsonb->>'consent_version',:'release_drift_scheduled_at_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_scheduled_at_fixture'::jsonb->>'creator')::uuid,(:'release_drift_scheduled_at_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_at_fixture'::jsonb->>'job')::uuid,:'release_drift_scheduled_at_fixture'::jsonb->>'consent_version',:'release_drift_scheduled_at_fixture'::jsonb->>'consent_hash','reldriftclaim35') as release_drift_scheduled_at_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_missing_scheduled_at',(:'release_drift_scheduled_at_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_at_fixture'::jsonb->>'creator')::uuid,:'release_drift_scheduled_at_fixture_attempts_before'::int);
select claim_token as release_drift_scheduled_at_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_scheduled_at_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(q) as release_drift_scheduled_at_fixture_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'release_drift_scheduled_at_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_drift_scheduled_at_fixture_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'release_drift_scheduled_at_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set scheduled_at=null where id=(:'release_drift_scheduled_at_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_missing_scheduled_at','OPERATOR_TASK_INELIGIBLE',(:'release_drift_scheduled_at_fixture'::jsonb->>'creator')::uuid,(:'release_drift_scheduled_at_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_at_fixture'::jsonb->>'job')::uuid,:'release_drift_scheduled_at_fixture_token'::uuid,'reldrift35');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'release_drift_missing_scheduled_at constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'release_drift_scheduled_at_fixture_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'release_drift_scheduled_at_fixture'::jsonb->>'task')::uuid), 'release_drift_missing_scheduled_at queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'release_drift_scheduled_at_fixture_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'release_drift_scheduled_at_fixture'::jsonb->>'job')::uuid), 'release_drift_missing_scheduled_at job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='reldrift35')=0, 'release_drift_missing_scheduled_at no release audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='reldrift35')=0, 'release_drift_missing_scheduled_at no release idempotency escaped rollback');
insert into task17a_release_rejections(label,key,task_id,job_id) values('release_drift_missing_scheduled_at','reldrift35',(:'release_drift_scheduled_at_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_at_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: release_drift_missing_scheduled_by
select task17a_test.reset_fixture(929036,'scheduled_internally','scheduled_internally',true) as release_drift_scheduled_by_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_scheduled_by_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_scheduled_by_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_scheduled_by_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_missing_scheduled_by',(:'release_drift_scheduled_by_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_by_fixture'::jsonb->>'job')::uuid,(:'release_drift_scheduled_by_fixture'::jsonb->>'creator')::uuid,:'release_drift_scheduled_by_fixture'::jsonb->>'consent_version',:'release_drift_scheduled_by_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_scheduled_by_fixture'::jsonb->>'creator')::uuid,(:'release_drift_scheduled_by_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_by_fixture'::jsonb->>'job')::uuid,:'release_drift_scheduled_by_fixture'::jsonb->>'consent_version',:'release_drift_scheduled_by_fixture'::jsonb->>'consent_hash','reldriftclaim36') as release_drift_scheduled_by_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_missing_scheduled_by',(:'release_drift_scheduled_by_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_by_fixture'::jsonb->>'creator')::uuid,:'release_drift_scheduled_by_fixture_attempts_before'::int);
select claim_token as release_drift_scheduled_by_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_scheduled_by_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(q) as release_drift_scheduled_by_fixture_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'release_drift_scheduled_by_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_drift_scheduled_by_fixture_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'release_drift_scheduled_by_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set scheduled_by=null where id=(:'release_drift_scheduled_by_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_missing_scheduled_by','OPERATOR_TASK_INELIGIBLE',(:'release_drift_scheduled_by_fixture'::jsonb->>'creator')::uuid,(:'release_drift_scheduled_by_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_by_fixture'::jsonb->>'job')::uuid,:'release_drift_scheduled_by_fixture_token'::uuid,'reldrift36');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'release_drift_missing_scheduled_by constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'release_drift_scheduled_by_fixture_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'release_drift_scheduled_by_fixture'::jsonb->>'task')::uuid), 'release_drift_missing_scheduled_by queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'release_drift_scheduled_by_fixture_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'release_drift_scheduled_by_fixture'::jsonb->>'job')::uuid), 'release_drift_missing_scheduled_by job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='reldrift36')=0, 'release_drift_missing_scheduled_by no release audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='reldrift36')=0, 'release_drift_missing_scheduled_by no release idempotency escaped rollback');
insert into task17a_release_rejections(label,key,task_id,job_id) values('release_drift_missing_scheduled_by','reldrift36',(:'release_drift_scheduled_by_fixture'::jsonb->>'task')::uuid,(:'release_drift_scheduled_by_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: release_drift_zero_schedule_revision
select task17a_test.reset_fixture(929037,'scheduled_internally','scheduled_internally',true) as release_drift_zero_revision_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_zero_revision_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_zero_revision_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_zero_revision_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_zero_schedule_revision',(:'release_drift_zero_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_zero_revision_fixture'::jsonb->>'job')::uuid,(:'release_drift_zero_revision_fixture'::jsonb->>'creator')::uuid,:'release_drift_zero_revision_fixture'::jsonb->>'consent_version',:'release_drift_zero_revision_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_zero_revision_fixture'::jsonb->>'creator')::uuid,(:'release_drift_zero_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_zero_revision_fixture'::jsonb->>'job')::uuid,:'release_drift_zero_revision_fixture'::jsonb->>'consent_version',:'release_drift_zero_revision_fixture'::jsonb->>'consent_hash','reldriftclaim37') as release_drift_zero_revision_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_zero_schedule_revision',(:'release_drift_zero_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_zero_revision_fixture'::jsonb->>'creator')::uuid,:'release_drift_zero_revision_fixture_attempts_before'::int);
select claim_token as release_drift_zero_revision_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_zero_revision_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(q) as release_drift_zero_revision_fixture_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'release_drift_zero_revision_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_drift_zero_revision_fixture_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'release_drift_zero_revision_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_schedule_revision_positive;
update public.creator_publishing_platform_jobs set schedule_revision=0 where id=(:'release_drift_zero_revision_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_zero_schedule_revision','OPERATOR_TASK_INELIGIBLE',(:'release_drift_zero_revision_fixture'::jsonb->>'creator')::uuid,(:'release_drift_zero_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_zero_revision_fixture'::jsonb->>'job')::uuid,:'release_drift_zero_revision_fixture_token'::uuid,'reldrift37');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_schedule_revision_positive'), 'release_drift_zero_schedule_revision constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'release_drift_zero_revision_fixture_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'release_drift_zero_revision_fixture'::jsonb->>'task')::uuid), 'release_drift_zero_schedule_revision queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'release_drift_zero_revision_fixture_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'release_drift_zero_revision_fixture'::jsonb->>'job')::uuid), 'release_drift_zero_schedule_revision job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='reldrift37')=0, 'release_drift_zero_schedule_revision no release audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='reldrift37')=0, 'release_drift_zero_schedule_revision no release idempotency escaped rollback');
insert into task17a_release_rejections(label,key,task_id,job_id) values('release_drift_zero_schedule_revision','reldrift37',(:'release_drift_zero_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_zero_revision_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: release_drift_negative_schedule_revision
select task17a_test.reset_fixture(929038,'scheduled_internally','scheduled_internally',true) as release_drift_negative_revision_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_negative_revision_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_negative_revision_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_negative_revision_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_negative_schedule_revision',(:'release_drift_negative_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_negative_revision_fixture'::jsonb->>'job')::uuid,(:'release_drift_negative_revision_fixture'::jsonb->>'creator')::uuid,:'release_drift_negative_revision_fixture'::jsonb->>'consent_version',:'release_drift_negative_revision_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_negative_revision_fixture'::jsonb->>'creator')::uuid,(:'release_drift_negative_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_negative_revision_fixture'::jsonb->>'job')::uuid,:'release_drift_negative_revision_fixture'::jsonb->>'consent_version',:'release_drift_negative_revision_fixture'::jsonb->>'consent_hash','reldriftclaim38') as release_drift_negative_revision_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_negative_schedule_revision',(:'release_drift_negative_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_negative_revision_fixture'::jsonb->>'creator')::uuid,:'release_drift_negative_revision_fixture_attempts_before'::int);
select claim_token as release_drift_negative_revision_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_negative_revision_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(q) as release_drift_negative_revision_fixture_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'release_drift_negative_revision_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_drift_negative_revision_fixture_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'release_drift_negative_revision_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_schedule_revision_positive;
update public.creator_publishing_platform_jobs set schedule_revision=-1 where id=(:'release_drift_negative_revision_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_negative_schedule_revision','OPERATOR_TASK_INELIGIBLE',(:'release_drift_negative_revision_fixture'::jsonb->>'creator')::uuid,(:'release_drift_negative_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_negative_revision_fixture'::jsonb->>'job')::uuid,:'release_drift_negative_revision_fixture_token'::uuid,'reldrift38');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_schedule_revision_positive'), 'release_drift_negative_schedule_revision constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'release_drift_negative_revision_fixture_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'release_drift_negative_revision_fixture'::jsonb->>'task')::uuid), 'release_drift_negative_schedule_revision queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'release_drift_negative_revision_fixture_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'release_drift_negative_revision_fixture'::jsonb->>'job')::uuid), 'release_drift_negative_schedule_revision job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='reldrift38')=0, 'release_drift_negative_schedule_revision no release audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='reldrift38')=0, 'release_drift_negative_schedule_revision no release idempotency escaped rollback');
insert into task17a_release_rejections(label,key,task_id,job_id) values('release_drift_negative_schedule_revision','reldrift38',(:'release_drift_negative_revision_fixture'::jsonb->>'task')::uuid,(:'release_drift_negative_revision_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: release_drift_operator_offset_not_60_minutes
select task17a_test.reset_fixture(929039,'scheduled_internally','scheduled_internally',true) as release_drift_offset_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_offset_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_offset_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_offset_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_operator_offset_not_60_minutes',(:'release_drift_offset_fixture'::jsonb->>'task')::uuid,(:'release_drift_offset_fixture'::jsonb->>'job')::uuid,(:'release_drift_offset_fixture'::jsonb->>'creator')::uuid,:'release_drift_offset_fixture'::jsonb->>'consent_version',:'release_drift_offset_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_offset_fixture'::jsonb->>'creator')::uuid,(:'release_drift_offset_fixture'::jsonb->>'task')::uuid,(:'release_drift_offset_fixture'::jsonb->>'job')::uuid,:'release_drift_offset_fixture'::jsonb->>'consent_version',:'release_drift_offset_fixture'::jsonb->>'consent_hash','reldriftclaim39') as release_drift_offset_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_operator_offset_not_60_minutes',(:'release_drift_offset_fixture'::jsonb->>'task')::uuid,(:'release_drift_offset_fixture'::jsonb->>'creator')::uuid,:'release_drift_offset_fixture_attempts_before'::int);
select claim_token as release_drift_offset_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_offset_fixture'::jsonb->>'task')::uuid \gset
update public.creator_publishing_platform_jobs set operator_due_at=intended_publish_at - interval '30 minutes' where id=(:'release_drift_offset_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_operator_offset_not_60_minutes','OPERATOR_TASK_INELIGIBLE',(:'release_drift_offset_fixture'::jsonb->>'creator')::uuid,(:'release_drift_offset_fixture'::jsonb->>'task')::uuid,(:'release_drift_offset_fixture'::jsonb->>'job')::uuid,:'release_drift_offset_fixture_token'::uuid,'reldrift39');

\echo TASK17A_SCENARIO_START: release_drift_job_state_inconsistent_with_schedule
select task17a_test.reset_fixture(929040,'scheduled_internally','scheduled_internally',true) as release_drift_job_state_fixture \gset
select task17a_test.set_valid_schedule_phase((:'release_drift_job_state_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select claim_attempt_count as release_drift_job_state_fixture_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_job_state_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_job_state_inconsistent_with_schedule',(:'release_drift_job_state_fixture'::jsonb->>'task')::uuid,(:'release_drift_job_state_fixture'::jsonb->>'job')::uuid,(:'release_drift_job_state_fixture'::jsonb->>'creator')::uuid,:'release_drift_job_state_fixture'::jsonb->>'consent_version',:'release_drift_job_state_fixture'::jsonb->>'consent_hash',true);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_job_state_fixture'::jsonb->>'creator')::uuid,(:'release_drift_job_state_fixture'::jsonb->>'task')::uuid,(:'release_drift_job_state_fixture'::jsonb->>'job')::uuid,:'release_drift_job_state_fixture'::jsonb->>'consent_version',:'release_drift_job_state_fixture'::jsonb->>'consent_hash','reldriftclaim40') as release_drift_job_state_fixture_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_job_state_inconsistent_with_schedule',(:'release_drift_job_state_fixture'::jsonb->>'task')::uuid,(:'release_drift_job_state_fixture'::jsonb->>'creator')::uuid,:'release_drift_job_state_fixture_attempts_before'::int);
select claim_token as release_drift_job_state_fixture_token from public.creator_publishing_queue_tasks where id=(:'release_drift_job_state_fixture'::jsonb->>'task')::uuid \gset
update public.creator_publishing_platform_jobs set job_state='needs_fix' where id=(:'release_drift_job_state_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_job_state_inconsistent_with_schedule','OPERATOR_TASK_INELIGIBLE',(:'release_drift_job_state_fixture'::jsonb->>'creator')::uuid,(:'release_drift_job_state_fixture'::jsonb->>'task')::uuid,(:'release_drift_job_state_fixture'::jsonb->>'job')::uuid,:'release_drift_job_state_fixture_token'::uuid,'reldrift40');

\echo TASK17A_SCENARIO_START: release_drift_unscheduled_job_with_schedule_fields
select task17a_test.reset_fixture(929041) as release_drift_unscheduled_fields_fixture \gset
select claim_attempt_count as release_drift_unscheduled_fields_attempts_before from public.creator_publishing_queue_tasks where id=(:'release_drift_unscheduled_fields_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert_release_claimable_setup('release_drift_unscheduled_job_with_schedule_fields',(:'release_drift_unscheduled_fields_fixture'::jsonb->>'task')::uuid,(:'release_drift_unscheduled_fields_fixture'::jsonb->>'job')::uuid,(:'release_drift_unscheduled_fields_fixture'::jsonb->>'creator')::uuid,:'release_drift_unscheduled_fields_fixture'::jsonb->>'consent_version',:'release_drift_unscheduled_fields_fixture'::jsonb->>'consent_hash',false);
select public.creator_publishing_claim_onlyfans_operator_task((:'release_drift_unscheduled_fields_fixture'::jsonb->>'creator')::uuid,(:'release_drift_unscheduled_fields_fixture'::jsonb->>'task')::uuid,(:'release_drift_unscheduled_fields_fixture'::jsonb->>'job')::uuid,:'release_drift_unscheduled_fields_fixture'::jsonb->>'consent_version',:'release_drift_unscheduled_fields_fixture'::jsonb->>'consent_hash','reldriftclaim41') as release_drift_unscheduled_fields_claim \gset
select task17a_test.assert_release_claimed_setup('release_drift_unscheduled_job_with_schedule_fields',(:'release_drift_unscheduled_fields_fixture'::jsonb->>'task')::uuid,(:'release_drift_unscheduled_fields_fixture'::jsonb->>'creator')::uuid,:'release_drift_unscheduled_fields_attempts_before'::int);
select claim_token as release_drift_unscheduled_fields_token from public.creator_publishing_queue_tasks where id=(:'release_drift_unscheduled_fields_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(q) as release_drift_unscheduled_fields_fixture_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'release_drift_unscheduled_fields_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as release_drift_unscheduled_fields_fixture_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'release_drift_unscheduled_fields_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_unscheduled_fields_null;
update public.creator_publishing_platform_jobs set intended_publish_at=clock_timestamp()+interval '2 hours', schedule_timezone='UTC', operator_due_at=clock_timestamp()+interval '1 hour', scheduled_at=clock_timestamp(), scheduled_by=(:'release_drift_unscheduled_fields_fixture'::jsonb->>'creator')::uuid where id=(:'release_drift_unscheduled_fields_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_release_rejected('release_drift_unscheduled_job_with_schedule_fields','OPERATOR_TASK_INELIGIBLE',(:'release_drift_unscheduled_fields_fixture'::jsonb->>'creator')::uuid,(:'release_drift_unscheduled_fields_fixture'::jsonb->>'task')::uuid,(:'release_drift_unscheduled_fields_fixture'::jsonb->>'job')::uuid,:'release_drift_unscheduled_fields_fixture_token'::uuid,'reldrift41');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_unscheduled_fields_null'), 'release_drift_unscheduled_job_with_schedule_fields constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'release_drift_unscheduled_fields_fixture_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'release_drift_unscheduled_fields_fixture'::jsonb->>'task')::uuid), 'release_drift_unscheduled_job_with_schedule_fields queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'release_drift_unscheduled_fields_fixture_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'release_drift_unscheduled_fields_fixture'::jsonb->>'job')::uuid), 'release_drift_unscheduled_job_with_schedule_fields job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key='reldrift41')=0, 'release_drift_unscheduled_job_with_schedule_fields no release audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key='reldrift41')=0, 'release_drift_unscheduled_job_with_schedule_fields no release idempotency escaped rollback');
insert into task17a_release_rejections(label,key,task_id,job_id) values('release_drift_unscheduled_job_with_schedule_fields','reldrift41',(:'release_drift_unscheduled_fields_fixture'::jsonb->>'task')::uuid,(:'release_drift_unscheduled_fields_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: release_complete_audit_idempotency_counts
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key in ('relrestore01','relrestore02','relrestore03','relrestore04','relreplay01','relconflict'))=6, 'release aggregate successful audit count');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key in ('relrestore01','relrestore02','relrestore03','relrestore04','relreplay01','relconflict'))=6, 'release aggregate successful idempotency count');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_released' and (before_state ? 'claim_token' or after_state ? 'claim_token')), 'release aggregate audits omit claim token');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key in (select key from task17a_release_rejections)), 'release aggregate rejected keys wrote no idempotency');

\echo TASK17A_SCENARIO_START: release_complete_no_mutation_assertions
select task17a_test.assert((select count(*) from task17a_release_rejections) >= 26, 'release no-mutation rejection registry populated');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_released' and idempotency_key in (select key from task17a_release_rejections)), 'release rejected keys wrote no success audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='release' and idempotency_key in (select key from task17a_release_rejections)), 'release rejected keys wrote no idempotency');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_queue_tasks where id in (select task_id from task17a_release_rejections where task_id is not null) and (posted_by is not null or posted_at is not null or posted_confirmation is true or final_post_url is not null or final_post_url_skip_reason is not null or proof_screenshot_storage_key is not null or skip_or_fail_reason is not null) and id not in ((:'release_manual_fixture'::jsonb->>'task')::uuid)), 'release rejected tasks wrote no new Task 18 fields except deliberate manual-result fixture');
