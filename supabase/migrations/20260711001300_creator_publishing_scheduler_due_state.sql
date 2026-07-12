-- Task 15: platform-neutral Creator Publishing scheduler and due-state engine.
-- Forward-only additive migration. Do not apply automatically; do not edit migrations 00100-01200.
create extension if not exists pgcrypto with schema extensions;

alter table public.creator_publishing_platform_jobs
  add column if not exists intended_publish_at timestamptz,
  add column if not exists schedule_timezone text,
  add column if not exists operator_due_at timestamptz,
  add column if not exists schedule_revision integer,
  add column if not exists scheduled_at timestamptz,
  add column if not exists scheduled_by uuid references auth.users(id) on delete set null,
  add column if not exists rescheduled_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text;

alter table public.creator_publishing_platform_jobs
  add constraint creator_publishing_jobs_schedule_timezone_required check (intended_publish_at is null or length(btrim(coalesce(schedule_timezone,''))) > 0),
  add constraint creator_publishing_jobs_assisted_operator_due_required check (not (publishing_mode = 'assisted' and job_state in ('scheduled_internally','awaiting_operator','due_now','claimed') and operator_due_at is null)),
  add constraint creator_publishing_jobs_operator_due_before_publish check (operator_due_at is null or intended_publish_at is null or operator_due_at <= intended_publish_at),
  add constraint creator_publishing_jobs_schedule_revision_positive check (schedule_revision is null or schedule_revision > 0),
  add constraint creator_publishing_jobs_cancelled_metadata_consistent check ((cancelled_at is null and cancelled_by is null and cancellation_reason is null) or (cancelled_at is not null and cancelled_by is not null and length(btrim(coalesce(cancellation_reason,''))) between 1 and 500));

create table if not exists public.creator_publishing_schedule_idempotency (
  creator_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (creator_id, idempotency_key)
);

create table if not exists public.creator_publishing_scheduler_events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null,
  publishing_plan_id uuid not null,
  platform_job_id uuid not null,
  event_type text not null check (event_type in ('operator_due','publish_due')),
  due_at timestamptz not null,
  schedule_revision integer not null check (schedule_revision > 0),
  event_status text not null default 'pending' check (event_status in ('pending','processing','processed','blocked','superseded','cancelled')),
  processing_attempts integer not null default 0 check (processing_attempts >= 0),
  lock_token uuid,
  locked_at timestamptz,
  processed_at timestamptz,
  superseded_at timestamptz,
  cancelled_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_publishing_scheduler_plan_creator_fk foreign key (publishing_plan_id, creator_id) references public.creator_publishing_plans(id, creator_id) on delete cascade,
  constraint creator_publishing_scheduler_job_plan_creator_fk foreign key (platform_job_id, publishing_plan_id, creator_id) references public.creator_publishing_platform_jobs(id, publishing_plan_id, creator_id) on delete cascade,
  constraint creator_publishing_scheduler_event_unique unique (platform_job_id, event_type, schedule_revision),
  constraint creator_publishing_scheduler_final_metadata check (
    (event_status <> 'processed' or processed_at is not null) and
    (event_status <> 'superseded' or superseded_at is not null) and
    (event_status <> 'cancelled' or cancelled_at is not null)
  )
);
create unique index if not exists creator_publishing_scheduler_active_uidx on public.creator_publishing_scheduler_events(platform_job_id,event_type,schedule_revision) where event_status in ('pending','processing');
create index if not exists creator_publishing_scheduler_due_idx on public.creator_publishing_scheduler_events(event_status,due_at,id);

drop trigger if exists trg_creator_publishing_scheduler_events_updated_at on public.creator_publishing_scheduler_events;
create trigger trg_creator_publishing_scheduler_events_updated_at before update on public.creator_publishing_scheduler_events for each row execute function public.set_updated_at();

alter table public.creator_publishing_scheduler_events enable row level security;
alter table public.creator_publishing_schedule_idempotency enable row level security;
revoke all on table public.creator_publishing_scheduler_events from public, anon, authenticated;
revoke all on table public.creator_publishing_schedule_idempotency from public, anon, authenticated;
grant select on table public.creator_publishing_scheduler_events to authenticated;
grant all on table public.creator_publishing_scheduler_events to service_role;
grant all on table public.creator_publishing_schedule_idempotency to service_role;
create policy creator_publishing_scheduler_events_creator_read on public.creator_publishing_scheduler_events for select to authenticated using (creator_id = auth.uid());

