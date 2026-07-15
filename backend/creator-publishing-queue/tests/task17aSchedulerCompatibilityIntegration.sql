\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql
\echo TASK17A_SCENARIO_START: scheduler_operator_due_ready
select task17a_test.reset_fixture(926001,'ready_for_handoff','scheduled_internally',true) as fixture \gset
select task17a_test.set_valid_schedule_phase((:'fixture'::jsonb->>'job')::uuid,'after_operator_due');
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92600000-0000-4000-8000-000000000001',(:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'plan')::uuid,(:'fixture'::jsonb->>'job')::uuid,'operator_due','processing',clock_timestamp()-interval '1 minute',1,'92600000-0000-4000-8000-000000000101',clock_timestamp());
select public.creator_publishing_process_scheduler_event('92600000-0000-4000-8000-000000000001','92600000-0000-4000-8000-000000000101',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash') as op_due_result \gset
select task17a_test.assert((:'op_due_result')::jsonb->>'status'='processed' and (select job_state from public.creator_publishing_platform_jobs where id=(:'fixture'::jsonb->>'job')::uuid)='awaiting_operator' and (select status from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)='awaiting_operator', 'operator_due advances unclaimed queue to awaiting_operator');
select task17a_test.reset_fixture(926002,'awaiting_operator','awaiting_operator',true) as fixture \gset
select task17a_test.set_valid_schedule_phase((:'fixture'::jsonb->>'job')::uuid,'after_publish_due');
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92600000-0000-4000-8000-000000000002',(:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'plan')::uuid,(:'fixture'::jsonb->>'job')::uuid,'publish_due','processing',clock_timestamp()-interval '1 minute',1,'92600000-0000-4000-8000-000000000102',clock_timestamp());
select public.creator_publishing_process_scheduler_event('92600000-0000-4000-8000-000000000002','92600000-0000-4000-8000-000000000102',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash') as pub_due_result \gset
select task17a_test.assert((:'pub_due_result')::jsonb->>'status'='processed' and (select job_state from public.creator_publishing_platform_jobs where id=(:'fixture'::jsonb->>'job')::uuid)='due_now' and (select status from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)='due_now', 'publish_due advances unclaimed queue to due_now');
select task17a_test.reset_fixture(926003,'scheduled_internally','scheduled_internally',true) as fixture \gset
select task17a_test.set_valid_schedule_phase((:'fixture'::jsonb->>'job')::uuid,'after_operator_due');
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','schedclaim') as claim_result \gset
select claimed_by as before_by, claimed_at as before_at, claim_token as before_token, claim_expires_at as before_expires, operator_progress_state as before_progress from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid \gset
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92600000-0000-4000-8000-000000000003',(:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'plan')::uuid,(:'fixture'::jsonb->>'job')::uuid,'operator_due','processing',clock_timestamp()-interval '1 minute',1,'92600000-0000-4000-8000-000000000103',clock_timestamp());
select public.creator_publishing_process_scheduler_event('92600000-0000-4000-8000-000000000003','92600000-0000-4000-8000-000000000103',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash') as claim_due_result \gset
select task17a_test.assert((:'claim_due_result')::jsonb->>'status'='processed' and status='claimed' and claimed_by=:'before_by'::uuid and claimed_at=:'before_at'::timestamptz and claim_token=:'before_token'::uuid and claim_expires_at=:'before_expires'::timestamptz and operator_progress_state=:'before_progress', 'operator_due preserves active claim fields') from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid;
create or replace function task17a_test.run_scheduler_transition(seed integer, input_queue_status text, input_job_state text, event text, expected_result_status text, expected_code text, expected_event_status text, expected_queue_status text, expected_job_state text, expect_processed_at boolean, expect_superseded_at boolean, expect_needs_fix boolean, label text) returns void language plpgsql as $$
declare
  f jsonb;
  v_event uuid := task17a_test.uuid_for('92610000-0000-4000-8000-', seed);
  v_lock uuid := task17a_test.uuid_for('92620000-0000-4000-8000-', seed);
  v_result jsonb;
  v_event_row public.creator_publishing_scheduler_events%rowtype;
begin
  f := task17a_test.reset_fixture(seed,input_queue_status,input_job_state,true);
  if event='operator_due' then
    perform task17a_test.set_valid_schedule_phase((f->>'job')::uuid,'after_operator_due');
  else
    perform task17a_test.set_valid_schedule_phase((f->>'job')::uuid,'after_publish_due');
  end if;
  insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at)
  values(v_event,(f->>'creator')::uuid,(f->>'plan')::uuid,(f->>'job')::uuid,event,'processing',clock_timestamp()-interval '1 minute',1,v_lock,clock_timestamp());
  v_result := public.creator_publishing_process_scheduler_event(v_event,v_lock,f->>'consent_version',f->>'consent_hash');
  select * into v_event_row from public.creator_publishing_scheduler_events where id=v_event;
  perform task17a_test.assert((v_result->>'ok')::boolean is true, label || ' result ok');
  perform task17a_test.assert(v_result->>'status'=expected_result_status, label || ' result status');
  perform task17a_test.assert((expected_code is null and coalesce(v_result->>'safe_error_code',v_result->>'code') is null) or coalesce(v_result->>'safe_error_code',v_result->>'code')=expected_code, label || ' result code');
  perform task17a_test.assert(v_event_row.status=expected_event_status, label || ' event status');
  perform task17a_test.assert((expect_processed_at and v_event_row.processed_at is not null) or (not expect_processed_at and v_event_row.processed_at is null), label || ' processed_at expectation');
  perform task17a_test.assert((expect_superseded_at and v_event_row.superseded_at is not null) or (not expect_superseded_at and v_event_row.superseded_at is null), label || ' superseded_at expectation');
  perform task17a_test.assert(v_event_row.lock_token is null and v_event_row.locked_at is null, label || ' lock cleared');
  perform task17a_test.assert((expected_event_status<>'blocked' and v_event_row.safe_error_code is null) or (expected_event_status='blocked' and v_event_row.safe_error_code=expected_code), label || ' event safe code');
  perform task17a_test.assert((select job_state=expected_job_state from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid), label || ' job state');
  perform task17a_test.assert((select status=expected_queue_status from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), label || ' queue state');
  perform task17a_test.assert((not expect_needs_fix) or expected_job_state='needs_fix', label || ' needs_fix expectation');
  if expected_result_status='blocked' then
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_audit_events where entity_id=v_event and action='creator_publishing_scheduler_gate_failed' and after_state->>'safe_error_code'=expected_code), label || ' gate-failure audit');
  elsif expected_result_status='superseded' then
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_audit_events where entity_id=v_event and action='creator_publishing_scheduler_event_superseded' and after_state->>'safe_error_code'=expected_code), label || ' superseded audit');
  else
    perform task17a_test.assert(exists(select 1 from public.creator_publishing_audit_events where entity_id=v_event and action='creator_publishing_scheduler_event_processed'), label || ' processed audit');
  end if;
