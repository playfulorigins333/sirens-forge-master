\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql
\echo TASK17A_SCENARIO_START: idempotency_claim_replay
select task17a_test.reset_fixture(922001) as fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','idemclaim1') as claim_first \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','idemclaim1') as claim_replay \gset
select task17a_test.assert((:'claim_replay')::jsonb->>'idempotent'='true' and (select claim_attempt_count from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)=1, 'claim exact replay returns stored result and one mutation');
select task17a_test.expect_error('claim changed task conflicts','IDEMPOTENCY_CONFLICT',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'creator'),(:'fixture'::jsonb->>'operator_a'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','idemclaim1'));
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
