-- Disposable PostgreSQL behavioral coverage for the non-runnable Fanvue CPQ gate.
create or replace function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$ begin if value is not true then raise exception 'ASSERTION_FAILED:%',label; end if; end $$;
create or replace function pg_temp.expect_error(label text,expected text,statement text) returns void language plpgsql as $$ begin begin execute statement; raise exception 'EXPECTED_ERROR_NOT_RAISED:%',label; exception when others then if position(expected in sqlerrm)=0 then raise exception 'UNEXPECTED_ERROR:%:%',label,sqlerrm; end if; end; end $$;
create or replace function pg_temp.public_execute_granted(signature regprocedure) returns boolean language sql stable as $$ select exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature and a.grantee=0 and a.privilege_type='EXECUTE') $$;

insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','fanvue@example.test'),
 ('22222222-2222-4222-8222-222222222222','other@example.test'),
 ('33333333-3333-4333-8333-333333333333','reviewer@example.test');

-- The Gate migration itself does not create or mutate any Fanvue destination.
select pg_temp.assert_true((select count(*) from public.cpq_fanvue_pre_gate_snapshot)=0,'pre-gate Fanvue snapshot empty');
select pg_temp.assert_true((select count(*) from public.creator_platform_accounts where platform='fanvue')=0,'Gate migration no Fanvue backfill');

-- Gate 4B canonical bridge establishes a connected OAuth row and unattested CPQ destination.
create temp table bridge_result as select public.creator_publishing_link_fanvue_oauth_account(
 '11111111-1111-4111-8111-111111111111','provider-fanvue-1','fanvue_creator','Fanvue Creator','bearer','["read:creator"]'::jsonb,
 'encrypted-access-fixture','encrypted-refresh-fixture',1,clock_timestamp()+interval '1 hour','{}'::jsonb
) result;
create temp table fixture as select (result->>'oauth_account_id')::uuid oauth_id,(result->>'destination_id')::uuid destination_id from bridge_result;
do $$ begin
 perform pg_temp.assert_true((select a.connection_status='CONNECTED' and a.provider_account_id='provider-fanvue-1' from public.autopost_accounts a join fixture f on f.oauth_id=a.id),'bridge connected identity');
 perform pg_temp.assert_true((select d.verification_status='unattested' and d.oauth_account_id=f.oauth_id and d.creator_id='11111111-1111-4111-8111-111111111111' from public.creator_platform_accounts d join fixture f on f.destination_id=d.id),'canonical unattested destination');
 perform pg_temp.assert_true((select d.verification_reviewed_by is null and d.verification_reviewed_at is null and d.verification_evidence_reference is null and d.verification_reason is null from public.creator_platform_accounts d join fixture f on f.destination_id=d.id),'no fake verification evidence');
end $$;

-- Schema and bridge invariants reject missing linkage, mismatched ownership, and connected identity absence.
select pg_temp.expect_error('missing oauth link','creator_platform_accounts_oauth_platform_check',$q$insert into public.creator_platform_accounts(creator_id,platform,platform_username,verification_status,is_virtual_entity) values('11111111-1111-4111-8111-111111111111','fanvue','missing','unattested',false)$q$);
select pg_temp.expect_error('connected provider identity missing','autopost_accounts_connected_fanvue_identity_check',$q$insert into public.autopost_accounts(user_id,platform,connection_status,provider_account_id) values('22222222-2222-4222-8222-222222222222','fanvue','CONNECTED',null)$q$);
do $$ declare other_oauth uuid; begin
 insert into public.autopost_accounts(user_id,platform,connection_status,provider_account_id) values('22222222-2222-4222-8222-222222222222','fanvue','DISCONNECTED','provider-other') returning id into other_oauth;
 begin
  insert into public.creator_platform_accounts(creator_id,platform,platform_username,verification_status,is_virtual_entity,oauth_account_id) values('11111111-1111-4111-8111-111111111111','fanvue','mismatch','unattested',false,other_oauth);
  set constraints all immediate;
  raise exception 'EXPECTED_ERROR_NOT_RAISED:broken ownership';
 exception when foreign_key_violation then null; end;
end $$;

