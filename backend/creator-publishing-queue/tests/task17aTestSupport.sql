\set ON_ERROR_STOP on
create schema if not exists task17a_test;
create or replace function task17a_test.assert(ok boolean, label text) returns void language plpgsql as $$ begin if not ok then raise exception 'TASK17A_ASSERT:%', label; end if; end $$;
create or replace function task17a_test.expect_error(label text, expected text, statement text) returns void language plpgsql as $$
declare
  v_saw_expected_error boolean := false;
begin
  begin
    execute statement;
  exception when others then
    if sqlerrm not like '%' || expected || '%' then
      raise exception 'TASK17A_ASSERT:% expected %, got %', label, expected, sqlerrm;
    end if;
    v_saw_expected_error := true;
  end;
  if not v_saw_expected_error then
    raise exception 'TASK17A_ASSERT:% expected %, but statement succeeded', label, expected;
  end if;
end $$;
create or replace function task17a_test.raise_text(message text) returns void language plpgsql as $$ begin raise exception '%', message; end $$;
do $$
declare
  v_failed boolean;
begin
  perform task17a_test.expect_error('expect_error self expected','EXPECTED','select task17a_test.raise_text(''EXPECTED'')');
  v_failed := false;
  begin
    perform task17a_test.expect_error('expect_error self wrong','EXPECTED','select task17a_test.raise_text(''OTHER'')');
  exception when others then
    if sqlerrm like '%expected EXPECTED, got OTHER%' then v_failed := true; else raise; end if;
  end;
  perform task17a_test.assert(v_failed, 'expect_error self-test rejects wrong error');
  v_failed := false;
  begin
    perform task17a_test.expect_error('expect_error self no error','EXPECTED','create temporary table if not exists task17a_expect_error_noop(x integer) on commit drop');
  exception when others then
    if sqlerrm like '%expected EXPECTED, but statement succeeded%' then v_failed := true; else raise; end if;
  end;
  perform task17a_test.assert(v_failed, 'expect_error self-test rejects missing error');
end $$;
create or replace function task17a_test.uuid_for(prefix text, seed integer) returns uuid language sql immutable as $$
  select (substr(prefix,1,24) || lpad(seed::text,12,'0'))::uuid;
$$;
create or replace function task17a_test.reset_fixture(seed integer, queue_status text default 'ready_for_handoff', job_state text default 'draft', scheduled boolean default false)
returns jsonb language plpgsql as $$
declare
  v_creator uuid := task17a_test.uuid_for('17000000-0000-4000-8000-', seed);
  v_operator_a uuid := task17a_test.uuid_for('17000001-0000-4000-8000-', seed);
  v_operator_b uuid := task17a_test.uuid_for('17000002-0000-4000-8000-', seed);
  v_unauthorized uuid := task17a_test.uuid_for('17000003-0000-4000-8000-', seed);
  v_revoked uuid := task17a_test.uuid_for('17000004-0000-4000-8000-', seed);
  v_other_creator uuid := task17a_test.uuid_for('17000005-0000-4000-8000-', seed);
  v_global_only uuid := task17a_test.uuid_for('17000006-0000-4000-8000-', seed);
  v_account uuid := task17a_test.uuid_for('17100000-0000-4000-8000-', seed);
  v_package uuid := task17a_test.uuid_for('17200000-0000-4000-8000-', seed);
  v_generation uuid := task17a_test.uuid_for('17300000-0000-4000-8000-', seed);
  v_media uuid := task17a_test.uuid_for('17400000-0000-4000-8000-', seed);
  v_plan uuid := task17a_test.uuid_for('17500000-0000-4000-8000-', seed);
  v_job uuid := task17a_test.uuid_for('17600000-0000-4000-8000-', seed);
  v_task uuid := task17a_test.uuid_for('17700000-0000-4000-8000-', seed);
  v_now timestamptz := clock_timestamp();
  v_updated timestamptz;
  v_fingerprint text;
