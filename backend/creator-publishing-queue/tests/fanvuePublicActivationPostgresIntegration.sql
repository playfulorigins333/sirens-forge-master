create or replace function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'ASSERT:%',label;end if;end$$;
create or replace function pg_temp.expect_error(label text,expected text,statement text) returns void language plpgsql as $$begin begin execute statement;raise exception 'EXPECTED_ERROR_NOT_RAISED:%',label;exception when others then if position(expected in sqlerrm)=0 then raise exception 'UNEXPECTED_ERROR:%:%',label,sqlerrm;end if;end;end$$;
create or replace function pg_temp.public_execute_granted(signature regprocedure) returns boolean language sql stable as $$select exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature and a.grantee=0 and a.privilege_type='EXECUTE')$$;

select pg_temp.assert_true((select count(distinct registry_version)=1 and min(registry_version)='task14.20260817.002' from public.creator_publishing_platform_capabilities),'activation registry is coherent');
select pg_temp.assert_true((select publishing_mode='direct' and availability_status='available' and connector_can_upload_media and connector_can_publish_immediately and not connector_can_schedule_directly and not human_operator_queue_supported and not human_publishing_required from public.creator_publishing_platform_capabilities where platform='fanvue'),'Fanvue direct capability activated');

select pg_temp.assert_true((select count(*)=1 from public.creator_platform_accounts where creator_id='22222222-2222-4222-8222-222222222222' and platform='fanvue' and oauth_account_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),'pre-bridge connected OAuth destination backfilled');
select pg_temp.assert_true((select encrypted_access_token='activation-access-fixture' and encrypted_refresh_token='activation-refresh-fixture' and connection_status='CONNECTED' from public.autopost_accounts where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),'activation backfill does not mutate OAuth credentials');
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_audit_events where action='fanvue_oauth_destination_activation_backfill' and actor_id='22222222-2222-4222-8222-222222222222'),'destination backfill audited once');

-- Existing bridged destination remains singular and is not duplicated by activation.
select pg_temp.assert_true((select count(*)=1 from public.creator_platform_accounts where creator_id='11111111-1111-4111-8111-111111111111' and platform='fanvue'),'existing bridge destination unchanged');

create temp table activation_package as
select public.creator_publishing_save_content_package(
 '11111111-1111-4111-8111-111111111111','create',null,
 (select id from public.creator_platform_accounts where creator_id='11111111-1111-4111-8111-111111111111' and platform='fanvue' limit 1),
 'Fanvue activation text package','Launch text package',false,null,null,null,'fanvue_activation_pkg_01'
) result;
create temp table activation_package_id as select (result->'package'->>'id')::uuid id from activation_package;
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_media_assets where content_package_id=(select id from activation_package_id)),'text plan uses zero media');

create temp table activation_plan as
select public.creator_publishing_create_fanvue_autopost_plan(
 '11111111-1111-4111-8111-111111111111',(select id from activation_package_id),'fanvue_activation_plan_01'
) result;
select pg_temp.assert_true((select result->>'idempotent'='false' and jsonb_array_length(result->'jobs')=1 from activation_plan),'Fanvue direct plan created');
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

-- Removing write:post prevents a new Fanvue plan before any scheduler/provider activity.
update public.autopost_accounts set scopes='["read:creator"]'::jsonb where user_id='11111111-1111-4111-8111-111111111111' and platform='fanvue';
create temp table scope_package as
select public.creator_publishing_save_content_package(
 '11111111-1111-4111-8111-111111111111','create',null,
 (select id from public.creator_platform_accounts where creator_id='11111111-1111-4111-8111-111111111111' and platform='fanvue' limit 1),
 'Fanvue scope test','scope test',false,null,null,null,'fanvue_scope_pkg_01'
) result;
select pg_temp.expect_error('write post required','FANVUE_PUBLICATION_SCOPE_MISSING',$q$select public.creator_publishing_create_fanvue_autopost_plan('11111111-1111-4111-8111-111111111111',(select (result->'package'->>'id')::uuid from scope_package),'fanvue_scope_plan_01')$q$);
update public.autopost_accounts set scopes='["openid","offline_access","offline","read:self","read:creator","read:post","write:post","read:media","write:media","write:creator"]'::jsonb where user_id='11111111-1111-4111-8111-111111111111' and platform='fanvue';

-- The activation RPC remains service-role-only and uses a safe search path.
do $$declare sig regprocedure:='public.creator_publishing_create_fanvue_autopost_plan(uuid,uuid,text)'::regprocedure;def text:=lower(pg_get_functiondef(sig));begin
 perform pg_temp.assert_true(position('security definer' in def)>0,'activation RPC security definer');
 perform pg_temp.assert_true(position('set search_path to ''public'', ''pg_temp''' in def)>0,'activation RPC safe search path');
 perform pg_temp.assert_true(not pg_temp.public_execute_granted(sig),'PUBLIC execute revoked');
 perform pg_temp.assert_true(not has_function_privilege('anon',sig,'execute'),'anon execute revoked');
 perform pg_temp.assert_true(not has_function_privilege('authenticated',sig,'execute'),'authenticated execute revoked');
 perform pg_temp.assert_true(has_function_privilege('service_role',sig,'execute'),'service role execute granted');
end$$;

select 'FANVUE_PUBLIC_ACTIVATION_POSTGRES_ASSERTIONS_PASSED';
