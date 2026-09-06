-- Phase 10: durable human-admin authority, bounded governance reads, and support cases.
begin;

create table public.admin_roles (
  role_key text primary key check (role_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  display_name text not null check (char_length(display_name) between 3 and 80),
  created_at timestamptz not null default statement_timestamp()
);
create table public.admin_capabilities (
  capability_key text primary key check (capability_key ~ '^[a-z][a-z0-9_.]{2,79}$'),
  description text not null check (char_length(description) between 3 and 200),
  created_at timestamptz not null default statement_timestamp()
);
create table public.admin_role_capabilities (
  role_key text not null references public.admin_roles(role_key) on delete restrict,
  capability_key text not null references public.admin_capabilities(capability_key) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key(role_key, capability_key)
);
create table public.admin_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  role_key text not null references public.admin_roles(role_key) on delete restrict,
  active_from timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check (revoked_at is null or revoked_at >= active_from)
);
create unique index admin_role_assignments_one_active_idx on public.admin_role_assignments(user_id,role_key) where revoked_at is null;

insert into public.admin_roles(role_key,display_name) values
 ('founder_admin','Founder administrator'),('support_operator','Support operator'),('security_operator','Security operator');
insert into public.admin_capabilities(capability_key,description) values
 ('governance.audit.read','Read minimized governance audit metadata'),
 ('governance.legal_hold.manage','Manage governance legal holds'),
 ('support.case.read','Read the bounded support queue'),
 ('support.case.manage','Manage support case lifecycle and notes'),
 ('support.private_access.authorize','Authorize case-bound private-content troubleshooting'),
 ('security.events.read','Read security-relevant audit metadata');
insert into public.admin_role_capabilities(role_key,capability_key)
select 'founder_admin', capability_key from public.admin_capabilities;
insert into public.admin_role_capabilities values
 ('support_operator','support.case.read',statement_timestamp()),
 ('support_operator','support.case.manage',statement_timestamp()),
 ('security_operator','security.events.read',statement_timestamp()),
 ('security_operator','governance.audit.read',statement_timestamp());

-- Abort rather than guessing when the Phase 8 bootstrap evidence is not exactly one valid Auth user.
do $$
declare v_count integer; v_valid_count integer; v_user uuid;
begin
  select count(*) into v_count from public.account_deletion_protected_subjects s
  where s.reason='sole_production_admin_guard';
  select count(*), (array_agg(s.auth_user_id))[1] into v_valid_count,v_user
  from public.account_deletion_protected_subjects s join auth.users u on u.id=s.auth_user_id
  where s.reason='sole_production_admin_guard';
  if v_count <> 1 or v_valid_count <> 1 then raise exception 'PHASE10_FOUNDER_BOOTSTRAP_INVALID'; end if;
  insert into public.admin_role_assignments(user_id,role_key) values(v_user,'founder_admin') on conflict do nothing;
end $$;