create or replace function public.creator_publishing_recalculate_plan_status(p_plan_id uuid) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text; begin
  select public.creator_publishing_aggregate_plan_status(p_plan_id) into v_status;
  update public.creator_publishing_plans set status=v_status, updated_at=now() where id=p_plan_id and status <> 'cancelled';
  return v_status;
end; $$;

create or replace function public.creator_publishing_schedule_plan(p_creator_id uuid,p_publishing_plan_id uuid,p_intended_publish_at timestamptz,p_schedule_timezone text,p_idempotency_key text,p_expected_schedule_revision integer default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=now(); v_key text:=btrim(coalesce(p_idempotency_key,'')); v_plan public.creator_publishing_plans%rowtype; v_fingerprint text; v_existing record; v_results jsonb:='[]'::jsonb; v_audits jsonb:='[]'::jsonb; j record; v_rev int; v_state text; v_operator_due timestamptz; v_event_ids jsonb; v_audit bigint; v_canonical jsonb;
begin
 if p_creator_id is null then raise exception 'UNAUTHENTICATED'; end if; if v_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'IDEMPOTENCY_CONFLICT'; end if; if p_intended_publish_at is null or length(btrim(coalesce(p_schedule_timezone,'')))=0 then raise exception 'INVALID_SCHEDULE_REQUEST'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_creator_id::text||':schedule:'||v_key,0));
 select * into v_plan from public.creator_publishing_plans where id=p_publishing_plan_id and creator_id=p_creator_id for update; if not found then raise exception 'PLAN_NOT_FOUND'; end if;
 v_canonical:=jsonb_build_object('creator_id',p_creator_id,'plan_id',p_publishing_plan_id,'intended_publish_at',p_intended_publish_at,'schedule_timezone',p_schedule_timezone,'expected_schedule_revision',p_expected_schedule_revision,'lead_minutes',60,'jobs',(select jsonb_agg(jsonb_build_object('job_id',id,'mode',publishing_mode,'registry_version',capability_registry_version,'fingerprint',source_package_fingerprint) order by id) from public.creator_publishing_platform_jobs where publishing_plan_id=p_publishing_plan_id and creator_id=p_creator_id));
 v_fingerprint:=encode(extensions.digest(v_canonical::text,'sha256'),'hex'); select * into v_existing from public.creator_publishing_schedule_idempotency where creator_id=p_creator_id and idempotency_key=v_key for update; if found then if v_existing.request_fingerprint<>v_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing.result; end if;
 for j in select j.*,c.availability_status,c.connector_can_publish_immediately,c.human_operator_queue_supported from public.creator_publishing_platform_jobs j join public.creator_publishing_platform_capabilities c on c.platform=j.target_platform where j.publishing_plan_id=p_publishing_plan_id and j.creator_id=p_creator_id order by j.id for update loop
   v_event_ids:='[]'::jsonb; v_operator_due:=case when j.publishing_mode='assisted' then p_intended_publish_at - interval '60 minutes' else null end;
   if j.job_state in ('published_direct','confirmed_posted_manual','exported','direct_publish_failed','failed_manual_upload','skipped','blocked','platform_rejected','archived') then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',j.id,'ok',false,'code','TERMINAL_JOB')); continue; end if;
   if p_expected_schedule_revision is not null and coalesce(j.schedule_revision,0)<>p_expected_schedule_revision then raise exception 'STALE_SCHEDULE_REVISION'; end if;
   if j.target_platform='fanvue' or j.availability_status <> 'available' or j.publishing_mode='disabled' then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',j.id,'ok',false,'code','PLATFORM_UNAVAILABLE')); continue; end if;
   if not public.creator_publishing_job_source_is_current(j.id) then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',j.id,'ok',false,'code','STALE_SOURCE_FINGERPRINT')); continue; end if;
   if j.publishing_mode='assisted' and v_operator_due <= v_now then v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',j.id,'ok',false,'code','ASSISTED_LEAD_TIME_REQUIRED')); continue; end if;
   v_rev:=coalesce(j.schedule_revision,0)+1; v_state:=case j.publishing_mode when 'assisted' then 'scheduled_internally' when 'direct' then 'ready_to_publish' when 'planner' then 'package_ready' else 'draft' end;
   update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now,lock_token=null,locked_at=null where platform_job_id=j.id and event_status in ('pending','processing');
   update public.creator_publishing_platform_jobs set intended_publish_at=p_intended_publish_at,schedule_timezone=p_schedule_timezone,operator_due_at=v_operator_due,schedule_revision=v_rev,scheduled_at=coalesce(scheduled_at,v_now),scheduled_by=coalesce(scheduled_by,p_creator_id),rescheduled_at=case when j.schedule_revision is null then rescheduled_at else v_now end,job_state=v_state,updated_at=v_now where id=j.id;
   if j.publishing_mode='assisted' then insert into public.creator_publishing_scheduler_events(creator_id,publishing_plan_id,platform_job_id,event_type,due_at,schedule_revision) values(p_creator_id,j.publishing_plan_id,j.id,'operator_due',v_operator_due,v_rev) returning to_jsonb(id) into v_event_ids; end if;
   insert into public.creator_publishing_scheduler_events(creator_id,publishing_plan_id,platform_job_id,event_type,due_at,schedule_revision) values(p_creator_id,j.publishing_plan_id,j.id,'publish_due',p_intended_publish_at,v_rev) returning coalesce(v_event_ids,'[]'::jsonb)||to_jsonb(id) into v_event_ids;
   insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,idempotency_key,created_at) values('creator_publishing_platform_job',j.id,p_creator_id,'creator',case when j.schedule_revision is null then 'creator_publishing_job_scheduled' else 'creator_publishing_job_rescheduled' end,jsonb_build_object('job_state',j.job_state,'schedule_revision',j.schedule_revision),jsonb_build_object('job_state',v_state,'schedule_revision',v_rev,'scheduler_event_ids',v_event_ids),v_key,v_now) returning id into v_audit;
   v_audits:=v_audits||to_jsonb(v_audit::text); v_results:=v_results||jsonb_build_array(jsonb_build_object('jobId',j.id,'ok',true,'jobState',v_state,'scheduleRevision',v_rev,'operatorDueAt',v_operator_due,'schedulerEventIds',v_event_ids,'auditEventId',v_audit::text));
 end loop;
 perform public.creator_publishing_recalculate_plan_status(p_publishing_plan_id);
 v_canonical:=jsonb_build_object('ok',true,'planId',p_publishing_plan_id,'results',v_results,'auditEventIds',v_audits,'idempotent',false); insert into public.creator_publishing_schedule_idempotency values(p_creator_id,v_key,v_fingerprint,v_canonical,v_now); return v_canonical;
