\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql
\echo TASK17A_SCENARIO_START: idempotency_claim_replay
select task17a_test.reset_fixture(922001) as fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','idemclaim1') as claim_first \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','idemclaim1') as claim_replay \gset
select task17a_test.assert((:'claim_replay')::jsonb->>'idempotent'='true' and (select claim_attempt_count from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)=1, 'claim exact replay returns stored result and one mutation');
select task17a_test.create_secondary_work(922901) as claim_alt_work \gset
select task17a_test.expect_error('claim changed task conflicts','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'creator'),(:'claim_alt_work'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','idemclaim1'));
select task17a_test.expect_error('claim changed job conflicts','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'creator'),(:'fixture'::jsonb->>'task'),(:'claim_alt_work'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','idemclaim1'));
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_claimed' and idempotency_key='idemclaim1')=1, 'claim writes one successful audit');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key='idemclaim1')=1, 'claim writes one idempotency row');
select claim_token as token from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid \gset
select public.creator_publishing_update_onlyfans_operator_progress((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'token'::uuid,'not_started',0,'preparing',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','idemprog1') as progress_first \gset
select public.creator_publishing_update_onlyfans_operator_progress((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'token'::uuid,'not_started',0,'preparing',:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','idemprog1') as progress_replay \gset
select task17a_test.assert((:'progress_replay')::jsonb->>'idempotent'='true' and (select operator_progress_revision from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)=1, 'progress replay one mutation');
select public.creator_publishing_release_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'token'::uuid,'idemrel01') as release_first \gset
select public.creator_publishing_release_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'token'::uuid,'idemrel01') as release_replay \gset
select task17a_test.assert((:'release_replay')::jsonb->>'idempotent'='true' and (select status from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)='ready_for_handoff', 'release replay and unscheduled restoration');
select task17a_test.assert((select operator_progress_state from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)='preparing', 'release preserves progress');
select task17a_test.assert((select claim_attempt_count from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)=1, 'release preserves claim attempts');
\echo TASK17A_SCENARIO_START: expired_claim_fixture_valid
select task17a_test.reset_fixture(922002) as fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','recoverclaim') as recover_claim \gset
select task17a_test.expire_claim((:'fixture'::jsonb->>'task')::uuid);
select claimed_by as expired_prior_by, claim_expires_at as expired_prior_expires from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid \gset
\echo TASK17A_SCENARIO_START: recovery_select_no_mutation
select count(*) as recovery_select_task_count from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid;
select count(*) as recovery_select_job_count from public.creator_publishing_platform_jobs where id=(:'fixture'::jsonb->>'job')::uuid;
select task17a_test.assert((select status='claimed' and claimed_by=:'expired_prior_by'::uuid and claim_expires_at=:'expired_prior_expires'::timestamptz from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid), 'ordinary select does not recover expired claim');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and entity_id=(:'fixture'::jsonb->>'task')::uuid), 'ordinary select creates no recovery audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and queue_task_id=(:'fixture'::jsonb->>'task')::uuid), 'ordinary select creates no recovery idempotency');
\echo TASK17A_SCENARIO_START: explicit_recovery_authorized_operator
select public.creator_publishing_recover_expired_onlyfans_operator_claim((:'fixture'::jsonb->>'operator_a')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,'recover01') as recover_first \gset
select public.creator_publishing_recover_expired_onlyfans_operator_claim((:'fixture'::jsonb->>'operator_a')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,'recover01') as recover_replay \gset
select task17a_test.assert((:'recover_replay')::jsonb->>'idempotent'='true' and (select status from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)='ready_for_handoff', 'expired recovery replay and restoration');
select task17a_test.assert((select before_state->>'claimed_by' from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recover01' order by id desc limit 1)=:'expired_prior_by', 'recovery audit before_state keeps prior owner');
select task17a_test.assert((select before_state->>'claim_expires_at' from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='recover01' order by id desc limit 1) is not null, 'recovery audit before_state keeps prior expiration');
\echo TASK17A_SCENARIO_START: recovery_active_claim_rejected
select task17a_test.reset_fixture(922003) as active_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'active_fixture'::jsonb->>'creator')::uuid,(:'active_fixture'::jsonb->>'task')::uuid,(:'active_fixture'::jsonb->>'job')::uuid,:'active_fixture'::jsonb->>'consent_version',:'active_fixture'::jsonb->>'consent_hash','activeclaim') as active_claim \gset
select * from public.creator_publishing_queue_tasks where id=(:'active_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.expect_error('active claim cannot be recovered','OPERATOR_CLAIM_NOT_EXPIRED',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'active_fixture'::jsonb->>'creator'),(:'active_fixture'::jsonb->>'task'),(:'active_fixture'::jsonb->>'job'),'active001'));
select task17a_test.assert(status='claimed' and claimed_by=:'claimed_by'::uuid and claim_token=:'claim_token'::uuid and claim_expires_at=:'claim_expires_at'::timestamptz and operator_progress_state=:'operator_progress_state' and claim_attempt_count=:'claim_attempt_count'::int and assigned_operator_id=:'assigned_operator_id'::uuid, 'active unexpired recovery rejection preserves queue fields') from public.creator_publishing_queue_tasks where id=(:'active_fixture'::jsonb->>'task')::uuid;
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='active001'), 'active recovery rejection creates no audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key='active001'), 'active recovery rejection creates no idempotency');
\echo TASK17A_SCENARIO_START: release_identity_rejections
select task17a_test.reset_fixture(922101) as release_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'release_fixture'::jsonb->>'creator')::uuid,(:'release_fixture'::jsonb->>'task')::uuid,(:'release_fixture'::jsonb->>'job')::uuid,:'release_fixture'::jsonb->>'consent_version',:'release_fixture'::jsonb->>'consent_hash','relidentclaim') as release_claim \gset
select claim_token as release_token, status as release_status, claim_attempt_count as release_attempts from public.creator_publishing_queue_tasks where id=(:'release_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.expect_error('release missing job','OPERATOR_JOB_NOT_FOUND',format('select public.creator_publishing_release_onlyfans_operator_task(%L,%L,%L,%L,%L)',(:'release_fixture'::jsonb->>'creator'),(:'release_fixture'::jsonb->>'task'),'92210100-ffff-4000-8000-000000000001',:'release_token','relmissingjob'));
select task17a_test.expect_error('release missing task','OPERATOR_TASK_NOT_FOUND',format('select public.creator_publishing_release_onlyfans_operator_task(%L,%L,%L,%L,%L)',(:'release_fixture'::jsonb->>'creator'),'92210100-ffff-4000-8000-000000000002',(:'release_fixture'::jsonb->>'job'),:'release_token','relmissingtask'));
select task17a_test.reset_fixture(922102) as release_other \gset
select task17a_test.expect_error('release mismatched task job','OPERATOR_TASK_JOB_MISMATCH',format('select public.creator_publishing_release_onlyfans_operator_task(%L,%L,%L,%L,%L)',(:'release_fixture'::jsonb->>'creator'),(:'release_fixture'::jsonb->>'task'),(:'release_other'::jsonb->>'job'),:'release_token','relmismatch'));
select task17a_test.expect_error('release wrong token','OPERATOR_CLAIM_TOKEN_MISMATCH',format('select public.creator_publishing_release_onlyfans_operator_task(%L,%L,%L,%L,%L)',(:'release_fixture'::jsonb->>'creator'),(:'release_fixture'::jsonb->>'task'),(:'release_fixture'::jsonb->>'job'),'92210100-ffff-4000-8000-000000000003','relwrongtoken'));
select task17a_test.assert((select status=:'release_status' and claim_attempt_count=:'release_attempts'::int from public.creator_publishing_queue_tasks where id=(:'release_fixture'::jsonb->>'task')::uuid), 'release identity rejections preserve queue');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key in ('relmissingjob','relmissingtask','relmismatch','relwrongtoken')), 'release identity rejections write no audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where idempotency_key in ('relmissingjob','relmissingtask','relmismatch','relwrongtoken')), 'release identity rejections write no idempotency');
\echo TASK17A_SCENARIO_START: manual_result_evidence_blocks_release_recovery_and_progress
select task17a_test.reset_fixture(922201) as evidence_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'evidence_fixture'::jsonb->>'creator')::uuid,(:'evidence_fixture'::jsonb->>'task')::uuid,(:'evidence_fixture'::jsonb->>'job')::uuid,:'evidence_fixture'::jsonb->>'consent_version',:'evidence_fixture'::jsonb->>'consent_hash','evidenceclaim1') as evidence_claim \gset
select claim_token as evidence_token, claim_attempt_count as evidence_attempts from public.creator_publishing_queue_tasks where id=(:'evidence_fixture'::jsonb->>'task')::uuid \gset
update public.creator_publishing_queue_tasks set posted_confirmation=true where id=(:'evidence_fixture'::jsonb->>'task')::uuid;
select task17a_test.expect_error('manual result blocks progress','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_update_onlyfans_operator_progress(%L,%L,%L,%L,%L,%s,%L,%L,%L,%L)',(:'evidence_fixture'::jsonb->>'creator'),(:'evidence_fixture'::jsonb->>'task'),(:'evidence_fixture'::jsonb->>'job'),:'evidence_token','not_started',0,'preparing',:'evidence_fixture'::jsonb->>'consent_version',:'evidence_fixture'::jsonb->>'consent_hash','evidenceprog'));
select task17a_test.expect_error('manual result blocks release','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_release_onlyfans_operator_task(%L,%L,%L,%L,%L)',(:'evidence_fixture'::jsonb->>'creator'),(:'evidence_fixture'::jsonb->>'task'),(:'evidence_fixture'::jsonb->>'job'),:'evidence_token','evidencerel'));
select task17a_test.expire_claim((:'evidence_fixture'::jsonb->>'task')::uuid);
select task17a_test.expect_error('manual result blocks explicit recovery','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'evidence_fixture'::jsonb->>'creator'),(:'evidence_fixture'::jsonb->>'task'),(:'evidence_fixture'::jsonb->>'job'),'evidencerec'));
select task17a_test.expect_error('manual result blocks in-claim recovery','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'evidence_fixture'::jsonb->>'creator'),(:'evidence_fixture'::jsonb->>'task'),(:'evidence_fixture'::jsonb->>'job'),:'evidence_fixture'::jsonb->>'consent_version',:'evidence_fixture'::jsonb->>'consent_hash','evidenceclaim2'));
select task17a_test.assert((select status='claimed' and posted_confirmation=true and claim_attempt_count=:'evidence_attempts'::int and operator_progress_state='not_started' from public.creator_publishing_queue_tasks where id=(:'evidence_fixture'::jsonb->>'task')::uuid), 'manual result evidence preserves ownership progress attempts');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key in ('evidenceprog','evidencerel','evidencerec','evidenceclaim2')), 'manual result evidence writes no success audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where idempotency_key in ('evidenceprog','evidencerel','evidencerec','evidenceclaim2')), 'manual result evidence writes no idempotency');

create or replace function task17a_test.assert_manual_result_field_blocks(seed integer, field_name text) returns void language plpgsql as $$
declare
  f jsonb;
  active_f jsonb;
  before_row public.creator_publishing_queue_tasks%rowtype;
  active_before public.creator_publishing_queue_tasks%rowtype;
  token uuid;
  value_sql text;
  claim_key text := 'manualclaim' || seed;
  progress_key text := 'manualprog' || seed;
  release_key text := 'manualrel' || seed;
  recovery_key text := 'manualrec' || seed;
  inclaim_key text := 'manualinclaim' || seed;
  field_is_present boolean;
begin
  value_sql := case field_name
    when 'posted_by' then 'FIXTURE_CREATOR'
    when 'posted_at' then 'clock_timestamp()'
    when 'posted_confirmation' then 'true'
    when 'final_post_url' then quote_literal('https://example.test/manual/' || seed)
    when 'final_post_url_skip_reason' then quote_literal('operator skipped ' || seed)
    when 'proof_screenshot_storage_key' then quote_literal('proof/task17a/' || seed)
    when 'skip_or_fail_reason' then quote_literal('manual result ' || seed)
    else null
  end;
  perform task17a_test.assert(value_sql is not null, 'manual result field supported ' || field_name);

  f := task17a_test.reset_fixture(seed);
  if field_name='posted_by' then
    update public.creator_publishing_queue_tasks set posted_by=(f->>'creator')::uuid where id=(f->>'task')::uuid;
    perform task17a_test.assert(exists(select 1 from auth.users where id=(f->>'creator')::uuid), 'posted_by unclaimed fixture user exists');
    perform task17a_test.assert((select posted_by=(f->>'creator')::uuid and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), 'posted_by unclaimed fixture setup valid');
  else
    execute format('update public.creator_publishing_queue_tasks set %I = %s where id=$1', field_name, value_sql) using (f->>'task')::uuid;
  end if;
  select * into before_row from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid;
  perform task17a_test.expect_error(field_name || ' blocks unclaimed claim','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)', f->>'creator', f->>'task', f->>'job', f->>'consent_version', f->>'consent_hash', claim_key));
  perform task17a_test.assert((select status is not distinct from before_row.status and claimed_by is not distinct from before_row.claimed_by and claimed_at is not distinct from before_row.claimed_at and claim_token is not distinct from before_row.claim_token and claim_expires_at is not distinct from before_row.claim_expires_at and claim_attempt_count is not distinct from before_row.claim_attempt_count and operator_progress_state is not distinct from before_row.operator_progress_state and operator_progress_revision is not distinct from before_row.operator_progress_revision and operator_progress_updated_by is not distinct from before_row.operator_progress_updated_by and operator_progress_updated_at is not distinct from before_row.operator_progress_updated_at and assigned_operator_id is not distinct from before_row.assigned_operator_id from public.creator_publishing_queue_tasks where id=(f->>'task')::uuid), field_name || ' unclaimed claim preserves queue');
  execute format('select (%I is not null%s) from public.creator_publishing_queue_tasks where id=$1', field_name, case when field_name='posted_confirmation' then ' and posted_confirmation is true' else '' end) using (f->>'task')::uuid into field_is_present;
  perform task17a_test.assert(field_is_present, field_name || ' evidence remains present after claim rejection');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claimed' and idempotency_key=claim_key), field_name || ' claim rejection writes no success audit');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key=claim_key), field_name || ' claim rejection writes no idempotency');

  active_f := task17a_test.reset_fixture(seed + 1000);
  perform public.creator_publishing_claim_onlyfans_operator_task((active_f->>'creator')::uuid,(active_f->>'task')::uuid,(active_f->>'job')::uuid,active_f->>'consent_version',active_f->>'consent_hash','manualactiveclaim' || seed);
  select claim_token into token from public.creator_publishing_queue_tasks where id=(active_f->>'task')::uuid;
  if field_name='posted_by' then
    update public.creator_publishing_queue_tasks set posted_by=(active_f->>'creator')::uuid where id=(active_f->>'task')::uuid;
    perform task17a_test.assert(exists(select 1 from auth.users where id=(active_f->>'creator')::uuid), 'posted_by active fixture user exists');
    perform task17a_test.assert((select posted_by=(active_f->>'creator')::uuid and status='claimed' and claimed_by is not null and claimed_at is not null and claim_token is not null and claim_expires_at is not null from public.creator_publishing_queue_tasks where id=(active_f->>'task')::uuid), 'posted_by active fixture setup valid');
  else
    execute format('update public.creator_publishing_queue_tasks set %I = %s where id=$1', field_name, value_sql) using (active_f->>'task')::uuid;
  end if;
  select * into active_before from public.creator_publishing_queue_tasks where id=(active_f->>'task')::uuid;
  perform task17a_test.expect_error(field_name || ' blocks progress','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_update_onlyfans_operator_progress(%L,%L,%L,%L,%L,%s,%L,%L,%L,%L)',active_f->>'creator',active_f->>'task',active_f->>'job',token,'not_started',0,'preparing',active_f->>'consent_version',active_f->>'consent_hash',progress_key));
  perform task17a_test.expect_error(field_name || ' blocks release','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_release_onlyfans_operator_task(%L,%L,%L,%L,%L)',active_f->>'creator',active_f->>'task',active_f->>'job',token,release_key));
  perform task17a_test.expire_claim((active_f->>'task')::uuid);
  select * into active_before from public.creator_publishing_queue_tasks where id=(active_f->>'task')::uuid;
  perform task17a_test.expect_error(field_name || ' blocks explicit recovery','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',active_f->>'creator',active_f->>'task',active_f->>'job',recovery_key));
  perform task17a_test.expect_error(field_name || ' blocks in-claim recovery','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',active_f->>'creator',active_f->>'task',active_f->>'job',active_f->>'consent_version',active_f->>'consent_hash',inclaim_key));
  perform task17a_test.assert((select status is not distinct from active_before.status and claimed_by is not distinct from active_before.claimed_by and claimed_at is not distinct from active_before.claimed_at and claim_token is not distinct from active_before.claim_token and claim_expires_at is not distinct from active_before.claim_expires_at and claim_attempt_count is not distinct from active_before.claim_attempt_count and operator_progress_state is not distinct from active_before.operator_progress_state and operator_progress_revision is not distinct from active_before.operator_progress_revision and operator_progress_updated_by is not distinct from active_before.operator_progress_updated_by and operator_progress_updated_at is not distinct from active_before.operator_progress_updated_at and assigned_operator_id is not distinct from active_before.assigned_operator_id from public.creator_publishing_queue_tasks where id=(active_f->>'task')::uuid), field_name || ' active errors preserve ownership progress attempts');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key in (progress_key,release_key,recovery_key,inclaim_key)), field_name || ' active errors write no success audit');
  perform task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where idempotency_key in (progress_key,release_key,recovery_key,inclaim_key)), field_name || ' active errors write no idempotency');
