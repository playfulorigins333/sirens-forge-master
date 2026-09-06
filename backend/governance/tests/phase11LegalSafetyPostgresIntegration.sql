\set ON_ERROR_STOP on

-- Capability matrix: only founder and explicitly assigned trust/safety staff.
do $$ begin
 if not public.admin_actor_has_capability('10000000-0000-4000-8000-000000000001','safety.case.read') or not public.admin_actor_has_capability('10000000-0000-4000-8000-000000000001','safety.case.manage') then raise exception 'founder safety capability missing'; end if;
 if public.admin_actor_has_capability('10000000-0000-4000-8000-000000000003','safety.case.read') then raise exception 'creator gained safety authority'; end if;
 if (select count(*) from admin_role_assignments)<>1 then raise exception 'Phase 11 bootstrapped another human'; end if;
 if (select count(*) from admin_role_capabilities where capability_key='support.private_access.authorize')<>1 then raise exception 'private access capability changed'; end if;
end $$;
insert into admin_role_assignments(user_id,role_key) values ('10000000-0000-4000-8000-000000000002','support_operator'),('10000000-0000-4000-8000-000000000004','security_operator');
do $$ begin
 if public.admin_actor_has_capability('10000000-0000-4000-8000-000000000002','safety.case.read') or public.admin_actor_has_capability('10000000-0000-4000-8000-000000000002','safety.case.manage') then raise exception 'support gained safety authority'; end if;
 if public.admin_actor_has_capability('10000000-0000-4000-8000-000000000004','safety.case.read') or public.admin_actor_has_capability('10000000-0000-4000-8000-000000000004','safety.case.manage') then raise exception 'security gained safety authority'; end if;
end $$;
insert into auth.users values('10000000-0000-4000-8000-000000000005');
do $$ begin if public.admin_actor_has_capability('10000000-0000-4000-8000-000000000005','safety.case.read') then raise exception 'unassigned trust actor authorized'; end if; end $$;
insert into admin_role_assignments(user_id,role_key) values('10000000-0000-4000-8000-000000000005','trust_safety_operator');
do $$ begin if not public.admin_actor_has_capability('10000000-0000-4000-8000-000000000005','safety.case.read') or not public.admin_actor_has_capability('10000000-0000-4000-8000-000000000005','safety.case.manage') then raise exception 'assigned trust actor missing capability'; end if; end $$;

-- No browser or service role receives direct table/sequence privileges; service_role receives bounded RPCs.
do $$ declare r text;p text; begin
 foreach r in array array['anon','authenticated','service_role'] loop foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop if has_table_privilege(r,'public.safety_cases',p) or has_table_privilege(r,'public.safety_case_activities',p) then raise exception '% direct % leaked',r,p;end if;end loop;end loop;
 if has_sequence_privilege('anon','public.safety_case_reference_seq','USAGE') or has_sequence_privilege('authenticated','public.safety_case_reference_seq','USAGE') or has_sequence_privilege('service_role','public.safety_case_reference_seq','USAGE') then raise exception 'sequence usage leaked';end if;
 if not has_function_privilege('service_role','public.create_public_safety_case(text,text,text,text,text,text,text,text,boolean)','EXECUTE') or not has_function_privilege('service_role','public.list_admin_safety_case_activities(uuid,text,bigint,integer)','EXECUTE') then raise exception 'bounded service RPC missing';end if;
 if has_function_privilege('anon','public.create_public_safety_case(text,text,text,text,text,text,text,text,boolean)','EXECUTE') or has_function_privilege('authenticated','public.list_admin_safety_cases(uuid,text,timestamptz,uuid,integer)','EXECUTE') then raise exception 'browser RPC leaked';end if;
end $$;

-- Intended server boundary creates valid cases. Synthetic fixtures only.
set role service_role;
create temp table phase11_refs(kind text,ref text);
insert into phase11_refs values('underage',public.create_public_safety_case('UNDERAGE_EXPLOITATION','WITNESS_OTHER','synthetic-reporter@example.invalid','synthetic-asset-a','https://example.invalid/synthetic-a','Synthetic text-only underage allegation for integration testing.',null,null,true));
insert into phase11_refs values('ncii',public.create_public_safety_case('NCII','AFFECTED_PERSON','ncii-synthetic@example.invalid','synthetic-asset-b','https://example.invalid/synthetic-b','Synthetic text-only intimate-content allegation for integration testing.','Review the synthetic reference.','AFFECTED_PERSON',true));
insert into phase11_refs values('ai',public.create_public_safety_case('UNAUTHORIZED_INTIMATE_AI','AUTHORIZED_REPRESENTATIVE',null,'synthetic-asset-c',null,'Synthetic text-only unauthorized AI allegation for integration testing.',null,'AUTHORIZED_REPRESENTATIVE',true));
reset role;
do $$ begin
 if exists(select from phase11_refs where ref!~'^SF-SAF-[0-9]{8}-[0-9]{8}$') then raise exception 'invalid reference shape';end if;
 if (select severity from safety_cases where case_reference=(select ref from phase11_refs where kind='underage'))<>'P0' then raise exception 'underage not P0';end if;
 if (select severity from safety_cases where case_reference=(select ref from phase11_refs where kind='ncii'))<>'P1' then raise exception 'NCII not P1';end if;
