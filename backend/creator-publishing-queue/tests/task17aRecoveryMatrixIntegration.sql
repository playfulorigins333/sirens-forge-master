\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql

drop table if exists task17a_recovery_successes;
drop table if exists task17a_recovery_rejections;
create temporary table task17a_recovery_successes(label text primary key, key text not null unique, task_id uuid not null, job_id uuid not null) on commit preserve rows;
create temporary table task17a_recovery_rejections(label text primary key, key text not null unique, task_id uuid, job_id uuid) on commit preserve rows;

create or replace function task17a_test.recovery_actor(f jsonb, p_actor text) returns uuid language sql immutable as $$
  select case p_actor when 'creator' then (f->>'creator')::uuid when 'operator_a' then (f->>'operator_a')::uuid when 'operator_b' then (f->>'operator_b')::uuid when 'unauthorized' then (f->>'unauthorized')::uuid when 'revoked' then (f->>'revoked')::uuid else (f->>'creator')::uuid end
$$;

create or replace function task17a_test.recovery_prepare_fixture(p_label text,p_seed integer,p_scheduled boolean,p_phase_before_claim text,p_claim_actor text,p_claim_key text,p_progress_steps integer default 0,p_assign_operator boolean default false)
returns jsonb language plpgsql as $$
declare f jsonb; actor uuid; token uuid; attempts_before integer; progress_result jsonb;
begin
  f := task17a_test.reset_fixture(p_seed, case when p_scheduled then 'scheduled_internally' else 'ready_for_handoff' end, case when p_scheduled then 'scheduled_internally' else 'draft' end, p_scheduled);
  if p_phase_before_claim is not null then perform task17a_test.set_valid_schedule_phase((f->>'job')::uuid,p_phase_before_claim); end if;
  select claim_attempt_count into attempts_before from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  actor := task17a_test.recovery_actor(f,p_claim_actor);
  perform task17a_test.assert(public.creator_publishing_operator_current_safety_gate((select j from public.creator_publishing_platform_jobs j where id=(f->>'job')::uuid),(select q from public.creator_publishing_queue_tasks q where id=(f->>'task')::uuid),actor,f->>'consent_version',f->>'consent_hash') is null, p_label || ' setup safety gate valid');
  perform public.creator_publishing_claim_onlyfans_operator_task(actor,(f->>'task')::uuid,(f->>'job')::uuid,f->>'consent_version',f->>'consent_hash',p_claim_key);
  perform task17a_test.assert((select status='claimed' and claimed_by=actor and claimed_at is not null and claim_token is not null and claim_expires_at is not null and claim_expires_at > claimed_at and claim_attempt_count=attempts_before+1 from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), p_label || ' claim setup complete');
  select claim_token into token from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  if p_progress_steps >= 1 then
    progress_result := public.creator_publishing_update_onlyfans_operator_progress(actor,(f->>'task')::uuid,(f->>'job')::uuid,token,'not_started',0,'preparing',f->>'consent_version',f->>'consent_hash',p_claim_key || '-prog1');
    perform task17a_test.assert(progress_result->>'ok'='true', p_label || ' progress preparing setup');
  end if;
  if p_progress_steps >= 2 then
    progress_result := public.creator_publishing_update_onlyfans_operator_progress(actor,(f->>'task')::uuid,(f->>'job')::uuid,token,'preparing',1,'prepared',f->>'consent_version',f->>'consent_hash',p_claim_key || '-prog2');
    perform task17a_test.assert(progress_result->>'ok'='true', p_label || ' progress prepared setup');
  end if;
  if p_assign_operator then update public.creator_publishing_queue_tasks set assigned_operator_id=(f->>'operator_b')::uuid where id=(f->>'task')::uuid; end if;
  perform task17a_test.expire_claim((f->>'task')::uuid);
  perform task17a_test.assert_recovery_claimed_expired(p_label,(f->>'task')::uuid,actor,attempts_before);
  return f || jsonb_build_object('claim_actor',actor::text,'claim_token',token::text);
end $$;

create or replace function task17a_test.recovery_apply_drift(f jsonb, drift text) returns void language plpgsql as $$
begin
  if drift='revoke_operator_a' then
    update public.creator_publishing_operator_authorizations set status='revoked', revoked_at=clock_timestamp(), updated_at=clock_timestamp() where creator_id=(f->>'creator')::uuid and operator_id=(f->>'operator_a')::uuid;
  elsif drift='creator_verification' then
    delete from public.creator_publishing_creator_verifications where creator_id=(f->>'creator')::uuid;
  elsif drift='account_revoked' then
    update public.creator_platform_accounts set verification_status='revoked', verification_reason='revoked', verification_reviewed_by=(f->>'global_only')::uuid, verification_reviewed_at=clock_timestamp() where id=(f->>'account')::uuid;
  elsif drift='consent_revoked' then
    update public.creator_publishing_ai_twin_consents set status='revoked', revoked_at=clock_timestamp() where creator_id=(f->>'creator')::uuid;
  elsif drift='compliance' then
    delete from public.creator_publishing_compliance_reviews where content_package_id=(f->>'package')::uuid;
  elsif drift='source_fingerprint' then
    update public.creator_publishing_platform_jobs set source_package_fingerprint='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' where id=(f->>'job')::uuid;
  end if;
end $$;


create or replace function task17a_test.assert_recovery_success(p_label text,p_expected_status text,p_actor_id uuid,p_task_id uuid,p_job_id uuid,p_idempotency_key text,p_preserved_baseline jsonb,p_job_snapshot jsonb)
returns jsonb language plpgsql as $$
declare result jsonb; prior_task public.creator_publishing_queue_tasks%rowtype; audit_before jsonb; audit_after jsonb;
begin
  select * into prior_task from public.creator_publishing_queue_tasks where id=p_task_id;
  result := public.creator_publishing_recover_expired_onlyfans_operator_claim(p_actor_id,p_task_id,p_job_id,p_idempotency_key);
  select before_state, after_state into audit_before, audit_after from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key=p_idempotency_key;
  raise notice 'TASK17A_RECOVERY_AUDIT_BEFORE:%', audit_before;
  raise notice 'TASK17A_RECOVERY_AUDIT_AFTER:%', audit_after;
  perform task17a_test.assert(result->>'ok'='true' and result->>'action'='expired_claim_recovery' and (result->>'queue_task_id')::uuid=p_task_id and (result->>'platform_job_id')::uuid=p_job_id and result->>'status'=p_expected_status, p_label || ' recovery result');
  perform task17a_test.assert((select status=p_expected_status and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and task17a_test.recovery_preserved_snapshot(id)=p_preserved_baseline from public.creator_publishing_queue_tasks where id=p_task_id), p_label || ' restored status cleared ownership and preserved baseline');
  perform task17a_test.assert((select to_jsonb(j)=p_job_snapshot from public.creator_publishing_platform_jobs j where id=p_job_id), p_label || ' recovery job unchanged');
  perform task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key=p_idempotency_key)=1, p_label || ' one recovery audit');
  perform task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key=p_idempotency_key)=1, p_label || ' one recovery idempotency');
  perform task17a_test.assert(audit_before->>'status'='claimed'
    and (audit_before->>'claimed_by')::uuid=prior_task.claimed_by
    and (audit_before->>'claimed_at')::timestamptz=prior_task.claimed_at
    and (audit_before->>'claim_expires_at')::timestamptz=prior_task.claim_expires_at
    and (audit_before->>'claim_attempt_count')::int=prior_task.claim_attempt_count
    and audit_before->>'progress_state'=prior_task.operator_progress_state
    and (audit_before->>'progress_revision')::int=prior_task.operator_progress_revision
    and (audit_before->>'progress_updated_by')::uuid is not distinct from prior_task.operator_progress_updated_by
    and (audit_before->>'progress_updated_at')::timestamptz is not distinct from prior_task.operator_progress_updated_at
    and (audit_before->>'assigned_operator_id')::uuid is not distinct from prior_task.assigned_operator_id
    and audit_after->>'action'='expired_claim_recovery'
    and (audit_after->>'queue_task_id')::uuid=p_task_id
    and (audit_after->>'platform_job_id')::uuid=p_job_id
    and audit_after->>'status'=p_expected_status
    and not (audit_before ? 'claim_token')
    and not (audit_after ? 'claim_token'), p_label || ' truthful recovery audit without token');
  insert into task17a_recovery_successes(label,key,task_id,job_id) values(p_label,p_idempotency_key,p_task_id,p_job_id) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;
  return result;