end $$;

\echo TASK17A_SCENARIO_START: manual_result_field_posted_by
select task17a_test.assert_manual_result_field_blocks(924001,'posted_by');
\echo TASK17A_SCENARIO_START: manual_result_field_posted_at
select task17a_test.assert_manual_result_field_blocks(924002,'posted_at');
\echo TASK17A_SCENARIO_START: manual_result_field_posted_confirmation
select task17a_test.assert_manual_result_field_blocks(924003,'posted_confirmation');
\echo TASK17A_SCENARIO_START: manual_result_field_final_post_url
select task17a_test.assert_manual_result_field_blocks(924004,'final_post_url');
\echo TASK17A_SCENARIO_START: manual_result_field_final_post_url_skip_reason
select task17a_test.assert_manual_result_field_blocks(924005,'final_post_url_skip_reason');
\echo TASK17A_SCENARIO_START: manual_result_field_proof_screenshot_storage_key
select task17a_test.assert_manual_result_field_blocks(924006,'proof_screenshot_storage_key');
\echo TASK17A_SCENARIO_START: manual_result_field_skip_or_fail_reason
select task17a_test.assert_manual_result_field_blocks(924007,'skip_or_fail_reason');

\echo TASK17A_SCENARIO_START: recovery_deterministic_errors
select task17a_test.reset_fixture(924101) as recovery_det_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'recovery_det_fixture'::jsonb->>'creator')::uuid,(:'recovery_det_fixture'::jsonb->>'task')::uuid,(:'recovery_det_fixture'::jsonb->>'job')::uuid,:'recovery_det_fixture'::jsonb->>'consent_version',:'recovery_det_fixture'::jsonb->>'consent_hash','recdetclaim') as recovery_det_claim \gset
select claim_token as recovery_det_token from public.creator_publishing_queue_tasks where id=(:'recovery_det_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.expect_error('recovery null actor invalid','OPERATOR_REQUEST_INVALID',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(null,%L,%L,%L)',(:'recovery_det_fixture'::jsonb->>'task'),(:'recovery_det_fixture'::jsonb->>'job'),'recdetnullactor'));
select task17a_test.expect_error('recovery null task invalid','OPERATOR_REQUEST_INVALID',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,null,%L,%L)',(:'recovery_det_fixture'::jsonb->>'creator'),(:'recovery_det_fixture'::jsonb->>'job'),'recdetnulltask'));
select task17a_test.expect_error('recovery null job invalid','OPERATOR_REQUEST_INVALID',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,null,%L)',(:'recovery_det_fixture'::jsonb->>'creator'),(:'recovery_det_fixture'::jsonb->>'task'),'recdetnulljob'));
select task17a_test.expect_error('recovery bad idempotency key','OPERATOR_IDEMPOTENCY_KEY_INVALID',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'recovery_det_fixture'::jsonb->>'creator'),(:'recovery_det_fixture'::jsonb->>'task'),(:'recovery_det_fixture'::jsonb->>'job'),'bad key'));
select task17a_test.expect_error('recovery missing job','OPERATOR_JOB_NOT_FOUND',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'recovery_det_fixture'::jsonb->>'creator'),(:'recovery_det_fixture'::jsonb->>'task'),'92410100-ffff-4000-8000-000000000001','recdetmissingjob'));
select task17a_test.expect_error('recovery missing task','OPERATOR_TASK_NOT_FOUND',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'recovery_det_fixture'::jsonb->>'creator'),'92410100-ffff-4000-8000-000000000002',(:'recovery_det_fixture'::jsonb->>'job'),'recdetmissingtask'));
select task17a_test.create_secondary_work(924102) as recovery_det_other \gset
select task17a_test.expect_error('recovery mismatched work','OPERATOR_TASK_JOB_MISMATCH',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'recovery_det_fixture'::jsonb->>'creator'),(:'recovery_det_fixture'::jsonb->>'task'),(:'recovery_det_other'::jsonb->>'job'),'recdetmismatch'));
update public.creator_publishing_platform_jobs set publishing_mode='direct' where id=(:'recovery_det_fixture'::jsonb->>'job')::uuid;
select task17a_test.expect_error('recovery non assisted','OPERATOR_TARGET_NOT_SUPPORTED',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'recovery_det_fixture'::jsonb->>'creator'),(:'recovery_det_fixture'::jsonb->>'task'),(:'recovery_det_fixture'::jsonb->>'job'),'recdetdirect'));
update public.creator_publishing_platform_jobs set publishing_mode='assisted', job_state='blocked' where id=(:'recovery_det_fixture'::jsonb->>'job')::uuid;
select task17a_test.expect_error('recovery ineligible job','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'recovery_det_fixture'::jsonb->>'creator'),(:'recovery_det_fixture'::jsonb->>'task'),(:'recovery_det_fixture'::jsonb->>'job'),'recdetblocked'));
update public.creator_publishing_platform_jobs set job_state='draft', cancelled_at=clock_timestamp(), cancelled_by=(:'recovery_det_fixture'::jsonb->>'creator')::uuid, cancellation_reason='cancelled' where id=(:'recovery_det_fixture'::jsonb->>'job')::uuid;
select task17a_test.expect_error('recovery cancelled job','OPERATOR_TASK_INELIGIBLE',format('select public.creator_publishing_recover_expired_onlyfans_operator_claim(%L,%L,%L,%L)',(:'recovery_det_fixture'::jsonb->>'creator'),(:'recovery_det_fixture'::jsonb->>'task'),(:'recovery_det_fixture'::jsonb->>'job'),'recdetcancel'));
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key='recdetclaim' and queue_task_id=(:'recovery_det_fixture'::jsonb->>'task')::uuid and platform_job_id=(:'recovery_det_fixture'::jsonb->>'job')::uuid and actor_id=(:'recovery_det_fixture'::jsonb->>'creator')::uuid)=1, 'recovery deterministic setup claim writes exactly one claim idempotency row');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key in ('recdetnullactor','recdetnulltask','recdetnulljob','recdetmissingjob','recdetmissingtask','recdetmismatch','recdetdirect','recdetblocked','recdetcancel','bad key')), 'recovery deterministic errors write no recovery audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_action_idempotency where action_type='expired_claim_recovery' and idempotency_key in ('recdetnullactor','recdetnulltask','recdetnulljob','recdetmissingjob','recdetmissingtask','recdetmismatch','recdetdirect','recdetblocked','recdetcancel','bad key')), 'recovery deterministic errors write no recovery idempotency');

