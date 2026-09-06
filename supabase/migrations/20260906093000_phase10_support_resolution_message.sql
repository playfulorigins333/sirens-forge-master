-- Phase 10 hotfix: creator-visible support resolution messages.
-- Production application requires separate explicit authorization.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.support_cases
  add column resolution_message text
  check (
    resolution_message is null
    or (
      char_length(resolution_message) between 3 and 1000
      and resolution_message !~ '[[:cntrl:]]'
    )
  );

drop function public.list_own_support_cases(timestamptz,uuid,integer);
create function public.list_own_support_cases(
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 25
)
returns table(
  id uuid,
  category text,
  summary text,
  status text,
  priority text,
  opened_at timestamptz,
  updated_at timestamptz,
  resolution_message text
)
language plpgsql
stable
security definer
set search_path=pg_catalog
as $$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null or p_limit not between 1 and 50 or ((p_before is null) <> (p_before_id is null)) then
    raise exception 'SUPPORT_LIST_INVALID';
  end if;
  return query
    select c.id,c.category,c.summary,c.status,c.priority,c.opened_at,c.updated_at,c.resolution_message
    from public.support_cases c
    where c.creator_user_id=v_user
      and (p_before is null or (c.opened_at,c.id)<(p_before,p_before_id))
    order by c.opened_at desc,c.id desc
    limit p_limit;
end $$;

create or replace function public.transition_admin_support_case(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_status text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path=pg_catalog,extensions
as $$
declare
  v_old text;
  v_subject uuid;
  v_actor_type text;
begin
  if not public.admin_actor_has_capability(p_actor_user_id,'support.case.manage') then
    raise exception 'PHASE10_ADMIN_REQUIRED';
  end if;
  if p_status not in ('open','in_progress','waiting_for_creator','resolved','closed') then
    raise exception 'SUPPORT_INPUT_INVALID';
  end if;
  if p_status='resolved' then
    if p_note is null
       or char_length(btrim(p_note)) not between 3 and 1000
       or p_note ~ '[[:cntrl:]]' then
      raise exception 'SUPPORT_RESOLUTION_MESSAGE_REQUIRED';
    end if;
  elsif p_note is not null then
    raise exception 'SUPPORT_INPUT_INVALID';
  end if;

  select status,creator_user_id into v_old,v_subject
  from public.support_cases
  where id=p_case_id
  for update;
  if not found then raise exception 'SUPPORT_NOT_FOUND'; end if;

  if (v_old,p_status) not in (
    ('open','in_progress'),('open','closed'),
    ('in_progress','waiting_for_creator'),('in_progress','resolved'),
    ('waiting_for_creator','in_progress'),('waiting_for_creator','resolved'),
    ('resolved','closed'),('resolved','in_progress')
  ) then
    raise exception 'SUPPORT_TRANSITION_INVALID';
  end if;

  update public.support_cases
  set status=p_status,
      updated_at=statement_timestamp(),
      resolved_at=case
        when p_status='resolved' then statement_timestamp()
        when v_old='resolved' and p_status<>'resolved' then null
        else resolved_at
      end,
      resolution_message=case
        when p_status='resolved' then btrim(p_note)
        when v_old='resolved' and p_status='in_progress' then null
        else resolution_message
      end
  where id=p_case_id;

  insert into public.support_case_activities(
    case_id,actor_user_id,actor_kind,activity_type,message,from_status,to_status
  ) values(
    p_case_id,p_actor_user_id,'staff','status_changed',
    case when p_status='resolved' then btrim(p_note) else null end,
    v_old,p_status
  );

  v_actor_type := case
    when public.admin_actor_has_active_role(p_actor_user_id,'founder_admin') then 'founder_admin'
    else 'admin_operator'
  end;
  perform public.append_governance_audit_event(
    p_actor_user_id,v_actor_type,'support.case.status_changed','support_case',p_case_id::text,
    'technical_support',null,p_status,null,null,gen_random_uuid(),null,
    jsonb_build_object('from_status',v_old,'to_status',p_status,'subject_user_id',v_subject),
    '{}'::jsonb,null
  );
end $$;

revoke all on function public.list_own_support_cases(timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_own_support_cases(timestamptz,uuid,integer) to authenticated;
revoke all on function public.transition_admin_support_case(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.transition_admin_support_case(uuid,uuid,text,text) to service_role;
alter function public.list_own_support_cases(timestamptz,uuid,integer) owner to postgres;
alter function public.transition_admin_support_case(uuid,uuid,text,text) owner to postgres;
select pg_notify('pgrst','reload schema');
commit;
