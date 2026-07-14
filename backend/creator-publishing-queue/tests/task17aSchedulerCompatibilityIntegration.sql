\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql
\echo TASK17A_SCENARIO_START: scheduler_operator_due_ready
select task17a_test.reset_fixture(926001,'ready_for_handoff','scheduled_internally',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '1 minute', intended_publish_at=clock_timestamp()+interval '1 hour' where id=(:'fixture'::jsonb->>'job')::uuid;
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92600000-0000-4000-8000-000000000001',(:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'plan')::uuid,(:'fixture'::jsonb->>'job')::uuid,'operator_due','processing',clock_timestamp()-interval '1 minute',1,'92600000-0000-4000-8000-000000000101',clock_timestamp());
select public.creator_publishing_process_scheduler_event('92600000-0000-4000-8000-000000000001','92600000-0000-4000-8000-000000000101',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash') as op_due_result \gset
select task17a_test.assert((:'op_due_result')::jsonb->>'status'='processed' and (select job_state from public.creator_publishing_platform_jobs where id=(:'fixture'::jsonb->>'job')::uuid)='awaiting_operator' and (select status from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)='awaiting_operator', 'operator_due advances unclaimed queue to awaiting_operator');
select task17a_test.reset_fixture(926002,'awaiting_operator','awaiting_operator',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '2 hours', intended_publish_at=clock_timestamp()-interval '1 minute' where id=(:'fixture'::jsonb->>'job')::uuid;
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92600000-0000-4000-8000-000000000002',(:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'plan')::uuid,(:'fixture'::jsonb->>'job')::uuid,'publish_due','processing',clock_timestamp()-interval '1 minute',1,'92600000-0000-4000-8000-000000000102',clock_timestamp());
select public.creator_publishing_process_scheduler_event('92600000-0000-4000-8000-000000000002','92600000-0000-4000-8000-000000000102',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash') as pub_due_result \gset
select task17a_test.assert((:'pub_due_result')::jsonb->>'status'='processed' and (select job_state from public.creator_publishing_platform_jobs where id=(:'fixture'::jsonb->>'job')::uuid)='due_now' and (select status from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)='due_now', 'publish_due advances unclaimed queue to due_now');
select task17a_test.reset_fixture(926003,'scheduled_internally','scheduled_internally',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '1 minute', intended_publish_at=clock_timestamp()+interval '1 hour' where id=(:'fixture'::jsonb->>'job')::uuid;
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
    update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '1 minute', intended_publish_at=clock_timestamp()+interval '1 hour' where id=(f->>'job')::uuid;
  else
    update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '2 hours', intended_publish_at=clock_timestamp()-interval '1 minute' where id=(f->>'job')::uuid;
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
  update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '2 hours', intended_publish_at=clock_timestamp()-interval '1 minute' where id=(f->>'job')::uuid;
  perform public.creator_publishing_claim_onlyfans_operator_task((f->>'creator')::uuid,(f->>'task')::uuid,(f->>'job')::uuid,f->>'consent_version',f->>'consent_hash','schedpubclaim');
  select * into before_row from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at)
  values(v_event,(f->>'creator')::uuid,(f->>'plan')::uuid,(f->>'job')::uuid,'publish_due','processing',clock_timestamp()-interval '1 minute',1,v_lock,clock_timestamp());
  v_result := public.creator_publishing_process_scheduler_event(v_event,v_lock,f->>'consent_version',f->>'consent_hash');
  perform task17a_test.assert(v_result->>'status'='processed','active claim publish_due processed');
  perform task17a_test.assert((select job_state='due_now' from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid),'active claim publish_due job due_now');
  perform task17a_test.assert((select status='claimed' and claimed_by=before_row.claimed_by and claimed_at=before_row.claimed_at and claim_token=before_row.claim_token and claim_expires_at=before_row.claim_expires_at and operator_progress_state=before_row.operator_progress_state and operator_progress_revision=before_row.operator_progress_revision and assigned_operator_id=before_row.assigned_operator_id and posted_by is null and posted_at is null and posted_confirmation=false and final_post_url is null and proof_screenshot_storage_key is null from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid),'active claim publish_due preserves claim progress assigned and Task18 fields');
end $$;
