create or replace function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'ASSERT:%',label;end if;end$$;
create or replace function pg_temp.expect_error(label text,expected text,statement text) returns void language plpgsql as $$begin begin execute statement;raise exception 'EXPECTED_ERROR_NOT_RAISED:%',label;exception when others then if position(expected in sqlerrm)=0 then raise exception 'UNEXPECTED_ERROR:%:%',label,sqlerrm;end if;end;end$$;
create or replace function pg_temp.public_execute_granted(signature regprocedure) returns boolean language sql stable as $$select exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature and a.grantee=0 and a.privilege_type='EXECUTE')$$;

select pg_temp.assert_true((select count(distinct registry_version)=1 and min(registry_version)='task14.20260817.002' from public.creator_publishing_platform_capabilities),'activation registry is coherent');
select pg_temp.assert_true((select platform_requires_ai_disclosure and not platform_blocks_fictional_personas),'Fanvue requires disclosure and permits fictional personas');
select pg_temp.assert_true((select publishing_mode='direct' and availability_status='available' and connector_can_upload_media and connector_can_publish_immediately and not connector_can_schedule_directly and not human_operator_queue_supported and not human_publishing_required from public.creator_publishing_platform_capabilities where platform='fanvue'),'Fanvue direct capability activated');
select pg_temp.assert_true((select publishing_mode='disabled' and availability_status='unassigned' from public.creator_publishing_platform_capabilities where platform='x'),'X remains disabled');
select pg_temp.assert_true((select publishing_mode='disabled' and availability_status='unassigned' from public.creator_publishing_platform_capabilities where platform='reddit'),'Reddit remains disabled');

select pg_temp.assert_true((select count(*)=1 from public.creator_platform_accounts where creator_id='22222222-2222-4222-8222-222222222222' and platform='fanvue' and oauth_account_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),'pre-bridge connected OAuth destination backfilled');
select pg_temp.assert_true((select encrypted_access_token='activation-access-fixture' and encrypted_refresh_token='activation-refresh-fixture' and connection_status='CONNECTED' from public.autopost_accounts where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),'activation backfill does not mutate OAuth credentials');
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_audit_events where action='fanvue_oauth_destination_activation_backfill' and actor_id='22222222-2222-4222-8222-222222222222'),'destination backfill audited once');
select pg_temp.assert_true((select count(*)=1 from public.creator_platform_accounts where creator_id='11111111-1111-4111-8111-111111111111' and platform='fanvue'),'existing bridge destination unchanged');

create temp table activation_package as
select public.creator_publishing_save_content_package(
 '11111111-1111-4111-8111-111111111111','create',null,
 (select id from public.creator_platform_accounts where creator_id='11111111-1111-4111-8111-111111111111' and platform='fanvue' limit 1),
 'Fanvue activation text package','Launch text package',false,null,null,null,'fanvue_activation_pkg_01'
) result;
create temp table activation_package_id as select (result->'package'->>'id')::uuid id from activation_package;
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_media_assets where content_package_id=(select id from activation_package_id)),'text plan uses zero media');

-- Database defense-in-depth rejects job creation before direct compliance/approval.
select pg_temp.expect_error('unapproved Fanvue job blocked','FANVUE_JOB_TRUST_GATE_FAILED',$q$select public.creator_publishing_create_fanvue_autopost_plan('11111111-1111-4111-8111-111111111111',(select id from activation_package_id),'fanvue_activation_plan_01')$q$);
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_plans where idempotency_key='fanvue_activation_plan_01'),'failed pre-approval plan rolls back atomically');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_platform_jobs where content_package_id=(select id from activation_package_id)),'failed pre-approval job rolls back atomically');

create temp table direct_facts as
select public.creator_publishing_load_fanvue_direct_compliance_facts('11111111-1111-4111-8111-111111111111',(select id from activation_package_id)) result;
select pg_temp.assert_true((select result->'facts'->>'schema_version'='creator-publishing-fanvue-direct-compliance-facts-v1' and result->'facts'->'media_manifest'='[]'::jsonb and result->'facts'->>'oauth_destination_verified'='true' from direct_facts),'Fanvue text facts are trusted without fake media');

