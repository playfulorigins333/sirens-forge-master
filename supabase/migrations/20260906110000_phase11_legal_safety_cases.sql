-- Phase 11: privacy-minimized trust, safety, legal, and rights case system.
-- Production application requires separate explicit authorization.
begin;
set local lock_timeout='5s'; set local statement_timeout='60s';

insert into public.admin_roles(role_key,display_name) values ('trust_safety_operator','Trust and safety operator') on conflict do nothing;
insert into public.admin_capabilities(capability_key,description) values
 ('safety.case.read','Read bounded trust and safety cases'),('safety.case.manage','Manage trust and safety case lifecycle') on conflict do nothing;
insert into public.admin_role_capabilities(role_key,capability_key) values
 ('founder_admin','safety.case.read',statement_timestamp()),('founder_admin','safety.case.manage',statement_timestamp()),
 ('trust_safety_operator','safety.case.read',statement_timestamp()),('trust_safety_operator','safety.case.manage',statement_timestamp()) on conflict do nothing;

create sequence public.safety_case_reference_seq;
create table public.safety_cases(
 id uuid primary key default gen_random_uuid(),
 case_reference text not null unique default ('SF-SAF-'||to_char(statement_timestamp(),'YYYYMMDD')||'-'||lpad(nextval('public.safety_case_reference_seq')::text,8,'0')) check(case_reference~'^SF-SAF-[0-9]{8}-[0-9]{8}$'),
 received_at timestamptz not null default statement_timestamp(),
 category text not null check(category in ('GENERAL_COMPLAINT','CONTENT_REMOVAL','NCII','UNAUTHORIZED_INTIMATE_AI','UNDERAGE_EXPLOITATION','LIKENESS_IDENTITY','PRIVACY','COPYRIGHT_DMCA','ACCOUNT_APPEAL','LEGAL_REGULATORY','OTHER_SAFETY')),
 severity text not null check(severity in ('P0','P1','P2','P3')),
 current_state text not null default 'RECEIVED' check(current_state in ('RECEIVED','TRIAGED','INFORMATION_NEEDED','UNDER_REVIEW','ESCALATED','ACTION_PENDING','ACTIONED','NOTIFIED','APPEAL_OR_COUNTERNOTICE','CLOSED')),
 reporter_type text not null check(reporter_type in ('AFFECTED_PERSON','AUTHORIZED_REPRESENTATIVE','PARENT_GUARDIAN','RIGHTS_HOLDER','ACCOUNT_HOLDER','ATTORNEY','LAW_ENFORCEMENT_REGULATOR','WITNESS_OTHER')),
 reporter_user_id uuid references auth.users(id) on delete set null,
 contact_email text check(contact_email is null or char_length(contact_email) between 3 and 254),
 affected_reference text check(affected_reference is null or char_length(affected_reference) between 1 and 500),
 content_url text check(content_url is null or (char_length(content_url) between 8 and 1000 and content_url~'^https?://')),
 description text not null check(char_length(description) between 20 and 4000 and description!~'[[:cntrl:]]'),
 requested_action text check(requested_action is null or (char_length(requested_action) between 1 and 1000 and requested_action!~'[[:cntrl:]]')),
 affected_person_declaration text check(affected_person_declaration is null or affected_person_declaration in ('AFFECTED_PERSON','AUTHORIZED_REPRESENTATIVE')),
 good_faith boolean not null,
 assigned_user_id uuid references auth.users(id) on delete set null,
 reason_code text check(reason_code is null or reason_code in ('SAFETY','UNDERAGE_REPORT','NONCONSENSUAL','LIKENESS','PRIVACY','COPYRIGHT_DMCA','PLATFORM_POLICY','ACCOUNT_APPEAL','LEGAL_PROCESS','INSUFFICIENT_INFORMATION')),
 outcome_summary text check(outcome_summary is null or (char_length(outcome_summary) between 1 and 1000 and outcome_summary!~'[[:cntrl:]]')),
 escalation_reference text check(escalation_reference is null or char_length(escalation_reference) between 1 and 500),
 preservation_required boolean not null default false,
 retention_review_at timestamptz,
 updated_at timestamptz not null default statement_timestamp(), closed_at timestamptz,
 check(category not in ('NCII','UNAUTHORIZED_INTIMATE_AI') or affected_person_declaration is not null)
);
comment on column public.safety_cases.reporter_user_id is 'ON DELETE SET NULL preserves minimum legal/safety evidence when an Auth user is deleted.';
create index safety_cases_queue_idx on public.safety_cases(current_state,severity,updated_at desc,id desc);
create table public.safety_case_activities(
 sequence_no bigint generated always as identity primary key,id uuid not null unique default gen_random_uuid(),
 case_id uuid not null references public.safety_cases(id) on delete restrict,
 actor_user_id uuid references auth.users(id) on delete set null,actor_kind text not null check(actor_kind in ('public_reporter','founder_admin','admin_operator','system')),
 activity_type text not null check(activity_type in ('RECEIVED','STATE_TRANSITION','ASSIGNMENT_CHANGED','DETAIL_ADDED')),
 from_state text,to_state text,reason_code text,reason text check(reason is null or (char_length(reason) between 3 and 1000 and reason!~'[[:cntrl:]]')),
 safe_reference text check(safe_reference is null or char_length(safe_reference) between 1 and 500),created_at timestamptz not null default statement_timestamp()
);
create index safety_case_activity_case_idx on public.safety_case_activities(case_id,sequence_no);