end $$;

create or replace function task17a_test.run_recovery_success_case(p_label text,p_seed integer,p_key text,p_expected_status text,p_scheduled boolean,p_phase_before_claim text,p_phase_after_claim text,p_claim_actor text,p_recover_actor text,p_progress_steps integer,p_assign_operator boolean,p_drift text)
returns void language plpgsql as $$
declare f jsonb; baseline jsonb; job_snapshot jsonb; recover_actor uuid; result jsonb;
begin
  f := task17a_test.recovery_prepare_fixture(p_label,p_seed,p_scheduled,p_phase_before_claim,p_claim_actor,p_key || '-claim',p_progress_steps,p_assign_operator);
  if p_phase_after_claim is not null then perform task17a_test.set_valid_schedule_phase((f->>'job')::uuid,p_phase_after_claim); end if;
  if p_drift <> 'none' then perform task17a_test.recovery_apply_drift(f,p_drift); end if;
  baseline := task17a_test.recovery_preserved_snapshot((f->>'task')::uuid);
  select to_jsonb(j) into job_snapshot from public.creator_publishing_platform_jobs j where id=(f->>'job')::uuid;
  recover_actor := task17a_test.recovery_actor(f,p_recover_actor);
  result := task17a_test.assert_recovery_success(p_label,p_expected_status,recover_actor,(f->>'task')::uuid,(f->>'job')::uuid,p_key,baseline,job_snapshot);
  perform task17a_test.assert((select actor_id=recover_actor from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key=p_key), p_label || ' audit actor is recovering actor');
  if p_claim_actor <> p_recover_actor then
    perform task17a_test.assert((select before_state->>'claimed_by'=f->>'claim_actor' from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key=p_key), p_label || ' audit before_state keeps prior claim owner');
  end if;
end $$;

create or replace function task17a_test.run_recovery_rejection_case(p_label text,p_seed integer,p_key text,p_expected_error text,p_kind text,p_aux_seed integer default null)
returns void language plpgsql as $$
declare f jsonb; actor uuid; task_id uuid; job_id uuid; ts timestamptz; other jsonb; setup_claim_key text := 'recsetup' || p_seed::text; primary_job_id uuid; alt_task_id uuid; alt_job_id uuid; primary_task_before jsonb; primary_task_after jsonb; primary_job_before jsonb; primary_job_after jsonb; alt_task_before jsonb; alt_task_after jsonb; alt_job_before jsonb; alt_job_after jsonb;
begin
  if p_kind='unclaimed' then
    f := task17a_test.reset_fixture(p_seed);
  elsif p_kind='active' then
    f := task17a_test.reset_fixture(p_seed);
    perform public.creator_publishing_claim_onlyfans_operator_task((f->>'creator')::uuid,(f->>'task')::uuid,(f->>'job')::uuid,f->>'consent_version',f->>'consent_hash',setup_claim_key);
    perform task17a_test.assert((select status='claimed' and claim_expires_at > clock_timestamp() from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), p_label || ' active claim remains unexpired');
  else
    f := task17a_test.recovery_prepare_fixture(p_label,p_seed,false,null,case when p_kind='revoked' then 'operator_a' else 'creator' end,setup_claim_key,0,false);
  end if;
  actor := case when p_kind='unauthorized' then (f->>'unauthorized')::uuid when p_kind='revoked' then (f->>'operator_a')::uuid else (f->>'creator')::uuid end;
  task_id := (f->>'task')::uuid; job_id := (f->>'job')::uuid;
  if p_kind <> 'unclaimed' then
    raise notice 'TASK17A_RECOVERY_REJECTION_SETUP_KEY:% seed:% setup:% recovery:% distinct:% valid:%', p_label, p_seed, setup_claim_key, p_key, setup_claim_key <> p_key, setup_claim_key ~ '^[A-Za-z0-9_-]{8,128}$';
    perform task17a_test.assert(setup_claim_key <> p_key and setup_claim_key ~ '^[A-Za-z0-9_-]{8,128}$', p_label || ' setup claim key is valid and distinct from tested recovery key');
    perform task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key=setup_claim_key)=1, p_label || ' exactly one setup claim idempotency row');
    perform task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and actor_id is not distinct from actor and queue_task_id is not distinct from task_id and platform_job_id is not distinct from job_id), p_label || ' no recovery idempotency before tested recovery call');
  end if;
  if p_kind='noop' then
    null;
  elsif p_kind='null_actor' then actor := null;
  elsif p_kind='null_task' then task_id := null;
  elsif p_kind='null_job' then job_id := null;
  elsif p_kind='missing_job' then job_id := task17a_test.uuid_for('19990000-0000-4000-8000-', p_seed);
  elsif p_kind='missing_task' then task_id := task17a_test.uuid_for('19980000-0000-4000-8000-', p_seed);
  elsif p_kind='mismatch' then
    perform task17a_test.assert(p_aux_seed is not null and p_aux_seed <> p_seed, p_label || ' explicit auxiliary seed is present and distinct');
    other := task17a_test.create_secondary_work(p_aux_seed);
    primary_job_id := job_id;
    alt_task_id := (other->>'task')::uuid;
    alt_job_id := (other->>'job')::uuid;
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_queue_tasks where id=task_id), p_label || ' primary task exists');
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_platform_jobs where id=primary_job_id), p_label || ' primary job exists');
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_queue_tasks where id=alt_task_id), p_label || ' alternate task exists');
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_platform_jobs where id=alt_job_id), p_label || ' alternate job exists');
    perform task17a_test.assert(task_id <> alt_task_id and primary_job_id <> alt_job_id and (f->>'package')::uuid <> (other->>'package')::uuid, p_label || ' primary and alternate identities differ');
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_queue_tasks qt join public.creator_publishing_platform_jobs pj on pj.content_package_id=qt.content_package_id join public.creator_publishing_content_packages cp on cp.id=qt.content_package_id join public.creator_publishing_plans p on p.id=pj.publishing_plan_id where qt.id=task_id and pj.id=primary_job_id and qt.content_package_id=pj.content_package_id and cp.id=pj.content_package_id and cp.creator_id=pj.creator_id and cp.platform_account_id=pj.platform_account_id and cp.target_platform=pj.target_platform and p.creator_id=pj.creator_id), p_label || ' primary graph is schema-valid');
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_queue_tasks qt join public.creator_publishing_platform_jobs pj on pj.content_package_id=qt.content_package_id join public.creator_publishing_content_packages cp on cp.id=qt.content_package_id join public.creator_publishing_plans p on p.id=pj.publishing_plan_id where qt.id=alt_task_id and pj.id=alt_job_id and qt.content_package_id=pj.content_package_id and cp.id=pj.content_package_id and cp.creator_id=pj.creator_id and cp.platform_account_id=pj.platform_account_id and cp.target_platform=pj.target_platform and p.creator_id=pj.creator_id), p_label || ' alternate graph is schema-valid');
    select to_jsonb(q) into primary_task_before from (select * from public.creator_publishing_queue_tasks where id=task_id) q;
    select to_jsonb(j) into primary_job_before from (select * from public.creator_publishing_platform_jobs where id=primary_job_id) j;
    select to_jsonb(q) into alt_task_before from (select * from public.creator_publishing_queue_tasks where id=alt_task_id) q;
    select to_jsonb(j) into alt_job_before from (select * from public.creator_publishing_platform_jobs where id=alt_job_id) j;
    job_id := alt_job_id;
  elsif p_kind='unsupported' then update public.creator_publishing_platform_jobs set publishing_mode='direct' where id=job_id;
  elsif p_kind='cancelled' then select clock_timestamp() into ts; update public.creator_publishing_platform_jobs set job_state='archived', cancelled_at=ts, cancelled_by=(f->>'creator')::uuid, cancellation_reason='Task 17A Recovery cancelled-job fixture', updated_at=ts where id=job_id;
  elsif p_kind='ineligible' then update public.creator_publishing_platform_jobs set job_state='blocked' where id=job_id;
  elsif p_kind='revoked' then select clock_timestamp() into ts; update public.creator_publishing_operator_authorizations set status='revoked', revoked_at=ts, updated_at=ts where creator_id=(f->>'creator')::uuid and operator_id=(f->>'operator_a')::uuid; perform task17a_test.assert(public.creator_publishing_operator_is_authorized((f->>'creator')::uuid,(f->>'operator_a')::uuid,'onlyfans') is false, p_label || ' revoked authorization helper false');
  elsif p_kind='manual' then update public.creator_publishing_queue_tasks set posted_confirmation=true where id=task_id;
  end if;
  perform task17a_test.assert_recovery_rejected(p_label,p_expected_error,actor,task_id,job_id,p_key);
  if p_kind='mismatch' then
    select to_jsonb(q) into primary_task_after from (select * from public.creator_publishing_queue_tasks where id=task_id) q;
    select to_jsonb(j) into primary_job_after from (select * from public.creator_publishing_platform_jobs where id=primary_job_id) j;
    select to_jsonb(q) into alt_task_after from (select * from public.creator_publishing_queue_tasks where id=alt_task_id) q;
    select to_jsonb(j) into alt_job_after from (select * from public.creator_publishing_platform_jobs where id=alt_job_id) j;
    perform task17a_test.assert(primary_task_after = primary_task_before, p_label || ' primary queue unchanged after mismatch rejection');
    perform task17a_test.assert(primary_job_after = primary_job_before, p_label || ' primary job unchanged after mismatch rejection');
    perform task17a_test.assert(alt_task_after = alt_task_before, p_label || ' alternate queue unchanged after mismatch rejection');
    perform task17a_test.assert(alt_job_after = alt_job_before, p_label || ' alternate job unchanged after mismatch rejection');
    perform task17a_test.assert(primary_task_after->>'posted_by' is not distinct from primary_task_before->>'posted_by' and primary_task_after->>'posted_at' is not distinct from primary_task_before->>'posted_at' and primary_task_after->>'posted_confirmation' is not distinct from primary_task_before->>'posted_confirmation' and primary_task_after->>'final_post_url' is not distinct from primary_task_before->>'final_post_url' and primary_task_after->>'proof_screenshot_storage_key' is not distinct from primary_task_before->>'proof_screenshot_storage_key' and alt_task_after->>'posted_by' is not distinct from alt_task_before->>'posted_by' and alt_task_after->>'posted_at' is not distinct from alt_task_before->>'posted_at' and alt_task_after->>'posted_confirmation' is not distinct from alt_task_before->>'posted_confirmation' and alt_task_after->>'final_post_url' is not distinct from alt_task_before->>'final_post_url' and alt_task_after->>'proof_screenshot_storage_key' is not distinct from alt_task_before->>'proof_screenshot_storage_key', p_label || ' manual-result fields unchanged on both mismatch queues');
  end if;