create temp table direct_compliance as
select public.creator_publishing_apply_fanvue_direct_compliance(
 '11111111-1111-4111-8111-111111111111',(select id from activation_package_id),
 (select (result->'facts'->'package'->>'updated_at')::timestamptz from direct_facts),
 (select result->>'facts_fingerprint' from direct_facts),(select result->>'media_manifest_hash' from direct_facts),
 'fanvue-reference-2026-07-10-v1','passed','Launch text package','none','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
 '{"evaluator":"creator_publishing_queue_compliance_v1","policy_mode":"direct_api","queue_enabled":false}'::jsonb,
 'not_applicable','fvcomp_postgres_activation_01'
) result;
select pg_temp.assert_true((select result->>'resulting_compliance_status'='passed' and result->>'idempotent'='false' from direct_compliance),'Fanvue direct compliance passes text package');
select pg_temp.assert_true((select compliance_status='passed' and compliance_policy_version='fanvue-reference-2026-07-10-v1' and creator_approval_status='pending' from public.creator_publishing_content_packages where id=(select id from activation_package_id)),'compliance persists without approval');
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_compliance_reviews where content_package_id=(select id from activation_package_id) and review_source='automated' and outcome='pass' and compliance_policy_version='fanvue-reference-2026-07-10-v1'),'Fanvue compliance evidence durable');

-- V1 consent is deliberately insufficient after the policy correction.
select pg_temp.expect_error('V1 consent rejected by approval','FANVUE_APPROVAL_AI_TWIN_CONSENT_REQUIRED',$q$select public.creator_publishing_approve_fanvue_direct_package(
 '11111111-1111-4111-8111-111111111111',(select id from activation_package_id),
 (select updated_at from public.creator_publishing_content_packages where id=(select id from activation_package_id)),
 'fanvue-reference-2026-07-10-v1','fvappr_v1_rejected_01')$q$);
update public.creator_publishing_ai_twin_consents
set status='granted', revoked_at=null,
    attestation_version='creator-ai-content-persona-consent-v2',
    attestation_text_sha256='b6c9ee005f1800b0cf41757592f846a97b4a28843bbee8abe0cb0997a47b760d'
where creator_id='11111111-1111-4111-8111-111111111111';

create temp table direct_approval as
select public.creator_publishing_approve_fanvue_direct_package(
 '11111111-1111-4111-8111-111111111111',(select id from activation_package_id),
 (select updated_at from public.creator_publishing_content_packages where id=(select id from activation_package_id)),
 'fanvue-reference-2026-07-10-v1','fvappr_postgres_activation_01'
) result;
select pg_temp.assert_true((select result->>'resulting_creator_approval_status'='approved' and result->>'queue_task_created'='false' from direct_approval),'Fanvue direct approval creates no operator task');
select pg_temp.assert_true((select creator_approval_status='approved' and creator_approved_by='11111111-1111-4111-8111-111111111111' and creator_approved_at is not null from public.creator_publishing_content_packages where id=(select id from activation_package_id)),'Fanvue approval durable');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_queue_tasks where content_package_id=(select id from activation_package_id)),'Fanvue approval remains outside manual operator queue');

-- The insert guard independently rejects V1 even after package approval.
update public.creator_publishing_ai_twin_consents
set attestation_version='creator-ai-twin-consent-v1',
    attestation_text_sha256='0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12'
where creator_id='11111111-1111-4111-8111-111111111111';
select pg_temp.expect_error('V1 consent rejected by job guard','FANVUE_JOB_TRUST_GATE_FAILED',$q$select public.creator_publishing_create_fanvue_autopost_plan(
 '11111111-1111-4111-8111-111111111111',(select id from activation_package_id),'fanvue_v1_guard_rejected_01')$q$);
update public.creator_publishing_ai_twin_consents
set attestation_version='creator-ai-content-persona-consent-v2',
    attestation_text_sha256='b6c9ee005f1800b0cf41757592f846a97b4a28843bbee8abe0cb0997a47b760d'
where creator_id='11111111-1111-4111-8111-111111111111';

