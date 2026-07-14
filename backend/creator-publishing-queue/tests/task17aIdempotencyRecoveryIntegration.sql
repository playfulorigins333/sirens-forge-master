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
select task17a_test.set_valid_schedule_phase((:'in_claim_not_due_fixture'::jsonb->>'job')::uuid,'after_publish_due',1);
select public.creator_publishing_claim_onlyfans_operator_task((:'in_claim_not_due_fixture'::jsonb->>'creator')::uuid,(:'in_claim_not_due_fixture'::jsonb->>'task')::uuid,(:'in_claim_not_due_fixture'::jsonb->>'job')::uuid,:'in_claim_not_due_fixture'::jsonb->>'consent_version',:'in_claim_not_due_fixture'::jsonb->>'consent_hash','inclnotdue1') as in_claim_not_due_first \gset
select task17a_test.expire_claim((:'in_claim_not_due_fixture'::jsonb->>'task')::uuid);
update public.creator_publishing_platform_jobs set job_state='scheduled_internally' where id=(:'in_claim_not_due_fixture'::jsonb->>'job')::uuid;
select task17a_test.set_valid_schedule_phase((:'in_claim_not_due_fixture'::jsonb->>'job')::uuid,'before_operator_due',2);
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

\echo TASK17A_SCENARIO_START: cancel_job_active_claim_cleanup
select task17a_test.reset_fixture(927201,'scheduled_internally','scheduled_internally',true) as cancel_job_fixture \gset
select task17a_test.set_valid_schedule_phase((:'cancel_job_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select public.creator_publishing_claim_onlyfans_operator_task((:'cancel_job_fixture'::jsonb->>'creator')::uuid,(:'cancel_job_fixture'::jsonb->>'task')::uuid,(:'cancel_job_fixture'::jsonb->>'job')::uuid,:'cancel_job_fixture'::jsonb->>'consent_version',:'cancel_job_fixture'::jsonb->>'consent_hash','canceljobclaim') as cancel_job_claim \gset
select claim_token as cancel_job_token, claim_attempt_count as cancel_job_attempts, assigned_operator_id as cancel_job_assigned from public.creator_publishing_queue_tasks where id=(:'cancel_job_fixture'::jsonb->>'task')::uuid \gset
select public.creator_publishing_update_onlyfans_operator_progress((:'cancel_job_fixture'::jsonb->>'creator')::uuid,(:'cancel_job_fixture'::jsonb->>'task')::uuid,(:'cancel_job_fixture'::jsonb->>'job')::uuid,:'cancel_job_token'::uuid,'not_started',0,'preparing',:'cancel_job_fixture'::jsonb->>'consent_version',:'cancel_job_fixture'::jsonb->>'consent_hash','canceljobprep') as cancel_job_progress \gset
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92720000-0000-4000-8000-000000000201',(:'cancel_job_fixture'::jsonb->>'creator')::uuid,(:'cancel_job_fixture'::jsonb->>'plan')::uuid,(:'cancel_job_fixture'::jsonb->>'job')::uuid,'publish_due','processing',clock_timestamp()-interval '1 minute',1,'92720000-0000-4000-8000-000000000301',clock_timestamp());
select public.creator_publishing_cancel_job_schedule((:'cancel_job_fixture'::jsonb->>'creator')::uuid,(:'cancel_job_fixture'::jsonb->>'job')::uuid,'Task 17A cancel active claim','canceljob01') as cancel_job_result \gset
select task17a_test.assert((:'cancel_job_result')::jsonb->>'task17a_queue_claims_cleared'='1', 'cancel job returns one Task 17A claim cleanup');
select task17a_test.assert((select job_state='archived' and cancelled_at is not null and cancelled_by=(:'cancel_job_fixture'::jsonb->>'creator')::uuid from public.creator_publishing_platform_jobs where id=(:'cancel_job_fixture'::jsonb->>'job')::uuid), 'cancel job archives platform job');
select task17a_test.assert((select status='archived' and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and claim_attempt_count=:'cancel_job_attempts'::int and operator_progress_state='preparing' and operator_progress_revision=1 and operator_progress_updated_by=(:'cancel_job_fixture'::jsonb->>'creator')::uuid and operator_progress_updated_at is not null and assigned_operator_id=:'cancel_job_assigned'::uuid and posted_by is null and posted_at is null and posted_confirmation is false and final_post_url is null and final_post_url_skip_reason is null and proof_screenshot_storage_key is null and skip_or_fail_reason is null from public.creator_publishing_queue_tasks where id=(:'cancel_job_fixture'::jsonb->>'task')::uuid), 'cancel job clears claim and preserves attempts progress assignment evidence');
select task17a_test.assert((select status='cancelled' and lock_token is null and locked_at is null from public.creator_publishing_scheduler_events where platform_job_id=(:'cancel_job_fixture'::jsonb->>'job')::uuid and id='92720000-0000-4000-8000-000000000201'::uuid), 'cancel job cancels scheduler event and clears lock');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_claim_cancelled_by_schedule_cancellation' and entity_id=(:'cancel_job_fixture'::jsonb->>'task')::uuid and idempotency_key='canceljob01')=1, 'cancel job writes one claim cleanup audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claim_cancelled_by_schedule_cancellation' and entity_id=(:'cancel_job_fixture'::jsonb->>'task')::uuid and (before_state ? 'claim_token' or after_state ? 'claim_token')), 'cancel job cleanup audit omits claim token');
select public.creator_publishing_cancel_job_schedule((:'cancel_job_fixture'::jsonb->>'creator')::uuid,(:'cancel_job_fixture'::jsonb->>'job')::uuid,'Task 17A cancel active claim','canceljob01') as cancel_job_replay \gset
select task17a_test.assert((:'cancel_job_replay')::jsonb->>'idempotent'='true' and (select count(*) from public.creator_publishing_audit_events where action='operator_task_claim_cancelled_by_schedule_cancellation' and entity_id=(:'cancel_job_fixture'::jsonb->>'task')::uuid)=1, 'cancel job replay deterministic no duplicate cleanup');
select task17a_test.expect_error('cancel job same key changed reason conflicts','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_cancel_job_schedule(%L,%L,%L,%L)',(:'cancel_job_fixture'::jsonb->>'creator'),(:'cancel_job_fixture'::jsonb->>'job'),'different reason','canceljob01'));

\echo TASK17A_SCENARIO_START: cancel_job_terminal_no_false_cleanup
select task17a_test.reset_fixture(927202,'ready_for_handoff','archived',false) as cancel_terminal_fixture \gset
select public.creator_publishing_cancel_job_schedule((:'cancel_terminal_fixture'::jsonb->>'creator')::uuid,(:'cancel_terminal_fixture'::jsonb->>'job')::uuid,'Already terminal','cancelterm1') as cancel_terminal_result \gset
select task17a_test.assert((:'cancel_terminal_result')::jsonb->>'task17a_queue_claims_cleared'='0', 'terminal cancel reports zero cleanup');
select task17a_test.assert((select status='ready_for_handoff' and claimed_by is null and claim_token is null from public.creator_publishing_queue_tasks where id=(:'cancel_terminal_fixture'::jsonb->>'task')::uuid), 'terminal cancel leaves unclaimed queue unchanged');

\echo TASK17A_SCENARIO_START: cancel_job_changed_job_conflict
select task17a_test.reset_fixture(927203,'scheduled_internally','scheduled_internally',true) as cancel_changed_a \gset
select task17a_test.set_valid_schedule_phase((:'cancel_changed_a'::jsonb->>'job')::uuid,'after_operator_due');
select task17a_test.reset_fixture(927204,'scheduled_internally','scheduled_internally',true) as cancel_changed_b \gset
select task17a_test.set_valid_schedule_phase((:'cancel_changed_b'::jsonb->>'job')::uuid,'after_operator_due');
update public.creator_publishing_platform_jobs set creator_id=(:'cancel_changed_a'::jsonb->>'creator')::uuid where id=(:'cancel_changed_b'::jsonb->>'job')::uuid;
select public.creator_publishing_cancel_job_schedule((:'cancel_changed_a'::jsonb->>'creator')::uuid,(:'cancel_changed_a'::jsonb->>'job')::uuid,'first job','canceljobchg') as cancel_changed_first \gset
select task17a_test.assert((:'cancel_changed_first')::jsonb->>'task17a_queue_claims_cleared'='0', 'changed-job baseline has no cleanup');
select task17a_test.expect_error('cancel job same key changed job conflicts','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_cancel_job_schedule(%L,%L,%L,%L)',(:'cancel_changed_a'::jsonb->>'creator'),(:'cancel_changed_b'::jsonb->>'job'),'first job','canceljobchg'));