\echo TASK17A_SCENARIO_START: in_claim_recovery_replacement_success
select task17a_test.reset_fixture(927001) as in_claim_success_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_success_fixture'::jsonb->>'creator')::uuid,(:'in_claim_success_fixture'::jsonb->>'task')::uuid,(:'in_claim_success_fixture'::jsonb->>'job')::uuid,:'in_claim_success_fixture'::jsonb->>'consent_version',:'in_claim_success_fixture'::jsonb->>'consent_hash','inclsuccclaim1') as in_claim_success_first \gset
select claim_token as in_claim_success_old_token from public.creator_publishing_queue_tasks where id=(:'in_claim_success_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.expire_claim((:'in_claim_success_fixture'::jsonb->>'task')::uuid);
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_success_fixture'::jsonb->>'creator')::uuid,(:'in_claim_success_fixture'::jsonb->>'task')::uuid,(:'in_claim_success_fixture'::jsonb->>'job')::uuid,:'in_claim_success_fixture'::jsonb->>'consent_version',:'in_claim_success_fixture'::jsonb->>'consent_hash','inclsuccclaim2') as in_claim_success_second \gset
select claim_token as in_claim_success_new_token, claim_attempt_count as in_claim_success_attempts from public.creator_publishing_queue_tasks where id=(:'in_claim_success_fixture'::jsonb->>'task')::uuid \gset
select task17a_test.assert((:'in_claim_success_second')::jsonb->>'ok'='true' and (:'in_claim_success_second')::jsonb->>'expired_claim_recovered'='true' and (:'in_claim_success_second')::jsonb->>'replacement_claim_granted'='true', 'in-claim recovery replacement success result flags');
select task17a_test.assert(:'in_claim_success_old_token' <> :'in_claim_success_new_token' and :'in_claim_success_attempts'::int=2, 'in-claim recovery replacement success token changed attempts two');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and entity_id=(:'in_claim_success_fixture'::jsonb->>'task')::uuid and idempotency_key='inclsuccclaim2')=1, 'in-claim recovery success writes one recovery audit');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_claimed' and entity_id=(:'in_claim_success_fixture'::jsonb->>'task')::uuid and idempotency_key='inclsuccclaim2')=1, 'in-claim recovery success writes one replacement claim audit');
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_success_fixture'::jsonb->>'creator')::uuid,(:'in_claim_success_fixture'::jsonb->>'task')::uuid,(:'in_claim_success_fixture'::jsonb->>'job')::uuid,:'in_claim_success_fixture'::jsonb->>'consent_version',:'in_claim_success_fixture'::jsonb->>'consent_hash','inclsuccclaim2') as in_claim_success_replay \gset
select task17a_test.assert((:'in_claim_success_replay')::jsonb->>'idempotent'='true' and (select claim_attempt_count from public.creator_publishing_queue_tasks where id=(:'in_claim_success_fixture'::jsonb->>'task')::uuid)=2, 'in-claim recovery replacement replay no additional mutation');

