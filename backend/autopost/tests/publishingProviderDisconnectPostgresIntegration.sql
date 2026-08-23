create or replace function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'ASSERT:%',label;end if;end$$;

insert into auth.users(id,email) values
('a1000000-0000-4000-8000-000000000001','fanvue@example.test'),
('a1000000-0000-4000-8000-000000000002','x@example.test'),
('a1000000-0000-4000-8000-000000000003','other@example.test'),
('a1000000-0000-4000-8000-000000000004','inflight@example.test'),
('a1000000-0000-4000-8000-000000000005','rollback@example.test');

insert into public.autopost_accounts(id,user_id,platform,connection_status,access_token,refresh_token,encrypted_access_token,encrypted_refresh_token,provider_account_id,scopes,metadata) values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','fanvue','CONNECTED','legacy-a','legacy-r','enc-a','enc-r','fv-one','["write:post"]','{}'),
('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','x','CONNECTED','legacy-a','legacy-r','enc-a','enc-r','x-one','[]','{}'),
('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003','x','CONNECTED','other-a','other-r','other-ea','other-er','x-other','[]','{}'),
('a2000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000004','fanvue','CONNECTED',null,null,'flight-a','flight-r','fv-flight','["write:post"]','{}'),
('a2000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000005','x','CONNECTED',null,null,'rollback-a','rollback-r','x-rollback','[]','{}');

insert into public.autopost_rules(id,user_id,selected_platforms,enabled,approval_state,timezone,posts_per_day) values
('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','["x","reddit"]',true,'APPROVED','UTC',1),
('a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','["x"]',true,'APPROVED','UTC',1),
('a3000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000005','["x"]',true,'APPROVED','UTC',1);
insert into public.autopost_jobs(id,rule_id,user_id,scheduled_for,state,platform,locked_at,lock_id) values
('a4000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002',clock_timestamp()+interval '1 hour','QUEUED','x',clock_timestamp(),'x-lock'),
('a4000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003',clock_timestamp()+interval '1 hour','QUEUED','x',null,null),
('a4000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000005',clock_timestamp()+interval '1 hour','QUEUED','x',null,null);

insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason,oauth_account_id) values
('a5000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','fanvue','fv-one','verified','a1000000-0000-4000-8000-000000000001',clock_timestamp(),'fixture','fixture','a2000000-0000-4000-8000-000000000001'),
('a5000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','onlyfans','of-one','verified','a1000000-0000-4000-8000-000000000001',clock_timestamp(),'fixture','fixture',null),
('a5000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000004','fanvue','fv-flight','verified','a1000000-0000-4000-8000-000000000004',clock_timestamp(),'fixture','fixture','a2000000-0000-4000-8000-000000000004');
insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,ai_flag,ai_detail,compliance_status,compliance_policy_version,creator_approval_status,platform_meta) values
('a6000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','fanvue','future','future','ai_generated','{}','passed','test','approved','{}'),
('a6000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000002','onlyfans','unrelated','unrelated','none','{}','passed','test','approved','{}'),
('a6000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','fanvue','published','published','ai_generated','{}','passed','test','approved','{}'),
('a6000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000004','a5000000-0000-4000-8000-000000000004','fanvue','flight','flight','ai_generated','{}','passed','test','approved','{}');
insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version) values
('a7000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','scheduled','mixed-plan',repeat('1',64),'task14.20260711.001'),
('a7000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','completed','history-plan',repeat('2',64),'task14.20260711.001'),
('a7000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000004','in_progress','flight-plan',repeat('4',64),'task14.20260711.001');
alter table public.creator_publishing_platform_jobs disable trigger trg_creator_publishing_fanvue_job_insert_guard;
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,oauth_account_id,publication_type,server_idempotency_key,intended_publish_at,schedule_timezone,scheduled_at,scheduled_by,schedule_revision,attempt_count,lease_token,leased_at,posted_at) values
('a8000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','fanvue','direct','direct_publish_queued',clock_timestamp(),repeat('a',64),'task14.20260711.001',repeat('b',64),'a2000000-0000-4000-8000-000000000001','text','future-one',clock_timestamp()+interval '1 hour','UTC',clock_timestamp(),'a1000000-0000-4000-8000-000000000001',1,1,'aa000000-0000-4000-8000-000000000001',clock_timestamp(),null),
('a8000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000002','onlyfans','assisted','scheduled_internally',clock_timestamp(),repeat('c',64),'task14.20260711.001',repeat('d',64),null,null,null,clock_timestamp()+interval '1 hour','UTC',clock_timestamp(),'a1000000-0000-4000-8000-000000000001',1,0,null,null,null),
('a8000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000001','fanvue','direct','published_direct',clock_timestamp(),repeat('e',64),'task14.20260711.001',repeat('f',64),'a2000000-0000-4000-8000-000000000001','text','published-one',clock_timestamp()-interval '1 hour','UTC',clock_timestamp()-interval '2 hours','a1000000-0000-4000-8000-000000000001',1,1,null,null,clock_timestamp()-interval '1 hour'),
('a8000000-0000-4000-8000-000000000004','a7000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000004','a6000000-0000-4000-8000-000000000004','a5000000-0000-4000-8000-000000000004','fanvue','direct','publishing_direct',clock_timestamp(),repeat('1',64),'task14.20260711.001',repeat('2',64),'a2000000-0000-4000-8000-000000000004','text','flight-one',clock_timestamp(),'UTC',clock_timestamp()-interval '1 hour','a1000000-0000-4000-8000-000000000004',1,1,'aa000000-0000-4000-8000-000000000004',clock_timestamp(),null);
alter table public.creator_publishing_platform_jobs enable trigger trg_creator_publishing_fanvue_job_insert_guard;
insert into public.creator_publishing_fanvue_attempts(id,job_id,creator_id,attempt_ordinal,lease_token,provider_create_dispatched_at) values
('a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',1,'aa000000-0000-4000-8000-000000000001',null),
('a9000000-0000-4000-8000-000000000004','a8000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000004',1,'aa000000-0000-4000-8000-000000000004',clock_timestamp());
insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,due_at) values
('ab000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','fanvue','a5000000-0000-4000-8000-000000000001','scheduled_internally',clock_timestamp()+interval '1 hour');
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,processed_at) values
('ac000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','publish_due','pending',clock_timestamp()+interval '1 hour',1,null),
('ac000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000004','a7000000-0000-4000-8000-000000000004','a8000000-0000-4000-8000-000000000004','publish_due','processed',clock_timestamp(),1,clock_timestamp());