-- The request has no target_platform parameter; the database derives Fanvue from the destination.
do $$ declare def text := pg_get_function_identity_arguments('public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)'::regprocedure); begin
 perform pg_temp.assert_true(position('target_platform' in def)=0,'browser cannot submit target platform');
end $$;
create temp table fanvue_create as select public.creator_publishing_save_content_package(
 '11111111-1111-4111-8111-111111111111','create',null,(select destination_id from fixture),'Fanvue package','caption',false,'price','visible',null,'fanvue_pkg_create_01'
) result;
create temp table package_fixture as select (result->'package'->>'id')::uuid package_id,(result->'package'->>'updated_at')::timestamptz updated_at from fanvue_create;
do $$ begin
 perform pg_temp.assert_true((select result->>'outcome'='created' and result->'package'->>'target_platform'='fanvue' from fanvue_create),'connected Fanvue package created');
 perform pg_temp.assert_true((select p.platform_account_id=f.destination_id and p.target_platform='fanvue' from public.creator_publishing_content_packages p join package_fixture x on x.package_id=p.id cross join fixture f),'package canonical destination');
end $$;

-- Exact replay is idempotent and changed replay conflicts without duplicate state.
create temp table replay as select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,(select destination_id from fixture),'Fanvue package','caption',false,'price','visible',null,'fanvue_pkg_create_01') result;
select pg_temp.assert_true((select result->>'outcome'='idempotent' and (result->>'idempotent')::boolean from replay),'exact replay idempotent');
select pg_temp.assert_true((select count(*) from public.creator_publishing_audit_events where idempotency_key='fanvue_pkg_create_01')=1,'replay no duplicate audit');
select pg_temp.expect_error('changed replay','IDEMPOTENCY_CONFLICT',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,(select destination_id from fixture),'changed','caption',false,'price','visible',null,'fanvue_pkg_create_01')$q$);

-- Eligible update works, meaningful change resets approval/compliance, stale and approved updates remain locked down.
update public.creator_publishing_content_packages set compliance_status='passed',compliance_policy_version='policy-v1',creator_approval_status='rejected' where id=(select package_id from package_fixture);
update package_fixture set updated_at=(select updated_at from public.creator_publishing_content_packages where id=package_id);
create temp table fanvue_update as select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','update',(select package_id from package_fixture),(select destination_id from fixture),'Fanvue package edited','caption edited',true,null,null,(select updated_at from package_fixture),'fanvue_pkg_update_01') result;
do $$ begin
 perform pg_temp.assert_true((select result->>'outcome'='updated' from fanvue_update),'Fanvue update succeeds');
 perform pg_temp.assert_true((select compliance_status='pending' and compliance_policy_version='unassigned' and creator_approval_status='pending' and creator_approved_by is null and creator_approved_at is null from public.creator_publishing_content_packages where id=(select package_id from package_fixture)),'meaningful edit invalidates approval compliance');
end $$;
select pg_temp.expect_error('stale update','PACKAGE_STALE',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','update',(select package_id from package_fixture),(select destination_id from fixture),'stale','caption',false,null,null,(select updated_at from package_fixture),'fanvue_pkg_stale_01')$q$);
update public.creator_publishing_content_packages set compliance_status='passed',compliance_policy_version='policy-v1',creator_approval_status='approved',creator_approved_by='11111111-1111-4111-8111-111111111111',creator_approved_at=clock_timestamp() where id=(select package_id from package_fixture);
select pg_temp.expect_error('approved locked','PACKAGE_LOCKED',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','update',(select package_id from package_fixture),(select destination_id from fixture),'locked','caption',false,null,null,(select updated_at from public.creator_publishing_content_packages where id=(select package_id from package_fixture)),'fanvue_pkg_locked_01')$q$);
update public.creator_publishing_content_packages set creator_approval_status='pending' where id=(select package_id from package_fixture);

-- Cross-creator, disconnected, and revoked destinations are rejected for new composition.
select pg_temp.expect_error('cross creator','PLATFORM_ACCOUNT_NOT_FOUND',$q$select public.creator_publishing_save_content_package('22222222-2222-4222-8222-222222222222','create',null,(select destination_id from fixture),'cross owner','caption',false,null,null,null,'fanvue_cross_0001')$q$);
update public.autopost_accounts set connection_status='DISCONNECTED' where id=(select oauth_id from fixture);
select pg_temp.expect_error('disconnected','FANVUE_OAUTH_DESTINATION_NOT_CONNECTED',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,(select destination_id from fixture),'disconnected','caption',false,null,null,null,'fanvue_disconn_01')$q$);
update public.autopost_accounts set connection_status='CONNECTED' where id=(select oauth_id from fixture);
update public.creator_platform_accounts set verification_status='revoked',verification_reviewed_by='33333333-3333-4333-8333-333333333333',verification_reviewed_at=clock_timestamp(),verification_reason='revoked fixture' where id=(select destination_id from fixture);
select pg_temp.expect_error('revoked destination','PLATFORM_ACCOUNT_REVOKED',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,(select destination_id from fixture),'revoked','caption',false,null,null,null,'fanvue_revoked_01')$q$);
update public.creator_platform_accounts set verification_status='unattested',verification_reviewed_by=null,verification_reviewed_at=null,verification_evidence_reference=null,verification_reason=null where id=(select destination_id from fixture);