\echo TASK17A_SCENARIO_START: in_claim_recovery_not_due_structured
select task17a_test.reset_fixture(927002,'scheduled_internally','scheduled_internally',true) as in_claim_not_due_fixture \gset
update public.creator_publishing_platform_jobs set intended_publish_at=now() - interval '1 minute', operator_due_at=now() - interval '61 minutes', scheduled_at=now() - interval '2 hours', schedule_timezone='UTC', schedule_revision=1 where id=(:'in_claim_not_due_fixture'::jsonb->>'job')::uuid;
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_not_due_fixture'::jsonb->>'creator')::uuid,(:'in_claim_not_due_fixture'::jsonb->>'task')::uuid,(:'in_claim_not_due_fixture'::jsonb->>'job')::uuid,:'in_claim_not_due_fixture'::jsonb->>'consent_version',:'in_claim_not_due_fixture'::jsonb->>'consent_hash','inclnotdue1') as in_claim_not_due_first \gset
select task17a_test.expire_claim((:'in_claim_not_due_fixture'::jsonb->>'task')::uuid);
update public.creator_publishing_platform_jobs set job_state='scheduled_internally', intended_publish_at=now() + interval '2 hours', operator_due_at=now() + interval '1 hour', scheduled_at=now(), schedule_timezone='UTC', schedule_revision=2 where id=(:'in_claim_not_due_fixture'::jsonb->>'job')::uuid;
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_not_due_fixture'::jsonb->>'creator')::uuid,(:'in_claim_not_due_fixture'::jsonb->>'task')::uuid,(:'in_claim_not_due_fixture'::jsonb->>'job')::uuid,:'in_claim_not_due_fixture'::jsonb->>'consent_version',:'in_claim_not_due_fixture'::jsonb->>'consent_hash','inclnotdue2') as in_claim_not_due_result \gset
select task17a_test.assert((:'in_claim_not_due_result')::jsonb->>'ok'='false' and (:'in_claim_not_due_result')::jsonb->>'expired_claim_recovered'='true' and (:'in_claim_not_due_result')::jsonb->>'replacement_claim_granted'='false' and (:'in_claim_not_due_result')::jsonb->>'safe_error_code'='OPERATOR_NOT_DUE', 'in-claim recovery not due returns structured denial');
select task17a_test.assert((select status='scheduled_internally' and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null from public.creator_publishing_queue_tasks where id=(:'in_claim_not_due_fixture'::jsonb->>'task')::uuid), 'in-claim recovery not due persists cleared scheduled status');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='inclnotdue2')=1 and (select count(*) from public.creator_publishing_audit_events where action='operator_task_claimed' and idempotency_key='inclnotdue2')=0, 'in-claim recovery not due audit counts');
select task17a_test.assert((select count(*) from public.creator_publishing_operator_action_idempotency where action_type='claim' and idempotency_key='inclnotdue2')=1, 'in-claim recovery not due stores claim idempotency result');
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_not_due_fixture'::jsonb->>'creator')::uuid,(:'in_claim_not_due_fixture'::jsonb->>'task')::uuid,(:'in_claim_not_due_fixture'::jsonb->>'job')::uuid,:'in_claim_not_due_fixture'::jsonb->>'consent_version',:'in_claim_not_due_fixture'::jsonb->>'consent_hash','inclnotdue2') as in_claim_not_due_replay \gset
select task17a_test.assert((:'in_claim_not_due_replay')::jsonb->>'idempotent'='true' and (select count(*) from public.creator_publishing_audit_events where action='operator_expired_claim_recovered' and idempotency_key='inclnotdue2')=1, 'in-claim recovery not due replay no duplicate recovery audit');