end $$;

create or replace function task17a_test.assert_terminal_scheduler_superseded(seed integer, input_queue_status text, input_job_state text, cancelled boolean, label text) returns void language plpgsql as $$
declare
  f jsonb;
  v_event uuid := task17a_test.uuid_for('92630000-0000-4000-8000-', seed);
  v_sibling uuid := task17a_test.uuid_for('92631000-0000-4000-8000-', seed);
  v_lock uuid := task17a_test.uuid_for('92632000-0000-4000-8000-', seed);
  v_result jsonb;
  before_row public.creator_publishing_queue_tasks%rowtype;
begin
  f := task17a_test.reset_fixture(seed,input_queue_status,input_job_state,true);
  if cancelled then
    update public.creator_publishing_platform_jobs set cancelled_at=clock_timestamp(), cancelled_by=(f->>'creator')::uuid, cancellation_reason='terminal cancellation' where id=(f->>'job')::uuid;
  end if;
  select * into before_row from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at)
  values(v_event,(f->>'creator')::uuid,(f->>'plan')::uuid,(f->>'job')::uuid,'operator_due','processing',clock_timestamp()-interval '1 minute',1,v_lock,clock_timestamp());
  insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision)
  values(v_sibling,(f->>'creator')::uuid,(f->>'plan')::uuid,(f->>'job')::uuid,'publish_due','pending',clock_timestamp()+interval '1 minute',1);
  v_result := public.creator_publishing_process_scheduler_event(v_event,v_lock,f->>'consent_version',f->>'consent_hash');
  perform task17a_test.assert((v_result->>'ok')::boolean is true and v_result->>'status'='superseded' and v_result->>'code'='JOB_TERMINAL' and v_result->>'job_state'=input_job_state, label || ' terminal result');
  perform task17a_test.assert((select status='superseded' and safe_error_code is null and superseded_at is not null and processed_at is null and lock_token is null and locked_at is null from public.creator_publishing_scheduler_events where id=v_event), label || ' event superseded state');
  perform task17a_test.assert((select status='superseded' and superseded_at is not null and lock_token is null and locked_at is null from public.creator_publishing_scheduler_events where id=v_sibling), label || ' sibling superseded');
  perform task17a_test.assert((select job_state=input_job_state from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid), label || ' job terminal state unchanged');
  perform task17a_test.assert((select status=before_row.status and claimed_by is not distinct from before_row.claimed_by and claimed_at is not distinct from before_row.claimed_at and claim_token is not distinct from before_row.claim_token and claim_expires_at is not distinct from before_row.claim_expires_at and posted_by is not distinct from before_row.posted_by and posted_at is not distinct from before_row.posted_at and posted_confirmation is not distinct from before_row.posted_confirmation and final_post_url is not distinct from before_row.final_post_url and proof_screenshot_storage_key is not distinct from before_row.proof_screenshot_storage_key from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), label || ' queue ownership and Task18 unchanged');
  perform task17a_test.assert((select count(*)=1 from public.creator_publishing_audit_events where entity_id=v_event and action='creator_publishing_scheduler_event_superseded' and after_state->>'safe_error_code'='JOB_TERMINAL'), label || ' one terminal superseded audit');