-- OnlyFans and Fansly retain exact trusted-verification requirements.
insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,is_virtual_entity,verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','onlyfans','verified_of','verified',false,'33333333-3333-4333-8333-333333333333',clock_timestamp(),'fixture://of','verified fixture'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111','fansly','verified_fansly','verified',false,'33333333-3333-4333-8333-333333333333',clock_timestamp(),'fixture://fansly','verified fixture'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','11111111-1111-4111-8111-111111111111','onlyfans','unverified_of','unattested',false,null,null,null,null),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','11111111-1111-4111-8111-111111111111','fansly','unverified_fansly','creator_attested',false,null,null,null,null);
create temp table legacy_packages as
 select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','OnlyFans verified','caption',false,null,null,null,'onlyfans_verified1') result
 union all select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Fansly verified','caption',false,null,null,null,'fansly_verified_1');
select pg_temp.assert_true((select count(*) from legacy_packages where result->>'outcome'='created')=2,'verified OnlyFans Fansly unchanged');
select pg_temp.expect_error('OnlyFans nonverified','DESTINATION_ACCOUNT_NOT_VERIFIED',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','bad','caption',false,null,null,null,'onlyfans_unverif1')$q$);
select pg_temp.expect_error('Fansly nonverified','DESTINATION_ACCOUNT_NOT_VERIFIED',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','bad','caption',false,null,null,null,'fansly_unverif_1')$q$);

-- A real Fanvue package remains non-runnable; plan failure leaves no jobs or scheduler events.
select pg_temp.expect_error('Fanvue plan frozen','FANVUE_NOT_AVAILABLE',$q$select public.creator_publishing_create_autopost_plan('11111111-1111-4111-8111-111111111111',array[(select package_id from package_fixture)],'fanvue_plan_0001')$q$);
select pg_temp.assert_true((select count(*) from public.creator_publishing_plans where idempotency_key='fanvue_plan_0001')=0,'no Fanvue plan');
select pg_temp.assert_true((select count(*) from public.creator_publishing_platform_jobs where target_platform='fanvue')=0,'zero Fanvue publication jobs');
select pg_temp.assert_true((select count(*) from public.creator_publishing_scheduler_events)=0,'zero scheduler events');

-- Final RPC security posture remains service-role only with a safe search path.
do $$ declare sig regprocedure := 'public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)'::regprocedure; def text := lower(pg_get_functiondef(sig)); begin
 perform pg_temp.assert_true(position('security definer' in def)>0,'security definer');
 perform pg_temp.assert_true(position('set search_path to ''public'', ''pg_temp''' in def)>0,'safe search path');
 perform pg_temp.assert_true(not pg_temp.public_execute_granted(sig),'PUBLIC execute revoked');
 perform pg_temp.assert_true(not has_function_privilege('anon',sig,'execute'),'anon execute revoked');
 perform pg_temp.assert_true(not has_function_privilege('authenticated',sig,'execute'),'authenticated execute revoked');
 perform pg_temp.assert_true(has_function_privilege('service_role',sig,'execute'),'service role execute granted');
end $$;
select 'CPQ_FANVUE_ACCOUNTS_PACKAGES_ASSERTIONS_PASSED' result;
