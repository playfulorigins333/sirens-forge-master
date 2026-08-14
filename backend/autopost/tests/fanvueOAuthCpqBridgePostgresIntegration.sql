-- Run only against the disposable Gate 4B PostgreSQL database.
create or replace function pg_temp.assert_true(value boolean, label text)
returns void language plpgsql as $$ begin if value is not true then raise exception 'ASSERTION_FAILED:%',label; end if; end $$;
create or replace function pg_temp.expect_error(label text, expected text, statement text)
returns void language plpgsql as $$ begin begin execute statement; raise exception 'EXPECTED_ERROR_NOT_RAISED:%',label; exception when others then if position(expected in sqlerrm)=0 then raise exception 'UNEXPECTED_ERROR:%:%',label,sqlerrm; end if; end; end $$;

insert into auth.users(id,email) values
 ('41111111-1111-4111-8111-111111111111','bridge-one@example.test'),
 ('42222222-2222-4222-8222-222222222222','bridge-two@example.test'),
 ('43333333-3333-4333-8333-333333333333','bridge-delete@example.test'),
 ('44444444-4444-4444-8444-444444444444','bridge-cpq-fail@example.test'),
 ('45555555-5555-4555-8555-555555555555','bridge-oauth-fail@example.test'),
 ('46666666-6666-4666-8666-666666666666','bridge-audit-fail@example.test');

select pg_temp.expect_error('connected identity required','autopost_accounts_connected_fanvue_identity_check',$q$
 insert into public.autopost_accounts(user_id,platform,connection_status) values('41111111-1111-4111-8111-111111111111','fanvue','CONNECTED')$q$);
insert into public.autopost_accounts(user_id,platform,provider_account_id,connection_status)
 values('41111111-1111-4111-8111-111111111111','x','x-original','CONNECTED');
update public.autopost_accounts set provider_account_id='x-changed' where user_id='41111111-1111-4111-8111-111111111111' and platform='x';

select public.creator_publishing_link_fanvue_oauth_account(
 '41111111-1111-4111-8111-111111111111','fanvue-provider-one',null,null,'bearer','["read"]','encrypted-a','encrypted-r',1,null,'{}');
do $$ declare a uuid; d uuid; begin
 select id into a from public.autopost_accounts where user_id='41111111-1111-4111-8111-111111111111' and platform='fanvue';
 select id into d from public.creator_platform_accounts where creator_id='41111111-1111-4111-8111-111111111111' and platform='fanvue';
 perform pg_temp.assert_true(a is not null and d is not null,'initial atomic bridge');
 perform pg_temp.assert_true((select oauth_account_id=a from public.creator_platform_accounts where id=d),'composite link');
 perform pg_temp.assert_true((select platform_username is null from public.creator_platform_accounts where id=d),'nullable Fanvue username');
 perform pg_temp.assert_true((select verification_status='unattested' and verification_reviewed_by is null from public.creator_platform_accounts where id=d),'OAuth separate from review');
 perform pg_temp.assert_true((select after_state::text not like '%encrypted-a%' and after_state::text not like '%encrypted-r%' from public.creator_publishing_audit_events where entity_id=d order by id desc limit 1),'audit has no credentials');
end $$;

-- Same-provider reconnect preserves both IDs and updates credential state.
create temp table bridge_ids as select a.id account_id,d.id destination_id from public.autopost_accounts a join public.creator_platform_accounts d on d.oauth_account_id=a.id where a.user_id='41111111-1111-4111-8111-111111111111' and a.platform='fanvue';
select public.creator_publishing_link_fanvue_oauth_account(
 '41111111-1111-4111-8111-111111111111','fanvue-provider-one','new_handle','New','bearer','["read"]','encrypted-a2','encrypted-r2',1,null,'{}');
do $$ begin
 perform pg_temp.assert_true((select count(*)=1 from public.autopost_accounts where user_id='41111111-1111-4111-8111-111111111111' and platform='fanvue'),'one OAuth row');
 perform pg_temp.assert_true((select count(*)=1 from public.creator_platform_accounts where creator_id='41111111-1111-4111-8111-111111111111' and platform='fanvue'),'one destination');
 perform pg_temp.assert_true((select a.id=b.account_id and d.id=b.destination_id from public.autopost_accounts a join public.creator_platform_accounts d on d.oauth_account_id=a.id cross join bridge_ids b where a.user_id='41111111-1111-4111-8111-111111111111' and a.platform='fanvue'),'IDs reused');