end $$;

\echo TASK17A_SCENARIO_START: scheduler_terminal_blocked_superseded
select task17a_test.assert_terminal_scheduler_superseded(926004,'blocked','blocked',false,'blocked scheduler terminal superseded');
\echo TASK17A_SCENARIO_START: scheduler_terminal_archived_superseded
select task17a_test.assert_terminal_scheduler_superseded(926005,'ready_for_handoff','archived',false,'archived scheduler terminal superseded');
\echo TASK17A_SCENARIO_START: scheduler_terminal_platform_rejected_superseded
select task17a_test.assert_terminal_scheduler_superseded(926006,'ready_for_handoff','platform_rejected',false,'platform rejected scheduler terminal superseded');
\echo TASK17A_SCENARIO_START: scheduler_terminal_confirmed_posted_manual_superseded
select task17a_test.assert_terminal_scheduler_superseded(926007,'ready_for_handoff','confirmed_posted_manual',false,'confirmed posted manual scheduler terminal superseded');
\echo TASK17A_SCENARIO_START: scheduler_terminal_cancelled_superseded
select task17a_test.assert_terminal_scheduler_superseded(926008,'ready_for_handoff','scheduled_internally',true,'cancelled scheduler terminal superseded');

select task17a_test.run_scheduler_transition(926101,'ready_for_handoff','scheduled_internally','operator_due','processed',null,'processed','awaiting_operator','awaiting_operator',true,false,false,'operator_due ready_for_handoff to awaiting_operator');
select task17a_test.run_scheduler_transition(926102,'scheduled_internally','scheduled_internally','operator_due','processed',null,'processed','awaiting_operator','awaiting_operator',true,false,false,'operator_due scheduled_internally to awaiting_operator');
select task17a_test.run_scheduler_transition(926103,'awaiting_operator','awaiting_operator','operator_due','blocked','SCHEDULER_STATE_TRANSITION_INVALID','blocked','awaiting_operator','needs_fix',true,false,true,'operator_due awaiting_operator invalid transition');
select task17a_test.run_scheduler_transition(926104,'due_now','due_now','operator_due','superseded','OBSOLETE_OPERATOR_DUE_SUPERSEDED','superseded','due_now','due_now',false,true,false,'operator_due due_now obsolete superseded');
select task17a_test.run_scheduler_transition(926105,'ready_for_handoff','scheduled_internally','publish_due','processed',null,'processed','due_now','due_now',true,false,false,'publish_due ready_for_handoff to due_now');
select task17a_test.run_scheduler_transition(926106,'scheduled_internally','scheduled_internally','publish_due','processed',null,'processed','due_now','due_now',true,false,false,'publish_due scheduled_internally to due_now');
select task17a_test.run_scheduler_transition(926107,'awaiting_operator','awaiting_operator','publish_due','processed',null,'processed','due_now','due_now',true,false,false,'publish_due awaiting_operator to due_now');
select task17a_test.run_scheduler_transition(926108,'due_now','due_now','publish_due','blocked','SCHEDULER_STATE_TRANSITION_INVALID','blocked','due_now','needs_fix',true,false,true,'publish_due due_now invalid transition');