end $$;

create or replace function task17a_test.run_recovery_partial_ownership_case(p_label text,p_fixture jsonb,p_missing_field text,p_key text)
returns void language plpgsql as $$
declare task_id uuid := (p_fixture->>'task')::uuid; job_id uuid := (p_fixture->>'job')::uuid; actor uuid := (p_fixture->>'creator')::uuid;
begin
  execute 'alter table public.creator_publishing_queue_tasks drop constraint creator_publishing_queue_claim_all_or_none';
  if p_missing_field='claimed_by' then
    update public.creator_publishing_queue_tasks set claimed_by=null where id=task_id;
  elsif p_missing_field='claimed_at' then
    update public.creator_publishing_queue_tasks set claimed_at=null where id=task_id;
  elsif p_missing_field='claim_token' then
    update public.creator_publishing_queue_tasks set claim_token=null where id=task_id;
  elsif p_missing_field='claim_expires_at' then
    update public.creator_publishing_queue_tasks set claim_expires_at=null where id=task_id;
  else
    raise exception 'TASK17A_UNKNOWN_OWNERSHIP_FIELD:%', p_missing_field;
  end if;
  perform task17a_test.assert((select status='claimed' and (claimed_by is not null or p_missing_field='claimed_by') and (claimed_by is null or p_missing_field<>'claimed_by') and (claimed_at is not null or p_missing_field='claimed_at') and (claimed_at is null or p_missing_field<>'claimed_at') and (claim_token is not null or p_missing_field='claim_token') and (claim_token is null or p_missing_field<>'claim_token') and ((claim_expires_at is not null and claim_expires_at <= clock_timestamp()) or p_missing_field='claim_expires_at') and (claim_expires_at is null or p_missing_field<>'claim_expires_at') from public.creator_publishing_queue_tasks where id=task_id), p_label || ' malformed expired ownership shape is present');
  perform task17a_test.assert_recovery_rejected(p_label,'OPERATOR_CLAIM_NOT_EXPIRED',actor,task_id,job_id,p_key);
end $$;

\echo TASK17A_SCENARIO_START: recovery_restore_unscheduled_ready
select task17a_test.run_recovery_success_case('recovery_restore_unscheduled_ready',931001,'recrestore01','ready_for_handoff',false,null,null,'creator','creator',0,false,'none');

\echo TASK17A_SCENARIO_START: recovery_restore_before_operator_due
select task17a_test.run_recovery_success_case('recovery_restore_before_operator_due',931002,'recrestore02','scheduled_internally',true,'after_operator_due','before_operator_due','creator','creator',0,false,'none');

\echo TASK17A_SCENARIO_START: recovery_restore_after_operator_due
select task17a_test.run_recovery_success_case('recovery_restore_after_operator_due',931003,'recrestore03','awaiting_operator',true,'after_operator_due',null,'creator','creator',1,false,'none');

\echo TASK17A_SCENARIO_START: recovery_restore_after_publish_due
select task17a_test.run_recovery_success_case('recovery_restore_after_publish_due',931004,'recrestore04','due_now',true,'after_publish_due',null,'creator','creator',2,true,'none');

\echo TASK17A_SCENARIO_START: recovery_creator_self
select task17a_test.run_recovery_success_case('recovery_creator_self',931005,'reccreator01','ready_for_handoff',false,null,null,'creator','creator',0,false,'none');

\echo TASK17A_SCENARIO_START: recovery_authorized_operator
select task17a_test.run_recovery_success_case('recovery_authorized_operator',931006,'recoperator01','ready_for_handoff',false,null,null,'creator','operator_a',0,false,'none');