\echo TASK17A_SCENARIO_START: in_claim_recovery_safety_drift_structured
select task17a_test.reset_fixture(927003) as in_claim_safety_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_safety_fixture'::jsonb->>'creator')::uuid,(:'in_claim_safety_fixture'::jsonb->>'task')::uuid,(:'in_claim_safety_fixture'::jsonb->>'job')::uuid,:'in_claim_safety_fixture'::jsonb->>'consent_version',:'in_claim_safety_fixture'::jsonb->>'consent_hash','inclsafety1') as in_claim_safety_first \gset
select task17a_test.expire_claim((:'in_claim_safety_fixture'::jsonb->>'task')::uuid);
update public.creator_publishing_ai_twin_consents set status='revoked', revoked_at=clock_timestamp() where creator_id=(:'in_claim_safety_fixture'::jsonb->>'creator')::uuid;
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_safety_fixture'::jsonb->>'creator')::uuid,(:'in_claim_safety_fixture'::jsonb->>'task')::uuid,(:'in_claim_safety_fixture'::jsonb->>'job')::uuid,:'in_claim_safety_fixture'::jsonb->>'consent_version',:'in_claim_safety_fixture'::jsonb->>'consent_hash','inclsafety2') as in_claim_safety_result \gset
select task17a_test.assert((:'in_claim_safety_result')::jsonb->>'ok'='false' and (:'in_claim_safety_result')::jsonb->>'expired_claim_recovered'='true' and (:'in_claim_safety_result')::jsonb->>'replacement_claim_granted'='false' and (:'in_claim_safety_result')::jsonb->>'safe_error_code'='AI_TWIN_CONSENT_MISSING', 'in-claim recovery safety drift structured denial');
select task17a_test.assert((select status='ready_for_handoff' and claimed_by is null and claim_token is null from public.creator_publishing_queue_tasks where id=(:'in_claim_safety_fixture'::jsonb->>'task')::uuid), 'in-claim recovery safety drift persists cleared ownership');
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_safety_fixture'::jsonb->>'creator')::uuid,(:'in_claim_safety_fixture'::jsonb->>'task')::uuid,(:'in_claim_safety_fixture'::jsonb->>'job')::uuid,:'in_claim_safety_fixture'::jsonb->>'consent_version',:'in_claim_safety_fixture'::jsonb->>'consent_hash','inclsafety2') as in_claim_safety_replay \gset
select task17a_test.assert((:'in_claim_safety_replay')::jsonb->>'idempotent'='true', 'in-claim recovery safety drift replay deterministic');