do $$
declare
  f jsonb;
  v_event uuid := '92600000-0000-4000-8000-000000000205';
  v_lock uuid := '92600000-0000-4000-8000-000000000305';
  v_result jsonb;
  before_row public.creator_publishing_queue_tasks%rowtype;
begin
  f := task17a_test.reset_fixture(926205,'scheduled_internally','scheduled_internally',true);
  perform task17a_test.set_valid_schedule_phase((f->>'job')::uuid,'after_publish_due');
  perform public.creator_publishing_claim_onlyfans_operator_task((f->>'creator')::uuid,(f->>'task')::uuid,(f->>'job')::uuid,f->>'consent_version',f->>'consent_hash','schedpubclaim');
  select * into before_row from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at)
  values(v_event,(f->>'creator')::uuid,(f->>'plan')::uuid,(f->>'job')::uuid,'publish_due','processing',clock_timestamp()-interval '1 minute',1,v_lock,clock_timestamp());
  v_result := public.creator_publishing_process_scheduler_event(v_event,v_lock,f->>'consent_version',f->>'consent_hash');
  perform task17a_test.assert(v_result->>'status'='processed','active claim publish_due processed');
  perform task17a_test.assert((select job_state='due_now' from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid),'active claim publish_due job due_now');
  perform task17a_test.assert((select status='claimed' and claimed_by=before_row.claimed_by and claimed_at=before_row.claimed_at and claim_token=before_row.claim_token and claim_expires_at=before_row.claim_expires_at and operator_progress_state=before_row.operator_progress_state and operator_progress_revision=before_row.operator_progress_revision and assigned_operator_id=before_row.assigned_operator_id and posted_by is null and posted_at is null and posted_confirmation=false and final_post_url is null and proof_screenshot_storage_key is null from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid),'active claim publish_due preserves claim progress assigned and Task18 fields');
end $$;

create or replace function task17a_test.assert_scheduler_claim_gate_cleanup(seed integer, event text, drift text, expected_job_state text, expected_code text, label text) returns void language plpgsql as $$
declare
  f jsonb;
  v_event uuid := task17a_test.uuid_for('92640000-0000-4000-8000-', seed);
  v_lock uuid := task17a_test.uuid_for('92641000-0000-4000-8000-', seed);
  v_result jsonb;
  before_row public.creator_publishing_queue_tasks%rowtype;
  v_actor uuid;
