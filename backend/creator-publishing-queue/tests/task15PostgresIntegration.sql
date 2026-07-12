\echo 'Task 15 PostgreSQL integration: catalog, privileges, scheduling, claiming, processing, cancellation'

create or replace function public.task15_assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition,false) then raise exception 'TASK15_ASSERTION_FAILED: %', p_message; end if;
end $$;

select public.task15_assert(current_setting('server_version_num')::int >= 150000, 'PostgreSQL 15+ required');

-- Catalog, RLS, and privilege checks after installing migrations 00100 through 01300.
select public.task15_assert(to_regclass('public.creator_publishing_scheduler_events') is not null, 'scheduler events table exists');
select public.task15_assert(to_regclass('public.creator_publishing_schedule_idempotency') is not null, 'schedule idempotency table exists');
select public.task15_assert(exists (select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_platform_jobs' and column_name='schedule_revision'), 'schedule_revision column exists');
select public.task15_assert(exists (select 1 from pg_constraint where conname='creator_publishing_scheduler_job_plan_creator_fk'), 'scheduler composite job FK exists');
select public.task15_assert(exists (select 1 from pg_indexes where schemaname='public' and indexname='creator_publishing_scheduler_active_uidx'), 'scheduler active unique index exists');
select public.task15_assert((select relrowsecurity from pg_class where oid='public.creator_publishing_scheduler_events'::regclass), 'scheduler events RLS enabled');
select public.task15_assert(not has_table_privilege('anon','public.creator_publishing_scheduler_events','SELECT'), 'anon cannot select scheduler events');
select public.task15_assert(not has_table_privilege('authenticated','public.creator_publishing_schedule_idempotency','SELECT'), 'authenticated cannot select scheduler idempotency');
select public.task15_assert(has_table_privilege('service_role','public.creator_publishing_scheduler_events','INSERT,UPDATE,SELECT,DELETE'), 'service_role owns scheduler table access');
select public.task15_assert(not has_function_privilege('anon','public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text)','EXECUTE'), 'anon cannot execute schedule RPC');
select public.task15_assert(not has_function_privilege('authenticated','public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)','EXECUTE'), 'authenticated cannot execute process RPC');
select public.task15_assert(has_function_privilege('service_role','public.creator_publishing_claim_due_scheduler_events(integer,integer)','EXECUTE'), 'service_role can execute claim RPC');
select public.task15_assert((select prosecdef from pg_proc where oid='public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)'::regprocedure), 'process RPC is security definer');
select public.task15_assert((select replace(array_to_string(proconfig,','),' ','') from pg_proc where oid='public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)'::regprocedure) like '%search_path=public,pg_temp%', 'process RPC search_path pinned');

-- Forward-only Task 15 repair for deployed credential-key helper ambiguity.
select public.task15_assert(not public.creator_publishing_queue_jsonb_has_forbidden_credential_key('{"safe":{"nested":[{"caption":"ok"}]}}'::jsonb), 'credential helper safe nested json false');
select public.task15_assert(public.creator_publishing_queue_jsonb_has_forbidden_credential_key('{"access_token":"redacted"}'::jsonb), 'credential helper top-level forbidden key true');
select public.task15_assert(public.creator_publishing_queue_jsonb_has_forbidden_credential_key('{"safe":{"cookie":"redacted"}}'::jsonb), 'credential helper nested object forbidden key true');
select public.task15_assert(public.creator_publishing_queue_jsonb_has_forbidden_credential_key(jsonb_build_array(jsonb_build_object('platform_secret','redacted'))), 'credential helper nested array forbidden key true');

-- Seed one valid assisted OnlyFans package/job with structured generated-media facts.
do $$
declare
  v_creator uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_reviewer uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_profile uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_account uuid := '11111111-1111-4111-8111-111111111111';
  v_package uuid := '22222222-2222-4222-8222-222222222222';
  v_generation uuid := '33333333-3333-4333-8333-333333333333';
  v_plan uuid := '44444444-4444-4444-8444-444444444444';
  v_job uuid := '55555555-5555-4555-8555-555555555555';
  v_result jsonb; v_retry jsonb; v_reschedule jsonb; v_conflict text; v_cancel jsonb; v_claim record; v_process jsonb; v_event_count int; v_audit_count int; v_event_ids uuid[]; v_operator uuid; v_publish uuid;
  v_hash text := '0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12';
begin
  insert into auth.users(id,email) values(v_creator,'creator@example.test'),(v_reviewer,'reviewer@example.test') on conflict do nothing;
  insert into public.profiles(id,user_id) values(v_profile,v_creator) on conflict do nothing;
  insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason)
    values(v_account,v_creator,'onlyfans','creator_of','verified',v_reviewer,now(),'evidence','trusted') on conflict do nothing;
  insert into public.creator_publishing_creator_verifications(creator_id,status,evidence_reference,reason,reviewed_by,reviewed_at)
    values(v_creator,'verified','evidence','trusted',v_reviewer,now()) on conflict (creator_id) do update set status='verified', evidence_reference='evidence', reason='trusted', reviewed_by=v_reviewer, reviewed_at=now();
  insert into public.creator_publishing_ai_twin_consents(creator_id,status,attestation_version,attestation_text_sha256,granted_at)
    values(v_creator,'granted','creator-ai-twin-consent-v1',v_hash,now()) on conflict (creator_id) do update set status='granted', attestation_version='creator-ai-twin-consent-v1', attestation_text_sha256=v_hash, revoked_at=null;
  insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,ai_flag,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_by,creator_approved_at)
    values(v_package,v_creator,v_account,'onlyfans','Title','Caption','ai_generated','passed','policy-v1','approved',v_creator,now()) on conflict do nothing;
  insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,compliance_policy_version,created_at)
    values(v_package,null,'pass','automated','policy-v1',now());
  insert into public.generations(id,user_id,status,r2_bucket,r2_key,metadata) values(v_generation,v_creator,'completed','bucket','key','{"safety":"safe"}'::jsonb) on conflict do nothing;
  insert into public.creator_publishing_media_assets(content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata)
    values(v_package,'media/key.png','image/png',repeat('a',64),'ai_pipeline',jsonb_build_object('generation_id',v_generation::text));
  insert into public.creator_publishing_queue_tasks(content_package_id,status,due_at) values(v_package,'ready_for_handoff',null);
  insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version)
    values(v_plan,v_creator,'draft','plan-key-1',repeat('b',64),'task14.20260711.001');
  insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint)
    select v_job,v_plan,v_creator,v_package,v_account,'onlyfans','assisted','draft',p.updated_at,public.creator_publishing_autopost_source_fingerprint(v_package),'task14.20260711.001',repeat('c',64) from public.creator_publishing_content_packages p where p.id=v_package;

  v_result := public.creator_publishing_schedule_plan(v_creator,v_plan,now()+interval '3 hours','UTC','schedule-key-1','creator-ai-twin-consent-v1',v_hash,array[v_job],'{}'::jsonb,'schedule');
  perform public.task15_assert((v_result->>'ok')::boolean, 'initial schedule ok');
  perform public.task15_assert((v_result->'results'->0->>'scheduleRevision')::int=1, 'initial schedule revision 1');
  perform public.task15_assert((select job_state from public.creator_publishing_platform_jobs where id=v_job)='scheduled_internally', 'assisted job scheduled internally');
  perform public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id=v_job and event_status='pending')=2, 'operator and publish events created');
  perform public.task15_assert((select status from public.creator_publishing_queue_tasks where content_package_id=v_package)='ready_for_handoff', 'compatible queue row unchanged');
  select array_agg(id order by event_type) into v_event_ids from public.creator_publishing_scheduler_events where platform_job_id=v_job;
  v_retry := public.creator_publishing_schedule_plan(v_creator,v_plan,now()+interval '3 hours','UTC','schedule-key-1','creator-ai-twin-consent-v1',v_hash,array[v_job],'{}'::jsonb,'schedule');
  perform public.task15_assert((v_retry->>'idempotent')::boolean, 'exact schedule retry idempotent');
  perform public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id=v_job)=2, 'retry created no new events');
  perform public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_job_scheduled' and entity_id=v_job)=1, 'retry created no new schedule audit');
  begin
    perform public.creator_publishing_schedule_plan(v_creator,v_plan,now()+interval '4 hours','UTC','schedule-key-1','creator-ai-twin-consent-v1',v_hash,array[v_job],'{}'::jsonb,'schedule');
    raise exception 'expected idempotency conflict';
  exception when others then v_conflict := sqlerrm; end;
  perform public.task15_assert(v_conflict like '%IDEMPOTENCY_CONFLICT%', 'changed request conflicts');

  v_reschedule := public.creator_publishing_schedule_plan(v_creator,v_plan,now()+interval '5 hours','UTC','reschedule-key-1','creator-ai-twin-consent-v1',v_hash,array[v_job],jsonb_build_object(v_job::text,1),'reschedule');
  perform public.task15_assert((v_reschedule->'results'->0->>'scheduleRevision')::int=2, 'reschedule increments once');
  perform public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id=v_job and schedule_revision=1 and event_status='superseded')=2, 'prior events superseded');
  perform public.task15_assert((select after_state ? 'superseded_event_ids' from public.creator_publishing_audit_events where action='creator_publishing_job_rescheduled' and entity_id=v_job order by id desc limit 1), 'reschedule audit records superseded IDs');

  update public.creator_publishing_scheduler_events set due_at=now()-interval '5 minutes' where platform_job_id=v_job;
  select * into v_claim from public.creator_publishing_claim_due_scheduler_events(1,15);
  perform public.task15_assert(v_claim.id is not null, 'claim returns one event');
  perform public.task15_assert((select event_type from public.creator_publishing_scheduler_events where id=v_claim.id)='operator_due', 'operator_due claimed first');
  perform public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_claimed' and entity_id=v_claim.id)=1, 'claim audited once');
  perform public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_claimed' and (before_state::text like '%lock_token%' or after_state::text like '%lock_token%')), 'claim audit has no lock token');
  v_process := public.creator_publishing_process_scheduler_event(v_claim.id,v_claim.lock_token,'creator-ai-twin-consent-v1',v_hash);
  perform public.task15_assert((v_process->>'processed')::boolean, 'operator_due processed');
  perform public.task15_assert((select job_state from public.creator_publishing_platform_jobs where id=v_job)='awaiting_operator', 'operator_due advances awaiting_operator');
  select * into v_claim from public.creator_publishing_claim_due_scheduler_events(1,15);
  perform public.task15_assert((select event_type from public.creator_publishing_scheduler_events where id=v_claim.id)='publish_due', 'publish_due claimed second');
  v_process := public.creator_publishing_process_scheduler_event(v_claim.id,v_claim.lock_token,'creator-ai-twin-consent-v1',v_hash);
  perform public.task15_assert((select job_state from public.creator_publishing_platform_jobs where id=v_job)='due_now', 'publish_due advances due_now');

  v_cancel := public.creator_publishing_cancel_schedule(v_creator,v_plan,null,'integration cancellation');
  perform public.task15_assert((select status from public.creator_publishing_plans where id=v_plan)='cancelled', 'plan cancelled');
  perform public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id=v_job and event_status in ('pending','processing'))=0, 'cancel closes active events');
  begin
    perform public.creator_publishing_schedule_plan(v_creator,v_plan,now()+interval '6 hours','UTC','schedule-after-cancel','creator-ai-twin-consent-v1',v_hash,array[v_job],'{}'::jsonb,'schedule');
    raise exception 'expected plan cancelled';
  exception when others then v_conflict := sqlerrm; end;
  perform public.task15_assert(v_conflict like '%PLAN_CANCELLED%', 'new schedule on cancelled plan rejected');