end $$;

-- Invalid public inputs fail closed at real constraints/function logic.
do $$ begin
 begin perform create_public_safety_case('BAD','WITNESS_OTHER',null,null,null,'Synthetic description long enough to pass.',null,null,true);raise exception 'bad category accepted';exception when others then if SQLERRM='bad category accepted' then raise;end if;end;
 begin perform create_public_safety_case('GENERAL_COMPLAINT','BAD',null,null,null,'Synthetic description long enough to pass.',null,null,true);raise exception 'bad reporter accepted';exception when others then if SQLERRM='bad reporter accepted' then raise;end if;end;
 begin perform create_public_safety_case('GENERAL_COMPLAINT','WITNESS_OTHER',null,null,null,'Synthetic description long enough to pass.',null,null,false);raise exception 'false good faith accepted';exception when others then if SQLERRM='false good faith accepted' then raise;end if;end;
 begin perform create_public_safety_case('NCII','AFFECTED_PERSON',null,null,null,'Synthetic description long enough to pass.',null,null,true);raise exception 'missing NCII declaration accepted';exception when others then if SQLERRM='missing NCII declaration accepted' then raise;end if;end;
 begin perform create_public_safety_case('GENERAL_COMPLAINT','WITNESS_OTHER',null,null,null,E'Synthetic description with forbidden control\ncharacter.',null,null,true);raise exception 'control accepted';exception when others then if SQLERRM='control accepted' then raise;end if;end;
 begin perform create_public_safety_case('GENERAL_COMPLAINT','WITNESS_OTHER',null,null,null,'too short',null,null,true);raise exception 'short accepted';exception when others then if SQLERRM='short accepted' then raise;end if;end;
 begin perform create_public_safety_case('GENERAL_COMPLAINT','WITNESS_OTHER','invalid-email',null,null,'Synthetic description long enough to pass.',null,null,true);raise exception 'invalid email accepted';exception when others then if SQLERRM='invalid email accepted' then raise;end if;end;
 begin perform create_public_safety_case('GENERAL_COMPLAINT','WITNESS_OTHER',null,E'bad\nreference',null,'Synthetic description long enough to pass.',null,null,true);raise exception 'control reference accepted';exception when others then if SQLERRM='control reference accepted' then raise;end if;end;
end $$;

-- Deterministic composite pagination with tied timestamps.
update safety_cases set updated_at='2026-09-06 10:00:00+00';
create temp table phase11_page1 as select * from list_admin_safety_cases('10000000-0000-4000-8000-000000000001',null,null,null,2);
create temp table phase11_page2 as select * from list_admin_safety_cases('10000000-0000-4000-8000-000000000001',null,(select updated_at from phase11_page1 order by updated_at,id limit 1),(select id from phase11_page1 order by updated_at,id limit 1),2);
do $$ begin if (select count(*) from phase11_page1)<>2 or (select count(*) from phase11_page2)<>1 or exists(select 1 from phase11_page1 join phase11_page2 using(id)) then raise exception 'composite pagination skipped/duplicated';end if;end $$;

-- State graph, required closure outcome, reopen truth, and append-only chronology.
select transition_admin_safety_case('10000000-0000-4000-8000-000000000001',(select ref from phase11_refs where kind='underage'),'TRIAGED','UNDERAGE_REPORT','Synthetic triage completed.',null);
select transition_admin_safety_case('10000000-0000-4000-8000-000000000001',(select ref from phase11_refs where kind='underage'),'UNDER_REVIEW','UNDERAGE_REPORT','Synthetic review started.',null);
select transition_admin_safety_case('10000000-0000-4000-8000-000000000001',(select ref from phase11_refs where kind='underage'),'NOTIFIED','UNDERAGE_REPORT','Synthetic safe notice recorded.',null);
do $$ begin
 begin perform transition_admin_safety_case('10000000-0000-4000-8000-000000000001',(select ref from phase11_refs where kind='underage'),'CLOSED','UNDERAGE_REPORT','Synthetic closure reason.',null);raise exception 'closure without outcome accepted';exception when others then if SQLERRM='closure without outcome accepted' then raise;end if;if position('SAFETY_CLOSURE_OUTCOME_REQUIRED' in SQLERRM)=0 then raise;end if;end;
 begin perform transition_admin_safety_case('10000000-0000-4000-8000-000000000001',(select ref from phase11_refs where kind='ncii'),'CLOSED','NONCONSENSUAL','Illegal jump.', 'Outcome');raise exception 'invalid jump accepted';exception when others then if SQLERRM='invalid jump accepted' then raise;end if;if position('SAFETY_TRANSITION_INVALID' in SQLERRM)=0 then raise;end if;end;