end $$;

select pg_temp.expect_error('different provider','FANVUE_PROVIDER_IDENTITY_CHANGE_REQUIRES_EXPLICIT_RELINK',$q$
 select public.creator_publishing_link_fanvue_oauth_account('41111111-1111-4111-8111-111111111111','fanvue-provider-two','other',null,'bearer','[]','replacement','replacement-r',1,null,'{}')$q$);
do $$ begin
 perform pg_temp.assert_true((select provider_account_id='fanvue-provider-one' and encrypted_access_token='encrypted-a2' from public.autopost_accounts where user_id='41111111-1111-4111-8111-111111111111' and platform='fanvue'),'different-provider rollback');
end $$;
select pg_temp.expect_error('cross user provider','FANVUE_PROVIDER_IDENTITY_ALREADY_LINKED',$q$
 select public.creator_publishing_link_fanvue_oauth_account('42222222-2222-4222-8222-222222222222','fanvue-provider-one','other',null,'bearer','[]','encrypted','encrypted-r',1,null,'{}')$q$);

-- Fail each required write stage and prove the function transaction leaves no partial bridge.
create function pg_temp.fail_cpq_bridge() returns trigger language plpgsql as $$begin raise exception 'SIMULATED_CPQ_FAILURE'; end$$;
create trigger simulate_cpq_failure before insert on public.creator_platform_accounts for each row execute function pg_temp.fail_cpq_bridge();
select pg_temp.expect_error('CPQ rollback','SIMULATED_CPQ_FAILURE',$q$select public.creator_publishing_link_fanvue_oauth_account('44444444-4444-4444-8444-444444444444','fanvue-provider-cpq-fail','fail',null,'bearer','[]','encrypted','encrypted-r',1,null,'{}')$q$);
drop trigger simulate_cpq_failure on public.creator_platform_accounts;
select pg_temp.assert_true(not exists(select 1 from public.autopost_accounts where user_id='44444444-4444-4444-8444-444444444444'),'CPQ failure rolls OAuth back');

create function pg_temp.fail_oauth_bridge() returns trigger language plpgsql as $$begin raise exception 'SIMULATED_OAUTH_FAILURE'; end$$;
create trigger simulate_oauth_failure before insert on public.autopost_accounts for each row execute function pg_temp.fail_oauth_bridge();
select pg_temp.expect_error('OAuth rollback','SIMULATED_OAUTH_FAILURE',$q$select public.creator_publishing_link_fanvue_oauth_account('45555555-5555-4555-8555-555555555555','fanvue-provider-oauth-fail','fail',null,'bearer','[]','encrypted','encrypted-r',1,null,'{}')$q$);
drop trigger simulate_oauth_failure on public.autopost_accounts;
select pg_temp.assert_true(not exists(select 1 from public.creator_platform_accounts where creator_id='45555555-5555-4555-8555-555555555555'),'OAuth failure creates no destination');

create function pg_temp.fail_bridge_audit() returns trigger language plpgsql as $$begin if new.action='fanvue_oauth_destination_linked' then raise exception 'SIMULATED_AUDIT_FAILURE'; end if; return new; end$$;
create trigger simulate_audit_failure before insert on public.creator_publishing_audit_events for each row execute function pg_temp.fail_bridge_audit();
select pg_temp.expect_error('audit rollback','SIMULATED_AUDIT_FAILURE',$q$select public.creator_publishing_link_fanvue_oauth_account('46666666-6666-4666-8666-666666666666','fanvue-provider-audit-fail','fail',null,'bearer','[]','encrypted','encrypted-r',1,null,'{}')$q$);
drop trigger simulate_audit_failure on public.creator_publishing_audit_events;
select pg_temp.assert_true(not exists(select 1 from public.autopost_accounts where user_id='46666666-6666-4666-8666-666666666666'),'audit failure rolls OAuth back');
select pg_temp.assert_true(not exists(select 1 from public.creator_platform_accounts where creator_id='46666666-6666-4666-8666-666666666666'),'audit failure rolls destination back');

