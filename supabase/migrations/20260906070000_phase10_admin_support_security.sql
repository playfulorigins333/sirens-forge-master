-- Phase 10: durable human-admin authority, bounded audited governance reads, and support cases.
-- Production application requires separate explicit authorization.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null references public.admin_roles(role_key) on delete restrict,
  active_from timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check (revoked_at is null or revoked_at >= active_from)
);
create unique index admin_role_assignments_one_active_idx on public.admin_role_assignments(user_id,role_key) where revoked_at is null;

insert into public.admin_roles(role_key,display_name) values
 ('founder_admin','Founder administrator'),
 ('support_operator','Support operator'),
 ('security_operator','Security operator');
insert into public.admin_capabilities(capability_key,description) values
 ('governance.audit.read','Read minimized governance audit metadata'),
 ('governance.legal_hold.manage','Manage governance legal holds'),
 ('support.case.read','Read the bounded support queue'),
 ('support.case.manage','Manage support case lifecycle and notes'),
 ('support.private_access.authorize','Authorize case-bound private-content troubleshooting');
insert into public.admin_role_capabilities(role_key,capability_key)
select 'founder_admin', capability_key from public.admin_capabilities;
insert into public.admin_role_capabilities values
 ('support_operator','support.case.read',statement_timestamp()),
 ('support_operator','support.case.manage',statement_timestamp()),
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

-- Phase 10 adds a truthful human admin-operator audit type without changing existing actor semantics.
alter table public.governance_audit_events drop constraint governance_audit_actor_type_check;
alter table public.governance_audit_events add constraint governance_audit_actor_type_check
  check (actor_type in ('creator','founder_admin','admin_operator','system','service'));
alter table public.governance_audit_events drop constraint governance_audit_actor_identity_check;
alter table public.governance_audit_events add constraint governance_audit_actor_identity_check
  check (actor_type in ('system','service') or actor_user_id is not null);