begin
  delete from public.creator_publishing_operator_action_idempotency where queue_task_id=v_task or platform_job_id=v_job;
  delete from public.creator_publishing_operator_authorizations where creator_id in (v_creator,v_other_creator) or operator_id in (v_operator_a,v_operator_b,v_unauthorized,v_revoked,v_global_only);
  delete from public.creator_publishing_queue_tasks where id=v_task or content_package_id=v_package;
  delete from public.creator_publishing_scheduler_events where platform_job_id=v_job;
  delete from public.creator_publishing_platform_jobs where id=v_job or content_package_id=v_package;
  delete from public.creator_publishing_plans where id=v_plan;
  delete from public.creator_publishing_co_performer_records where content_package_id=v_package;
  delete from public.creator_publishing_compliance_reviews where content_package_id=v_package;
  delete from public.creator_publishing_media_assets where id=v_media or content_package_id=v_package;
  delete from public.creator_publishing_content_packages where id=v_package;
  delete from public.creator_platform_accounts where id=v_account;
  delete from public.creator_publishing_ai_twin_consents where creator_id in (v_creator,v_other_creator);
  delete from public.creator_publishing_creator_verifications where creator_id in (v_creator,v_other_creator);
  delete from public.creator_publishing_trusted_reviewers where reviewer_id=v_global_only;
  insert into auth.users(id,email) values (v_creator,'creator'||seed||'@example.test'),(v_operator_a,'opa'||seed||'@example.test'),(v_operator_b,'opb'||seed||'@example.test'),(v_unauthorized,'unauth'||seed||'@example.test'),(v_revoked,'revoked'||seed||'@example.test'),(v_other_creator,'other'||seed||'@example.test'),(v_global_only,'global'||seed||'@example.test') on conflict (id) do nothing;
  insert into public.creator_publishing_trusted_reviewers(reviewer_id,role,active,created_at) values(v_global_only,'operator',true,v_now) on conflict (reviewer_id) do update set role='operator', active=true, revoked_at=null;
  insert into public.creator_publishing_creator_verifications(creator_id,status,evidence_reference,reason,reviewed_by,reviewed_at) values(v_creator,'verified','evidence','verified',v_global_only,v_now) on conflict (creator_id) do update set status='verified', evidence_reference='evidence', reason='verified', reviewed_by=v_global_only, reviewed_at=v_now;
  insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_attested_at,is_virtual_entity,verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason) values(v_account,v_creator,'onlyfans','creator'||seed,'verified',v_now,false,v_global_only,v_now,'account evidence','verified');
  insert into public.creator_publishing_ai_twin_consents(creator_id,status,attestation_version,attestation_text_sha256,granted_at) values(v_creator,'granted','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',v_now) on conflict (creator_id) do update set status='granted', attestation_version='creator-ai-twin-consent-v1', attestation_text_sha256='0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12', granted_at=v_now, revoked_at=null;
  insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,compliance_status,compliance_policy_version,creator_approval_status,created_at,updated_at) values(v_package,v_creator,v_account,'onlyfans','Task17A package '||seed,'caption','#AI','ai_generated','{}','pending','unassigned','pending',v_now,v_now);
  insert into public.generations(id,user_id,status,r2_bucket,r2_key,metadata) values(v_generation,v_creator,'completed','bucket','task17a/'||seed,'{}') on conflict (id) do nothing;
  insert into public.creator_publishing_media_assets(id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at) values(v_media,v_package,'media/task17a/'||seed,'image/png','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','ai_pipeline',jsonb_build_object('generation_id',v_generation::text),v_now);
  insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata) values(v_package,v_global_only,'pass','automated','[]','policy-v1',v_now,'{}');
  update public.creator_publishing_content_packages set compliance_status='passed', compliance_policy_version='policy-v1', creator_approval_status='approved', creator_approved_at=v_now, creator_approved_by=v_creator where id=v_package;
  select updated_at, public.creator_publishing_autopost_source_fingerprint(v_package) into v_updated, v_fingerprint from public.creator_publishing_content_packages where id=v_package;
  insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at) values(v_plan,v_creator,'draft','task17a-plan-'||seed,'1111111111111111111111111111111111111111111111111111111111111111','task14.20260711.001',v_now,v_now);
  insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at,intended_publish_at,operator_due_at,schedule_timezone,schedule_revision,scheduled_at,scheduled_by) values(v_job,v_plan,v_creator,v_package,v_account,'onlyfans','assisted',job_state,v_updated,v_fingerprint,'task14.20260711.001','2222222222222222222222222222222222222222222222222222222222222222',v_now,v_now,case when scheduled then v_now+interval '2 hours' else null end,case when scheduled then v_now+interval '1 hour' else null end,case when scheduled then 'UTC' else null end,case when scheduled then 1 else null end,case when scheduled then v_now else null end,case when scheduled then v_creator else null end);
  insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,due_at,created_at,updated_at,assigned_operator_id) values(v_task,v_package,v_creator,'onlyfans',v_account,queue_status,null,v_now,v_now,v_operator_b);
  insert into public.creator_publishing_operator_authorizations(creator_id,operator_id,platform,status,authorized_at) values(v_creator,v_operator_a,'onlyfans','active',v_now),(v_creator,v_operator_b,'onlyfans','active',v_now),(v_creator,v_revoked,'onlyfans','active',v_now) on conflict do nothing;
  update public.creator_publishing_operator_authorizations set status='revoked', revoked_at=v_now where creator_id=v_creator and operator_id=v_revoked;
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_operator_authorizations where creator_id=v_creator and operator_id=v_revoked and status='revoked' and revoked_at is not null and revoked_at >= authorized_at), 'revoked authorization fixture is constraint-valid');
  perform task17a_test.assert(public.creator_publishing_operator_is_authorized(v_creator,v_revoked,'onlyfans') is false, 'revoked authorization helper returns false');
  insert into public.creator_publishing_operator_authorizations(creator_id,operator_id,platform,status,authorized_at) values(v_other_creator,v_unauthorized,'onlyfans','active',v_now) on conflict do nothing;
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_content_packages where id=v_package and compliance_policy_version='policy-v1' and creator_approval_status='approved' and compliance_status='passed'), 'fixture package exists approved with policy-v1');
  perform task17a_test.assert(exists(select 1 from public.creator_platform_accounts where id=v_account and creator_id=v_creator and platform='onlyfans' and verification_status='verified'), 'fixture account verified');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_creator_verifications where creator_id=v_creator and status='verified'), 'fixture creator verified');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_ai_twin_consents where creator_id=v_creator and status='granted' and revoked_at is null and attestation_version='creator-ai-twin-consent-v1' and attestation_text_sha256='0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12'), 'fixture consent current');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_platform_jobs where id=v_job and source_package_updated_at=v_updated and source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(v_package)), 'fixture source fingerprint current');
  perform task17a_test.assert((select count(*) from public.creator_publishing_queue_tasks where content_package_id=v_package and creator_id=v_creator and target_platform='onlyfans' and platform_account_id=v_account and status not in ('archived','skipped','failed_manual_upload','confirmed_posted_manual'))=1, 'fixture exactly one active queue task');
  perform task17a_test.assert(public.creator_publishing_operator_is_authorized(v_creator,v_creator,'onlyfans') and public.creator_publishing_operator_is_authorized(v_creator,v_operator_a,'onlyfans') and public.creator_publishing_operator_is_authorized(v_creator,v_operator_b,'onlyfans') and not public.creator_publishing_operator_is_authorized(v_creator,v_unauthorized,'onlyfans') and not public.creator_publishing_operator_is_authorized(v_creator,v_revoked,'onlyfans'), 'fixture authorization matrix valid');
  perform task17a_test.assert((not scheduled and exists(select 1 from public.creator_publishing_platform_jobs where id=v_job and schedule_revision is null and intended_publish_at is null and operator_due_at is null and schedule_timezone is null and scheduled_at is null and scheduled_by is null)) or (scheduled and exists(select 1 from public.creator_publishing_platform_jobs where id=v_job and schedule_revision=1 and intended_publish_at is not null and operator_due_at is not null and schedule_timezone='UTC' and scheduled_at is not null and scheduled_by=v_creator)), 'fixture scheduling fields valid');
  return jsonb_build_object('creator',v_creator,'operator_a',v_operator_a,'operator_b',v_operator_b,'unauthorized',v_unauthorized,'revoked',v_revoked,'other_creator',v_other_creator,'global_only',v_global_only,'account',v_account,'package',v_package,'plan',v_plan,'job',v_job,'task',v_task,'consent_version','creator-ai-twin-consent-v1','consent_hash','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12');