select pg_temp.expect_error('identity mutation','FANVUE_PROVIDER_IDENTITY_IMMUTABLE',$q$update public.autopost_accounts set provider_account_id='changed' where user_id='41111111-1111-4111-8111-111111111111' and platform='fanvue'$q$);
select pg_temp.expect_error('identity clear','FANVUE_PROVIDER_IDENTITY_IMMUTABLE',$q$update public.autopost_accounts set provider_account_id=null where user_id='41111111-1111-4111-8111-111111111111' and platform='fanvue'$q$);
update public.autopost_accounts set provider_account_id=provider_account_id, connection_status='REVOKED' where user_id='41111111-1111-4111-8111-111111111111' and platform='fanvue';
select pg_temp.expect_error('revoked reservation','autopost_accounts_fanvue_provider_account_uidx',$q$insert into public.autopost_accounts(user_id,platform,provider_account_id,connection_status) values('42222222-2222-4222-8222-222222222222','fanvue','fanvue-provider-one','REVOKED')$q$);

select pg_temp.expect_error('fanvue link required','creator_platform_accounts_oauth_platform_check',$q$insert into public.creator_platform_accounts(creator_id,platform,platform_username) values('42222222-2222-4222-8222-222222222222','fanvue','handle')$q$);
select pg_temp.expect_error('onlyfans link forbidden','creator_platform_accounts_oauth_platform_check',$q$insert into public.creator_platform_accounts(creator_id,platform,platform_username,oauth_account_id) select '42222222-2222-4222-8222-222222222222','onlyfans','handle',account_id from bridge_ids$q$);
select pg_temp.expect_error('fansly link forbidden','creator_platform_accounts_oauth_platform_check',$q$insert into public.creator_platform_accounts(creator_id,platform,platform_username,oauth_account_id) select '42222222-2222-4222-8222-222222222222','fansly','handle',account_id from bridge_ids$q$);
select pg_temp.expect_error('onlyfans username required','creator_platform_accounts_username_required_check',$q$insert into public.creator_platform_accounts(creator_id,platform,platform_username) values('42222222-2222-4222-8222-222222222222','onlyfans',null)$q$);
select pg_temp.expect_error('fansly username nonblank','creator_platform_accounts_username_required_check',$q$insert into public.creator_platform_accounts(creator_id,platform,platform_username) values('42222222-2222-4222-8222-222222222222','fansly','  ')$q$);
select pg_temp.expect_error('direct OAuth delete blocked','creator_platform_accounts_oauth_owner_fk',$q$delete from public.autopost_accounts where user_id='41111111-1111-4111-8111-111111111111' and platform='fanvue'$q$);

-- A deferred NO ACTION bridge allows both auth-owned rows to cascade in one transaction.
select public.creator_publishing_link_fanvue_oauth_account(
 '43333333-3333-4333-8333-333333333333','fanvue-provider-delete','delete_me',null,'bearer','[]','encrypted','encrypted-r',1,null,'{}');
delete from auth.users where id='43333333-3333-4333-8333-333333333333';
do $$ begin
 perform pg_temp.assert_true(not exists(select 1 from public.autopost_accounts where user_id='43333333-3333-4333-8333-333333333333'),'auth cascade OAuth');
 perform pg_temp.assert_true(not exists(select 1 from public.creator_platform_accounts where creator_id='43333333-3333-4333-8333-333333333333'),'auth cascade destination');
end $$;

do $$ declare sig regprocedure := 'public.creator_publishing_link_fanvue_oauth_account(uuid,text,text,text,text,jsonb,text,text,integer,timestamptz,jsonb)'::regprocedure; begin
 perform pg_temp.assert_true(not has_table_privilege('anon','public.autopost_accounts','select,insert,update,delete,truncate,references,trigger'),'anon table authority removed');
 perform pg_temp.assert_true(not has_table_privilege('authenticated','public.autopost_accounts','select,insert,update,delete,truncate,references,trigger'),'authenticated table authority removed');
 perform pg_temp.assert_true(not has_function_privilege('anon',sig,'execute'),'anon RPC denied');
 perform pg_temp.assert_true(not has_function_privilege('authenticated',sig,'execute'),'authenticated RPC denied');
 perform pg_temp.assert_true(has_function_privilege('service_role',sig,'execute'),'service RPC allowed');
end $$;