create function public.reject_safety_activity_mutation() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'SAFETY_CHRONOLOGY_APPEND_ONLY';end$$;
create trigger safety_activity_no_update_delete before update or delete on public.safety_case_activities for each row execute function public.reject_safety_activity_mutation();

create function public.create_public_safety_case(p_category text,p_reporter_type text,p_contact_email text,p_affected_reference text,p_content_url text,p_description text,p_requested_action text,p_affected_person_declaration text,p_good_faith boolean) returns text
language plpgsql security definer set search_path=pg_catalog as $$declare v_id uuid;v_ref text;v_severity text;begin
 if p_good_faith is not true then raise exception 'SAFETY_INPUT_INVALID';end if;
 v_severity:=case when p_category='UNDERAGE_EXPLOITATION' then 'P0' when p_category in ('NCII','UNAUTHORIZED_INTIMATE_AI','LIKENESS_IDENTITY') then 'P1' when p_category in ('CONTENT_REMOVAL','PRIVACY','COPYRIGHT_DMCA','ACCOUNT_APPEAL','LEGAL_REGULATORY') then 'P2' else 'P3' end;
 insert into public.safety_cases(category,severity,reporter_type,contact_email,affected_reference,content_url,description,requested_action,affected_person_declaration,good_faith)
 values(p_category,v_severity,p_reporter_type,nullif(btrim(p_contact_email),''),nullif(btrim(p_affected_reference),''),nullif(btrim(p_content_url),''),btrim(p_description),nullif(btrim(p_requested_action),''),p_affected_person_declaration,true) returning id,case_reference into v_id,v_ref;
 insert into public.safety_case_activities(case_id,actor_kind,activity_type,to_state) values(v_id,'public_reporter','RECEIVED','RECEIVED');return v_ref;
exception when check_violation then raise exception 'SAFETY_INPUT_INVALID';end$$;

