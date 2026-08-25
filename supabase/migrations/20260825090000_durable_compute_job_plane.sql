begin;
create extension if not exists pgcrypto;
create type public.compute_workload as enum ('trainer','image','video','stitch');
create type public.compute_job_state as enum ('queued','claimed','running','recovering','cancel_requested','succeeded','failed','cancelled');
create type public.compute_cost_event_kind as enum ('reservation','actual','release','correction');

create table public.compute_scheduler_policies (
 workload public.compute_workload primary key, max_global_active integer not null check(max_global_active>0),
 lease_seconds integer not null check(lease_seconds between 15 and 86400), stale_seconds integer not null check(stale_seconds>=lease_seconds),
 max_attempts smallint not null check(max_attempts between 1 and 20), og_priority_seconds integer not null check(og_priority_seconds>=0),
 warm_grace_seconds integer not null default 0 check(warm_grace_seconds>=0), enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.compute_spend_policies (
 id uuid primary key default gen_random_uuid(), version integer not null unique check(version>0), effective_from timestamptz not null,
 effective_until timestamptz, daily_limit_micros bigint not null check(daily_limit_micros>0), monthly_limit_micros bigint not null check(monthly_limit_micros>0),
 video_job_limit_micros bigint not null check(video_job_limit_micros>0), currency text not null default 'USD' check(currency='USD'), enabled boolean not null default false,
 check(effective_until is null or effective_until>effective_from)
);
create table public.compute_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete restrict,
 workload public.compute_workload not null, state public.compute_job_state not null default 'queued', idempotency_key text not null check(length(idempotency_key) between 1 and 128),
 request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'), request_payload jsonb not null check(jsonb_typeof(request_payload)='object'),
 priority_class text not null check(priority_class in ('og','standard')), queued_at timestamptz not null default now(), available_at timestamptz not null default now(),
 attempt_count smallint not null default 0, max_attempts smallint not null check(max_attempts between 1 and 20), lease_token uuid, lease_expires_at timestamptz,
 cancellation_requested_at timestamptz, internal_hold_code text, safe_error_code text, result_reference jsonb,
 started_at timestamptz, terminal_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,workload,idempotency_key), check((lease_token is null)=(lease_expires_at is null)),
 check((state in ('claimed','running','cancel_requested') and lease_token is not null) or state not in ('claimed','running'))
);
create table public.compute_job_attempts (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.compute_jobs(id) on delete restrict, ordinal smallint not null check(ordinal>0),
 lease_token uuid not null unique, worker_ref text not null check(length(worker_ref) between 1 and 200), claimed_at timestamptz not null default now(), started_at timestamptz,
 heartbeat_at timestamptz not null default now(), lease_expires_at timestamptz not null, provider_dispatched_at timestamptz, provider_operation_ref text,
 finished_at timestamptz, outcome_class text, safe_error_code text, reserved_cost_micros bigint check(reserved_cost_micros>=0), actual_cost_micros bigint check(actual_cost_micros>=0),
 runtime_ms bigint check(runtime_ms>=0), internal_telemetry jsonb not null default '{}'::jsonb, unique(job_id,ordinal)
);
create table public.compute_cost_ledger (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.compute_jobs(id) on delete restrict,
 attempt_id uuid references public.compute_job_attempts(id) on delete restrict, kind public.compute_cost_event_kind not null, amount_micros bigint not null,
 currency text not null default 'USD' check(currency='USD'), occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb,
 check((kind in ('reservation','actual') and amount_micros>=0) or (kind in ('release','correction') and amount_micros<>0))
);
create table public.compute_spend_threshold_events (
 id uuid primary key default gen_random_uuid(), policy_id uuid not null references public.compute_spend_policies(id), period_kind text not null check(period_kind in ('daily','monthly')),
 period_start date not null, threshold smallint not null check(threshold in (50,75,90,100)), created_at timestamptz not null default now(), unique(policy_id,period_kind,period_start,threshold)
);
create index compute_jobs_owner_history_idx on public.compute_jobs(owner_id,created_at desc);
create index compute_jobs_queue_idx on public.compute_jobs(workload,available_at,queued_at,id) where state='queued';
create index compute_jobs_state_idx on public.compute_jobs(state);
create index compute_jobs_stale_idx on public.compute_jobs(lease_expires_at) where lease_expires_at is not null;
create index compute_jobs_active_owner_idx on public.compute_jobs(owner_id,workload) where state in ('claimed','running','recovering','cancel_requested');
create index compute_attempts_provider_idx on public.compute_job_attempts(provider_operation_ref) where provider_operation_ref is not null;
create index compute_cost_period_idx on public.compute_cost_ledger(occurred_at,kind);

