\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql
\echo TASK17A_SCENARIO_START: scheduler_operator_due_ready
select task17a_test.reset_fixture(924001,'ready_for_handoff','scheduled_internally',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '1 minute', intended_publish_at=clock_timestamp()+interval '1 hour' where id=(:'fixture'::jsonb->>'job')::uuid;
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92400000-0000-4000-8000-000000000001',(:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'plan')::uuid,(:'fixture'::jsonb->>'job')::uuid,'operator_due','processing',clock_timestamp()-interval '1 minute',1,'92400000-0000-4000-8000-000000000101',clock_timestamp());
select public.creator_publishing_process_scheduler_event('92400000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000101',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash') as op_due_result \gset
select task17a_test.assert((:'op_due_result')::jsonb->>'status'='processed' and (select job_state from public.creator_publishing_platform_jobs where id=(:'fixture'::jsonb->>'job')::uuid)='awaiting_operator' and (select status from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)='awaiting_operator', 'operator_due advances unclaimed queue to awaiting_operator');
select task17a_test.reset_fixture(924002,'awaiting_operator','awaiting_operator',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '2 hours', intended_publish_at=clock_timestamp()-interval '1 minute' where id=(:'fixture'::jsonb->>'job')::uuid;
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92400000-0000-4000-8000-000000000002',(:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'plan')::uuid,(:'fixture'::jsonb->>'job')::uuid,'publish_due','processing',clock_timestamp()-interval '1 minute',1,'92400000-0000-4000-8000-000000000102',clock_timestamp());
select public.creator_publishing_process_scheduler_event('92400000-0000-4000-8000-000000000002','92400000-0000-4000-8000-000000000102',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash') as pub_due_result \gset
select task17a_test.assert((:'pub_due_result')::jsonb->>'status'='processed' and (select job_state from public.creator_publishing_platform_jobs where id=(:'fixture'::jsonb->>'job')::uuid)='due_now' and (select status from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)='due_now', 'publish_due advances unclaimed queue to due_now');
select task17a_test.reset_fixture(924003,'scheduled_internally','scheduled_internally',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '1 minute', intended_publish_at=clock_timestamp()+interval '1 hour' where id=(:'fixture'::jsonb->>'job')::uuid;
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','schedclaim') as claim_result \gset
select claimed_by as before_by, claimed_at as before_at, claim_token as before_token, claim_expires_at as before_expires, operator_progress_state as before_progress from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid \gset
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92400000-0000-4000-8000-000000000003',(:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'plan')::uuid,(:'fixture'::jsonb->>'job')::uuid,'operator_due','processing',clock_timestamp()-interval '1 minute',1,'92400000-0000-4000-8000-000000000103',clock_timestamp());
select public.creator_publishing_process_scheduler_event('92400000-0000-4000-8000-000000000003','92400000-0000-4000-8000-000000000103',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash') as claim_due_result \gset
select task17a_test.assert((:'claim_due_result')::jsonb->>'status'='processed' and status='claimed' and claimed_by=:'before_by'::uuid and claim_token=:'before_token'::uuid and claim_expires_at=:'before_expires'::timestamptz and operator_progress_state=:'before_progress', 'operator_due preserves active claim fields') from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid;
select task17a_test.reset_fixture(924004,'blocked','blocked',true) as fixture \gset
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92400000-0000-4000-8000-000000000004',(:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'plan')::uuid,(:'fixture'::jsonb->>'job')::uuid,'operator_due','processing',clock_timestamp()-interval '1 minute',1,'92400000-0000-4000-8000-000000000104',clock_timestamp());
select public.creator_publishing_process_scheduler_event('92400000-0000-4000-8000-000000000004','92400000-0000-4000-8000-000000000104',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash') as blocked_result \gset
select task17a_test.assert((:'blocked_result')::jsonb->>'status'='blocked', 'blocked scheduler work fails closed');

create or replace function task17a_test.run_scheduler_transition(seed integer, input_queue_status text, input_job_state text, event text, expected_queue_status text, expected_job_state text, label text) returns void language plpgsql as $$
declare
  f jsonb;
  v_event uuid := task17a_test.uuid_for('92410000-0000-4000-8000-', seed);
  v_lock uuid := task17a_test.uuid_for('92420000-0000-4000-8000-', seed);
  v_result jsonb;
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
  perform task17a_test.assert(v_result->>'status'='processed', label || ' processed');
  perform task17a_test.assert((select job_state=expected_job_state from public.creator_publishing_platform_jobs where id=(f->>'job')::uuid), label || ' job state');
  perform task17a_test.assert((select status=expected_queue_status from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), label || ' queue state');
end $$;

select task17a_test.run_scheduler_transition(924101,'ready_for_handoff','scheduled_internally','operator_due','awaiting_operator','awaiting_operator','operator_due ready_for_handoff to awaiting_operator');
select task17a_test.run_scheduler_transition(924102,'scheduled_internally','scheduled_internally','operator_due','awaiting_operator','awaiting_operator','operator_due scheduled_internally to awaiting_operator');
select task17a_test.run_scheduler_transition(924103,'awaiting_operator','awaiting_operator','operator_due','awaiting_operator','awaiting_operator','operator_due awaiting_operator nonregression');
select task17a_test.run_scheduler_transition(924104,'due_now','due_now','operator_due','due_now','due_now','operator_due due_now nonregression');
select task17a_test.run_scheduler_transition(924105,'ready_for_handoff','scheduled_internally','publish_due','due_now','due_now','publish_due ready_for_handoff to due_now');
select task17a_test.run_scheduler_transition(924106,'scheduled_internally','scheduled_internally','publish_due','due_now','due_now','publish_due scheduled_internally to due_now');
select task17a_test.run_scheduler_transition(924107,'awaiting_operator','awaiting_operator','publish_due','due_now','due_now','publish_due awaiting_operator to due_now');
select task17a_test.run_scheduler_transition(924108,'due_now','due_now','publish_due','due_now','due_now','publish_due due_now nonregression');

do $$
declare
  f jsonb;
  v_event uuid := '92400000-0000-4000-8000-000000000205';
  v_lock uuid := '92400000-0000-4000-8000-000000000305';
  v_result jsonb;
  before_row public.creator_publishing_queue_tasks%rowtype;
begin
  f := task17a_test.reset_fixture(924205,'scheduled_internally','scheduled_internally',true);
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