end; $$;

create or replace function public.creator_publishing_cancel_schedule(p_creator_id uuid,p_publishing_plan_id uuid,p_platform_job_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=now(); v_reason text:=btrim(coalesce(p_reason,'')); v_count int:=0; j record; v_audit bigint; begin
 if length(v_reason) not between 1 and 500 then raise exception 'CANCELLATION_REASON_REQUIRED'; end if;
 perform 1 from public.creator_publishing_plans where id=p_publishing_plan_id and creator_id=p_creator_id for update; if not found then raise exception 'PLAN_NOT_FOUND'; end if;
 for j in select * from public.creator_publishing_platform_jobs where publishing_plan_id=p_publishing_plan_id and creator_id=p_creator_id and (p_platform_job_id is null or id=p_platform_job_id) order by id for update loop
  if j.job_state not in ('published_direct','confirmed_posted_manual','exported') then update public.creator_publishing_platform_jobs set job_state='archived',cancelled_at=v_now,cancelled_by=p_creator_id,cancellation_reason=v_reason,updated_at=v_now where id=j.id; update public.creator_publishing_scheduler_events set event_status='cancelled',cancelled_at=v_now,lock_token=null,locked_at=null where platform_job_id=j.id and event_status in ('pending','processing'); insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_platform_job',j.id,p_creator_id,'creator','creator_publishing_job_cancelled',jsonb_build_object('job_state',j.job_state),jsonb_build_object('job_state','archived','reason',v_reason),v_now) returning id into v_audit; v_count:=v_count+1; end if;
 end loop;
 if p_platform_job_id is null then update public.creator_publishing_plans set status='cancelled',cancelled_at=v_now,cancelled_by=p_creator_id,cancellation_reason=v_reason,updated_at=v_now where id=p_publishing_plan_id; insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_plan',p_publishing_plan_id,p_creator_id,'creator','creator_publishing_plan_cancelled',null,jsonb_build_object('status','cancelled','reason',v_reason),v_now); else perform public.creator_publishing_recalculate_plan_status(p_publishing_plan_id); end if;
 return jsonb_build_object('ok',true,'planId',p_publishing_plan_id,'jobId',p_platform_job_id,'cancelledJobs',v_count);
end; $$;

create or replace function public.creator_publishing_claim_due_scheduler_events(p_limit integer default 25,p_lock_minutes integer default 15)
returns setof public.creator_publishing_scheduler_events language sql security definer set search_path=public,pg_temp as $$
 with due as (select id from public.creator_publishing_scheduler_events where due_at <= now() and (event_status='pending' or (event_status='processing' and locked_at < now() - make_interval(mins=>p_lock_minutes))) order by due_at,id for update skip locked limit least(greatest(coalesce(p_limit,25),1),50)), upd as (update public.creator_publishing_scheduler_events e set event_status='processing', lock_token=gen_random_uuid(), locked_at=now(), processing_attempts=processing_attempts+1 from due where e.id=due.id returning e.*) select * from upd order by due_at,id;
$$;

create or replace function public.creator_publishing_process_scheduler_event(p_event_id uuid,p_lock_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.creator_publishing_scheduler_events%rowtype; j public.creator_publishing_platform_jobs%rowtype; c public.creator_publishing_platform_capabilities%rowtype; v_state text; v_now timestamptz:=now(); begin
 select * into e from public.creator_publishing_scheduler_events where id=p_event_id and lock_token=p_lock_token and event_status='processing' for update; if not found then return jsonb_build_object('ok',true,'skipped',true); end if;
 select * into j from public.creator_publishing_platform_jobs where id=e.platform_job_id for update; if not found or j.schedule_revision<>e.schedule_revision then update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now where id=e.id; return jsonb_build_object('ok',true,'skipped',true,'code','REVISION_SUPERSEDED'); end if;
 select * into c from public.creator_publishing_platform_capabilities where platform=j.target_platform;
 if not public.creator_publishing_job_source_is_current(j.id) or c.availability_status<>'available' or j.target_platform='fanvue' then update public.creator_publishing_platform_jobs set job_state=case when c.availability_status='available' then 'needs_fix' else 'blocked' end, updated_at=v_now where id=j.id; update public.creator_publishing_scheduler_events set event_status='blocked',processed_at=v_now,last_error_code='CURRENT_GATES_BLOCKED' where id=e.id; update public.creator_publishing_scheduler_events set event_status='superseded',superseded_at=v_now where platform_job_id=j.id and schedule_revision=e.schedule_revision and event_status in ('pending','processing') and id<>e.id; perform public.creator_publishing_recalculate_plan_status(j.publishing_plan_id); return jsonb_build_object('ok',false,'blocked',true,'code','CURRENT_GATES_BLOCKED'); end if;
 v_state:=case when e.event_type='operator_due' and j.publishing_mode='assisted' then 'awaiting_operator' when e.event_type='publish_due' and j.publishing_mode='assisted' then 'due_now' when e.event_type='publish_due' and j.publishing_mode='direct' and c.connector_can_publish_immediately then 'direct_publish_queued' when e.event_type='publish_due' and j.publishing_mode='planner' then 'ready_for_export' else null end;
 if v_state is null then update public.creator_publishing_scheduler_events set event_status='blocked',processed_at=v_now,last_error_code='UNSUPPORTED_DUE_TRANSITION' where id=e.id; return jsonb_build_object('ok',false,'blocked',true,'code','UNSUPPORTED_DUE_TRANSITION'); end if;
 update public.creator_publishing_platform_jobs set job_state=v_state,updated_at=v_now where id=j.id and job_state not in ('published_direct','confirmed_posted_manual','exported'); update public.creator_publishing_scheduler_events set event_status='processed',processed_at=v_now where id=e.id; insert into public.creator_publishing_audit_events(entity_type,entity_id,actor_role,action,before_state,after_state,created_at) values('creator_publishing_platform_job',j.id,'system','creator_publishing_due_state_transition_completed',jsonb_build_object('job_state',j.job_state),jsonb_build_object('job_state',v_state,'event_id',e.id),v_now); perform public.creator_publishing_recalculate_plan_status(j.publishing_plan_id); return jsonb_build_object('ok',true,'processed',true,'jobState',v_state);
end; $$;

revoke all on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,integer) from public, anon, authenticated;
revoke all on function public.creator_publishing_cancel_schedule(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.creator_publishing_claim_due_scheduler_events(integer,integer) from public, anon, authenticated;
revoke all on function public.creator_publishing_process_scheduler_event(uuid,uuid) from public, anon, authenticated;
grant execute on function public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,integer) to service_role;
grant execute on function public.creator_publishing_cancel_schedule(uuid,uuid,uuid,text) to service_role;
grant execute on function public.creator_publishing_claim_due_scheduler_events(integer,integer) to service_role;
grant execute on function public.creator_publishing_process_scheduler_event(uuid,uuid) to service_role;