create temp table activation_plan as
select public.creator_publishing_create_fanvue_autopost_plan(
 '11111111-1111-4111-8111-111111111111',(select id from activation_package_id),'fanvue_activation_plan_01'
) result;
select pg_temp.assert_true((select result->>'idempotent'='false' and jsonb_array_length(result->'jobs')=1 from activation_plan),'Fanvue direct plan created only after preparation');
select pg_temp.assert_true((select target_platform='fanvue' and publishing_mode='direct' and job_state='draft' and publication_type='text' and oauth_account_id is not null and server_idempotency_key is not null and capability_registry_version='task14.20260817.002' from public.creator_publishing_platform_jobs where content_package_id=(select id from activation_package_id)),'Fanvue job has complete direct execution shape');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_scheduler_events where publishing_plan_id=(select (result->'plan'->>'id')::uuid from activation_plan)),'draft plan creates no scheduler event');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_fanvue_attempts where job_id=(select id from public.creator_publishing_platform_jobs where content_package_id=(select id from activation_package_id))),'draft plan creates no provider attempt');

create temp table activation_replay as
select public.creator_publishing_create_fanvue_autopost_plan(
 '11111111-1111-4111-8111-111111111111',(select id from activation_package_id),'fanvue_activation_plan_01'
) result;
select pg_temp.assert_true((select result->>'idempotent'='true' from activation_replay),'exact activation plan replay idempotent');
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_platform_jobs where content_package_id=(select id from activation_package_id)),'replay creates no duplicate job');
select pg_temp.expect_error('cross creator package hidden','CONTENT_PACKAGE_NOT_FOUND',$q$select public.creator_publishing_create_fanvue_autopost_plan('22222222-2222-4222-8222-222222222222',(select id from activation_package_id),'fanvue_cross_plan_01')$q$);

-- Removing write:post prevents a new Fanvue plan before scheduler/provider activity.
update public.autopost_accounts set scopes='["read:creator"]'::jsonb where user_id='11111111-1111-4111-8111-111111111111' and platform='fanvue';
create temp table scope_package as
select public.creator_publishing_save_content_package(
 '11111111-1111-4111-8111-111111111111','create',null,
 (select id from public.creator_platform_accounts where creator_id='11111111-1111-4111-8111-111111111111' and platform='fanvue' limit 1),
 'Fanvue scope test','scope test',false,null,null,null,'fanvue_scope_pkg_01'
) result;
select pg_temp.expect_error('write post required at facts gate','FANVUE_COMPLIANCE_DESTINATION_INVALID',$q$select public.creator_publishing_load_fanvue_direct_compliance_facts('11111111-1111-4111-8111-111111111111',(select (result->'package'->>'id')::uuid from scope_package))$q$);
update public.autopost_accounts set scopes='["openid","offline_access","offline","read:self","read:creator","read:post","write:post","read:media","write:media","write:creator"]'::jsonb where user_id='11111111-1111-4111-8111-111111111111' and platform='fanvue';

-- Activation RPCs remain service-role-only with safe search paths.
do $$
declare sig regprocedure; def text;
begin
 foreach sig in array array[
  'public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text)'::regprocedure,
  'public.creator_publishing_build_fanvue_direct_compliance_facts(uuid,uuid)'::regprocedure,
  'public.creator_publishing_load_fanvue_direct_compliance_facts(uuid,uuid)'::regprocedure,
  'public.creator_publishing_apply_fanvue_direct_compliance(uuid,uuid,timestamptz,text,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,text)'::regprocedure,
  'public.creator_publishing_approve_fanvue_direct_package(uuid,uuid,timestamptz,text,text)'::regprocedure
 ] loop
  def:=lower(pg_get_functiondef(sig));
  perform pg_temp.assert_true(position('security definer' in def)>0,'activation RPC security definer');
  perform pg_temp.assert_true(position('set search_path to ''public'', ''pg_temp''' in def)>0,'activation RPC safe search path');
  perform pg_temp.assert_true(not pg_temp.public_execute_granted(sig),'PUBLIC execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('anon',sig,'execute'),'anon execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('authenticated',sig,'execute'),'authenticated execute revoked');
  perform pg_temp.assert_true(has_function_privilege('service_role',sig,'execute'),'service role execute granted');
 end loop;
end$$;

select 'FANVUE_PUBLIC_ACTIVATION_POSTGRES_ASSERTIONS_PASSED';