end $$;


create or replace function task17a_test.set_valid_schedule_phase(p_job_id uuid, p_phase text, p_schedule_revision integer default null)
returns void language plpgsql as $$
declare
  v_now timestamptz := clock_timestamp();
  v_intended timestamptz;
  v_operator_due timestamptz;
  v_creator uuid;
  v_revision integer;
begin
  select creator_id, coalesce(p_schedule_revision, schedule_revision, 1)
  into v_creator, v_revision
  from public.creator_publishing_platform_jobs
  where id=p_job_id;
  if not found then
    raise exception 'TASK17A_SCHEDULE_FIXTURE_JOB_NOT_FOUND';
  end if;
  if v_revision is null or v_revision <= 0 then
    raise exception 'TASK17A_SCHEDULE_FIXTURE_REVISION_INVALID';
  end if;

  if p_phase='before_operator_due' then
    v_intended := v_now + interval '2 hours';
    v_operator_due := v_now + interval '1 hour';
  elsif p_phase='after_operator_due' then
    v_intended := v_now + interval '59 minutes';
    v_operator_due := v_now - interval '1 minute';
  elsif p_phase='after_publish_due' then
    v_intended := v_now - interval '1 minute';
    v_operator_due := v_now - interval '61 minutes';
  else
    raise exception 'TASK17A_SCHEDULE_FIXTURE_PHASE_UNSUPPORTED';
  end if;

  update public.creator_publishing_platform_jobs
  set intended_publish_at=v_intended,
      operator_due_at=v_operator_due,
      schedule_timezone=coalesce(nullif(schedule_timezone,''),'UTC'),
      schedule_revision=v_revision,
      scheduled_at=coalesce(scheduled_at,v_now),
      scheduled_by=coalesce(scheduled_by,v_creator)
  where id=p_job_id;

  perform task17a_test.assert(exists(
    select 1
    from public.creator_publishing_platform_jobs
    where id=p_job_id
      and schedule_revision is not null
      and schedule_revision > 0
      and intended_publish_at is not null
      and operator_due_at is not null
      and length(btrim(coalesce(schedule_timezone,''))) > 0
      and scheduled_at is not null
      and scheduled_by is not null
      and operator_due_at = intended_publish_at - interval '60 minutes'
  ), 'valid schedule phase exact sixty minute offset');

  perform task17a_test.assert(
    (p_phase='before_operator_due' and exists(select 1 from public.creator_publishing_platform_jobs where id=p_job_id and operator_due_at > clock_timestamp()))
    or (p_phase='after_operator_due' and exists(select 1 from public.creator_publishing_platform_jobs where id=p_job_id and operator_due_at <= clock_timestamp() and intended_publish_at > clock_timestamp()))
    or (p_phase='after_publish_due' and exists(select 1 from public.creator_publishing_platform_jobs where id=p_job_id and intended_publish_at <= clock_timestamp())),
    'valid schedule phase requested time window holds'
  );