-- ACL is service-only.
begin; set local role authenticated;
do $$begin begin perform public.disconnect_publishing_provider('a1000000-0000-4000-8000-000000000002','x'); raise exception 'authenticated executed disconnect'; exception when insufficient_privilege then null; end;end$$;
rollback;

do $$begin begin perform public.disconnect_publishing_provider('a1000000-0000-4000-8000-000000000002','reddit'); raise exception 'unsupported accepted'; exception when others then if sqlerrm not like '%PUBLISHING_DISCONNECT_ARGUMENT_INVALID%' then raise; end if;end;end$$;
do $$begin begin perform public.disconnect_publishing_provider('ffffffff-0000-4000-8000-000000000000','x'); raise exception 'missing accepted'; exception when others then if sqlerrm not like '%PUBLISHING_ACCOUNT_NOT_FOUND%' then raise; end if;end;end$$;

select public.disconnect_publishing_provider('a1000000-0000-4000-8000-000000000001','fanvue');
select pg_temp.assert_true((select connection_status='REVOKED' and access_token is null and refresh_token is null and encrypted_access_token is null and encrypted_refresh_token is null from public.autopost_accounts where id='a2000000-0000-4000-8000-000000000001'),'fanvue credentials revoked');
select pg_temp.assert_true((select job_state='cancelled' from public.creator_publishing_platform_jobs where id='a8000000-0000-4000-8000-000000000001'),'fanvue future cancelled');
select pg_temp.assert_true((select status='cancelled' from public.creator_publishing_scheduler_events where id='ac000000-0000-4000-8000-000000000001'),'fanvue event cancelled');
select pg_temp.assert_true((select status='archived' from public.creator_publishing_queue_tasks where id='ab000000-0000-4000-8000-000000000001'),'fanvue queue archived');
select pg_temp.assert_true((select finished_at is not null and outcome_class='permanent' from public.creator_publishing_fanvue_attempts where id='a9000000-0000-4000-8000-000000000001'),'fanvue predispatch attempt finished');
select pg_temp.assert_true((select job_state='published_direct' and posted_at is not null from public.creator_publishing_platform_jobs where id='a8000000-0000-4000-8000-000000000003'),'published history preserved');
select pg_temp.assert_true((select job_state='scheduled_internally' from public.creator_publishing_platform_jobs where id='a8000000-0000-4000-8000-000000000002'),'onlyfans untouched');
select pg_temp.assert_true((select status='in_progress' from public.creator_publishing_plans where id='a7000000-0000-4000-8000-000000000001'),'mixed plan reconciled from remaining onlyfans job');
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_audit_events where actor_id='a1000000-0000-4000-8000-000000000001' and action='publishing_provider_disconnected'),'fanvue receipt');