\echo TASK17A_SCENARIO_START: recovery_creator_after_operator_revoked
select task17a_test.run_recovery_success_case('recovery_creator_after_operator_revoked',931007,'reccreatorrevoked','ready_for_handoff',false,null,null,'operator_a','creator',0,false,'revoke_operator_a');

\echo TASK17A_SCENARIO_START: recovery_cleanup_creator_verification_drift
select task17a_test.run_recovery_success_case('recovery_cleanup_creator_verification_drift',931008,'reccreatordrift','ready_for_handoff',false,null,null,'creator','creator',0,false,'creator_verification');

\echo TASK17A_SCENARIO_START: recovery_cleanup_account_revoked_drift
select task17a_test.run_recovery_success_case('recovery_cleanup_account_revoked_drift',931009,'recacctrevoked','ready_for_handoff',false,null,null,'creator','creator',0,false,'account_revoked');

\echo TASK17A_SCENARIO_START: recovery_cleanup_consent_revoked_drift
select task17a_test.run_recovery_success_case('recovery_cleanup_consent_revoked_drift',931010,'recconsentdrift','ready_for_handoff',false,null,null,'creator','creator',0,false,'consent_revoked');

\echo TASK17A_SCENARIO_START: recovery_cleanup_compliance_drift
select task17a_test.run_recovery_success_case('recovery_cleanup_compliance_drift',931011,'reccompdrift','ready_for_handoff',false,null,null,'creator','creator',0,false,'compliance');

\echo TASK17A_SCENARIO_START: recovery_cleanup_source_fingerprint_drift
select task17a_test.run_recovery_success_case('recovery_cleanup_source_fingerprint_drift',931012,'recsourcedrift','ready_for_handoff',false,null,null,'creator','creator',0,false,'source_fingerprint');