alter table public.compute_jobs enable row level security; alter table public.compute_job_attempts enable row level security;
alter table public.compute_cost_ledger enable row level security; alter table public.compute_spend_policies enable row level security;
alter table public.compute_scheduler_policies enable row level security; alter table public.compute_spend_threshold_events enable row level security;
revoke all on all tables in schema public from anon, authenticated;

create function public.submit_compute_job(p_owner_id uuid,p_workload public.compute_workload,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text)
returns table(job_id uuid, workload public.compute_workload, creator_status text, queued_at timestamptz, started_at timestamptz, completed_at timestamptz, result_reference jsonb, safe_error_code text, can_cancel boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; policy public.compute_scheduler_policies;
begin
 if p_owner_id is null or length(p_idempotency_key) not between 1 and 128 or p_request_fingerprint!~'^[0-9a-f]{64}$' or jsonb_typeof(p_request_payload)<>'object' or p_priority_class not in ('og','standard') then raise exception 'INVALID_COMPUTE_SUBMISSION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_workload::text||':'||p_idempotency_key,0));
 select * into j from public.compute_jobs x where x.owner_id=p_owner_id and x.workload=p_workload and x.idempotency_key=p_idempotency_key;
 if found then if j.request_fingerprint<>p_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; else
  select * into policy from public.compute_scheduler_policies p where p.workload=p_workload and p.enabled;
  if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
  insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts)
   values(p_owner_id,p_workload,p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class,policy.max_attempts) returning * into j;
 end if;
 return query select j.id,j.workload,case j.state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else j.state::text end,j.queued_at,j.started_at,j.terminal_at,j.result_reference,j.safe_error_code,j.state not in ('succeeded','failed','cancelled');
end$$;

create function public.claim_compute_job(p_workload public.compute_workload,p_worker_ref text)
returns table(job_id uuid,attempt_id uuid,lease_token uuid,request_payload jsonb) language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.compute_scheduler_policies; j public.compute_jobs; a public.compute_job_attempts; active_count int;
begin
 if length(p_worker_ref) not between 1 and 200 then raise exception 'INVALID_WORKER'; end if;
 select * into p from public.compute_scheduler_policies where workload=p_workload and enabled for update; if not found then return; end if;
 select count(*) into active_count from public.compute_jobs where workload=p_workload and state in ('claimed','running','recovering','cancel_requested'); if active_count>=p.max_global_active then return; end if;
 select * into j from public.compute_jobs q where q.workload=p_workload and q.state='queued' and q.available_at<=now() and q.attempt_count<q.max_attempts
 and not exists(select 1 from public.compute_jobs x where x.owner_id=q.owner_id and x.workload=q.workload and x.state in ('claimed','running','recovering','cancel_requested'))
 order by q.queued_at-(case when q.priority_class='og' then p.og_priority_seconds else 0 end)*interval '1 second',q.queued_at,q.id for update skip locked limit 1;
 if not found then return; end if;
 update public.compute_jobs set state='claimed',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=now()+p.lease_seconds*interval '1 second',updated_at=now() where id=j.id returning * into j;
 insert into public.compute_job_attempts(job_id,ordinal,lease_token,worker_ref,lease_expires_at) values(j.id,j.attempt_count,j.lease_token,p_worker_ref,j.lease_expires_at) returning * into a;
 return query select j.id,a.id,j.lease_token,j.request_payload;
end$$;