create function public.list_admin_safety_cases(p_actor_user_id uuid,p_state text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns table(id uuid,case_reference text,category text,severity text,current_state text,received_at timestamptz,updated_at timestamptz,safe_summary text)
language plpgsql volatile security definer set search_path=pg_catalog,extensions as $$declare v_kind text;v_count integer;begin
 if not public.admin_actor_has_capability(p_actor_user_id,'safety.case.read') then raise exception 'PHASE11_ADMIN_REQUIRED';end if;
 if p_limit not between 1 and 50 or ((p_before is null)<>(p_before_id is null)) or (p_state is not null and p_state not in ('RECEIVED','TRIAGED','INFORMATION_NEEDED','UNDER_REVIEW','ESCALATED','ACTION_PENDING','ACTIONED','NOTIFIED','APPEAL_OR_COUNTERNOTICE','CLOSED')) then raise exception 'SAFETY_LIST_INVALID';end if;
 return query select c.id,c.case_reference,c.category,c.severity,c.current_state,c.received_at,c.updated_at,left(c.description,240) from public.safety_cases c where (p_state is null or c.current_state=p_state) and (p_before is null or (c.updated_at,c.id)<(p_before,p_before_id)) order by c.updated_at desc,c.id desc limit p_limit;
 get diagnostics v_count=row_count;v_kind:=case when public.admin_actor_has_active_role(p_actor_user_id,'founder_admin') then 'founder_admin' else 'admin_operator' end;
 perform public.append_governance_audit_event(p_actor_user_id,v_kind,'safety.case.queue_read','safety_case_queue','queue','safety',null,'success',null,null,gen_random_uuid(),null,jsonb_build_object('returned_count',v_count,'state_filter',p_state,'limit',p_limit),'{}'::jsonb,null);
end$$;
create function public.get_admin_safety_case(p_actor_user_id uuid,p_case_ref text) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,extensions as $$declare v_case public.safety_cases;v_kind text;begin
 if not public.admin_actor_has_capability(p_actor_user_id,'safety.case.read') then raise exception 'PHASE11_ADMIN_REQUIRED';end if;select * into v_case from public.safety_cases where case_reference=p_case_ref;if not found then raise exception 'SAFETY_NOT_FOUND';end if;
 v_kind:=case when public.admin_actor_has_active_role(p_actor_user_id,'founder_admin') then 'founder_admin' else 'admin_operator' end;perform public.append_governance_audit_event(p_actor_user_id,v_kind,'safety.case.read','safety_case',v_case.case_reference,'safety',null,'success',null,null,gen_random_uuid(),null,jsonb_build_object('category',v_case.category,'severity',v_case.severity,'state',v_case.current_state),'{}'::jsonb,null);
 return jsonb_build_object('caseReference',v_case.case_reference,'category',v_case.category,'severity',v_case.severity,'state',v_case.current_state,'receivedAt',v_case.received_at,'updatedAt',v_case.updated_at,'reporterType',v_case.reporter_type,'contactEmail',v_case.contact_email,'affectedReference',v_case.affected_reference,'contentUrl',v_case.content_url,'description',v_case.description,'requestedAction',v_case.requested_action,'declaration',v_case.affected_person_declaration,'outcomeSummary',v_case.outcome_summary);
end$$;
create function public.transition_admin_safety_case(p_actor_user_id uuid,p_case_ref text,p_to_state text,p_reason_code text,p_reason text,p_outcome_summary text default null) returns void
language plpgsql security definer set search_path=pg_catalog,extensions as $$declare v public.safety_cases;v_kind text;begin
 if not public.admin_actor_has_capability(p_actor_user_id,'safety.case.manage') then raise exception 'PHASE11_ADMIN_REQUIRED';end if;select * into v from public.safety_cases where case_reference=p_case_ref for update;if not found then raise exception 'SAFETY_NOT_FOUND';end if;
 if (v.current_state,p_to_state) not in (('RECEIVED','TRIAGED'),('TRIAGED','INFORMATION_NEEDED'),('TRIAGED','UNDER_REVIEW'),('TRIAGED','ESCALATED'),('INFORMATION_NEEDED','UNDER_REVIEW'),('INFORMATION_NEEDED','CLOSED'),('UNDER_REVIEW','ESCALATED'),('UNDER_REVIEW','ACTION_PENDING'),('UNDER_REVIEW','NOTIFIED'),('ESCALATED','UNDER_REVIEW'),('ESCALATED','ACTION_PENDING'),('ACTION_PENDING','ACTIONED'),('ACTION_PENDING','UNDER_REVIEW'),('ACTIONED','NOTIFIED'),('NOTIFIED','CLOSED'),('CLOSED','APPEAL_OR_COUNTERNOTICE'),('APPEAL_OR_COUNTERNOTICE','UNDER_REVIEW'),('APPEAL_OR_COUNTERNOTICE','CLOSED')) then raise exception 'SAFETY_TRANSITION_INVALID';end if;
 if p_reason_code not in ('SAFETY','UNDERAGE_REPORT','NONCONSENSUAL','LIKENESS','PRIVACY','COPYRIGHT_DMCA','PLATFORM_POLICY','ACCOUNT_APPEAL','LEGAL_PROCESS','INSUFFICIENT_INFORMATION') or char_length(btrim(p_reason)) not between 3 and 1000 then raise exception 'SAFETY_INPUT_INVALID';end if;
 update public.safety_cases set current_state=p_to_state,reason_code=p_reason_code,outcome_summary=coalesce(nullif(btrim(p_outcome_summary),''),outcome_summary),updated_at=statement_timestamp(),closed_at=case when p_to_state='CLOSED' then statement_timestamp() when v.current_state='CLOSED' then null else closed_at end where id=v.id;
 v_kind:=case when public.admin_actor_has_active_role(p_actor_user_id,'founder_admin') then 'founder_admin' else 'admin_operator' end;insert into public.safety_case_activities(case_id,actor_user_id,actor_kind,activity_type,from_state,to_state,reason_code,reason) values(v.id,p_actor_user_id,v_kind,'STATE_TRANSITION',v.current_state,p_to_state,p_reason_code,btrim(p_reason));
 perform public.append_governance_audit_event(p_actor_user_id,v_kind,'safety.case.state_changed','safety_case',v.case_reference,p_reason_code,null,p_to_state,null,null,gen_random_uuid(),null,jsonb_build_object('from_state',v.current_state,'to_state',p_to_state,'category',v.category,'severity',v.severity),'{}'::jsonb,null);
end$$;

alter table public.safety_cases enable row level security;alter table public.safety_cases force row level security;alter table public.safety_case_activities enable row level security;alter table public.safety_case_activities force row level security;
revoke all on table public.safety_cases,public.safety_case_activities from public,anon,authenticated,service_role;
revoke all on sequence public.safety_case_reference_seq from public,anon,authenticated,service_role;
revoke all on function public.create_public_safety_case(text,text,text,text,text,text,text,text,boolean),public.list_admin_safety_cases(uuid,text,timestamptz,uuid,integer),public.get_admin_safety_case(uuid,text),public.transition_admin_safety_case(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_public_safety_case(text,text,text,text,text,text,text,text,boolean),public.list_admin_safety_cases(uuid,text,timestamptz,uuid,integer),public.get_admin_safety_case(uuid,text),public.transition_admin_safety_case(uuid,text,text,text,text,text) to service_role;
commit;