end $$;

-- Obsolete assisted operator events must supersede before gate evaluation even when gates are invalidated.
do $$
declare
  v_creator uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_account uuid := '11111111-1111-4111-8111-111111111111';
  v_package uuid := '66666666-6666-4666-8666-666666666666';
  v_generation uuid := '77777777-7777-4777-8777-777777777777';
  v_plan uuid := '88888888-8888-4888-8888-888888888888';
  v_job uuid := '99999999-9999-4999-8999-999999999999';
  v_event uuid; v_token uuid; v_result jsonb; v_hash text := '0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12';
begin
  insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,ai_flag,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_by,creator_approved_at)
    values(v_package,v_creator,v_account,'onlyfans','Title 2','Caption','ai_generated','passed','policy-v1','approved',v_creator,now());
  insert into public.creator_publishing_compliance_reviews(content_package_id,outcome,review_source,compliance_policy_version,created_at) values(v_package,'pass','automated','policy-v1',now());
  insert into public.generations(id,user_id,status,r2_bucket,r2_key,metadata) values(v_generation,v_creator,'completed','bucket','key','{"safety":"safe"}'::jsonb);
  insert into public.creator_publishing_media_assets(content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata) values(v_package,'media/2.png','image/png',repeat('b',64),'ai_pipeline',jsonb_build_object('generation_id',v_generation::text));
  insert into public.creator_publishing_queue_tasks(content_package_id,status) values(v_package,'ready_for_handoff');
  insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version) values(v_plan,v_creator,'in_progress','plan-key-2',repeat('d',64),'task14.20260711.001');
  insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,schedule_revision,intended_publish_at,schedule_timezone,operator_due_at)
    select v_job,v_plan,v_creator,v_package,v_account,'onlyfans','assisted','due_now',p.updated_at,public.creator_publishing_autopost_source_fingerprint(v_package),'task14.20260711.001',repeat('e',64),1,now()-interval '1 minute','UTC',now()-interval '1 hour' from public.creator_publishing_content_packages p where p.id=v_package;
  insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,due_at,schedule_revision,event_status,lock_token,locked_at,processing_attempts)
    values(extensions.gen_random_uuid(),v_creator,v_plan,v_job,'operator_due',now()-interval '2 hours',1,'processing',extensions.gen_random_uuid(),now(),1) returning id,lock_token into v_event,v_token;
  update public.creator_publishing_ai_twin_consents set revoked_at=now(), status='revoked' where creator_id=v_creator;
  v_result := public.creator_publishing_process_scheduler_event(v_event,v_token,'creator-ai-twin-consent-v1',v_hash);
  perform public.task15_assert((v_result->>'skipped')::boolean and v_result->>'code'='OBSOLETE_OPERATOR_DUE', 'obsolete operator skipped before gate');
  perform public.task15_assert((select job_state from public.creator_publishing_platform_jobs where id=v_job)='due_now', 'obsolete operator preserves due_now');
  perform public.task15_assert((select event_status from public.creator_publishing_scheduler_events where id=v_event)='superseded', 'obsolete operator superseded');
  perform public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=v_event)=1, 'obsolete supersession audited once');
  perform public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_due_state_transition_blocked' and entity_id=v_job), 'obsolete operator did not create gate-block audit');