\echo TASK17A_SCENARIO_START: recovery_exact_replay
select task17a_test.run_recovery_success_case('recovery_exact_replay',931013,'recreplay01','ready_for_handoff',false,null,null,'creator','creator',0,false,'none');
select to_jsonb(q) as recovery_replay_queue from public.creator_publishing_queue_tasks q join task17a_recovery_successes s on s.task_id=q.id where s.label='recovery_exact_replay' \gset
select to_jsonb(j) as recovery_replay_job from public.creator_publishing_platform_jobs j join task17a_recovery_successes s on s.job_id=j.id where s.label='recovery_exact_replay' \gset
select to_jsonb(i) as recovery_replay_idem from public.creator_publishing_operator_action_idempotency i where action_type='expired_claim_recovery' and idempotency_key='recreplay01' \gset
select public.creator_publishing_recover_expired_onlyfans_operator_claim((:'recovery_replay_idem'::jsonb->>'actor_id')::uuid,(:'recovery_replay_idem'::jsonb->>'queue_task_id')::uuid,(:'recovery_replay_idem'::jsonb->>'platform_job_id')::uuid,'recreplay01') as recovery_replay_result \gset
select task17a_test.assert((:'recovery_replay_result')::jsonb->>'idempotent'='true', 'recovery replay returns idempotent true');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_replay_queue')::jsonb from public.creator_publishing_queue_tasks q where id=((:'recovery_replay_idem')::jsonb->>'queue_task_id')::uuid), 'recovery replay queue unchanged');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_replay_job')::jsonb from public.creator_publishing_platform_jobs j where id=((:'recovery_replay_idem')::jsonb->>'platform_job_id')::uuid), 'recovery replay job unchanged');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recreplay01')=1, 'recovery replay one audit');
select task17a_test.assert((select request_fingerprint=(:'recovery_replay_idem'::jsonb->>'request_fingerprint') and stored_result=(:'recovery_replay_idem'::jsonb->'stored_result') and created_at=(:'recovery_replay_idem'::jsonb->>'created_at')::timestamptz from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recreplay01'), 'recovery replay stored idempotency unchanged');
select task17a_test.assert((:'recovery_replay_idem'::jsonb->'stored_result') = ((:'recovery_replay_result')::jsonb - 'idempotent'), 'recovery replay stored_result equals replay without idempotent');

\echo TASK17A_SCENARIO_START: recovery_request_invalid_actor
select task17a_test.run_recovery_rejection_case('recovery_request_invalid_actor',931101,'recbadactor','OPERATOR_REQUEST_INVALID','null_actor');

\echo TASK17A_SCENARIO_START: recovery_request_invalid_task
select task17a_test.run_recovery_rejection_case('recovery_request_invalid_task',931102,'recbadtask','OPERATOR_REQUEST_INVALID','null_task');

\echo TASK17A_SCENARIO_START: recovery_request_invalid_job
select task17a_test.run_recovery_rejection_case('recovery_request_invalid_job',931103,'recbadjob','OPERATOR_REQUEST_INVALID','null_job');

\echo TASK17A_SCENARIO_START: recovery_idempotency_key_invalid
select task17a_test.run_recovery_rejection_case('recovery_idempotency_key_invalid',931104,'bad key','OPERATOR_IDEMPOTENCY_KEY_INVALID','invalid_key');

\echo TASK17A_SCENARIO_START: recovery_missing_job
select task17a_test.run_recovery_rejection_case('recovery_missing_job',931105,'recmissingjob','OPERATOR_JOB_NOT_FOUND','missing_job');

\echo TASK17A_SCENARIO_START: recovery_missing_task
select task17a_test.run_recovery_rejection_case('recovery_missing_task',931106,'recmissingtask','OPERATOR_TASK_NOT_FOUND','missing_task');

\echo TASK17A_SCENARIO_START: recovery_task_job_mismatch
select task17a_test.run_recovery_rejection_case('recovery_task_job_mismatch',931107,'recmismatch','OPERATOR_TASK_JOB_MISMATCH','mismatch',941107);

\echo TASK17A_SCENARIO_START: recovery_unsupported_target_or_mode
select task17a_test.run_recovery_rejection_case('recovery_unsupported_target_or_mode',931108,'recunsupported','OPERATOR_TARGET_NOT_SUPPORTED','unsupported');

\echo TASK17A_SCENARIO_START: recovery_cancelled_job
select task17a_test.run_recovery_rejection_case('recovery_cancelled_job',931109,'reccancelled','OPERATOR_TASK_INELIGIBLE','cancelled');

\echo TASK17A_SCENARIO_START: recovery_ineligible_job_state
select task17a_test.run_recovery_rejection_case('recovery_ineligible_job_state',931110,'recineligible','OPERATOR_TASK_INELIGIBLE','ineligible');

\echo TASK17A_SCENARIO_START: recovery_unauthorized_actor
select task17a_test.run_recovery_rejection_case('recovery_unauthorized_actor',931111,'recunauth','OPERATOR_NOT_AUTHORIZED','unauthorized');

\echo TASK17A_SCENARIO_START: recovery_revoked_authorization
select task17a_test.run_recovery_rejection_case('recovery_revoked_authorization',931112,'recrevoked','OPERATOR_NOT_AUTHORIZED','revoked');

\echo TASK17A_SCENARIO_START: recovery_active_unexpired_claim
select task17a_test.run_recovery_rejection_case('recovery_active_unexpired_claim',931113,'recactive','OPERATOR_CLAIM_NOT_EXPIRED','active');

\echo TASK17A_SCENARIO_START: recovery_unclaimed_task
select task17a_test.run_recovery_rejection_case('recovery_unclaimed_task',931114,'recunclaimed','OPERATOR_CLAIM_NOT_EXPIRED','unclaimed');

\echo TASK17A_SCENARIO_START: recovery_manual_result_evidence_rejected
select task17a_test.run_recovery_rejection_case('recovery_manual_result_evidence_rejected',931115,'recmanual','OPERATOR_TASK_INELIGIBLE','manual');

\echo TASK17A_SCENARIO_START: recovery_partial_ownership_defensive_boundary
select task17a_test.recovery_prepare_fixture('recovery_partial_ownership_defensive_boundary',931116,false,null,'creator','recpartialclaim',0,false) as recovery_partial_fixture \gset
select to_jsonb(q) as recovery_partial_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_partial_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_partial_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_partial_fixture'::jsonb->>'job')::uuid \gset
begin;
select task17a_test.run_recovery_partial_ownership_case('recovery_partial_ownership_defensive_boundary',(:'recovery_partial_fixture')::jsonb,'claim_token','recpartial');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_queue_tasks'::regclass and conname='creator_publishing_queue_claim_all_or_none'), 'recovery_partial_ownership_defensive_boundary ownership constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_partial_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_partial_fixture'::jsonb->>'task')::uuid), 'recovery_partial_ownership_defensive_boundary queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_partial_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_partial_fixture'::jsonb->>'job')::uuid), 'recovery_partial_ownership_defensive_boundary job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recpartial')=0, 'recovery_partial_ownership_defensive_boundary no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recpartial')=0, 'recovery_partial_ownership_defensive_boundary no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_partial_ownership_defensive_boundary','recpartial',(:'recovery_partial_fixture'::jsonb->>'task')::uuid,(:'recovery_partial_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_partial_ownership_missing_claimed_by
select task17a_test.recovery_prepare_fixture('recovery_partial_ownership_missing_claimed_by',931122,false,null,'creator','recpartialbyclaim',0,false) as recovery_partial_by_fixture \gset
select to_jsonb(q) as recovery_partial_by_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_partial_by_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_partial_by_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_partial_by_fixture'::jsonb->>'job')::uuid \gset
begin;
select task17a_test.run_recovery_partial_ownership_case('recovery_partial_ownership_missing_claimed_by',(:'recovery_partial_by_fixture')::jsonb,'claimed_by','recpartialby');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_queue_tasks'::regclass and conname='creator_publishing_queue_claim_all_or_none'), 'recovery_partial_ownership_missing_claimed_by ownership constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_partial_by_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_partial_by_fixture'::jsonb->>'task')::uuid), 'recovery_partial_ownership_missing_claimed_by queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_partial_by_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_partial_by_fixture'::jsonb->>'job')::uuid), 'recovery_partial_ownership_missing_claimed_by job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recpartialby')=0, 'recovery_partial_ownership_missing_claimed_by no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recpartialby')=0, 'recovery_partial_ownership_missing_claimed_by no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_partial_ownership_missing_claimed_by','recpartialby',(:'recovery_partial_by_fixture'::jsonb->>'task')::uuid,(:'recovery_partial_by_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_partial_ownership_missing_claimed_at
select task17a_test.recovery_prepare_fixture('recovery_partial_ownership_missing_claimed_at',931123,false,null,'creator','recpartialatclaim',0,false) as recovery_partial_at_fixture \gset
select to_jsonb(q) as recovery_partial_at_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_partial_at_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_partial_at_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_partial_at_fixture'::jsonb->>'job')::uuid \gset
begin;
select task17a_test.run_recovery_partial_ownership_case('recovery_partial_ownership_missing_claimed_at',(:'recovery_partial_at_fixture')::jsonb,'claimed_at','recpartialat');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_queue_tasks'::regclass and conname='creator_publishing_queue_claim_all_or_none'), 'recovery_partial_ownership_missing_claimed_at ownership constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_partial_at_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_partial_at_fixture'::jsonb->>'task')::uuid), 'recovery_partial_ownership_missing_claimed_at queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_partial_at_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_partial_at_fixture'::jsonb->>'job')::uuid), 'recovery_partial_ownership_missing_claimed_at job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recpartialat')=0, 'recovery_partial_ownership_missing_claimed_at no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recpartialat')=0, 'recovery_partial_ownership_missing_claimed_at no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_partial_ownership_missing_claimed_at','recpartialat',(:'recovery_partial_at_fixture'::jsonb->>'task')::uuid,(:'recovery_partial_at_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_partial_ownership_missing_claim_expires_at
select task17a_test.recovery_prepare_fixture('recovery_partial_ownership_missing_claim_expires_at',931124,false,null,'creator','recpartialexpiresclaim',0,false) as recovery_partial_expires_fixture \gset
select to_jsonb(q) as recovery_partial_expires_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_partial_expires_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_partial_expires_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_partial_expires_fixture'::jsonb->>'job')::uuid \gset
begin;
select task17a_test.run_recovery_partial_ownership_case('recovery_partial_ownership_missing_claim_expires_at',(:'recovery_partial_expires_fixture')::jsonb,'claim_expires_at','recpartialexpires');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_queue_tasks'::regclass and conname='creator_publishing_queue_claim_all_or_none'), 'recovery_partial_ownership_missing_claim_expires_at ownership constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_partial_expires_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_partial_expires_fixture'::jsonb->>'task')::uuid), 'recovery_partial_ownership_missing_claim_expires_at queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_partial_expires_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_partial_expires_fixture'::jsonb->>'job')::uuid), 'recovery_partial_ownership_missing_claim_expires_at job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recpartialexpires')=0, 'recovery_partial_ownership_missing_claim_expires_at no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recpartialexpires')=0, 'recovery_partial_ownership_missing_claim_expires_at no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_partial_ownership_missing_claim_expires_at','recpartialexpires',(:'recovery_partial_expires_fixture'::jsonb->>'task')::uuid,(:'recovery_partial_expires_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_changed_task_idempotency_conflict
select task17a_test.run_recovery_success_case('recovery_changed_task_idempotency_conflict_base',931117,'recconflict','ready_for_handoff',false,null,null,'creator','creator',0,false,'none');
select task17a_test.recovery_prepare_fixture('recovery_changed_task_idempotency_conflict_alt',931118,false,null,'creator','recconflictaltclaim',0,false) as recovery_conflict_alt \gset
select to_jsonb(q) as recovery_conflict_original_queue from public.creator_publishing_queue_tasks q join task17a_recovery_successes s on s.task_id=q.id where s.label='recovery_changed_task_idempotency_conflict_base' \gset
select to_jsonb(j) as recovery_conflict_original_job from public.creator_publishing_platform_jobs j join task17a_recovery_successes s on s.job_id=j.id where s.label='recovery_changed_task_idempotency_conflict_base' \gset
select to_jsonb(q) as recovery_conflict_alt_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_conflict_alt'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_conflict_alt_job from public.creator_publishing_platform_jobs j where id=(:'recovery_conflict_alt'::jsonb->>'job')::uuid \gset
select to_jsonb(i) as recovery_conflict_idem from public.creator_publishing_operator_action_idempotency i where action_type='expired_claim_recovery' and idempotency_key='recconflict' \gset
select task17a_test.expect_error('recovery changed task idempotency conflict','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'recovery_conflict_idem'::jsonb->>'actor_id'),(:'recovery_conflict_alt'::jsonb->>'task'),(:'recovery_conflict_idem'::jsonb->>'platform_job_id'),'recconflict'));
select task17a_test.assert((select to_jsonb(q)=(:'recovery_conflict_original_queue')::jsonb from public.creator_publishing_queue_tasks q where id=((:'recovery_conflict_idem')::jsonb->>'queue_task_id')::uuid), 'recovery changed task original queue unchanged');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_conflict_alt_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_conflict_alt'::jsonb->>'task')::uuid), 'recovery changed task alternate queue unchanged');

\echo TASK17A_SCENARIO_START: recovery_changed_job_idempotency_conflict
select task17a_test.expect_error('recovery changed job idempotency conflict','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'recovery_conflict_idem'::jsonb->>'actor_id'),(:'recovery_conflict_idem'::jsonb->>'queue_task_id'),(:'recovery_conflict_alt'::jsonb->>'job'),'recconflict'));
select task17a_test.assert((select request_fingerprint=(:'recovery_conflict_idem'::jsonb->>'request_fingerprint') and stored_result=(:'recovery_conflict_idem'::jsonb->'stored_result') and queue_task_id=(:'recovery_conflict_idem'::jsonb->>'queue_task_id')::uuid and platform_job_id=(:'recovery_conflict_idem'::jsonb->>'platform_job_id')::uuid and created_at=(:'recovery_conflict_idem'::jsonb->>'created_at')::timestamptz from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recconflict'), 'recovery changed job stored idempotency unchanged');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recconflict')=1, 'recovery conflict one audit remains');

\echo TASK17A_SCENARIO_START: recovery_same_key_different_actor_namespace
select task17a_test.run_recovery_success_case('recovery_same_key_different_actor_namespace',931119,'recnamespace','ready_for_handoff',false,null,null,'creator','creator',0,false,'none');
select task17a_test.expect_error('same key different actor validates current task state independently','OPERATOR_CLAIM_NOT_EXPIRED',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(select operator_id from public.creator_publishing_operator_authorizations where creator_id=(select creator_id from public.creator_publishing_operator_action_idempotency where idempotency_key='recnamespace') and status='active' and operator_id <> (select actor_id from public.creator_publishing_operator_action_idempotency where idempotency_key='recnamespace') limit 1),(select queue_task_id from public.creator_publishing_operator_action_idempotency where idempotency_key='recnamespace'),(select platform_job_id from public.creator_publishing_operator_action_idempotency where idempotency_key='recnamespace'),'recnamespace'));
select task17a_test.assert((select count(distinct actor_id) from public.creator_publishing_operator_action_idempotency where idempotency_key='recnamespace' and action_type='expired_claim_recovery')=1, 'recovery same key different actor no cross-actor idempotency leakage');

\echo TASK17A_SCENARIO_START: recovery_drift_missing_intended_publish_at
select task17a_test.recovery_prepare_fixture('recovery_drift_missing_intended_publish_at',931201,true,'after_operator_due','creator','recdrift31-claim',0,false) as recovery_drift_missing_intended_publish_at_fixture \gset
select to_jsonb(q) as recovery_drift_missing_intended_publish_at_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_missing_intended_publish_at_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set intended_publish_at=null where id=(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_missing_intended_publish_at','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'job')::uuid,'recdrift31');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'recovery_drift_missing_intended_publish_at constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_missing_intended_publish_at_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'task')::uuid), 'recovery_drift_missing_intended_publish_at queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_missing_intended_publish_at_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'job')::uuid), 'recovery_drift_missing_intended_publish_at job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift31')=0, 'recovery_drift_missing_intended_publish_at no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift31')=0, 'recovery_drift_missing_intended_publish_at no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_missing_intended_publish_at','recdrift31',(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_intended_publish_at_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_missing_operator_due_at
select task17a_test.recovery_prepare_fixture('recovery_drift_missing_operator_due_at',931202,true,'after_operator_due','creator','recdrift32-claim',0,false) as recovery_drift_missing_operator_due_at_fixture \gset
select to_jsonb(q) as recovery_drift_missing_operator_due_at_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_missing_operator_due_at_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set operator_due_at=null where id=(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_missing_operator_due_at','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'job')::uuid,'recdrift32');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'recovery_drift_missing_operator_due_at constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_missing_operator_due_at_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'task')::uuid), 'recovery_drift_missing_operator_due_at queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_missing_operator_due_at_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'job')::uuid), 'recovery_drift_missing_operator_due_at job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift32')=0, 'recovery_drift_missing_operator_due_at no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift32')=0, 'recovery_drift_missing_operator_due_at no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_missing_operator_due_at','recdrift32',(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_operator_due_at_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_missing_timezone
select task17a_test.recovery_prepare_fixture('recovery_drift_missing_timezone',931203,true,'after_operator_due','creator','recdrift33-claim',0,false) as recovery_drift_missing_timezone_fixture \gset
select to_jsonb(q) as recovery_drift_missing_timezone_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_timezone_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_missing_timezone_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_timezone_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set schedule_timezone=null where id=(:'recovery_drift_missing_timezone_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_missing_timezone','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_missing_timezone_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_missing_timezone_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_timezone_fixture'::jsonb->>'job')::uuid,'recdrift33');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'recovery_drift_missing_timezone constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_missing_timezone_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_timezone_fixture'::jsonb->>'task')::uuid), 'recovery_drift_missing_timezone queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_missing_timezone_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_timezone_fixture'::jsonb->>'job')::uuid), 'recovery_drift_missing_timezone job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift33')=0, 'recovery_drift_missing_timezone no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift33')=0, 'recovery_drift_missing_timezone no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_missing_timezone','recdrift33',(:'recovery_drift_missing_timezone_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_timezone_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_blank_timezone
select task17a_test.recovery_prepare_fixture('recovery_drift_blank_timezone',931204,true,'after_operator_due','creator','recdrift34-claim',0,false) as recovery_drift_blank_timezone_fixture \gset
select to_jsonb(q) as recovery_drift_blank_timezone_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_blank_timezone_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_blank_timezone_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_blank_timezone_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set schedule_timezone='' where id=(:'recovery_drift_blank_timezone_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_blank_timezone','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_blank_timezone_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_blank_timezone_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_blank_timezone_fixture'::jsonb->>'job')::uuid,'recdrift34');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'recovery_drift_blank_timezone constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_blank_timezone_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_blank_timezone_fixture'::jsonb->>'task')::uuid), 'recovery_drift_blank_timezone queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_blank_timezone_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_blank_timezone_fixture'::jsonb->>'job')::uuid), 'recovery_drift_blank_timezone job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift34')=0, 'recovery_drift_blank_timezone no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift34')=0, 'recovery_drift_blank_timezone no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_blank_timezone','recdrift34',(:'recovery_drift_blank_timezone_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_blank_timezone_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_missing_scheduled_at
select task17a_test.recovery_prepare_fixture('recovery_drift_missing_scheduled_at',931205,true,'after_operator_due','creator','recdrift35-claim',0,false) as recovery_drift_missing_scheduled_at_fixture \gset
select to_jsonb(q) as recovery_drift_missing_scheduled_at_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_missing_scheduled_at_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set scheduled_at=null where id=(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_missing_scheduled_at','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'job')::uuid,'recdrift35');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'recovery_drift_missing_scheduled_at constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_missing_scheduled_at_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'task')::uuid), 'recovery_drift_missing_scheduled_at queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_missing_scheduled_at_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'job')::uuid), 'recovery_drift_missing_scheduled_at job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift35')=0, 'recovery_drift_missing_scheduled_at no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift35')=0, 'recovery_drift_missing_scheduled_at no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_missing_scheduled_at','recdrift35',(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_scheduled_at_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_missing_scheduled_by
select task17a_test.recovery_prepare_fixture('recovery_drift_missing_scheduled_by',931206,true,'after_operator_due','creator','recdrift36-claim',0,false) as recovery_drift_missing_scheduled_by_fixture \gset
select to_jsonb(q) as recovery_drift_missing_scheduled_by_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_missing_scheduled_by_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_scheduled_fields_required;
update public.creator_publishing_platform_jobs set scheduled_by=null where id=(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_missing_scheduled_by','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'job')::uuid,'recdrift36');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_scheduled_fields_required'), 'recovery_drift_missing_scheduled_by constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_missing_scheduled_by_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'task')::uuid), 'recovery_drift_missing_scheduled_by queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_missing_scheduled_by_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'job')::uuid), 'recovery_drift_missing_scheduled_by job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift36')=0, 'recovery_drift_missing_scheduled_by no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift36')=0, 'recovery_drift_missing_scheduled_by no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_missing_scheduled_by','recdrift36',(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_missing_scheduled_by_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_zero_schedule_revision
select task17a_test.recovery_prepare_fixture('recovery_drift_zero_schedule_revision',931207,true,'after_operator_due','creator','recdrift37-claim',0,false) as recovery_drift_zero_schedule_revision_fixture \gset
select to_jsonb(q) as recovery_drift_zero_schedule_revision_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_zero_schedule_revision_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_schedule_revision_positive;
update public.creator_publishing_platform_jobs set schedule_revision=0 where id=(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_zero_schedule_revision','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'job')::uuid,'recdrift37');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_schedule_revision_positive'), 'recovery_drift_zero_schedule_revision constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_zero_schedule_revision_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'task')::uuid), 'recovery_drift_zero_schedule_revision queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_zero_schedule_revision_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'job')::uuid), 'recovery_drift_zero_schedule_revision job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift37')=0, 'recovery_drift_zero_schedule_revision no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift37')=0, 'recovery_drift_zero_schedule_revision no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_zero_schedule_revision','recdrift37',(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_zero_schedule_revision_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_negative_schedule_revision
select task17a_test.recovery_prepare_fixture('recovery_drift_negative_schedule_revision',931208,true,'after_operator_due','creator','recdrift38-claim',0,false) as recovery_drift_negative_schedule_revision_fixture \gset
select to_jsonb(q) as recovery_drift_negative_schedule_revision_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_negative_schedule_revision_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_schedule_revision_positive;
update public.creator_publishing_platform_jobs set schedule_revision=-1 where id=(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_negative_schedule_revision','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'job')::uuid,'recdrift38');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_schedule_revision_positive'), 'recovery_drift_negative_schedule_revision constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_negative_schedule_revision_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'task')::uuid), 'recovery_drift_negative_schedule_revision queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_negative_schedule_revision_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'job')::uuid), 'recovery_drift_negative_schedule_revision job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift38')=0, 'recovery_drift_negative_schedule_revision no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift38')=0, 'recovery_drift_negative_schedule_revision no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_negative_schedule_revision','recdrift38',(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_negative_schedule_revision_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_operator_offset_not_60_minutes
select task17a_test.recovery_prepare_fixture('recovery_drift_operator_offset_not_60_minutes',931209,true,'after_operator_due','creator','recdrift39-claim',0,false) as recovery_drift_operator_offset_not_60_minutes_fixture \gset
select to_jsonb(q) as recovery_drift_operator_offset_not_60_minutes_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_operator_offset_not_60_minutes_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'job')::uuid \gset
begin;
update public.creator_publishing_platform_jobs set operator_due_at=intended_publish_at - interval '30 minutes' where id=(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_operator_offset_not_60_minutes','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'job')::uuid,'recdrift39');
rollback;
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_operator_offset_not_60_minutes_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'task')::uuid), 'recovery_drift_operator_offset_not_60_minutes queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_operator_offset_not_60_minutes_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'job')::uuid), 'recovery_drift_operator_offset_not_60_minutes job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift39')=0, 'recovery_drift_operator_offset_not_60_minutes no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift39')=0, 'recovery_drift_operator_offset_not_60_minutes no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_operator_offset_not_60_minutes','recdrift39',(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_operator_offset_not_60_minutes_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_job_state_inconsistent_with_schedule
select task17a_test.recovery_prepare_fixture('recovery_drift_job_state_inconsistent_with_schedule',931210,true,'after_operator_due','creator','recdrift40-claim',0,false) as recovery_drift_job_state_inconsistent_with_schedule_fixture \gset
select to_jsonb(q) as recovery_drift_job_state_inconsistent_with_schedule_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_job_state_inconsistent_with_schedule_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'job')::uuid \gset
begin;
update public.creator_publishing_platform_jobs set job_state='draft' where id=(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_job_state_inconsistent_with_schedule','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'job')::uuid,'recdrift40');
rollback;
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_job_state_inconsistent_with_schedule_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'task')::uuid), 'recovery_drift_job_state_inconsistent_with_schedule queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_job_state_inconsistent_with_schedule_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'job')::uuid), 'recovery_drift_job_state_inconsistent_with_schedule job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift40')=0, 'recovery_drift_job_state_inconsistent_with_schedule no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift40')=0, 'recovery_drift_job_state_inconsistent_with_schedule no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_job_state_inconsistent_with_schedule','recdrift40',(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_job_state_inconsistent_with_schedule_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_drift_unscheduled_job_with_schedule_fields
select task17a_test.recovery_prepare_fixture('recovery_drift_unscheduled_job_with_schedule_fields',931211,false,null,'creator','recdrift41-claim',0,false) as recovery_drift_unscheduled_job_with_schedule_fields_fixture \gset
select to_jsonb(q) as recovery_drift_unscheduled_job_with_schedule_fields_pre_tx_queue from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'task')::uuid \gset
select to_jsonb(j) as recovery_drift_unscheduled_job_with_schedule_fields_pre_tx_job from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'job')::uuid \gset
begin;
alter table public.creator_publishing_platform_jobs drop constraint creator_publishing_jobs_unscheduled_fields_null;
update public.creator_publishing_platform_jobs set intended_publish_at=clock_timestamp()+interval '2 hours', operator_due_at=clock_timestamp()+interval '1 hour', schedule_timezone='UTC', scheduled_at=clock_timestamp(), scheduled_by=creator_id where id=(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'job')::uuid;
select task17a_test.assert_recovery_rejected('recovery_drift_unscheduled_job_with_schedule_fields','OPERATOR_TASK_INELIGIBLE',(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'creator')::uuid,(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'job')::uuid,'recdrift41');
rollback;
select task17a_test.assert(exists(select 1 from pg_constraint where conrelid='public.creator_publishing_platform_jobs'::regclass and conname='creator_publishing_jobs_unscheduled_fields_null'), 'recovery_drift_unscheduled_job_with_schedule_fields constraint restored after rollback');
select task17a_test.assert((select to_jsonb(q)=(:'recovery_drift_unscheduled_job_with_schedule_fields_pre_tx_queue')::jsonb from public.creator_publishing_queue_tasks q where id=(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'task')::uuid), 'recovery_drift_unscheduled_job_with_schedule_fields queue restored after rollback');
select task17a_test.assert((select to_jsonb(j)=(:'recovery_drift_unscheduled_job_with_schedule_fields_pre_tx_job')::jsonb from public.creator_publishing_platform_jobs j where id=(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'job')::uuid), 'recovery_drift_unscheduled_job_with_schedule_fields job restored after rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recdrift41')=0, 'recovery_drift_unscheduled_job_with_schedule_fields no recovery audit escaped rollback');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recdrift41')=0, 'recovery_drift_unscheduled_job_with_schedule_fields no recovery idempotency escaped rollback');
insert into task17a_recovery_rejections(label,key,task_id,job_id) values('recovery_drift_unscheduled_job_with_schedule_fields','recdrift41',(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'task')::uuid,(:'recovery_drift_unscheduled_job_with_schedule_fields_fixture'::jsonb->>'job')::uuid) on conflict (label) do update set key=excluded.key, task_id=excluded.task_id, job_id=excluded.job_id;