do $$begin begin perform public.disconnect_publishing_provider('a1000000-0000-4000-8000-000000000004','fanvue'); raise exception 'dispatched fanvue accepted'; exception when others then if sqlerrm not like '%PUBLISHING_DISCONNECT_PROVIDER_CREATE_IN_FLIGHT%' then raise; end if;end;end$$;
select pg_temp.assert_true((select connection_status='CONNECTED' and encrypted_access_token='flight-a' from public.autopost_accounts where id='a2000000-0000-4000-8000-000000000004'),'fanvue inflight rollback account');
select pg_temp.assert_true((select job_state='publishing_direct' from public.creator_publishing_platform_jobs where id='a8000000-0000-4000-8000-000000000004'),'fanvue inflight rollback job');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_audit_events where actor_id='a1000000-0000-4000-8000-000000000004' and action='publishing_provider_disconnected'),'fanvue inflight no receipt');

select public.disconnect_publishing_provider('a1000000-0000-4000-8000-000000000002','x');
select pg_temp.assert_true((select connection_status='REVOKED' and encrypted_access_token is null from public.autopost_accounts where id='a2000000-0000-4000-8000-000000000002'),'x revoked');
select pg_temp.assert_true((select state='SKIPPED' and lock_id is null from public.autopost_jobs where id='a4000000-0000-4000-8000-000000000001'),'x queued skipped');
select pg_temp.assert_true((select selected_platforms='["reddit"]'::jsonb and enabled from public.autopost_rules where id='a3000000-0000-4000-8000-000000000001'),'x removed from mixed rule');
select pg_temp.assert_true(not public.autopost_begin_x_dispatch('a1000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000001','x-lock'),'cancelled x cannot begin dispatch');
select pg_temp.assert_true((select connection_status='CONNECTED' and encrypted_access_token='other-ea' from public.autopost_accounts where id='a2000000-0000-4000-8000-000000000003'),'unrelated creator untouched');

do $$begin begin perform public.disconnect_publishing_provider('a1000000-0000-4000-8000-000000000002','x'); raise exception 'repeat accepted'; exception when others then if sqlerrm not like '%PUBLISHING_ACCOUNT_ALREADY_DISCONNECTED%' then raise; end if;end;end$$;
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_audit_events where actor_id='a1000000-0000-4000-8000-000000000002' and action='publishing_provider_disconnected'),'repeat no duplicate receipt');

create function public.test_disconnect_audit_failure() returns trigger language plpgsql as $$begin if new.actor_id='a1000000-0000-4000-8000-000000000005' then raise exception 'INTENTIONAL_AUDIT_FAILURE'; end if; return new; end$$;
create trigger test_disconnect_audit_failure before insert on public.creator_publishing_audit_events for each row execute function public.test_disconnect_audit_failure();
do $$begin begin perform public.disconnect_publishing_provider('a1000000-0000-4000-8000-000000000005','x'); raise exception 'failure trigger ignored'; exception when others then if sqlerrm not like '%INTENTIONAL_AUDIT_FAILURE%' then raise; end if;end;end$$;
select pg_temp.assert_true((select connection_status='CONNECTED' and encrypted_access_token='rollback-a' from public.autopost_accounts where id='a2000000-0000-4000-8000-000000000005'),'atomic rollback credentials');
select pg_temp.assert_true((select state='QUEUED' from public.autopost_jobs where id='a4000000-0000-4000-8000-000000000003'),'atomic rollback job');
drop trigger test_disconnect_audit_failure on public.creator_publishing_audit_events; drop function public.test_disconnect_audit_failure();

-- Fixture consumed by the runner's separate-session deterministic race.
insert into auth.users(id,email) values('a1000000-0000-4000-8000-000000000006','race@example.test');
insert into public.autopost_accounts(id,user_id,platform,connection_status,encrypted_access_token,encrypted_refresh_token,provider_account_id,metadata) values('a2000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000006','x','CONNECTED','race-a','race-r','x-race','{}');
insert into public.autopost_rules(id,user_id,selected_platforms,enabled,approval_state,timezone,posts_per_day) values('a3000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000006','["x"]',true,'APPROVED','UTC',1);
insert into public.autopost_jobs(id,rule_id,user_id,scheduled_for,state,platform,locked_at,lock_id) values('a4000000-0000-4000-8000-000000000006','a3000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000006',clock_timestamp()+interval '1 hour','QUEUED','x',clock_timestamp(),'race-lock');

select 'PUBLISHING_PROVIDER_DISCONNECT_POSTGRES_ASSERTIONS_PASSED';