create or replace function public.admin_actor_has_active_role(p_actor_user_id uuid,p_role_key text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_actor_user_id is not null and p_role_key ~ '^[a-z][a-z0-9_]{2,63}$'
 and exists(select 1 from auth.users u join public.admin_role_assignments a on a.user_id=u.id
   where u.id=p_actor_user_id and a.role_key=p_role_key and a.active_from<=statement_timestamp() and a.revoked_at is null)
$$;
create or replace function public.admin_actor_has_capability(p_actor_user_id uuid,p_capability_key text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_actor_user_id is not null and p_capability_key ~ '^[a-z][a-z0-9_.]{2,79}$'
 and exists(select 1 from auth.users u join public.admin_role_assignments a on a.user_id=u.id
 join public.admin_role_capabilities rc on rc.role_key=a.role_key
 where u.id=p_actor_user_id and rc.capability_key=p_capability_key and a.active_from<=statement_timestamp() and a.revoked_at is null)
$$;
create or replace function public.governance_actor_is_founder_admin(p_actor_user_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select public.admin_actor_has_active_role(p_actor_user_id,'founder_admin')
$$;

create or replace function public.list_governance_audit_events(
 p_actor_user_id uuid,p_before_sequence bigint default null,p_limit integer default 50,
 p_action text default null,p_target_type text default null,p_actor_type text default null)
returns table(sequence_no bigint,id uuid,actor_type text,action text,target_type text,target_id text,occurred_at timestamptz,reason_category text,result text,correlation_id uuid)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not public.admin_actor_has_capability(p_actor_user_id,'governance.audit.read') then raise exception 'PHASE10_ADMIN_REQUIRED'; end if;
 if p_limit not between 1 and 100 or (p_before_sequence is not null and p_before_sequence<1)
 or (p_action is not null and p_action !~ '^[a-z0-9][a-z0-9_.:-]{2,119}$')
 or (p_target_type is not null and p_target_type !~ '^[a-z0-9][a-z0-9_]{2,79}$')
 or (p_actor_type is not null and p_actor_type not in ('creator','founder_admin','system','service')) then raise exception 'PHASE10_AUDIT_FILTER_INVALID'; end if;
 return query select e.sequence_no,e.id,e.actor_type,e.action,e.target_type,e.target_id,e.occurred_at,e.reason_category,e.result,e.correlation_id
 from public.governance_audit_events e where (p_before_sequence is null or e.sequence_no<p_before_sequence)
 and (p_action is null or e.action=p_action) and (p_target_type is null or e.target_type=p_target_type) and (p_actor_type is null or e.actor_type=p_actor_type)
 order by e.sequence_no desc limit p_limit;
end $$;

create table public.support_cases (
 id uuid primary key default gen_random_uuid(), creator_user_id uuid not null references auth.users(id) on delete restrict,
 category text not null check(category in ('account','security','generation','technical','other')),
 summary text not null check(char_length(summary) between 3 and 500 and summary !~ '[[:cntrl:]]'),
 status text not null default 'open' check(status in ('open','in_progress','waiting_for_creator','resolved','closed')),
 priority text not null default 'normal' check(priority in ('normal','high','urgent')),
 assigned_user_id uuid references auth.users(id) on delete restrict,
 opened_at timestamptz not null default statement_timestamp(),updated_at timestamptz not null default statement_timestamp(),resolved_at timestamptz
);
create index support_cases_creator_idx on public.support_cases(creator_user_id,opened_at desc,id desc);
create index support_cases_queue_idx on public.support_cases(status,updated_at desc,id desc);
create table public.support_case_activities (
 sequence_no bigint generated always as identity primary key,id uuid not null unique default gen_random_uuid(),
 case_id uuid not null references public.support_cases(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 actor_kind text not null check(actor_kind in ('creator','staff')),
 activity_type text not null check(activity_type in ('created','creator_message','staff_note','status_changed','assigned','private_access_authorized')),
 message text check(message is null or (char_length(message) between 1 and 1000 and message !~ '[[:cntrl:]]')),
 from_status text,to_status text,created_at timestamptz not null default statement_timestamp()
);
create index support_case_activities_case_idx on public.support_case_activities(case_id,sequence_no desc);

create or replace function public.create_own_support_case(p_category text,p_summary text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
 if v_user is null or not exists(select 1 from auth.users where id=v_user) then raise exception 'SUPPORT_UNAUTHENTICATED'; end if;
 insert into public.support_cases(creator_user_id,category,summary) values(v_user,p_category,btrim(p_summary)) returning id into v_id;
 insert into public.support_case_activities(case_id,actor_user_id,actor_kind,activity_type) values(v_id,v_user,'creator','created'); return v_id;
exception when check_violation then raise exception 'SUPPORT_INPUT_INVALID'; end $$;
create or replace function public.list_own_support_cases(p_before timestamptz default null,p_limit integer default 25)
returns table(id uuid,category text,summary text,status text,priority text,opened_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_user uuid:=auth.uid(); begin
 if v_user is null or p_limit not between 1 and 50 then raise exception 'SUPPORT_LIST_INVALID'; end if;
 return query select c.id,c.category,c.summary,c.status,c.priority,c.opened_at,c.updated_at from public.support_cases c
 where c.creator_user_id=v_user and (p_before is null or c.opened_at<p_before) order by c.opened_at desc,c.id desc limit p_limit;
end $$;
create or replace function public.list_admin_support_cases(p_actor_user_id uuid,p_status text default null,p_before timestamptz default null,p_limit integer default 25)
returns table(id uuid,creator_user_id uuid,category text,summary text,status text,priority text,assigned_user_id uuid,opened_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog as $$ begin
 if not public.admin_actor_has_capability(p_actor_user_id,'support.case.read') then raise exception 'PHASE10_ADMIN_REQUIRED'; end if;
 if p_limit not between 1 and 50 or (p_status is not null and p_status not in ('open','in_progress','waiting_for_creator','resolved','closed')) then raise exception 'SUPPORT_LIST_INVALID'; end if;
 return query select c.id,c.creator_user_id,c.category,c.summary,c.status,c.priority,c.assigned_user_id,c.opened_at,c.updated_at from public.support_cases c
 where (p_status is null or c.status=p_status) and (p_before is null or c.updated_at<p_before) order by c.updated_at desc,c.id desc limit p_limit;
end $$;
create or replace function public.transition_admin_support_case(p_actor_user_id uuid,p_case_id uuid,p_status text,p_note text default null) returns void
language plpgsql security definer set search_path=pg_catalog,extensions as $$
declare v_old text; v_subject uuid; begin
 if not public.admin_actor_has_capability(p_actor_user_id,'support.case.manage') then raise exception 'PHASE10_ADMIN_REQUIRED'; end if;
 if p_status not in ('open','in_progress','waiting_for_creator','resolved','closed') or (p_note is not null and (char_length(btrim(p_note)) not between 1 and 1000 or p_note ~ '[[:cntrl:]]')) then raise exception 'SUPPORT_INPUT_INVALID'; end if;
 select status,creator_user_id into v_old,v_subject from public.support_cases where id=p_case_id for update; if not found then raise exception 'SUPPORT_NOT_FOUND'; end if;
 if (v_old,p_status) not in (('open','in_progress'),('open','closed'),('in_progress','waiting_for_creator'),('in_progress','resolved'),('waiting_for_creator','in_progress'),('waiting_for_creator','resolved'),('resolved','closed'),('resolved','in_progress')) then raise exception 'SUPPORT_TRANSITION_INVALID'; end if;
 update public.support_cases set status=p_status,updated_at=statement_timestamp(),resolved_at=case when p_status='resolved' then statement_timestamp() else resolved_at end where id=p_case_id;
 insert into public.support_case_activities(case_id,actor_user_id,actor_kind,activity_type,message,from_status,to_status) values(p_case_id,p_actor_user_id,'staff','status_changed',nullif(btrim(p_note),''),v_old,p_status);
 perform public.append_governance_audit_event(p_actor_user_id,'founder_admin','support.case.status_changed','support_case',p_case_id::text,'technical_support',null,p_status,null,null,gen_random_uuid(),null,jsonb_build_object('from_status',v_old,'to_status',p_status,'subject_user_id',v_subject), '{}'::jsonb,null);
end $$;

-- Every privileged table is RPC-only. Creator RPCs derive auth.uid(); staff RPCs re-check DB authority.
alter table public.admin_roles enable row level security; alter table public.admin_roles force row level security;
alter table public.admin_capabilities enable row level security; alter table public.admin_capabilities force row level security;
alter table public.admin_role_capabilities enable row level security; alter table public.admin_role_capabilities force row level security;
alter table public.admin_role_assignments enable row level security; alter table public.admin_role_assignments force row level security;
alter table public.support_cases enable row level security; alter table public.support_cases force row level security;
alter table public.support_case_activities enable row level security; alter table public.support_case_activities force row level security;
revoke all on table public.admin_roles,public.admin_capabilities,public.admin_role_capabilities,public.admin_role_assignments,public.support_cases,public.support_case_activities from public,anon,authenticated,service_role;
revoke all on function public.admin_actor_has_active_role(uuid,text),public.admin_actor_has_capability(uuid,text),public.list_governance_audit_events(uuid,bigint,integer,text,text,text),public.create_own_support_case(text,text),public.list_own_support_cases(timestamptz,integer),public.list_admin_support_cases(uuid,text,timestamptz,integer),public.transition_admin_support_case(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_own_support_case(text,text),public.list_own_support_cases(timestamptz,integer) to authenticated;
grant execute on function public.admin_actor_has_capability(uuid,text),public.list_governance_audit_events(uuid,bigint,integer,text,text,text),public.list_admin_support_cases(uuid,text,timestamptz,integer),public.transition_admin_support_case(uuid,uuid,text,text) to service_role;
alter function public.admin_actor_has_active_role(uuid,text) owner to postgres; alter function public.admin_actor_has_capability(uuid,text) owner to postgres;
alter function public.governance_actor_is_founder_admin(uuid) owner to postgres; alter function public.list_governance_audit_events(uuid,bigint,integer,text,text,text) owner to postgres;
alter function public.create_own_support_case(text,text) owner to postgres; alter function public.list_own_support_cases(timestamptz,integer) owner to postgres;
alter function public.list_admin_support_cases(uuid,text,timestamptz,integer) owner to postgres; alter function public.transition_admin_support_case(uuid,uuid,text,text) owner to postgres;
commit;