\echo TASK17A_SCENARIO_START: recovery_complete_audit_idempotency_counts
drop table if exists task17a_recovery_expected_successes;
create temporary table task17a_recovery_expected_successes(label text primary key, key text not null unique) on commit preserve rows;
insert into task17a_recovery_expected_successes(label,key) values
  ('recovery_restore_unscheduled_ready','recrestore01'),
  ('recovery_restore_before_operator_due','recrestore02'),
  ('recovery_restore_after_operator_due','recrestore03'),
  ('recovery_restore_after_publish_due','recrestore04'),
  ('recovery_creator_self','reccreator01'),
  ('recovery_authorized_operator','recoperator01'),
  ('recovery_creator_after_operator_revoked','reccreatorrevoked'),
  ('recovery_cleanup_creator_verification_drift','reccreatordrift'),
  ('recovery_cleanup_account_revoked_drift','recacctrevoked'),
  ('recovery_cleanup_consent_revoked_drift','recconsentdrift'),
  ('recovery_cleanup_compliance_drift','reccompdrift'),
  ('recovery_cleanup_source_fingerprint_drift','recsourcedrift'),
  ('recovery_exact_replay','recreplay01'),
  ('recovery_changed_task_idempotency_conflict_base','recconflict'),
  ('recovery_same_key_different_actor_namespace','recnamespace');

