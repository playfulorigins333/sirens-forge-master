\set ON_ERROR_STOP on
create schema if not exists task20_test;

create or replace function task20_test.assert(p boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p,false) then
    raise exception 'TASK20_ASSERTION_FAILED: %', label;
  end if;
end $$;

create or replace function task20_test.expect_error(label text, expected text, sql text)
returns void
language plpgsql
as $$
begin
  execute sql;
  raise exception 'TASK20_EXPECTED_ERROR_NOT_RAISED: %', label;
exception when others then
  if position(expected in sqlerrm)=0 then
    raise exception 'TASK20_WRONG_ERROR % expected % got %', label, expected, sqlerrm;
  end if;
end $$;

create or replace function task20_test.uuid_for(p_family text, p_seed integer)
returns uuid
language sql
immutable
as $$
  select (p_family || '-0000-4000-8000-' || lpad(p_seed::text,12,'0'))::uuid
$$;

create or replace function task20_test.create_fixture(
  p_seed integer,
  p_actor_id uuid default '00000000-0000-4000-8000-000000000202'::uuid,
  p_authorize_actor boolean default true
) returns jsonb
language plpgsql
as $$
declare
  v_creator uuid := '00000000-0000-4000-8000-000000000101'::uuid;
  v_reviewer uuid := '00000000-0000-4000-8000-000000000303'::uuid;
  v_account uuid := '00000000-0000-4000-8000-000000000401'::uuid;
  v_pkg uuid := task20_test.uuid_for('20000000',p_seed);
  v_plan uuid := task20_test.uuid_for('30000000',p_seed);
  v_job uuid := task20_test.uuid_for('40000000',p_seed);
  v_task uuid := task20_test.uuid_for('50000000',p_seed);
  v_token uuid := task20_test.uuid_for('60000000',p_seed);
  v_evidence uuid := task20_test.uuid_for('70000000',p_seed);
  v_scheduler uuid := task20_test.uuid_for('80000000',p_seed);
  v_digest text := repeat('1',64);
  v_claimed_at timestamptz := clock_timestamp();
