\set ON_ERROR_STOP on
\i backend/creator-publishing-queue/tests/task17aTestSupport.sql
\echo TASK17A_SCENARIO_START: authorization_creator_claim
select task17a_test.reset_fixture(921001) as fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','selfclaim1') as self_claim \gset
select task17a_test.assert((:'self_claim')::jsonb->>'ok'='true', 'creator self-claim succeeds');
select task17a_test.reset_fixture(921002) as fixture \gset
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'operator_a')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','opclaim01') as op_claim \gset
select task17a_test.assert((:'op_claim')::jsonb->>'ok'='true', 'authorized operator claim succeeds');
select task17a_test.reset_fixture(921003) as fixture \gset
select task17a_test.expect_error('unauthorized operator fails','OPERATOR_NOT_AUTHORIZED',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'unauthorized'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','unauth01'));
select task17a_test.assert((select claim_attempt_count from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid)=0, 'unauthorized claim leaves attempts unchanged');
select task17a_test.reset_fixture(921004) as fixture \gset
select task17a_test.expect_error('revoked operator fails','OPERATOR_NOT_AUTHORIZED',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'revoked'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','revoked1'));
select task17a_test.reset_fixture(921005) as fixture \gset
select task17a_test.expect_error('other creator authorization fails','OPERATOR_NOT_AUTHORIZED',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'unauthorized'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','otherauth'));
select task17a_test.reset_fixture(921006) as fixture \gset
select task17a_test.assert(exists(select 1 from public.creator_publishing_trusted_reviewers where reviewer_id=(:'fixture'::jsonb->>'global_only')::uuid and role='operator' and active is true), 'global-role-only fixture has active operator role');
select task17a_test.assert(not exists(select 1 from public.creator_publishing_operator_authorizations where creator_id=(:'fixture'::jsonb->>'creator')::uuid and operator_id=(:'fixture'::jsonb->>'global_only')::uuid and status='active'), 'global-role-only fixture has no creator authorization');
select task17a_test.expect_error('global role alone fails','OPERATOR_NOT_AUTHORIZED',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'global_only'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','global01'));
select task17a_test.reset_fixture(921007) as fixture \gset
select task17a_test.expect_error('Fanvue platform job constraint prevents matching Fanvue work','creator_publishing_jobs_no_fanvue',format('update public.creator_publishing_platform_jobs set target_platform=%L where id=%L','fanvue',(:'fixture'::jsonb->>'job')));
update public.creator_publishing_queue_tasks set target_platform='fanvue' where id=(:'fixture'::jsonb->>'task')::uuid;
select task17a_test.expect_error('Task17A RPC rejects non-OnlyFans queue work','OPERATOR_TASK_JOB_MISMATCH',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'creator'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','fanvue01'));
select task17a_test.reset_fixture(921008,'ready_for_handoff','scheduled_internally',true) as fixture \gset
select task17a_test.expect_error('scheduled before operator due blocked','OPERATOR_NOT_DUE',format('select public.creator_publishing_claim_onlyfans_operator_task(%L,%L,%L,%L,%L,%L)',(:'fixture'::jsonb->>'creator'),(:'fixture'::jsonb->>'task'),(:'fixture'::jsonb->>'job'),:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','early001'));
select task17a_test.assert(status='ready_for_handoff' and claim_attempt_count=0 and operator_progress_state='not_started' and not exists(select 1 from public.creator_publishing_operator_action_idempotency where idempotency_key='early001'), 'early claim leaves task audit progress idempotency unchanged') from public.creator_publishing_queue_tasks where id=(:'fixture'::jsonb->>'task')::uuid;
select task17a_test.reset_fixture(921009,'awaiting_operator','scheduled_internally',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '1 minute' where id=(:'fixture'::jsonb->>'job')::uuid;
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'creator')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','dueclaim1');
select task17a_test.reset_fixture(921010,'due_now','due_now',true) as fixture \gset
update public.creator_publishing_platform_jobs set operator_due_at=clock_timestamp()-interval '2 hours', intended_publish_at=clock_timestamp()-interval '1 minute' where id=(:'fixture'::jsonb->>'job')::uuid;
select public.creator_publishing_claim_onlyfans_operator_task((:'fixture'::jsonb->>'operator_a')::uuid,(:'fixture'::jsonb->>'task')::uuid,(:'fixture'::jsonb->>'job')::uuid,:'fixture'::jsonb->>'consent_version',:'fixture'::jsonb->>'consent_hash','duenow01');