select 'actual recovery successes' as diagnostic, jsonb_agg(jsonb_build_object('label',label,'key',key) order by label) from task17a_recovery_successes;
select 'expected recovery successes' as diagnostic, jsonb_agg(jsonb_build_object('label',label,'key',key) order by label) from task17a_recovery_expected_successes;
select task17a_test.assert((select count(*) from task17a_recovery_successes)=(select count(*) from task17a_recovery_expected_successes), 'recovery successful registry exact count');
select task17a_test.assert(not exists(select label,key from task17a_recovery_expected_successes except select label,key from task17a_recovery_successes), 'recovery missing expected successful rows empty');
select task17a_test.assert(not exists(select label,key from task17a_recovery_successes except select label,key from task17a_recovery_expected_successes), 'recovery unexpected successful rows empty');
select task17a_test.assert(not exists(select 1 from (select label,count(*) from task17a_recovery_successes group by label having count(*)>1) d), 'recovery successful labels unique');
select task17a_test.assert(not exists(select 1 from (select key,count(*) from task17a_recovery_successes group by key having count(*)>1) d), 'recovery successful keys unique');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key in (select key from task17a_recovery_successes))=(select count(*) from task17a_recovery_successes), 'one recovery audit per successful key');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key in (select key from task17a_recovery_successes))=(select count(*) from task17a_recovery_successes), 'one recovery idempotency per successful key');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and (before_state ? 'claim_token' or after_state ? 'claim_token')), 'recovery audits omit claim_token');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='recconflict')=1, 'recovery conflict retains original idempotency row');