create function public.compute_worker_transition(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_action text,p_safe_error_code text default null,p_result_reference jsonb default null)
returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts;
begin
 select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id and lease_token=p_lease_token for update;
 if not found or j.lease_token is distinct from p_lease_token then raise exception 'LEASE_MISMATCH'; end if;
 if p_action='heartbeat' and j.state in ('claimed','running','cancel_requested') then update public.compute_job_attempts set heartbeat_at=now() where id=a.id;
 elsif p_action='start' and j.state='claimed' then update public.compute_jobs set state='running',started_at=coalesce(started_at,now()) where id=j.id; update public.compute_job_attempts set started_at=coalesce(started_at,now()) where id=a.id;
 elsif p_action='success' and j.state in ('running','cancel_requested') then update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=p_result_reference,lease_token=null,lease_expires_at=null where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='succeeded' where id=a.id;
 elsif p_action='failure' and j.state in ('claimed','running') then update public.compute_jobs set state='failed',terminal_at=now(),safe_error_code=p_safe_error_code,lease_token=null,lease_expires_at=null where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='failed',safe_error_code=p_safe_error_code where id=a.id;
 elsif p_action='cancelled' and j.state='cancel_requested' then update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='cancelled' where id=a.id;
 elsif (p_action='success' and j.state='succeeded') or (p_action='failure' and j.state='failed') or (p_action='cancelled' and j.state='cancelled') then return j.state;
 else raise exception 'ILLEGAL_COMPUTE_TRANSITION'; end if;
 select state into j.state from public.compute_jobs where id=j.id; return j.state;
end$$;