begin
  insert into auth.users(id,email) values
    (v_creator,'task20-creator@test'),
    (p_actor_id,'task20-actor-'||p_seed||'@test'),
    (v_reviewer,'task20-reviewer@test')
  on conflict (id) do nothing;

  insert into public.creator_publishing_creator_verifications(
    creator_id,status,evidence_reference,reason,reviewed_by,reviewed_at
  ) values (
    v_creator,'verified','task20-evidence','ok',v_reviewer,clock_timestamp()
  ) on conflict (creator_id) do update set
    status='verified',evidence_reference='task20-evidence',reason='ok',
    reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at;

  insert into public.creator_publishing_ai_twin_consents(
    creator_id,status,attestation_version,attestation_text_sha256,granted_at
  ) values (
    v_creator,'granted','v1',repeat('a',64),clock_timestamp()
  ) on conflict (creator_id) do update set
    status='granted',revoked_at=null,attestation_version='v1',
    attestation_text_sha256=repeat('a',64),granted_at=excluded.granted_at;

  if p_authorize_actor then
    insert into public.creator_publishing_operator_authorizations(
      creator_id,operator_id,platform,status
    ) values (v_creator,p_actor_id,'onlyfans','active')
    on conflict (creator_id,operator_id,platform) where status='active'
    do update set status='active',revoked_at=null,updated_at=clock_timestamp();
  end if;

  insert into public.creator_platform_accounts(
    id,creator_id,platform,platform_username,verification_status,
    verification_attested_at,verification_reviewed_by,verification_reviewed_at,
    verification_evidence_reference,verification_reason
  ) values (
    v_account,v_creator,'onlyfans','trusteduser','verified',clock_timestamp(),
    v_reviewer,clock_timestamp(),'task20-evidence','ok'
  ) on conflict (id) do update set
    creator_id=excluded.creator_id,platform='onlyfans',platform_username='trusteduser',
    verification_status='verified',verification_attested_at=excluded.verification_attested_at,
    verification_reviewed_by=excluded.verification_reviewed_by,
    verification_reviewed_at=excluded.verification_reviewed_at,
    verification_evidence_reference='task20-evidence',verification_reason='ok';

  insert into public.creator_publishing_content_packages(
    id,creator_id,platform_account_id,target_platform,title,caption_body,
    compliance_status,compliance_policy_version,creator_approval_status,
    creator_approved_at,creator_approved_by
  ) values (
    v_pkg,v_creator,v_account,'onlyfans','Task 20 fixture '||p_seed,'caption',
    'passed','task20-test-policy-v1','approved',clock_timestamp(),v_creator
  );

  insert into public.creator_publishing_plans(
    id,creator_id,status,idempotency_key,request_fingerprint,registry_version
  ) values (
    v_plan,v_creator,'in_progress','task20-plan-'||p_seed,
    encode(extensions.digest(('task20-plan-'||p_seed)::text,'sha256'),'hex'),'task20'
  );

  insert into public.creator_publishing_platform_jobs(
    id,publishing_plan_id,creator_id,content_package_id,platform_account_id,
    target_platform,publishing_mode,job_state,source_package_updated_at,
    source_package_fingerprint,capability_registry_version,original_request_fingerprint
  ) values (
    v_job,v_plan,v_creator,v_pkg,v_account,'onlyfans','assisted','due_now',
    (select updated_at from public.creator_publishing_content_packages where id=v_pkg),
    repeat('c',64),'task20',
    encode(extensions.digest(('task20-job-'||p_seed)::text,'sha256'),'hex')
  );

  update public.creator_publishing_platform_jobs
  set source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(content_package_id)
  where id=v_job;

  insert into public.creator_publishing_compliance_reviews(
    content_package_id,reviewer_id,outcome,review_source,compliance_policy_version,
    rule_hits,review_metadata,created_at
  ) values (
    v_pkg,v_reviewer,'pass','automated','task20-test-policy-v1',
    '[]'::jsonb,'{}'::jsonb,clock_timestamp()
  );

  insert into public.creator_publishing_queue_tasks(
    id,content_package_id,creator_id,target_platform,platform_account_id,status,
    due_at,claimed_by,claimed_at,claim_token,claim_expires_at,operator_progress_state
  ) values (
    v_task,v_pkg,v_creator,'onlyfans',v_account,'claimed',clock_timestamp(),
    p_actor_id,v_claimed_at,v_token,v_claimed_at+interval '20 minutes','handoff_ready'
  );

  insert into public.creator_publishing_scheduler_events(
    id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,
    schedule_revision,lock_token,locked_at
  ) values (
    v_scheduler,v_creator,v_plan,v_job,'publish_due','processing',clock_timestamp(),
    1,gen_random_uuid(),clock_timestamp()
  );

  insert into public.creator_publishing_operator_completion_evidence_intents(
    id,actor_id,creator_id,queue_task_id,platform_job_id,content_package_id,
    platform_account_id,request_key,request_fingerprint,claim_fingerprint,
    operation,server_bucket,server_path,expected_mime_type,expected_size_bytes,
    normalized_mime_type,actual_size_bytes,verified_sha256,status,intent_expires_at,
    verified_at,created_at,updated_at
  ) values (
    v_evidence,p_actor_id,v_creator,v_task,v_job,v_pkg,v_account,
    'task20ev'||lpad(p_seed::text,8,'0'),
    encode(extensions.digest(('task20-evidence-'||p_seed)::text,'sha256'),'hex'),
    public.task18_claim_fingerprint(v_task,v_token),'create',
    'operator-completion-evidence',
    'operator-completion-evidence/task20/'||p_seed||'/proof.jpg',
    'image/jpeg',8,'image/jpeg',8,v_digest,'verified',
    clock_timestamp()+interval '15 minutes',clock_timestamp(),clock_timestamp(),clock_timestamp()
  );

  return jsonb_build_object(
    'creator',v_creator,'actor',p_actor_id,'reviewer',v_reviewer,'account',v_account,
    'package',v_pkg,'plan',v_plan,'job',v_job,'task',v_task,'token',v_token,
    'evidence',v_evidence,'scheduler',v_scheduler,'digest',v_digest
  );
end $$;
