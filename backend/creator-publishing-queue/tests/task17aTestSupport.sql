\set ON_ERROR_STOP on
create schema if not exists task17a_test;
create or replace function task17a_test.assert(ok boolean, label text) returns void language plpgsql as $$ begin if not ok then raise exception 'TASK17A_ASSERT:%', label; end if; end $$;
create or replace function task17a_test.expect_error(label text, expected text, statement text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'TASK17A_ASSERT:% expected %', label, expected;
exception when others then
  if sqlerrm not like '%' || expected || '%' then
    raise exception 'TASK17A_ASSERT:% expected %, got %', label, expected, sqlerrm;
  end if;
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
  insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,compliance_status,review_status,creator_approval_status,created_at,updated_at) values(v_package,v_creator,v_account,'onlyfans','Task17A package '||seed,'caption','#AI','ai_generated','{}','pending','unassigned','pending',v_now,v_now);
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
  return jsonb_build_object('creator',v_creator,'operator_a',v_operator_a,'operator_b',v_operator_b,'unauthorized',v_unauthorized,'revoked',v_revoked,'other_creator',v_other_creator,'global_only',v_global_only,'account',v_account,'package',v_package,'plan',v_plan,'job',v_job,'task',v_task,'consent_version','creator-ai-twin-consent-v1','consent_hash','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12');
end $$;