\echo TASK17A_SCENARIO_START: cancel_job_expired_claim_cleanup
select task17a_test.reset_fixture(927205,'scheduled_internally','scheduled_internally',true) as cancel_expired_fixture \gset
select task17a_test.set_valid_schedule_phase((:'cancel_expired_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select public.creator_publishing_claim_onlyfans_operator_task((:'cancel_expired_fixture'::jsonb->>'creator')::uuid,(:'cancel_expired_fixture'::jsonb->>'task')::uuid,(:'cancel_expired_fixture'::jsonb->>'job')::uuid,:'cancel_expired_fixture'::jsonb->>'consent_version',:'cancel_expired_fixture'::jsonb->>'consent_hash','cancelxclaim') as cancel_expired_claim \gset
select task17a_test.expire_claim((:'cancel_expired_fixture'::jsonb->>'task')::uuid);
select claim_attempt_count as cancel_expired_attempts from public.creator_publishing_queue_tasks where id=(:'cancel_expired_fixture'::jsonb->>'task')::uuid \gset
select public.creator_publishing_cancel_job_schedule((:'cancel_expired_fixture'::jsonb->>'creator')::uuid,(:'cancel_expired_fixture'::jsonb->>'job')::uuid,'Cancel expired claim','cancelxjob1') as cancel_expired_result \gset
select task17a_test.assert((:'cancel_expired_result')::jsonb->>'task17a_queue_claims_cleared'='1', 'expired claim cancellation clears one claim');
select task17a_test.assert((select status='archived' and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and claim_attempt_count=:'cancel_expired_attempts'::int from public.creator_publishing_queue_tasks where id=(:'cancel_expired_fixture'::jsonb->>'task')::uuid), 'expired claim cancellation archives unclaimed preserving attempts');

\echo TASK17A_SCENARIO_START: cancel_job_unclaimed_cleanup
select task17a_test.reset_fixture(927206,'scheduled_internally','scheduled_internally',true) as cancel_unclaimed_fixture \gset
select task17a_test.set_valid_schedule_phase((:'cancel_unclaimed_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select public.creator_publishing_cancel_job_schedule((:'cancel_unclaimed_fixture'::jsonb->>'creator')::uuid,(:'cancel_unclaimed_fixture'::jsonb->>'job')::uuid,'Cancel unclaimed','cancelunj1') as cancel_unclaimed_result \gset
select task17a_test.assert((:'cancel_unclaimed_result')::jsonb->>'task17a_queue_claims_cleared'='0', 'unclaimed cancellation reports zero cleanup');
select task17a_test.assert((select status='scheduled_internally' and claimed_by is null and claim_token is null from public.creator_publishing_queue_tasks where id=(:'cancel_unclaimed_fixture'::jsonb->>'task')::uuid), 'unclaimed cancellation leaves queue ownership untouched');
select task17a_test.assert((select job_state='archived' from public.creator_publishing_platform_jobs where id=(:'cancel_unclaimed_fixture'::jsonb->>'job')::uuid), 'unclaimed cancellation archives job');

\echo TASK17A_SCENARIO_START: cancel_job_non_onlyfans_assisted_exclusion
select task17a_test.reset_fixture(927207,'scheduled_internally','scheduled_internally',true) as cancel_exclusion_fixture \gset
select task17a_test.set_valid_schedule_phase((:'cancel_exclusion_fixture'::jsonb->>'job')::uuid,'after_operator_due');
select public.creator_publishing_claim_onlyfans_operator_task((:'cancel_exclusion_fixture'::jsonb->>'creator')::uuid,(:'cancel_exclusion_fixture'::jsonb->>'task')::uuid,(:'cancel_exclusion_fixture'::jsonb->>'job')::uuid,:'cancel_exclusion_fixture'::jsonb->>'consent_version',:'cancel_exclusion_fixture'::jsonb->>'consent_hash','cancelexclclaim') as cancel_exclusion_claim \gset
update public.creator_publishing_platform_jobs set publishing_mode='direct' where id=(:'cancel_exclusion_fixture'::jsonb->>'job')::uuid;
select public.creator_publishing_cancel_job_schedule((:'cancel_exclusion_fixture'::jsonb->>'creator')::uuid,(:'cancel_exclusion_fixture'::jsonb->>'job')::uuid,'Cancel direct mode','cancelexcl') as cancel_exclusion_result \gset
select task17a_test.assert((:'cancel_exclusion_result')::jsonb->>'task17a_queue_claims_cleared'='0', 'direct-mode cancellation reports zero Task 17A cleanup');
select task17a_test.assert((select status='claimed' and claimed_by is not null and claim_token is not null from public.creator_publishing_queue_tasks where id=(:'cancel_exclusion_fixture'::jsonb->>'task')::uuid), 'direct-mode queue claim is excluded from Task 17A cleanup helper');

\echo TASK17A_SCENARIO_START: cancel_plan_multi_job_cleanup
select task17a_test.reset_fixture(927301,'scheduled_internally','scheduled_internally',true) as cancel_plan_claimed \gset
select task17a_test.set_valid_schedule_phase((:'cancel_plan_claimed'::jsonb->>'job')::uuid,'after_operator_due');
select public.creator_publishing_claim_onlyfans_operator_task((:'cancel_plan_claimed'::jsonb->>'creator')::uuid,(:'cancel_plan_claimed'::jsonb->>'task')::uuid,(:'cancel_plan_claimed'::jsonb->>'job')::uuid,:'cancel_plan_claimed'::jsonb->>'consent_version',:'cancel_plan_claimed'::jsonb->>'consent_hash','cancelplclaim') as cancel_plan_claim \gset
select claim_attempt_count as cancel_plan_attempts, operator_progress_state as cancel_plan_progress, operator_progress_revision as cancel_plan_revision, assigned_operator_id as cancel_plan_assigned from public.creator_publishing_queue_tasks where id=(:'cancel_plan_claimed'::jsonb->>'task')::uuid \gset
select task17a_test.reset_fixture(927302,'scheduled_internally','scheduled_internally',true) as cancel_plan_unclaimed \gset
select task17a_test.set_valid_schedule_phase((:'cancel_plan_unclaimed'::jsonb->>'job')::uuid,'after_operator_due');
select task17a_test.reset_fixture(927303,'ready_for_handoff','archived',false) as cancel_plan_terminal \gset
update public.creator_publishing_platform_jobs set publishing_plan_id=(:'cancel_plan_claimed'::jsonb->>'plan')::uuid where id in ((:'cancel_plan_unclaimed'::jsonb->>'job')::uuid,(:'cancel_plan_terminal'::jsonb->>'job')::uuid);
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at) values('92730000-0000-4000-8000-000000000301',(:'cancel_plan_claimed'::jsonb->>'creator')::uuid,(:'cancel_plan_claimed'::jsonb->>'plan')::uuid,(:'cancel_plan_claimed'::jsonb->>'job')::uuid,'publish_due','processing',clock_timestamp()-interval '1 minute',1,'92730000-0000-4000-8000-000000000401',clock_timestamp());
select public.creator_publishing_cancel_plan_schedule((:'cancel_plan_claimed'::jsonb->>'creator')::uuid,(:'cancel_plan_claimed'::jsonb->>'plan')::uuid,'Cancel multi-job plan','cancelplan1') as cancel_plan_result \gset
select task17a_test.assert((:'cancel_plan_result')::jsonb->>'task17a_queue_claims_cleared'='1', 'plan cancellation reports one claimed queue cleanup');
select task17a_test.assert((select status='cancelled' and cancelled_at is not null and cancelled_by=(:'cancel_plan_claimed'::jsonb->>'creator')::uuid from public.creator_publishing_plans where id=(:'cancel_plan_claimed'::jsonb->>'plan')::uuid), 'plan cancellation stores cancellation evidence');
select task17a_test.assert((select job_state='archived' from public.creator_publishing_platform_jobs where id=(:'cancel_plan_claimed'::jsonb->>'job')::uuid), 'plan cancellation archives claimed job');
select task17a_test.assert((select job_state='archived' from public.creator_publishing_platform_jobs where id=(:'cancel_plan_unclaimed'::jsonb->>'job')::uuid), 'plan cancellation archives unclaimed scheduled job');
select task17a_test.assert((select job_state='archived' from public.creator_publishing_platform_jobs where id=(:'cancel_plan_terminal'::jsonb->>'job')::uuid), 'plan cancellation leaves terminal job terminal');
select task17a_test.assert((select status='archived' and claimed_by is null and claimed_at is null and claim_token is null and claim_expires_at is null and claim_attempt_count=:'cancel_plan_attempts'::int and operator_progress_state=:'cancel_plan_progress' and operator_progress_revision=:'cancel_plan_revision'::int and assigned_operator_id=:'cancel_plan_assigned'::uuid and posted_by is null and posted_at is null and posted_confirmation is false and final_post_url is null and final_post_url_skip_reason is null and proof_screenshot_storage_key is null and skip_or_fail_reason is null from public.creator_publishing_queue_tasks where id=(:'cancel_plan_claimed'::jsonb->>'task')::uuid), 'plan cancellation clears claimed queue and preserves attempts progress assignment evidence');
select task17a_test.assert((select status='cancelled' and lock_token is null and locked_at is null from public.creator_publishing_scheduler_events where id='92730000-0000-4000-8000-000000000301'::uuid), 'plan cancellation cancels scheduler event and clears lock');
select task17a_test.assert((select count(*) from public.creator_publishing_audit_events where action='operator_task_claim_cancelled_by_schedule_cancellation' and entity_id=(:'cancel_plan_claimed'::jsonb->>'task')::uuid and idempotency_key='cancelplan1')=1, 'plan cancellation writes exactly one cleanup audit');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_audit_events where action='operator_task_claim_cancelled_by_schedule_cancellation' and entity_id=(:'cancel_plan_claimed'::jsonb->>'task')::uuid and (before_state ? 'claim_token' or after_state ? 'claim_token')), 'plan cancellation cleanup audit omits claim token');

\echo TASK17A_SCENARIO_START: cancel_plan_replay
select public.creator_publishing_cancel_plan_schedule((:'cancel_plan_claimed'::jsonb->>'creator')::uuid,(:'cancel_plan_claimed'::jsonb->>'plan')::uuid,'Cancel multi-job plan','cancelplan1') as cancel_plan_replay \gset
select task17a_test.assert((:'cancel_plan_replay')::jsonb->>'idempotent'='true' and (select count(*) from public.creator_publishing_audit_events where action='operator_task_claim_cancelled_by_schedule_cancellation' and entity_id=(:'cancel_plan_claimed'::jsonb->>'task')::uuid)=1, 'plan cancellation replay deterministic without duplicate cleanup audit');

\echo TASK17A_SCENARIO_START: cancel_plan_changed_reason_conflict
select task17a_test.expect_error('cancel plan same key changed reason conflicts','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_cancel_plan_schedule(%L,%L,%L,%L)',(:'cancel_plan_claimed'::jsonb->>'creator'),(:'cancel_plan_claimed'::jsonb->>'plan'),'changed reason','cancelplan1'));

\echo TASK17A_SCENARIO_START: cancel_plan_changed_plan_conflict
select task17a_test.reset_fixture(927304,'scheduled_internally','scheduled_internally',true) as cancel_plan_other \gset
select task17a_test.set_valid_schedule_phase((:'cancel_plan_other'::jsonb->>'job')::uuid,'after_operator_due');
select task17a_test.expect_error('cancel plan same key changed plan conflicts','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_cancel_plan_schedule(%L,%L,%L,%L)',(:'cancel_plan_claimed'::jsonb->>'creator'),(:'cancel_plan_other'::jsonb->>'plan'),'Cancel multi-job plan','cancelplan1'));