end $$;


create or replace function task17a_test.expire_claim(p_task_id uuid) returns void language plpgsql as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  update public.creator_publishing_queue_tasks
  set claimed_at = v_now - interval '30 minutes',
      claim_expires_at = v_now - interval '1 second'
  where id = p_task_id;
  perform task17a_test.assert(exists(
    select 1 from public.creator_publishing_queue_tasks
    where id=p_task_id
      and status='claimed'
      and claimed_by is not null
      and claimed_at is not null
      and claim_token is not null
      and claim_expires_at is not null
      and claim_expires_at > claimed_at
      and claim_expires_at <= claimed_at + interval '30 minutes'
      and claim_expires_at < clock_timestamp()
  ), 'expired_claim_fixture_valid');
end $$;

create or replace function task17a_test.recovery_preserved_snapshot(p_task_id uuid)
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

create or replace function task17a_test.assert_recovery_claimed_expired(p_label text,p_task_id uuid,p_actor_id uuid,p_attempts_before integer default null)
returns void language plpgsql as $$
begin
  perform task17a_test.assert((select status='claimed' and claimed_by=p_actor_id and claimed_at is not null and claim_token is not null and claim_expires_at is not null and claim_expires_at < clock_timestamp() and (p_attempts_before is null or claim_attempt_count=p_attempts_before+1) from public.creator_publishing_queue_tasks where id=p_task_id), p_label || ' expired claimed ownership tuple valid');
end $$;