\echo TASK17A_SCENARIO_START: recovery_complete_no_mutation_assertions
drop table if exists task17a_recovery_expected_rejections;
create temporary table task17a_recovery_expected_rejections(label text primary key, key text not null unique) on commit preserve rows;
insert into task17a_recovery_expected_rejections(label,key) values
  ('recovery_request_invalid_actor','recbadactor'),
  ('recovery_request_invalid_task','recbadtask'),
  ('recovery_request_invalid_job','recbadjob'),
  ('recovery_idempotency_key_invalid','bad key'),
  ('recovery_missing_job','recmissingjob'),
  ('recovery_missing_task','recmissingtask'),
  ('recovery_task_job_mismatch','recmismatch'),
  ('recovery_unsupported_target_or_mode','recunsupported'),
  ('recovery_cancelled_job','reccancelled'),
  ('recovery_ineligible_job_state','recineligible'),
  ('recovery_unauthorized_actor','recunauth'),
  ('recovery_revoked_authorization','recrevoked'),
  ('recovery_active_unexpired_claim','recactive'),
  ('recovery_unclaimed_task','recunclaimed'),
  ('recovery_manual_result_evidence_rejected','recmanual'),
  ('recovery_partial_ownership_defensive_boundary','recpartial'),
  ('recovery_partial_ownership_missing_claimed_by','recpartialby'),
  ('recovery_partial_ownership_missing_claimed_at','recpartialat'),
  ('recovery_partial_ownership_missing_claim_expires_at','recpartialexpires'),
  ('recovery_drift_missing_intended_publish_at','recdrift31'),
  ('recovery_drift_missing_operator_due_at','recdrift32'),
  ('recovery_drift_missing_timezone','recdrift33'),
  ('recovery_drift_blank_timezone','recdrift34'),
  ('recovery_drift_missing_scheduled_at','recdrift35'),
  ('recovery_drift_missing_scheduled_by','recdrift36'),
  ('recovery_drift_zero_schedule_revision','recdrift37'),
  ('recovery_drift_negative_schedule_revision','recdrift38'),
  ('recovery_drift_operator_offset_not_60_minutes','recdrift39'),
  ('recovery_drift_job_state_inconsistent_with_schedule','recdrift40'),
  ('recovery_drift_unscheduled_job_with_schedule_fields','recdrift41');

select 'actual recovery rejections' as diagnostic, jsonb_agg(jsonb_build_object('label',label,'key',key) order by label) from task17a_recovery_rejections;
select 'expected recovery rejections' as diagnostic, jsonb_agg(jsonb_build_object('label',label,'key',key) order by label) from task17a_recovery_expected_rejections;
select 'missing recovery rejections' as diagnostic, jsonb_agg(to_jsonb(m) order by label) from (select label,key from task17a_recovery_expected_rejections except select label,key from task17a_recovery_rejections) m;
select 'unexpected recovery rejections' as diagnostic, jsonb_agg(to_jsonb(u) order by label) from (select label,key from task17a_recovery_rejections except select label,key from task17a_recovery_expected_rejections) u;
select task17a_test.assert((select count(*) from task17a_recovery_rejections)=(select count(*) from task17a_recovery_expected_rejections), 'recovery rejection registry exact count');
select task17a_test.assert(not exists(select label,key from task17a_recovery_expected_rejections except select label,key from task17a_recovery_rejections), 'recovery missing expected rejected rows empty');
select task17a_test.assert(not exists(select label,key from task17a_recovery_rejections except select label,key from task17a_recovery_expected_rejections), 'recovery unexpected rejected rows empty');
select task17a_test.assert(not exists(select 1 from (select label,count(*) from task17a_recovery_rejections group by label having count(*)>1) d), 'recovery rejected labels unique');
select task17a_test.assert(not exists(select 1 from (select key,count(*) from task17a_recovery_rejections group by key having count(*)>1) d), 'recovery rejected keys unique');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key in (select key from task17a_recovery_rejections)), 'rejected recovery keys wrote no audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key in (select key from task17a_recovery_rejections)), 'rejected recovery keys wrote no idempotency');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_queue_tasks q join task17a_recovery_rejections r on r.task_id=q.id where r.label <> 'recovery_manual_result_evidence_rejected' and (posted_by is not null or posted_at is not null or posted_confirmation is true or final_post_url is not null or final_post_url_skip_reason is not null or proof_screenshot_storage_key is not null or skip_or_fail_reason is not null)), 'recovery rejected tasks introduced no Task 18 fields');
