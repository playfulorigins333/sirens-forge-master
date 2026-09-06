\set ON_ERROR_STOP on

-- Founder bootstrap and capability matrix.
do $$ begin
  if not public.admin_actor_has_active_role('10000000-0000-4000-8000-000000000001','founder_admin') then raise exception 'founder bootstrap missing'; end if;
  if not public.admin_actor_has_capability('10000000-0000-4000-8000-000000000001','governance.legal_hold.manage') then raise exception 'founder capability missing'; end if;
  if public.admin_actor_has_capability('10000000-0000-4000-8000-000000000002','support.case.read') then raise exception 'ordinary user received admin capability'; end if;
end $$;

-- Separate support and security operators receive only their intended capabilities.
insert into public.admin_role_assignments(user_id,role_key) values
 ('10000000-0000-4000-8000-000000000002','support_operator'),
 ('10000000-0000-4000-8000-000000000004','security_operator');
do $$ begin
  if not public.admin_actor_has_capability('10000000-0000-4000-8000-000000000002','support.case.manage') then raise exception 'support operator missing support capability'; end if;
  if public.admin_actor_has_capability('10000000-0000-4000-8000-000000000002','governance.legal_hold.manage') then raise exception 'support operator gained legal hold capability'; end if;
  if not public.admin_actor_has_capability('10000000-0000-4000-8000-000000000004','governance.audit.read') then raise exception 'security operator missing audit capability'; end if;
  if public.admin_actor_has_capability('10000000-0000-4000-8000-000000000004','support.case.manage') then raise exception 'security operator gained support mutation capability'; end if;
end $$;

-- Direct privileged table access remains denied.
do $$ begin
  if has_table_privilege('anon','public.admin_role_assignments','SELECT') or has_table_privilege('authenticated','public.admin_role_assignments','SELECT') or has_table_privilege('service_role','public.admin_role_assignments','SELECT') then raise exception 'authority table select leaked'; end if;
  if has_table_privilege('anon','public.support_cases','SELECT') or has_table_privilege('authenticated','public.support_cases','SELECT') or has_table_privilege('service_role','public.support_cases','SELECT') then raise exception 'support table select leaked'; end if;
  if not has_function_privilege('service_role','public.admin_actor_has_capability(uuid,text)','EXECUTE') then raise exception 'bounded capability RPC missing'; end if;
  if has_function_privilege('anon','public.admin_actor_has_capability(uuid,text)','EXECUTE') or has_function_privilege('authenticated','public.admin_actor_has_capability(uuid,text)','EXECUTE') then raise exception 'capability RPC leaked'; end if;
end $$;

-- Creator ownership and same-timestamp composite pagination.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.create_own_support_case('technical','first support case');
select public.create_own_support_case('technical','second support case');
reset role;
update public.support_cases set opened_at='2026-09-06 08:00:00+00',updated_at='2026-09-06 08:00:00+00' where creator_user_id='10000000-0000-4000-8000-000000000003';

-- Create both cursor pages as the authenticated role so the second query can read
-- the first temporary relation while still exercising the real creator RPC grant.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
create temp table phase10_creator_page1 as
select * from public.list_own_support_cases(null,null,1);
create temp table phase10_creator_page2 as
select * from public.list_own_support_cases(
 (select opened_at from phase10_creator_page1 limit 1),
 (select id from phase10_creator_page1 limit 1),1
);
reset role;
do $$ begin
 if (select count(*) from phase10_creator_page1)<>1 or (select count(*) from phase10_creator_page2)<>1 then raise exception 'creator pagination skipped row'; end if;
 if exists(select 1 from phase10_creator_page1 p1 join phase10_creator_page2 p2 using(id)) then raise exception 'creator pagination duplicated row'; end if;
end $$;

-- Support operator can transition and produces truthful admin_operator audit evidence.
select public.transition_admin_support_case(
 '10000000-0000-4000-8000-000000000002',
 (select id from public.support_cases where creator_user_id='10000000-0000-4000-8000-000000000003' order by id limit 1),
 'in_progress','working case'
);
do $$ begin
 if not exists(select 1 from public.governance_audit_events where actor_user_id='10000000-0000-4000-8000-000000000002' and actor_type='admin_operator' and action='support.case.status_changed') then raise exception 'support operator audit evidence missing'; end if;
end $$;

-- Resolution and reopening maintain coherent resolved_at state.
select public.transition_admin_support_case(
 '10000000-0000-4000-8000-000000000002',
 (select id from public.support_cases where status='in_progress' limit 1),'resolved','resolved'
);
do $$ begin if not exists(select 1 from public.support_cases where status='resolved' and resolved_at is not null) then raise exception 'resolved_at not set'; end if; end $$;
select public.transition_admin_support_case(
 '10000000-0000-4000-8000-000000000002',
 (select id from public.support_cases where status='resolved' limit 1),'in_progress','reopened'
);
do $$ begin if exists(select 1 from public.support_cases where status='in_progress' and resolved_at is not null) then raise exception 'resolved_at survived reopen'; end if; end $$;

-- Governance reads are bounded/minimized and the privileged read audits itself.
select public.append_governance_audit_event('10000000-0000-4000-8000-000000000001','founder_admin','phase10.test.event','test_target','one','test',null,'success',null,null,gen_random_uuid(),null,'{}'::jsonb,'{}'::jsonb,null);
create temp table phase10_audit_page as select * from public.list_governance_audit_events('10000000-0000-4000-8000-000000000001',null,10,null,null,null);
do $$ begin
 if not exists(select 1 from public.governance_audit_events where actor_user_id='10000000-0000-4000-8000-000000000001' and action='governance.audit.read') then raise exception 'audit read did not audit itself'; end if;
 if exists(select 1 from information_schema.columns where table_name='phase10_audit_page' and column_name in ('facts','reference_hashes','reason')) then raise exception 'audit read exposed private columns'; end if;
end $$;

-- A security operator may read minimized audit evidence and is truthfully logged as admin_operator.
select * from public.list_governance_audit_events('10000000-0000-4000-8000-000000000004',null,1,null,null,null);
do $$ begin
 if not exists(select 1 from public.governance_audit_events where actor_user_id='10000000-0000-4000-8000-000000000004' and actor_type='admin_operator' and action='governance.audit.read') then raise exception 'security operator audit read evidence missing'; end if;
end $$;

-- Creator support records and non-founder role assignments must not block final Auth deletion.
delete from auth.users where id='10000000-0000-4000-8000-000000000003';
do $$ begin if exists(select 1 from public.support_cases where creator_user_id='10000000-0000-4000-8000-000000000003') then raise exception 'support case survived final auth deletion'; end if; end $$;
delete from auth.users where id='10000000-0000-4000-8000-000000000002';
do $$ begin
 if exists(select 1 from public.admin_role_assignments where user_id='10000000-0000-4000-8000-000000000002') then raise exception 'admin assignment blocked/survived auth deletion'; end if;
 if public.admin_actor_has_capability('10000000-0000-4000-8000-000000000002','support.case.manage') then raise exception 'deleted auth actor retained authority'; end if;
 if not exists(select 1 from public.governance_audit_events where actor_user_id='10000000-0000-4000-8000-000000000002' and action='support.case.status_changed') then raise exception 'durable audit evidence was erased'; end if;
end $$;

-- Founder remains protected by the pre-existing sole-production-admin guard; Phase 10 does not weaken it.
do $$ begin
 begin
   delete from auth.users where id='10000000-0000-4000-8000-000000000001';
   raise exception 'founder protection unexpectedly allowed deletion';
 exception when foreign_key_violation then null;
 end;
end $$;