create function public.mark_compute_provider_dispatch(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_operation_ref text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if p_operation_ref is null or length(p_operation_ref)>500 then raise exception 'INVALID_OPERATION_REFERENCE'; end if;
 update public.compute_job_attempts set provider_dispatched_at=coalesce(provider_dispatched_at,now()),provider_operation_ref=coalesce(provider_operation_ref,p_operation_ref) where id=p_attempt_id and job_id=p_job_id and lease_token=p_lease_token;
 if not found then raise exception 'LEASE_MISMATCH'; end if;
end$$;

create function public.recover_stale_compute_jobs() returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; n int:=0;
begin for j in select * from public.compute_jobs where state in ('claimed','running') and lease_expires_at<now() for update skip locked loop
 select * into a from public.compute_job_attempts where job_id=j.id and ordinal=j.attempt_count;
 if a.provider_dispatched_at is not null or a.provider_operation_ref is not null then update public.compute_jobs set state='recovering',lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
 elsif j.attempt_count<j.max_attempts then update public.compute_jobs set state='queued',lease_token=null,lease_expires_at=null,available_at=now(),updated_at=now() where id=j.id;
 else update public.compute_jobs set state='failed',lease_token=null,lease_expires_at=null,terminal_at=now(),safe_error_code='RETRY_LIMIT_REACHED' where id=j.id; end if;
 update public.compute_job_attempts set finished_at=now(),outcome_class=case when a.provider_dispatched_at is null and a.provider_operation_ref is null then 'lease_expired' else 'dispatch_uncertain' end where id=a.id; n:=n+1; end loop; return n; end$$;

create function public.creator_compute_status(p_owner_id uuid,p_job_id uuid) returns table(job_id uuid,workload public.compute_workload,creator_status text,queued_at timestamptz,started_at timestamptz,completed_at timestamptz,result_reference jsonb,safe_error_code text,can_cancel boolean)
language sql security definer set search_path=pg_catalog,public as $$ select id,workload,case state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else state::text end,queued_at,started_at,terminal_at,result_reference,safe_error_code,state not in ('succeeded','failed','cancelled') from public.compute_jobs where id=p_job_id and owner_id=p_owner_id $$;
create function public.cancel_compute_job(p_owner_id uuid,p_job_id uuid) returns setof public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$ declare s public.compute_job_state; begin select state into s from public.compute_jobs where id=p_job_id and owner_id=p_owner_id for update; if not found then raise exception 'COMPUTE_JOB_NOT_FOUND'; end if; if s='queued' then update public.compute_jobs set state='cancelled',cancellation_requested_at=now(),terminal_at=now() where id=p_job_id returning state into s; elsif s in ('claimed','running','recovering') then update public.compute_jobs set state='cancel_requested',cancellation_requested_at=coalesce(cancellation_requested_at,now()) where id=p_job_id returning state into s; end if; return next s; end$$;

create function public.authorize_compute_dispatch(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_estimated_cost_micros bigint) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare pol public.compute_spend_policies; j public.compute_jobs; daily_spent bigint; monthly_spent bigint; threshold_value smallint; begin if p_estimated_cost_micros<0 then raise exception 'INVALID_COST'; end if; select * into j from public.compute_jobs where id=p_job_id and lease_token=p_lease_token for update; if not found or not exists(select 1 from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id and lease_token=p_lease_token) then raise exception 'LEASE_MISMATCH'; end if; select * into pol from public.compute_spend_policies where enabled and effective_from<=now() and (effective_until is null or effective_until>now()) order by version desc limit 1; if not found then update public.compute_jobs set internal_hold_code='SPEND_POLICY_UNCONFIGURED' where id=j.id; return false; end if; if j.workload='video' and p_estimated_cost_micros>pol.video_job_limit_micros then return false; end if; select coalesce(sum(amount_micros),0) into daily_spent from public.compute_cost_ledger where occurred_at>=date_trunc('day',now()); if daily_spent+p_estimated_cost_micros>pol.daily_limit_micros then return false; end if; select coalesce(sum(amount_micros),0) into monthly_spent from public.compute_cost_ledger where occurred_at>=date_trunc('month',now()); if monthly_spent+p_estimated_cost_micros>pol.monthly_limit_micros then return false; end if; foreach threshold_value in array array[50,75,90,100]::smallint[] loop if daily_spent+p_estimated_cost_micros>=pol.daily_limit_micros*threshold_value/100 then insert into public.compute_spend_threshold_events(policy_id,period_kind,period_start,threshold) values(pol.id,'daily',current_date,threshold_value) on conflict do nothing; end if; if monthly_spent+p_estimated_cost_micros>=pol.monthly_limit_micros*threshold_value/100 then insert into public.compute_spend_threshold_events(policy_id,period_kind,period_start,threshold) values(pol.id,'monthly',date_trunc('month',current_date)::date,threshold_value) on conflict do nothing; end if; end loop; insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(j.id,p_attempt_id,'reservation',p_estimated_cost_micros); update public.compute_job_attempts set reserved_cost_micros=p_estimated_cost_micros where id=p_attempt_id; return true; end$$;
create function public.record_compute_actual_cost(p_job_id uuid,p_attempt_id uuid,p_actual_cost_micros bigint,p_runtime_ms bigint,p_telemetry jsonb default '{}') returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin if p_actual_cost_micros<0 or p_runtime_ms<0 then raise exception 'INVALID_COST'; end if; insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(p_job_id,p_attempt_id,'actual',p_actual_cost_micros); update public.compute_job_attempts set actual_cost_micros=p_actual_cost_micros,runtime_ms=p_runtime_ms,internal_telemetry=p_telemetry where id=p_attempt_id and job_id=p_job_id; if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if; end$$;

revoke all on function public.submit_compute_job(uuid,public.compute_workload,text,text,jsonb,text),public.claim_compute_job(public.compute_workload,text),public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb),public.mark_compute_provider_dispatch(uuid,uuid,uuid,text),public.recover_stale_compute_jobs(),public.creator_compute_status(uuid,uuid),public.cancel_compute_job(uuid,uuid),public.authorize_compute_dispatch(uuid,uuid,uuid,bigint),public.record_compute_actual_cost(uuid,uuid,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.submit_compute_job(uuid,public.compute_workload,text,text,jsonb,text),public.claim_compute_job(public.compute_workload,text),public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb),public.mark_compute_provider_dispatch(uuid,uuid,uuid,text),public.recover_stale_compute_jobs(),public.creator_compute_status(uuid,uuid),public.cancel_compute_job(uuid,uuid),public.authorize_compute_dispatch(uuid,uuid,uuid,bigint),public.record_compute_actual_cost(uuid,uuid,bigint,bigint,jsonb) to service_role;
grant all on public.compute_jobs,public.compute_job_attempts,public.compute_cost_ledger,public.compute_spend_policies,public.compute_scheduler_policies,public.compute_spend_threshold_events to service_role;
commit;