create or replace function task17a_test.assert_recovery_rejected(p_label text,p_expected_error text,p_actor_id uuid,p_task_id uuid,p_job_id uuid,p_idempotency_key text)
returns void language plpgsql as $$
declare before_task jsonb; after_task jsonb; before_job jsonb; after_job jsonb; before_audits integer; after_audits integer; before_idem integer; after_idem integer;
begin
  select to_jsonb(q) into before_task from public.creator_publishing_queue_tasks q where id=p_task_id;
  select to_jsonb(j) into before_job from public.creator_publishing_platform_jobs j where id=p_job_id;
  select count(*) into before_audits from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key=p_idempotency_key;
  select count(*) into before_idem from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key=p_idempotency_key;
  begin
    perform public.creator_publishing_recover_expired_onlyfans_operator_claim(p_actor_id,p_task_id,p_job_id,p_idempotency_key);
    raise exception 'TASK17A_EXPECTED_RECOVERY_REJECTION_NOT_RAISED:%', p_label;
  exception when others then
    if sqlerrm not like '%' || p_expected_error || '%' then
      raise exception 'TASK17A_UNEXPECTED_RECOVERY_ERROR:% expected:% actual:%', p_label, p_expected_error, sqlerrm;
    end if;
  end;
  select to_jsonb(q) into after_task from public.creator_publishing_queue_tasks q where id=p_task_id;
  select to_jsonb(j) into after_job from public.creator_publishing_platform_jobs j where id=p_job_id;
  select count(*) into after_audits from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key=p_idempotency_key;
  select count(*) into after_idem from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key=p_idempotency_key;
  perform task17a_test.assert(before_task is not distinct from after_task, p_label || ' recovery rejected queue unchanged');
  perform task17a_test.assert(before_job is not distinct from after_job, p_label || ' recovery rejected job unchanged');
  perform task17a_test.assert(before_audits=after_audits, p_label || ' no recovery audit');
  perform task17a_test.assert(before_idem=after_idem, p_label || ' no recovery idempotency');
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
  insert into task17a_recovery_rejections(label,key,task_id,job_id) values(p_label,p_idempotency_key,p_task_id,p_job_id) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;
end $$;

create or replace function task17a_test.assert_recovery_success(p_label text,p_expected_status text,p_actor_id uuid,p_task_id uuid,p_job_id uuid,p_idempotency_key text,p_preserved_baseline jsonb,p_job_snapshot jsonb)
returns jsonb language plpgsql as $$
declare result jsonb; prior_task public.creator_publishing_queue_tasks%rowtype;
begin
  select * into prior_task from public.creator_publishing_queue_tasks where id=p_task_id;
  result := public.creator_publishing_recover_expired_onlyfans_operator_claim(p_actor_id,p_task_id,p_job_id,p_idempotency_key);
  perform task17a_test.assert(result->>'ok'='true' and result->>'action'='expired_claim_recovery' and (result->>'queue_task_id')::uuid=p_task_id and (result->>'platform_job_id')::uuid=p_job_id and result->>'status'=p_expected_status, p_label || ' recovery result');
  perform task17a_test.assert((select status=p_expected_status and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and task17a_test.recovery_preserved_snapshot(id)=p_preserved_baseline from public.creator_publishing_queue_tasks where id=p_task_id), p_label || ' restored status cleared ownership and preserved baseline');
  perform task17a_test.assert((select to_jsonb(j)=p_job_snapshot from public.creator_publishing_platform_jobs j where id=p_job_id), p_label || ' recovery job unchanged');
  perform task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key=p_idempotency_key)=1, p_label || ' one recovery audit');
  perform task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key=p_idempotency_key)=1, p_label || ' one recovery idempotency');
  perform task17a_test.assert((select actor_id=p_actor_id and before_state->>'status'='claimed' and (before_state->>'claimed_by')::uuid=prior_task.claimed_by and (before_state->>'claimed_at')::timestamptz=prior_task.claimed_at and (before_state->>'claim_expires_at')::timestamptz=prior_task.claim_expires_at and (before_state->>'claim_attempt_count')::int=prior_task.claim_attempt_count and before_state->>'progress_state'=prior_task.operator_progress_state and (before_state->>'progress_revision')::int=prior_task.operator_progress_revision and (before_state->>'progress_updated_by')::uuid is not distinct from prior_task.operator_progress_updated_by and (before_state->>'assigned_operator_id')::uuid is not distinct from prior_task.assigned_operator_id and after_state->>'action'='expired_claim_recovery' and (after_state->>'queue_task_id')::uuid=p_task_id and (after_state->>'platform_job_id')::uuid=p_job_id and after_state->>'status'=p_expected_status and not (before_state ? 'claim_token') and not (after_state ? 'claim_token') from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key=p_idempotency_key), p_label || ' truthful recovery audit without token');
  insert into task17a_recovery_successes(label,key,task_id,job_id) values(p_label,p_idempotency_key,p_task_id,p_job_id) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;
  return result;