begin
  f := task17a_test.reset_fixture(seed,'scheduled_internally','scheduled_internally',true);
  if event='publish_due' then
    perform task17a_test.set_valid_schedule_phase((f->>'job')::uuid,'after_publish_due');
  else
    perform task17a_test.set_valid_schedule_phase((f->>'job')::uuid,'after_operator_due');
  end if;
  v_actor := case when drift='authorization_revoked' then (f->>'operator_a')::uuid else (f->>'creator')::uuid end;
  perform public.creator_publishing_claim_onlyfans_operator_task(v_actor,(f->>'task')::uuid,(f->>'job')::uuid,f->>'consent_version',f->>'consent_hash','schedgateclaim' || seed);
  select * into before_row from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  if drift='authorization_revoked' then
    update public.creator_publishing_operator_authorizations set status='revoked', revoked_at=clock_timestamp() where creator_id=(f->>'creator')::uuid and operator_id=(f->>'operator_a')::uuid;
  elsif drift='claim_expired' then
    perform task17a_test.expire_claim((f->>'task')::uuid);
    select * into before_row from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  elsif drift='consent_revoked' then
    update public.creator_publishing_ai_twin_consents set status='revoked', revoked_at=clock_timestamp() where creator_id=(f->>'creator')::uuid;
  elsif drift='source_stale' then
    update public.creator_publishing_platform_jobs set source_package_fingerprint='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' where id=(f->>'job')::uuid;
  elsif drift='creator_verification_revoked' then
    update public.creator_publishing_creator_verifications set status='revoked', reason='revoked' where creator_id=(f->>'creator')::uuid;
  elsif drift='account_revoked' then
    update public.creator_platform_accounts set verification_status='revoked', verification_reason='revoked' where id=(f->>'account')::uuid;
  else
    raise exception 'TASK17A_SCHEDULER_GATE_DRIFT_UNSUPPORTED';
  end if;
  insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at)
  values(v_event,(f->>'creator')::uuid,(f->>'plan')::uuid,(f->>'job')::uuid,event,'processing',clock_timestamp()-interval '1 minute',(select schedule_revision from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid),v_lock,clock_timestamp());
  v_result := public.creator_publishing_process_scheduler_event(v_event,v_lock,f->>'consent_version',f->>'consent_hash');
  perform task17a_test.assert(v_result->>'status'='blocked' and v_result->>'safe_error_code'=expected_code, label || ' result blocked with expected code');
  perform task17a_test.assert((select job_state=expected_job_state from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid), label || ' job state mapped');
  perform task17a_test.assert((select status=expected_job_state and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and claim_attempt_count=before_row.claim_attempt_count and operator_progress_state=before_row.operator_progress_state and assigned_operator_id is not distinct from before_row.assigned_operator_id from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), label || ' claimed queue cleared without stranding');
  perform task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_claim_cleared_by_scheduler_gate' and entity_id=(f->>'task')::uuid)=1, label || ' writes one scheduler claim cleanup audit');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claim_cleared_by_scheduler_gate' and entity_id=(f->>'task')::uuid and (before_state ? 'claim_token' or after_state ? 'claim_token')), label || ' cleanup audit omits claim token');
end $$;

\echo TASK17A_SCENARIO_START: scheduler_claim_cleanup_authorization_revoked
select task17a_test.assert_scheduler_claim_gate_cleanup(926301,'operator_due','authorization_revoked','blocked','ACTIVE_QUEUE_TASK_CONFLICT','scheduler claimed authorization revoked cleanup');
\echo TASK17A_SCENARIO_START: scheduler_claim_cleanup_claim_expired
select task17a_test.assert_scheduler_claim_gate_cleanup(926302,'operator_due','claim_expired','blocked','ACTIVE_QUEUE_TASK_CONFLICT','scheduler claimed expired cleanup');
\echo TASK17A_SCENARIO_START: scheduler_claim_cleanup_consent_revoked
select task17a_test.assert_scheduler_claim_gate_cleanup(926303,'publish_due','consent_revoked','needs_fix','AI_TWIN_CONSENT_MISSING','scheduler claimed consent cleanup');
\echo TASK17A_SCENARIO_START: scheduler_claim_cleanup_source_stale
select task17a_test.assert_scheduler_claim_gate_cleanup(926304,'publish_due','source_stale','needs_fix','SOURCE_FINGERPRINT_STALE','scheduler claimed source cleanup');
\echo TASK17A_SCENARIO_START: scheduler_claim_cleanup_creator_verification_revoked
select task17a_test.assert_scheduler_claim_gate_cleanup(926305,'operator_due','creator_verification_revoked','needs_fix','CREATOR_VERIFICATION_MISSING','scheduler claimed creator verification cleanup');
\echo TASK17A_SCENARIO_START: scheduler_claim_cleanup_account_revoked
select task17a_test.assert_scheduler_claim_gate_cleanup(926306,'operator_due','account_revoked','blocked','DESTINATION_ACCOUNT_REVOKED','scheduler claimed account cleanup');