end $$;
select transition_admin_safety_case('10000000-0000-4000-8000-000000000001',(select ref from phase11_refs where kind='underage'),'CLOSED','UNDERAGE_REPORT','Synthetic closure reason.','Closed after synthetic review; no external action performed.');
do $$ begin if not exists(select from safety_cases where case_reference=(select ref from phase11_refs where kind='underage') and closed_at is not null and outcome_summary is not null) then raise exception 'closure projection false';end if;end $$;
select transition_admin_safety_case('10000000-0000-4000-8000-000000000005',(select ref from phase11_refs where kind='underage'),'APPEAL_OR_COUNTERNOTICE','ACCOUNT_APPEAL','Synthetic appeal received.',null);
do $$ begin
 if exists(select from safety_cases where case_reference=(select ref from phase11_refs where kind='underage') and (closed_at is not null or outcome_summary is not null)) then raise exception 'reopen projection retained stale closure';end if;
 if not exists(select from safety_case_activities where case_id=(select id from safety_cases where case_reference=(select ref from phase11_refs where kind='underage')) and to_state='CLOSED' and safe_reference='Closed after synthetic review; no external action performed.') then raise exception 'historical closure outcome missing';end if;
 if (select count(*) from safety_case_activities where case_id=(select id from safety_cases where case_reference=(select ref from phase11_refs where kind='underage')))<>6 then raise exception 'chronology count incorrect';end if;
 if exists(select 1 from (select sequence_no,lag(sequence_no) over(order by sequence_no) prior from safety_case_activities where case_id=(select id from safety_cases where case_reference=(select ref from phase11_refs where kind='underage'))) x where prior is not null and sequence_no<=prior) then raise exception 'chronology order unstable';end if;
 if not exists(select from safety_case_activities where actor_kind='founder_admin') or not exists(select from safety_case_activities where actor_kind='admin_operator') then raise exception 'chronology actor kind false';end if;
end $$;
create temp table phase11_activity_page as select * from list_admin_safety_case_activities('10000000-0000-4000-8000-000000000001',(select ref from phase11_refs where kind='underage'),null,3);
do $$ begin if (select count(*) from phase11_activity_page)<>3 then raise exception 'bounded activity page failed';end if;end $$;
do $$ begin begin update safety_case_activities set reason='forged';raise exception 'chronology update accepted';exception when others then if SQLERRM='chronology update accepted' then raise;end if;if position('SAFETY_CHRONOLOGY_APPEND_ONLY' in SQLERRM)=0 then raise;end if;end;begin delete from safety_case_activities;raise exception 'chronology delete accepted';exception when others then if SQLERRM='chronology delete accepted' then raise;end if;if position('SAFETY_CHRONOLOGY_APPEND_ONLY' in SQLERRM)=0 then raise;end if;end;end $$;

-- Actual referenced Auth deletion clears references and preserves case.
update safety_cases set reporter_user_id='10000000-0000-4000-8000-000000000004',assigned_user_id='10000000-0000-4000-8000-000000000004' where case_reference=(select ref from phase11_refs where kind='ai');
delete from auth.users where id='10000000-0000-4000-8000-000000000004';
do $$ begin if not exists(select from safety_cases where case_reference=(select ref from phase11_refs where kind='ai') and reporter_user_id is null and assigned_user_id is null) then raise exception 'referenced Auth deletion unsafe';end if;end $$;

-- Real governance reads/transitions and minimized, linked hash chain.
select get_admin_safety_case('10000000-0000-4000-8000-000000000001',(select ref from phase11_refs where kind='ncii'));
select * from list_admin_safety_cases('10000000-0000-4000-8000-000000000005',null,null,null,10);
select transition_admin_safety_case('10000000-0000-4000-8000-000000000005',(select ref from phase11_refs where kind='ncii'),'TRIAGED','NONCONSENSUAL','Synthetic trust operator triage.',null);
do $$ declare combined text;begin
 if not exists(select from governance_audit_events where action='safety.case.queue_read' and actor_type='founder_admin') then raise exception 'founder queue audit missing';end if;
 if not exists(select from governance_audit_events where action='safety.case.queue_read' and actor_type='admin_operator' and actor_user_id='10000000-0000-4000-8000-000000000005') then raise exception 'operator queue audit false';end if;
 if not exists(select from governance_audit_events where action='safety.case.read') or not exists(select from governance_audit_events where action='safety.case.chronology_read') or not exists(select from governance_audit_events where action='safety.case.state_changed') then raise exception 'case audit missing';end if;
 select string_agg(coalesce(facts::text,'')||coalesce(reference_hashes::text,'')||coalesce(reason,''),' ') into combined from governance_audit_events where action like 'safety.case.%';
 if combined like '%synthetic-reporter@example.invalid%' or combined like '%Synthetic text-only intimate-content allegation%' or combined like '%https://example.invalid/synthetic-b%' or combined like '%Review the synthetic reference%' then raise exception 'private report data leaked to governance';end if;
 if exists(select 1 from (select sequence_no,previous_event_hash,lag(event_hash) over(order by sequence_no) expected from governance_audit_events) q where (expected is null and previous_event_hash is not null) or (expected is not null and previous_event_hash is distinct from expected)) then raise exception 'audit hash chain linkage invalid';end if;
 if exists(select from governance_audit_events where event_hash!~'^[0-9a-f]{64}$') then raise exception 'audit hash malformed';end if;
end $$;