\echo TASK17A_SCENARIO_START: in_claim_recovery_duplicate_task_structured
begin;
select task17a_test.reset_fixture(927004) as in_claim_dupe_fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_dupe_fixture'::jsonb->>'creator')::uuid,(:'in_claim_dupe_fixture'::jsonb->>'task')::uuid,(:'in_claim_dupe_fixture'::jsonb->>'job')::uuid,:'in_claim_dupe_fixture'::jsonb->>'consent_version',:'in_claim_dupe_fixture'::jsonb->>'consent_hash','incldupe1') as in_claim_dupe_first \gset
select task17a_test.expire_claim((:'in_claim_dupe_fixture'::jsonb->>'task')::uuid);
drop index public.creator_publishing_queue_one_task_per_package_platform_uidx;
insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,created_at,updated_at) values('17700000-ffff-4000-8000-000000927004',(:'in_claim_dupe_fixture'::jsonb->>'package')::uuid,(:'in_claim_dupe_fixture'::jsonb->>'creator')::uuid,'onlyfans',(:'in_claim_dupe_fixture'::jsonb->>'account')::uuid,'ready_for_handoff',clock_timestamp(),clock_timestamp());
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_dupe_fixture'::jsonb->>'creator')::uuid,(:'in_claim_dupe_fixture'::jsonb->>'task')::uuid,(:'in_claim_dupe_fixture'::jsonb->>'job')::uuid,:'in_claim_dupe_fixture'::jsonb->>'consent_version',:'in_claim_dupe_fixture'::jsonb->>'consent_hash','incldupe2') as in_claim_dupe_result \gset
select task17a_test.assert((:'in_claim_dupe_result')::jsonb->>'ok'='false' and (:'in_claim_dupe_result')::jsonb->>'safe_error_code'='OPERATOR_QUEUE_TASK_AMBIGUOUS' and (:'in_claim_dupe_result')::jsonb->>'expired_claim_recovered'='true' and (:'in_claim_dupe_result')::jsonb->>'replacement_claim_granted'='false', 'in-claim recovery duplicate task structured denial');
select task17a_test.assert((select status='ready_for_handoff' and claimed_by is null and claim_token is null from public.creator_publishing_queue_tasks where id=(:'in_claim_dupe_fixture'::jsonb->>'task')::uuid), 'in-claim recovery duplicate leaves original restored unclaimed');
select task17a_test.assert((select status='ready_for_handoff' and claimed_by is null and claim_token is null from public.creator_publishing_queue_tasks where id='17700000-ffff-4000-8000-000000927004'::uuid), 'in-claim recovery duplicate leaves duplicate unclaimed');
rollback;