create or replace function public.append_governance_audit_event(
  p_actor_user_id uuid,
  p_actor_type text,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason_category text,
  p_reason text,
  p_result text,
  p_policy_version text,
  p_form_version text,
  p_correlation_id uuid,
  p_request_id text,
  p_facts jsonb,
  p_reference_hashes jsonb,
  p_correction_of uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_now timestamptz := statement_timestamp();
  v_previous_hash text;
  v_event_hash text;
  v_payload jsonb;
begin
  if p_actor_type not in ('creator','founder_admin','admin_operator','system','service') then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_actor_type in ('creator','founder_admin','admin_operator') and p_actor_user_id is null then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_actor_user_id is not null and not exists(select 1 from auth.users where id=p_actor_user_id) then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_actor_type='founder_admin' and not public.governance_actor_is_founder_admin(p_actor_user_id) then raise exception 'GOVERNANCE_AUDIT_ADMIN_REQUIRED'; end if;
  if p_actor_type='admin_operator' and not exists(
    select 1 from public.admin_role_assignments a
    where a.user_id=p_actor_user_id and a.active_from<=statement_timestamp() and a.revoked_at is null
  ) then raise exception 'GOVERNANCE_AUDIT_ADMIN_REQUIRED'; end if;
  if coalesce(p_action,'') !~ '^[a-z0-9][a-z0-9_.:-]{2,119}$' then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if coalesce(p_target_type,'') !~ '^[a-z0-9][a-z0-9_]{2,79}$' then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if char_length(coalesce(p_target_id,'')) not between 1 and 200 or p_target_id ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if char_length(coalesce(p_result,'')) not between 1 and 80 or p_result ~ '[[:cntrl:]]' then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_correlation_id is null then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_reason_category is not null and (char_length(p_reason_category) not between 1 and 80 or p_reason_category ~ '[[:cntrl:]]') then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_reason is not null and (char_length(p_reason) not between 1 and 1000 or p_reason ~ '[[:cntrl:]]') then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_request_id is not null and (char_length(p_request_id) not between 1 and 200 or p_request_id ~ '[[:cntrl:]]') then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_policy_version is not null and char_length(p_policy_version) not between 1 and 120 then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if p_form_version is not null and char_length(p_form_version) not between 1 and 120 then raise exception 'GOVERNANCE_AUDIT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_facts,'{}'::jsonb))<>'object'
     or octet_length(coalesce(p_facts,'{}'::jsonb)::text)>8192
     or public.governance_jsonb_has_forbidden_private_key(coalesce(p_facts,'{}'::jsonb)) then
    raise exception 'GOVERNANCE_AUDIT_PRIVATE_CONTENT_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_reference_hashes,'{}'::jsonb))<>'object'
     or octet_length(coalesce(p_reference_hashes,'{}'::jsonb)::text)>8192
     or public.governance_jsonb_has_forbidden_private_key(coalesce(p_reference_hashes,'{}'::jsonb)) then
    raise exception 'GOVERNANCE_AUDIT_PRIVATE_CONTENT_FORBIDDEN';
  end if;
  if p_correction_of is not null and not exists(select 1 from public.governance_audit_events where id=p_correction_of) then raise exception 'GOVERNANCE_AUDIT_CORRECTION_TARGET_NOT_FOUND'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase8_governance_audit_chain_v1',0));
  select event_hash into v_previous_hash from public.governance_audit_events order by sequence_no desc limit 1;
  v_payload := jsonb_build_object(
    'id',v_id,'actor_user_id',p_actor_user_id,'actor_type',p_actor_type,'action',p_action,
    'target_type',p_target_type,'target_id',p_target_id,'occurred_at',v_now,
    'reason_category',p_reason_category,'reason',p_reason,'result',p_result,
    'policy_version',p_policy_version,'form_version',p_form_version,
    'correlation_id',p_correlation_id,'request_id',p_request_id,
    'facts',coalesce(p_facts,'{}'::jsonb),'reference_hashes',coalesce(p_reference_hashes,'{}'::jsonb),
    'correction_of',p_correction_of,'previous_event_hash',v_previous_hash
  );
  v_event_hash := encode(extensions.digest(coalesce(v_previous_hash,'') || '|' || v_payload::text,'sha256'),'hex');
  insert into public.governance_audit_events(
    id,actor_user_id,actor_type,action,target_type,target_id,occurred_at,
    reason_category,reason,result,policy_version,form_version,correlation_id,
    request_id,facts,reference_hashes,correction_of,previous_event_hash,event_hash,created_at
  ) values (
    v_id,p_actor_user_id,p_actor_type,p_action,p_target_type,p_target_id,v_now,
    p_reason_category,p_reason,p_result,p_policy_version,p_form_version,p_correlation_id,
    p_request_id,coalesce(p_facts,'{}'::jsonb),coalesce(p_reference_hashes,'{}'::jsonb),
    p_correction_of,v_previous_hash,v_event_hash,v_now
  );
  return v_id;
end;
$$;

create or replace function public.list_governance_audit_events(
 p_actor_user_id uuid,p_before_sequence bigint default null,p_limit integer default 50,
 p_action text default null,p_target_type text default null,p_actor_type text default null)
returns table(sequence_no bigint,id uuid,actor_type text,action text,target_type text,target_id text,occurred_at timestamptz,reason_category text,result text,correlation_id uuid)
language plpgsql volatile security definer set search_path=pg_catalog,extensions as $$
declare v_actor_type text; v_returned integer;
begin
 if not public.admin_actor_has_capability(p_actor_user_id,'governance.audit.read') then raise exception 'PHASE10_ADMIN_REQUIRED'; end if;
 if p_limit not between 1 and 100 or (p_before_sequence is not null and p_before_sequence<1)
 or (p_action is not null and p_action !~ '^[a-z0-9][a-z0-9_.:-]{2,119}$')
 or (p_target_type is not null and p_target_type !~ '^[a-z0-9][a-z0-9_]{2,79}$')
 or (p_actor_type is not null and p_actor_type not in ('creator','founder_admin','admin_operator','system','service')) then raise exception 'PHASE10_AUDIT_FILTER_INVALID'; end if;
 return query select e.sequence_no,e.id,e.actor_type,e.action,e.target_type,e.target_id,e.occurred_at,e.reason_category,e.result,e.correlation_id
 from public.governance_audit_events e where (p_before_sequence is null or e.sequence_no<p_before_sequence)
 and (p_action is null or e.action=p_action) and (p_target_type is null or e.target_type=p_target_type) and (p_actor_type is null or e.actor_type=p_actor_type)
 order by e.sequence_no desc limit p_limit;
 get diagnostics v_returned = row_count;
 v_actor_type := case when public.admin_actor_has_active_role(p_actor_user_id,'founder_admin') then 'founder_admin' else 'admin_operator' end;
 perform public.append_governance_audit_event(
   p_actor_user_id,v_actor_type,'governance.audit.read','governance_audit','events',
   'governance_review',null,'success',null,null,gen_random_uuid(),null,
   jsonb_strip_nulls(jsonb_build_object(
     'before_sequence',p_before_sequence,'limit',p_limit,'returned_count',v_returned,
     'action_filter',p_action,'target_type_filter',p_target_type,'actor_type_filter',p_actor_type
   )),'{}'::jsonb,null
 );
end $$;

create table public.support_cases (
 id uuid primary key default gen_random_uuid(),
 creator_user_id uuid not null references auth.users(id) on delete cascade,
 category text not null check(category in ('account','security','generation','technical','other')),
 summary text not null check(char_length(summary) between 3 and 500 and summary !~ '[[:cntrl:]]'),
 status text not null default 'open' check(status in ('open','in_progress','waiting_for_creator','resolved','closed')),
 priority text not null default 'normal' check(priority in ('normal','high','urgent')),
 assigned_user_id uuid references auth.users(id) on delete set null,
 opened_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 resolved_at timestamptz
);
create index support_cases_creator_idx on public.support_cases(creator_user_id,opened_at desc,id desc);
create index support_cases_queue_idx on public.support_cases(status,updated_at desc,id desc);
create table public.support_case_activities (
 sequence_no bigint generated always as identity primary key,
 id uuid not null unique default gen_random_uuid(),
 case_id uuid not null references public.support_cases(id) on delete cascade,
 actor_user_id uuid references auth.users(id) on delete set null,
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

create or replace function public.list_own_support_cases(p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns table(id uuid,category text,summary text,status text,priority text,opened_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_user uuid:=auth.uid(); begin
 if v_user is null or p_limit not between 1 and 50 or ((p_before is null) <> (p_before_id is null)) then raise exception 'SUPPORT_LIST_INVALID'; end if;
 return query select c.id,c.category,c.summary,c.status,c.priority,c.opened_at,c.updated_at from public.support_cases c
 where c.creator_user_id=v_user and (p_before is null or (c.opened_at,c.id)<(p_before,p_before_id))
 order by c.opened_at desc,c.id desc limit p_limit;
end $$;

create or replace function public.list_admin_support_cases(p_actor_user_id uuid,p_status text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns table(id uuid,creator_user_id uuid,category text,summary text,status text,priority text,assigned_user_id uuid,opened_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog as $$ begin
 if not public.admin_actor_has_capability(p_actor_user_id,'support.case.read') then raise exception 'PHASE10_ADMIN_REQUIRED'; end if;
 if p_limit not between 1 and 50 or ((p_before is null) <> (p_before_id is null))
 or (p_status is not null and p_status not in ('open','in_progress','waiting_for_creator','resolved','closed')) then raise exception 'SUPPORT_LIST_INVALID'; end if;
 return query select c.id,c.creator_user_id,c.category,c.summary,c.status,c.priority,c.assigned_user_id,c.opened_at,c.updated_at from public.support_cases c
 where (p_status is null or c.status=p_status) and (p_before is null or (c.updated_at,c.id)<(p_before,p_before_id))
 order by c.updated_at desc,c.id desc limit p_limit;
end $$;

create or replace function public.transition_admin_support_case(p_actor_user_id uuid,p_case_id uuid,p_status text,p_note text default null) returns void
language plpgsql security definer set search_path=pg_catalog,extensions as $$
declare v_old text; v_subject uuid; v_actor_type text; begin
 if not public.admin_actor_has_capability(p_actor_user_id,'support.case.manage') then raise exception 'PHASE10_ADMIN_REQUIRED'; end if;
 if p_status not in ('open','in_progress','waiting_for_creator','resolved','closed') or (p_note is not null and (char_length(btrim(p_note)) not between 1 and 1000 or p_note ~ '[[:cntrl:]]')) then raise exception 'SUPPORT_INPUT_INVALID'; end if;
 select status,creator_user_id into v_old,v_subject from public.support_cases where id=p_case_id for update; if not found then raise exception 'SUPPORT_NOT_FOUND'; end if;
 if (v_old,p_status) not in (('open','in_progress'),('open','closed'),('in_progress','waiting_for_creator'),('in_progress','resolved'),('waiting_for_creator','in_progress'),('waiting_for_creator','resolved'),('resolved','closed'),('resolved','in_progress')) then raise exception 'SUPPORT_TRANSITION_INVALID'; end if;
 update public.support_cases set status=p_status,updated_at=statement_timestamp(),
   resolved_at=case when p_status='resolved' then statement_timestamp() when v_old='resolved' and p_status<>'resolved' then null else resolved_at end
 where id=p_case_id;
 insert into public.support_case_activities(case_id,actor_user_id,actor_kind,activity_type,message,from_status,to_status)
 values(p_case_id,p_actor_user_id,'staff','status_changed',nullif(btrim(p_note),''),v_old,p_status);
 v_actor_type := case when public.admin_actor_has_active_role(p_actor_user_id,'founder_admin') then 'founder_admin' else 'admin_operator' end;
 perform public.append_governance_audit_event(p_actor_user_id,v_actor_type,'support.case.status_changed','support_case',p_case_id::text,'technical_support',null,p_status,null,null,gen_random_uuid(),null,jsonb_build_object('from_status',v_old,'to_status',p_status,'subject_user_id',v_subject),'{}'::jsonb,null);
end $$;

alter table public.admin_roles enable row level security; alter table public.admin_roles force row level security;
alter table public.admin_capabilities enable row level security; alter table public.admin_capabilities force row level security;
alter table public.admin_role_capabilities enable row level security; alter table public.admin_role_capabilities force row level security;
alter table public.admin_role_assignments enable row level security; alter table public.admin_role_assignments force row level security;
alter table public.support_cases enable row level security; alter table public.support_cases force row level security;
alter table public.support_case_activities enable row level security; alter table public.support_case_activities force row level security;
revoke all on table public.admin_roles,public.admin_capabilities,public.admin_role_capabilities,public.admin_role_assignments,public.support_cases,public.support_case_activities from public,anon,authenticated,service_role;
revoke all on function public.admin_actor_has_active_role(uuid,text),public.admin_actor_has_capability(uuid,text),public.list_governance_audit_events(uuid,bigint,integer,text,text,text),public.create_own_support_case(text,text),public.list_own_support_cases(timestamptz,uuid,integer),public.list_admin_support_cases(uuid,text,timestamptz,uuid,integer),public.transition_admin_support_case(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.append_governance_audit_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.append_governance_audit_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb,jsonb,uuid) to service_role;
grant execute on function public.create_own_support_case(text,text),public.list_own_support_cases(timestamptz,uuid,integer) to authenticated;
grant execute on function public.admin_actor_has_capability(uuid,text),public.list_governance_audit_events(uuid,bigint,integer,text,text,text),public.list_admin_support_cases(uuid,text,timestamptz,uuid,integer),public.transition_admin_support_case(uuid,uuid,text,text) to service_role;
alter function public.admin_actor_has_active_role(uuid,text) owner to postgres;
alter function public.admin_actor_has_capability(uuid,text) owner to postgres;
alter function public.governance_actor_is_founder_admin(uuid) owner to postgres;
alter function public.append_governance_audit_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb,jsonb,uuid) owner to postgres;
alter function public.list_governance_audit_events(uuid,bigint,integer,text,text,text) owner to postgres;
alter function public.create_own_support_case(text,text) owner to postgres;
alter function public.list_own_support_cases(timestamptz,uuid,integer) owner to postgres;
alter function public.list_admin_support_cases(uuid,text,timestamptz,uuid,integer) owner to postgres;
alter function public.transition_admin_support_case(uuid,uuid,text,text) owner to postgres;
select pg_notify('pgrst','reload schema');
commit;