end $$;


create or replace function task17a_test.create_additional_work(
  p_seed integer,
  p_creator_id uuid,
  p_existing_plan_id uuid default null,
  p_queue_status text default 'ready_for_handoff',
  p_job_state text default 'draft',
  p_scheduled boolean default false
) returns jsonb language plpgsql as $$
declare
  v_account uuid := task17a_test.uuid_for('18100000-0000-4000-8000-', p_seed);
  v_package uuid := task17a_test.uuid_for('18200000-0000-4000-8000-', p_seed);
  v_generation uuid := task17a_test.uuid_for('18300000-0000-4000-8000-', p_seed);
  v_media uuid := task17a_test.uuid_for('18400000-0000-4000-8000-', p_seed);
  v_plan uuid := coalesce(p_existing_plan_id, task17a_test.uuid_for('18500000-0000-4000-8000-', p_seed));
  v_job uuid := task17a_test.uuid_for('18600000-0000-4000-8000-', p_seed);
  v_task uuid := task17a_test.uuid_for('18700000-0000-4000-8000-', p_seed);
  v_now timestamptz := clock_timestamp();
  v_updated timestamptz;
  v_fingerprint text;
  v_reviewer uuid;
begin
  perform task17a_test.assert(p_creator_id is not null, 'additional work creator required');
  perform task17a_test.assert(exists(select 1 from auth.users where id=p_creator_id), 'additional work creator exists');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_creator_verifications where creator_id=p_creator_id and status='verified'), 'additional work uses verified creator');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_ai_twin_consents where creator_id=p_creator_id and status='granted' and revoked_at is null), 'additional work uses current creator consent');
  if p_existing_plan_id is not null then
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_plans where id=p_existing_plan_id and creator_id=p_creator_id), 'additional work existing plan belongs to creator');
  end if;

  delete from public.creator_publishing_operator_action_idempotency where queue_task_id=v_task or platform_job_id=v_job;
  delete from public.creator_publishing_queue_tasks where id=v_task or content_package_id=v_package;
  delete from public.creator_publishing_scheduler_events where platform_job_id=v_job;
  delete from public.creator_publishing_platform_jobs where id=v_job or content_package_id=v_package;
  if p_existing_plan_id is null then delete from public.creator_publishing_plans where id=v_plan; end if;
  delete from public.creator_publishing_co_performer_records where content_package_id=v_package;
  delete from public.creator_publishing_compliance_reviews where content_package_id=v_package;
  delete from public.creator_publishing_media_assets where id=v_media or content_package_id=v_package;
  delete from public.creator_publishing_content_packages where id=v_package;
  delete from public.creator_platform_accounts where id=v_account;

  select reviewer_id into v_reviewer from public.creator_publishing_trusted_reviewers where active is true order by created_at desc nulls last limit 1;
  v_reviewer := coalesce(v_reviewer, p_creator_id);

  insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_attested_at,is_virtual_entity,verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason)
  values(v_account,p_creator_id,'onlyfans','additional'||p_seed,'verified',v_now,false,v_reviewer,v_now,'additional account evidence','verified');

  insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,compliance_status,compliance_policy_version,creator_approval_status,created_at,updated_at)
  values(v_package,p_creator_id,v_account,'onlyfans','Task17A additional package '||p_seed,'additional caption','#AI','ai_generated','{}','pending','unassigned','pending',v_now,v_now);
  insert into public.generations(id,user_id,status,r2_bucket,r2_key,metadata) values(v_generation,p_creator_id,'completed','bucket','task17a/additional/'||p_seed,'{}') on conflict (id) do nothing;
  insert into public.creator_publishing_media_assets(id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at)
  values(v_media,v_package,'media/task17a/additional/'||p_seed,'image/png','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','ai_pipeline',jsonb_build_object('generation_id',v_generation::text),v_now);
  insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata)
  values(v_package,v_reviewer,'pass','automated','[]','policy-v1',v_now,'{}');
  update public.creator_publishing_content_packages
  set compliance_status='passed', compliance_policy_version='policy-v1', creator_approval_status='approved', creator_approved_at=v_now, creator_approved_by=p_creator_id
  where id=v_package;
  select updated_at, public.creator_publishing_autopost_source_fingerprint(v_package) into v_updated, v_fingerprint from public.creator_publishing_content_packages where id=v_package;

  if p_existing_plan_id is null then
    insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
    values(v_plan,p_creator_id,'draft','task17a-additional-plan-'||p_seed,'4444444444444444444444444444444444444444444444444444444444444444','task14.20260711.001',v_now,v_now);
  end if;

  insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at,intended_publish_at,operator_due_at,schedule_timezone,schedule_revision,scheduled_at,scheduled_by)
  values(v_job,v_plan,p_creator_id,v_package,v_account,'onlyfans','assisted',p_job_state,v_updated,v_fingerprint,'task14.20260711.001','5555555555555555555555555555555555555555555555555555555555555555',v_now,v_now,case when p_scheduled then v_now+interval '2 hours' else null end,case when p_scheduled then v_now+interval '1 hour' else null end,case when p_scheduled then 'UTC' else null end,case when p_scheduled then 1 else null end,case when p_scheduled then v_now else null end,case when p_scheduled then p_creator_id else null end);
  insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,due_at,created_at,updated_at,assigned_operator_id)
  values(v_task,v_package,p_creator_id,'onlyfans',v_account,p_queue_status,null,v_now,v_now,null);

  perform task17a_test.assert(exists(select 1 from public.creator_platform_accounts where id=v_account and creator_id=p_creator_id and platform='onlyfans'), 'additional work account identity valid');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_content_packages where id=v_package and creator_id=p_creator_id and platform_account_id=v_account and target_platform='onlyfans' and compliance_status='passed' and creator_approval_status='approved'), 'additional work package approved valid');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_plans where id=v_plan and creator_id=p_creator_id), 'additional work plan creator valid');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_platform_jobs where id=v_job and publishing_plan_id=v_plan and creator_id=p_creator_id and content_package_id=v_package and platform_account_id=v_account and target_platform='onlyfans' and publishing_mode='assisted'), 'additional work job identity valid');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_platform_jobs j join public.creator_publishing_plans p on p.id=j.publishing_plan_id and p.creator_id=j.creator_id where j.id=v_job), 'additional work composite plan creator valid');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_platform_jobs where id=v_job and source_package_updated_at=v_updated and source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(v_package)), 'additional work source fingerprint current');
  perform task17a_test.assert(exists(select 1 from public.creator_publishing_queue_tasks where id=v_task and content_package_id=v_package and creator_id=p_creator_id and target_platform='onlyfans' and platform_account_id=v_account and status=p_queue_status), 'additional work queue identity valid');
  perform task17a_test.assert((not p_scheduled and exists(select 1 from public.creator_publishing_platform_jobs where id=v_job and schedule_revision is null and intended_publish_at is null and operator_due_at is null and schedule_timezone is null and scheduled_at is null and scheduled_by is null)) or (p_scheduled and exists(select 1 from public.creator_publishing_platform_jobs where id=v_job and schedule_revision=1 and intended_publish_at is not null and operator_due_at is not null and operator_due_at=intended_publish_at-interval '60 minutes' and schedule_timezone='UTC' and scheduled_at is not null and scheduled_by=p_creator_id)), 'additional work scheduling tuple valid');

  return jsonb_build_object('creator',p_creator_id,'account',v_account,'package',v_package,'plan',v_plan,'job',v_job,'task',v_task,'consent_version','creator-ai-twin-consent-v1','consent_hash','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12');
end $$;

create or replace function task17a_test.create_secondary_work(seed integer)
returns jsonb language plpgsql as $$
begin
  return task17a_test.reset_fixture(seed);
end $$;