end $$;

-- Expired-lock recovery and bounded claim ordering.
do $$
declare
  v_old uuid; v_new uuid; v_claim record;
begin
  select id into v_old from public.creator_publishing_scheduler_events where event_status='superseded' limit 1;
  update public.creator_publishing_scheduler_events set event_status='processing', locked_at=now()-interval '30 minutes', lock_token=extensions.gen_random_uuid(), processing_attempts=4, superseded_at=null where id=v_old;
  select * into v_claim from public.creator_publishing_claim_due_scheduler_events(1,15);
  perform public.task15_assert(v_claim.id=v_old, 'expired processing event reclaimed before later events');
  perform public.task15_assert((select processing_attempts from public.creator_publishing_scheduler_events where id=v_old)=5, 'expired recovery increments attempts');
  perform public.task15_assert((select before_state->>'event_status' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_claimed' and entity_id=v_old order by id desc limit 1)='processing', 'expired recovery audit starts from processing');
  perform public.task15_assert((select before_state->>'processing_attempts' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_claimed' and entity_id=v_old order by id desc limit 1)='4', 'expired recovery audit prior attempts');
end $$;

-- Direct and Planner transitions stop at Task 15 states and never claim publication success.
do $$
declare
  v_creator uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_account uuid := '11111111-1111-4111-8111-111111111111';
  v_hash text := '0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12';
begin
  update public.creator_publishing_ai_twin_consents set status='granted', revoked_at=null, attestation_version='creator-ai-twin-consent-v1', attestation_text_sha256=v_hash where creator_id=v_creator;
  update public.creator_publishing_platform_capabilities set publishing_mode='direct', availability_status='available', connector_can_publish_immediately=true, human_publishing_required=false where platform='onlyfans';
  update public.creator_publishing_platform_jobs set publishing_mode='direct', job_state='ready_to_publish', schedule_revision=10 where id='99999999-9999-4999-8999-999999999999';
  insert into public.creator_publishing_scheduler_events(creator_id,publishing_plan_id,platform_job_id,event_type,due_at,schedule_revision,event_status,lock_token,locked_at,processing_attempts)
    values(v_creator,'88888888-8888-4888-8888-888888888888','99999999-9999-4999-8999-999999999999','publish_due',now()-interval '1 minute',10,'processing',extensions.gen_random_uuid(),now(),1);
  perform public.creator_publishing_process_scheduler_event((select id from public.creator_publishing_scheduler_events where platform_job_id='99999999-9999-4999-8999-999999999999' and schedule_revision=10),'00000000-0000-4000-8000-000000000000','creator-ai-twin-consent-v1',v_hash);
  -- stale token path mutates nothing; now process with current token.
  perform public.task15_assert((select job_state from public.creator_publishing_platform_jobs where id='99999999-9999-4999-8999-999999999999')='ready_to_publish', 'stale token did not mutate direct job');
  perform public.creator_publishing_process_scheduler_event((select id from public.creator_publishing_scheduler_events where platform_job_id='99999999-9999-4999-8999-999999999999' and schedule_revision=10),(select lock_token from public.creator_publishing_scheduler_events where platform_job_id='99999999-9999-4999-8999-999999999999' and schedule_revision=10),'creator-ai-twin-consent-v1',v_hash);
  perform public.task15_assert((select job_state from public.creator_publishing_platform_jobs where id='99999999-9999-4999-8999-999999999999')='direct_publish_queued', 'direct path stops at direct_publish_queued');

  update public.creator_publishing_platform_capabilities set publishing_mode='planner', availability_status='available', connector_can_publish_immediately=false, human_publishing_required=false where platform='onlyfans';
  update public.creator_publishing_platform_jobs set publishing_mode='planner', job_state='package_ready', schedule_revision=11 where id='99999999-9999-4999-8999-999999999999';
  insert into public.creator_publishing_scheduler_events(creator_id,publishing_plan_id,platform_job_id,event_type,due_at,schedule_revision,event_status,lock_token,locked_at,processing_attempts)
    values(v_creator,'88888888-8888-4888-8888-888888888888','99999999-9999-4999-8999-999999999999','publish_due',now()-interval '1 minute',11,'processing',extensions.gen_random_uuid(),now(),1);
  perform public.creator_publishing_process_scheduler_event((select id from public.creator_publishing_scheduler_events where platform_job_id='99999999-9999-4999-8999-999999999999' and schedule_revision=11),(select lock_token from public.creator_publishing_scheduler_events where platform_job_id='99999999-9999-4999-8999-999999999999' and schedule_revision=11),'creator-ai-twin-consent-v1',v_hash);
  perform public.task15_assert((select job_state from public.creator_publishing_platform_jobs where id='99999999-9999-4999-8999-999999999999')='ready_for_export', 'planner path stops at ready_for_export');
  perform public.task15_assert(not exists(select 1 from public.creator_publishing_platform_jobs where job_state in ('published_direct','confirmed_posted_manual')), 'Task 15 never sets terminal publication success');
end $$;

select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where before_state::text like '%lock_token%' or after_state::text like '%lock_token%'), 'audits never include lock tokens');
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where before_state::text ~ 'P0001|SQLSTATE|cookie|session|credential' or after_state::text ~ 'P0001|SQLSTATE|cookie|session|credential'), 'audits omit SQLSTATE/credentials/session data');
\echo 'Task 15 PostgreSQL integration completed successfully'