\echo TASK17A_SCENARIO_START: reschedule_active_claim_to_future_clears_claim
do $$
declare
  f jsonb;
  claim_result jsonb;
  reschedule_result jsonb;
  replay_result jsonb;
  reclaim_result jsonb;
  before_queue public.creator_publishing_queue_tasks%rowtype;
  before_job public.creator_publishing_platform_jobs%rowtype;
  after_queue public.creator_publishing_queue_tasks%rowtype;
  after_job public.creator_publishing_platform_jobs%rowtype;
  replay_queue public.creator_publishing_queue_tasks%rowtype;
  replay_job public.creator_publishing_platform_jobs%rowtype;
  final_queue public.creator_publishing_queue_tasks%rowtype;
  former_token uuid;
  new_intended timestamptz := clock_timestamp() + interval '4 hours';
  progress_audits_before integer;
  progress_idempotency_before integer;
  v_audit public.creator_publishing_audit_events%rowtype;
  cleanup jsonb;
begin
  f := task17a_test.reset_fixture(926401,'scheduled_internally','scheduled_internally',true);
  perform task17a_test.set_valid_schedule_phase((f->>'job')::uuid,'after_operator_due');
  claim_result := public.creator_publishing_claim_onlyfans_operator_task((f->>'creator')::uuid,(f->>'task')::uuid,(f->>'job')::uuid,f->>'consent_version',f->>'consent_hash','reschedclaim01');
  perform task17a_test.assert((claim_result->>'ok')::boolean is true, 'reschedule active claim setup claim succeeds');
  select claim_token into former_token from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  perform public.creator_publishing_update_onlyfans_operator_progress((f->>'creator')::uuid,(f->>'task')::uuid,(f->>'job')::uuid,former_token,'not_started',0,'preparing',f->>'consent_version',f->>'consent_hash','reschedprog01');
  perform public.creator_publishing_update_onlyfans_operator_progress((f->>'creator')::uuid,(f->>'task')::uuid,(f->>'job')::uuid,former_token,'preparing',1,'prepared',f->>'consent_version',f->>'consent_hash','reschedprog02');
  update public.creator_publishing_queue_tasks set assigned_operator_id=(f->>'operator_b')::uuid where id=(f->>'task')::uuid;
  select * into before_queue from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  select * into before_job from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid;
  progress_audits_before := (select count(*) from public.creator_publishing_audit_events where action='operator_progress_updated' and entity_id=(f->>'task')::uuid);
  progress_idempotency_before := (select count(*) from public.creator_publishing_operator_action_idempotency where action_type='progress' and queue_task_id=(f->>'task')::uuid);
  reschedule_result := public.creator_publishing_schedule_plan((f->>'creator')::uuid,(f->>'plan')::uuid,new_intended,'UTC','reschedfuture01',f->>'consent_version',f->>'consent_hash',array[(f->>'job')::uuid],jsonb_build_object(f->>'job',before_job.schedule_revision),'reschedule');
  cleanup := reschedule_result->'jobs'->0->'operator_claim_cleanup';
  select * into after_queue from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  select * into after_job from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid;
  perform task17a_test.assert((cleanup->>'performed')::boolean is true and cleanup->>'queue_task_id'=f->>'task' and cleanup->>'previous_status'='claimed' and cleanup->>'resulting_status'='scheduled_internally' and cleanup->>'reason'='rescheduled_before_operator_due','reschedule result reports operator claim cleanup');
  perform task17a_test.assert(reschedule_result::text not like '%claim_token%', 'reschedule cleanup result omits claim_token');
  perform task17a_test.assert(after_job.job_state='scheduled_internally' and after_job.schedule_revision=before_job.schedule_revision+1 and after_job.operator_due_at > clock_timestamp() and after_job.operator_due_at = after_job.intended_publish_at - interval '60 minutes', 'future reschedule updates schedule exactly once');
  perform task17a_test.assert(after_queue.status='scheduled_internally' and after_queue.claimed_by is null and after_queue.claimed_at is null and after_queue.claim_token is null and after_queue.claim_expires_at is null, 'future reschedule clears complete claim tuple');
  perform task17a_test.assert(after_queue.claim_attempt_count=before_queue.claim_attempt_count and after_queue.operator_progress_state=before_queue.operator_progress_state and after_queue.operator_progress_revision=before_queue.operator_progress_revision and after_queue.operator_progress_updated_by is not distinct from before_queue.operator_progress_updated_by and after_queue.operator_progress_updated_at is not distinct from before_queue.operator_progress_updated_at and after_queue.assigned_operator_id is not distinct from before_queue.assigned_operator_id, 'future reschedule preserves attempts progress and assignment');
  perform task17a_test.assert(after_queue.posted_by is not distinct from before_queue.posted_by and after_queue.posted_at is not distinct from before_queue.posted_at and after_queue.posted_confirmation is not distinct from before_queue.posted_confirmation and after_queue.final_post_url is not distinct from before_queue.final_post_url and after_queue.final_post_url_skip_reason is not distinct from before_queue.final_post_url_skip_reason and after_queue.proof_screenshot_storage_key is not distinct from before_queue.proof_screenshot_storage_key and after_queue.skip_or_fail_reason is not distinct from before_queue.skip_or_fail_reason, 'future reschedule preserves Task18 manual-result fields');
  select * into v_audit from public.creator_publishing_audit_events where action='operator_task_claim_cleared_by_reschedule' and entity_id=(f->>'task')::uuid and idempotency_key='reschedfuture01';
  perform task17a_test.assert(found and (select count(*) from public.creator_publishing_audit_events where action='operator_task_claim_cleared_by_reschedule' and entity_id=(f->>'task')::uuid and idempotency_key='reschedfuture01')=1, 'one reschedule claim cleanup audit');
  perform task17a_test.assert(v_audit.before_state->>'status'='claimed' and (v_audit.before_state->>'claimed_by')::uuid=before_queue.claimed_by and (v_audit.before_state->>'claimed_at')::timestamptz=before_queue.claimed_at and (v_audit.before_state->>'claim_expires_at')::timestamptz=before_queue.claim_expires_at and (v_audit.before_state->>'claim_attempt_count')::integer=before_queue.claim_attempt_count and v_audit.before_state->>'operator_progress_state'=before_queue.operator_progress_state and (v_audit.before_state->>'operator_progress_revision')::integer=before_queue.operator_progress_revision and (v_audit.before_state->>'operator_progress_updated_by')::uuid=before_queue.operator_progress_updated_by and (v_audit.before_state->>'operator_progress_updated_at')::timestamptz=before_queue.operator_progress_updated_at and (v_audit.before_state->>'assigned_operator_id')::uuid=before_queue.assigned_operator_id, 'cleanup audit before_state preserves safe prior claim progress assignment');
  perform task17a_test.assert(v_audit.after_state->>'resulting_status'='scheduled_internally' and (v_audit.after_state->>'schedule_revision')::integer=after_job.schedule_revision and (v_audit.after_state->>'operator_due_at')::timestamptz=after_job.operator_due_at and v_audit.after_state->>'reason'='rescheduled_before_operator_due', 'cleanup audit after_state records schedule result');
  perform task17a_test.assert(not (v_audit.before_state ? 'claim_token') and not (v_audit.after_state ? 'claim_token'), 'cleanup audit omits claim_token');
  replay_result := public.creator_publishing_schedule_plan((f->>'creator')::uuid,(f->>'plan')::uuid,new_intended,'UTC','reschedfuture01',f->>'consent_version',f->>'consent_hash',array[(f->>'job')::uuid],jsonb_build_object(f->>'job',before_job.schedule_revision),'reschedule');
  select * into replay_queue from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  select * into replay_job from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid;
  perform task17a_test.assert((replay_result->>'idempotent')::boolean is true and (replay_result - 'idempotent')=(reschedule_result - 'idempotent'), 'exact reschedule replay returns stored cleanup result');
  perform task17a_test.assert(replay_job.schedule_revision=after_job.schedule_revision and replay_job.operator_due_at=after_job.operator_due_at and replay_queue.status='scheduled_internally' and replay_queue.claimed_by is null and (select count(*) from public.creator_publishing_audit_events where action='operator_task_claim_cleared_by_reschedule' and entity_id=(f->>'task')::uuid and idempotency_key='reschedfuture01')=1, 'exact reschedule replay does not repeat mutation or audit');
  perform task17a_test.assert((select count(*) from public.creator_publishing_scheduler_idempotency where creator_id=(f->>'creator')::uuid and action_type='reschedule' and idempotency_key='reschedfuture01')=1, 'one reschedule idempotency row');
  perform task17a_test.expect_error('former token progress after future reschedule','OPERATOR_CLAIM_TOKEN_MISMATCH',format('select public.creator_publishing_update_onlyfans_operator_progress(%L,%L,%L,%L,%L,%s,%L,%L,%L,%L)',f->>'creator',f->>'task',f->>'job',former_token::text,'prepared',2,'handoff_ready',f->>'consent_version',f->>'consent_hash','reschedstaletok01'));
  perform task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_progress_updated' and entity_id=(f->>'task')::uuid)=progress_audits_before and (select count(*) from public.creator_publishing_operator_action_idempotency where action_type='progress' and queue_task_id=(f->>'task')::uuid)=progress_idempotency_before, 'former token progress writes no success audit or idempotency');
  perform task17a_test.expect_error('before due claim after future reschedule','OPERATOR_NOT_DUE',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',f->>'creator',f->>'task',f->>'job',f->>'consent_version',f->>'consent_hash','reschedclaimbefore01'));
  perform task17a_test.assert((select claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and claim_attempt_count=after_queue.claim_attempt_count from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), 'before due rejected claim leaves ownership empty and attempts unchanged');
  perform task17a_test.set_valid_schedule_phase((f->>'job')::uuid,'after_operator_due',after_job.schedule_revision);
  reclaim_result := public.creator_publishing_claim_onlyfans_operator_task((f->>'creator')::uuid,(f->>'task')::uuid,(f->>'job')::uuid,f->>'consent_version',f->>'consent_hash','reschedclaim02');
  select * into final_queue from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  perform task17a_test.assert((reclaim_result->>'ok')::boolean is true and final_queue.claim_token is not null and final_queue.claim_token <> former_token and final_queue.claimed_by=(f->>'creator')::uuid and final_queue.claimed_at is not null and final_queue.claim_expires_at is not null, 'after due reclaim succeeds with new ownership tuple');
  perform task17a_test.assert(final_queue.operator_progress_state=before_queue.operator_progress_state and final_queue.operator_progress_revision=before_queue.operator_progress_revision and final_queue.assigned_operator_id is not distinct from before_queue.assigned_operator_id, 'reclaim preserves preparation progress and assignment');
  perform task17a_test.assert(final_queue.posted_by is not distinct from before_queue.posted_by and final_queue.posted_at is not distinct from before_queue.posted_at and final_queue.posted_confirmation is not distinct from before_queue.posted_confirmation and final_queue.final_post_url is not distinct from before_queue.final_post_url and final_queue.proof_screenshot_storage_key is not distinct from before_queue.proof_screenshot_storage_key and final_queue.skip_or_fail_reason is not distinct from before_queue.skip_or_fail_reason, 'reclaim preserves Task18 manual-result fields');
end $$;
