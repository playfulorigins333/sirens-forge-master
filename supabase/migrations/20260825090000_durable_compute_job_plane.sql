begin;
create extension if not exists pgcrypto;
create type public.compute_workload as enum ('trainer','image','video','stitch');
create type public.compute_job_state as enum ('queued','claimed','running','recovering','cancel_requested','succeeded','failed','cancelled');
create type public.compute_cost_event_kind as enum ('reservation','actual','release','correction');

create table public.compute_scheduler_policies (
 workload public.compute_workload primary key, max_global_active integer not null check(max_global_active>0),
 lease_seconds integer not null check(lease_seconds between 15 and 86400), stale_seconds integer not null check(stale_seconds>=lease_seconds),
 max_attempts smallint not null check(max_attempts between 1 and 20), og_priority_seconds integer not null check(og_priority_seconds>=0),
 warm_grace_seconds integer not null default 0 check(warm_grace_seconds>=0), spend_hold_seconds integer not null check(spend_hold_seconds between 1 and 86400), enabled boolean not null default false,
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
 attempt_count integer not null default 0, retry_count smallint not null default 0, max_attempts smallint not null check(max_attempts between 1 and 20), lease_token uuid, lease_expires_at timestamptz,
 cancellation_requested_at timestamptz, internal_hold_code text, safe_error_code text, result_reference jsonb,
 started_at timestamptz, terminal_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,workload,idempotency_key), check((lease_token is null)=(lease_expires_at is null)),
 check((state in ('claimed','running','cancel_requested') and lease_token is not null) or state not in ('claimed','running'))
);
create table public.compute_job_attempts (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.compute_jobs(id) on delete restrict, ordinal integer not null check(ordinal>0),
 lease_token uuid not null unique, worker_ref text not null check(length(worker_ref) between 1 and 200), claimed_at timestamptz not null default now(), started_at timestamptz,
 heartbeat_at timestamptz not null default now(), lease_expires_at timestamptz not null, provider_dispatched_at timestamptz, provider_operation_ref text,
 finished_at timestamptz, outcome_class text, safe_error_code text, reserved_cost_micros bigint check(reserved_cost_micros>=0), actual_cost_micros bigint check(actual_cost_micros>=0),
 runtime_ms bigint check(runtime_ms>=0), recovery_token uuid, spend_policy_id uuid references public.compute_spend_policies(id), internal_telemetry jsonb not null default '{}'::jsonb, unique(job_id,ordinal)
);
create table public.compute_cost_ledger (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.compute_jobs(id) on delete restrict,
 attempt_id uuid references public.compute_job_attempts(id) on delete restrict, kind public.compute_cost_event_kind not null, amount_micros bigint not null,
 currency text not null default 'USD' check(currency='USD'), correction_key text, reason_code text, occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb,
 check((kind in ('reservation','actual') and amount_micros>0 and correction_key is null and reason_code is null) or (kind='release' and amount_micros<0 and correction_key is null and reason_code is null) or (kind='correction' and amount_micros<>0 and length(correction_key) between 1 and 128 and reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'))
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
create unique index compute_cost_one_reservation_idx on public.compute_cost_ledger(attempt_id) where kind='reservation';
create unique index compute_cost_one_release_idx on public.compute_cost_ledger(attempt_id) where kind='release';
create unique index compute_cost_correction_key_idx on public.compute_cost_ledger(job_id,correction_key) where kind='correction';
create unique index compute_cost_one_actual_idx on public.compute_cost_ledger(attempt_id) where kind='actual';
create unique index compute_jobs_one_active_owner_workload_idx on public.compute_jobs(owner_id,workload) where state in ('claimed','running','recovering','cancel_requested');

alter table public.compute_jobs enable row level security; alter table public.compute_job_attempts enable row level security;
alter table public.compute_cost_ledger enable row level security; alter table public.compute_spend_policies enable row level security;
alter table public.compute_scheduler_policies enable row level security; alter table public.compute_spend_threshold_events enable row level security;
revoke all on table public.compute_jobs, public.compute_job_attempts, public.compute_cost_ledger, public.compute_spend_policies, public.compute_scheduler_policies, public.compute_spend_threshold_events from public, anon, authenticated, service_role;

create function public.compute_safe_error(p_code text) returns text language plpgsql immutable set search_path=pg_catalog,public as $$
begin if p_code is null then return null; end if; if length(p_code) not between 1 and 64 or p_code !~ '^[A-Z][A-Z0-9_]*$' then raise exception 'INVALID_SAFE_ERROR_CODE'; end if; return p_code; end$$;

create function public.compute_creator_result(p_result jsonb) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select case when p_result is null then null else jsonb_strip_nulls(jsonb_build_object(
  'generation_id',case when p_result->>'generation_id' ~ '^[0-9a-fA-F-]{36}$' then p_result->'generation_id' end,
  'asset_ids',case when jsonb_typeof(p_result->'asset_ids')='array' then p_result->'asset_ids' end,
  'project_id',case when p_result->>'project_id' ~ '^[0-9a-fA-F-]{36}$' then p_result->'project_id' end,
  'result_id',case when p_result->>'result_id' ~ '^[0-9a-fA-F-]{36}$' then p_result->'result_id' end)) end
$$;


create function public.emit_compute_spend_thresholds(p_policy_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare pol public.compute_spend_policies; daily_spent bigint; monthly_spent bigint; threshold_value smallint;
begin
 select * into pol from public.compute_spend_policies where id=p_policy_id; if not found then raise exception 'SPEND_POLICY_NOT_FOUND'; end if;
 select coalesce(sum(amount_micros),0) into daily_spent from public.compute_cost_ledger where occurred_at>=date_trunc('day',now());
 select coalesce(sum(amount_micros),0) into monthly_spent from public.compute_cost_ledger where occurred_at>=date_trunc('month',now());
 foreach threshold_value in array array[50,75,90,100]::smallint[] loop
  if daily_spent>=pol.daily_limit_micros*threshold_value/100 then insert into public.compute_spend_threshold_events(policy_id,period_kind,period_start,threshold) values(pol.id,'daily',current_date,threshold_value) on conflict do nothing; end if;
  if monthly_spent>=pol.monthly_limit_micros*threshold_value/100 then insert into public.compute_spend_threshold_events(policy_id,period_kind,period_start,threshold) values(pol.id,'monthly',date_trunc('month',current_date)::date,threshold_value) on conflict do nothing; end if;
 end loop;
end$$;

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
 return query select j.id,j.workload,case when j.state='recovering' and j.cancellation_requested_at is not null then 'cancelling' else case j.state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else j.state::text end end,j.queued_at,j.started_at,j.terminal_at,public.compute_creator_result(j.result_reference),j.safe_error_code,j.state not in ('succeeded','failed','cancelled');
end$$;

create function public.submit_trainer_compute_job(p_owner_id uuid,p_lora_id uuid,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text,p_dataset_r2_bucket text,p_dataset_r2_prefix text)
returns table(job_id uuid, workload public.compute_workload, creator_status text, queued_at timestamptz, started_at timestamptz, completed_at timestamptz, result_reference jsonb, safe_error_code text, can_cancel boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job_id uuid;
begin
 if p_lora_id is null or p_dataset_r2_bucket is null or p_dataset_r2_prefix is null or length(p_dataset_r2_bucket)>255 or length(p_dataset_r2_prefix)>1024 then raise exception 'INVALID_TRAINER_SUBMISSION'; end if;
 select s.job_id into v_job_id from public.submit_compute_job(p_owner_id,'trainer',p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class) s;
 update public.user_loras set training_job_id=v_job_id,status='queued',dataset_r2_bucket=p_dataset_r2_bucket,dataset_r2_prefix=p_dataset_r2_prefix,updated_at=now() where id=p_lora_id and user_id=p_owner_id;
 if not found then raise exception 'TRAINER_TARGET_NOT_OWNED'; end if;
 return query select * from public.submit_compute_job(p_owner_id,'trainer',p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class);
end$$;

create function public.claim_compute_job(p_workload public.compute_workload,p_worker_ref text)
returns table(job_id uuid,attempt_id uuid,lease_token uuid,request_payload jsonb) language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.compute_scheduler_policies; j public.compute_jobs; a public.compute_job_attempts; active_count int;
begin
 if length(p_worker_ref) not between 1 and 200 then raise exception 'INVALID_WORKER'; end if;
 select * into p from public.compute_scheduler_policies where workload=p_workload and enabled for update; if not found then return; end if;
 select count(*) into active_count from public.compute_jobs where workload=p_workload and state in ('claimed','running','recovering','cancel_requested'); if active_count>=p.max_global_active then return; end if;
 select * into j from public.compute_jobs q where q.workload=p_workload and q.state='queued' and q.available_at<=now() and q.retry_count<q.max_attempts
 and not exists(select 1 from public.compute_jobs x where x.owner_id=q.owner_id and x.workload=q.workload and x.state in ('claimed','running','recovering','cancel_requested'))
 order by q.queued_at-(case when q.priority_class='og' then p.og_priority_seconds else 0 end)*interval '1 second',q.queued_at,q.id for update skip locked limit 1;
 if not found then return; end if;
 update public.compute_jobs set state='claimed',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=now()+p.lease_seconds*interval '1 second',internal_hold_code=null,updated_at=now() where id=j.id returning * into j;
 insert into public.compute_job_attempts(job_id,ordinal,lease_token,worker_ref,lease_expires_at) values(j.id,j.attempt_count,j.lease_token,p_worker_ref,j.lease_expires_at) returning * into a;
 return query select j.id,a.id,j.lease_token,j.request_payload;
end$$;

create function public.heartbeat_compute_job(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid) returns timestamptz language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; p public.compute_scheduler_policies; renewed timestamptz;
begin
 select * into j from public.compute_jobs where id=p_job_id for update;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or j.lease_token is distinct from p_lease_token or a.lease_token<>p_lease_token or a.finished_at is not null or j.lease_expires_at<=clock_timestamp() or j.state not in ('claimed','running','cancel_requested') then raise exception 'LEASE_MISMATCH'; end if;
 select * into p from public.compute_scheduler_policies where workload=j.workload and enabled; if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
 renewed:=clock_timestamp()+p.stale_seconds*interval '1 second'; update public.compute_jobs set lease_expires_at=renewed,updated_at=now() where id=j.id; update public.compute_job_attempts set heartbeat_at=now(),lease_expires_at=renewed where id=a.id; return renewed;
end$$;

create function public.compute_worker_transition(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_action text,p_safe_error_code text default null,p_result_reference jsonb default null)
returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; safe_code text;
begin
 select * into j from public.compute_jobs where id=p_job_id for update;
 if (p_action='success' and j.state='succeeded') or (p_action='failure' and j.state='failed') or (p_action='cancelled' and j.state='cancelled') then return j.state; end if;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or j.lease_token is distinct from p_lease_token or a.lease_token<>p_lease_token or a.finished_at is not null or j.lease_expires_at<=clock_timestamp() then raise exception 'LEASE_MISMATCH'; end if;
 safe_code:=public.compute_safe_error(p_safe_error_code);
 if p_action='start' and j.state='claimed' then update public.compute_jobs set state='running',started_at=coalesce(started_at,now()),updated_at=now() where id=j.id; update public.compute_job_attempts set started_at=coalesce(started_at,now()) where id=a.id;
 elsif p_action='success' and j.state in ('running','cancel_requested') then update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=p_result_reference,lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='succeeded' where id=a.id;
 elsif p_action='failure' and j.state in ('claimed','running') then update public.compute_jobs set state='failed',terminal_at=now(),safe_error_code=safe_code,lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='failed',safe_error_code=safe_code where id=a.id;
 elsif p_action='cancelled' and j.state='cancel_requested' then update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='cancelled' where id=a.id;
 else raise exception 'ILLEGAL_COMPUTE_TRANSITION'; end if;
 select state into j.state from public.compute_jobs where id=j.id; return j.state;
end$$;

create function public.mark_compute_provider_dispatch(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_operation_ref text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts;
begin
 if p_operation_ref is null or length(p_operation_ref) not between 1 and 500 then raise exception 'INVALID_OPERATION_REFERENCE'; end if;
 select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or j.lease_token is distinct from p_lease_token or a.lease_token<>p_lease_token or a.finished_at is not null or j.lease_expires_at<=clock_timestamp() or j.state not in ('claimed','running') or j.cancellation_requested_at is not null then raise exception 'LEASE_MISMATCH'; end if;
 if a.provider_operation_ref is not null and a.provider_operation_ref<>p_operation_ref then raise exception 'PROVIDER_OPERATION_CONFLICT'; end if;
 update public.compute_job_attempts set provider_dispatched_at=coalesce(provider_dispatched_at,now()),provider_operation_ref=coalesce(provider_operation_ref,p_operation_ref) where id=a.id;
end$$;

create function public.retry_compute_pre_dispatch(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_safe_error_code text,p_delay_seconds integer default 0) returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; safe_code text;
begin
 if p_delay_seconds not between 0 and 86400 then raise exception 'INVALID_RETRY_DELAY'; end if; safe_code:=public.compute_safe_error(p_safe_error_code);
 select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or j.lease_token is distinct from p_lease_token or a.lease_token<>p_lease_token or a.finished_at is not null or j.lease_expires_at<=clock_timestamp() then raise exception 'LEASE_MISMATCH'; end if;
 if j.state='cancel_requested' or j.cancellation_requested_at is not null then raise exception 'CANCELLATION_REQUESTED'; end if;
 if a.provider_dispatched_at is not null or a.provider_operation_ref is not null then raise exception 'POST_DISPATCH_RETRY_FORBIDDEN'; end if;
 update public.compute_job_attempts set finished_at=now(),outcome_class='retryable_failure',safe_error_code=safe_code where id=a.id;
 if j.retry_count+1<j.max_attempts then update public.compute_jobs set state='queued',retry_count=retry_count+1,available_at=now()+p_delay_seconds*interval '1 second',lease_token=null,lease_expires_at=null,internal_hold_code=null,updated_at=now() where id=j.id;
 else update public.compute_jobs set state='failed',retry_count=retry_count+1,terminal_at=now(),lease_token=null,lease_expires_at=null,safe_error_code='RETRY_LIMIT_REACHED',updated_at=now() where id=j.id; end if;
 select state into j.state from public.compute_jobs where id=j.id; return j.state;
end$$;

create function public.recover_stale_compute_jobs() returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; n int:=0;
begin
 for j in select * from public.compute_jobs where state in ('claimed','running','cancel_requested') and lease_expires_at<now() order by id for update skip locked loop
  select * into a from public.compute_job_attempts where job_id=j.id and ordinal=j.attempt_count for update;
  if a.provider_dispatched_at is not null or a.provider_operation_ref is not null then
   update public.compute_jobs set state='recovering',lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
   update public.compute_job_attempts set recovery_token=coalesce(recovery_token,gen_random_uuid()),outcome_class='dispatch_uncertain' where id=a.id;
  elsif j.state='cancel_requested' then
   update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
   update public.compute_job_attempts set finished_at=now(),outcome_class='cancelled_before_dispatch' where id=a.id;
  elsif j.retry_count+1<j.max_attempts then
   update public.compute_jobs set state='queued',retry_count=retry_count+1,lease_token=null,lease_expires_at=null,available_at=now(),updated_at=now() where id=j.id;
   update public.compute_job_attempts set finished_at=now(),outcome_class='lease_expired' where id=a.id;
  else
   update public.compute_jobs set state='failed',retry_count=retry_count+1,lease_token=null,lease_expires_at=null,terminal_at=now(),safe_error_code='RETRY_LIMIT_REACHED',updated_at=now() where id=j.id;
   update public.compute_job_attempts set finished_at=now(),outcome_class='lease_expired' where id=a.id;
  end if; n:=n+1;
 end loop; return n;
end$$;

create function public.reconcile_compute_recovery(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_outcome text,p_provider_nonexecution_proven boolean default false,p_safe_error_code text default null,p_result_reference jsonb default null) returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; safe_code text;
begin
 safe_code:=public.compute_safe_error(p_safe_error_code); select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or j.state<>'recovering' or a.recovery_token is distinct from p_recovery_token or a.finished_at is not null then raise exception 'RECOVERY_AUTHORITY_MISMATCH'; end if;
 if p_outcome='requeue' then if not p_provider_nonexecution_proven then raise exception 'PROVIDER_NONEXECUTION_EVIDENCE_REQUIRED'; end if; if j.cancellation_requested_at is not null then update public.compute_jobs set state='cancelled',terminal_at=now(),updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='cancelled_provider_nonexecution_proven' where id=a.id; else update public.compute_jobs set state='queued',available_at=now(),updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='provider_nonexecution_proven' where id=a.id; end if;
 elsif p_outcome in ('succeeded','failed','cancelled') then update public.compute_jobs set state=p_outcome::public.compute_job_state,terminal_at=now(),result_reference=case when p_outcome='succeeded' then p_result_reference else result_reference end,safe_error_code=case when p_outcome='failed' then safe_code else safe_error_code end,updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='reconciled_'||p_outcome,safe_error_code=case when p_outcome='failed' then safe_code else safe_error_code end where id=a.id;
 else raise exception 'INVALID_RECOVERY_OUTCOME'; end if; select state into j.state from public.compute_jobs where id=j.id; return j.state;
end$$;

create function public.creator_compute_status(p_owner_id uuid,p_job_id uuid) returns table(job_id uuid,workload public.compute_workload,creator_status text,queued_at timestamptz,started_at timestamptz,completed_at timestamptz,result_reference jsonb,safe_error_code text,can_cancel boolean)
language sql security definer set search_path=pg_catalog,public as $$ select id,workload,case when state='recovering' and cancellation_requested_at is not null then 'cancelling' else case state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else state::text end end,queued_at,started_at,terminal_at,public.compute_creator_result(result_reference),safe_error_code,state not in ('succeeded','failed','cancelled') from public.compute_jobs where id=p_job_id and owner_id=p_owner_id $$;

create function public.cancel_compute_job(p_owner_id uuid,p_job_id uuid) returns setof public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$ declare s public.compute_job_state; begin select state into s from public.compute_jobs where id=p_job_id and owner_id=p_owner_id for update; if not found then raise exception 'COMPUTE_JOB_NOT_FOUND'; end if; if s='queued' then update public.compute_jobs set state='cancelled',cancellation_requested_at=now(),terminal_at=now(),updated_at=now() where id=p_job_id returning state into s; elsif s in ('claimed','running') then update public.compute_jobs set state='cancel_requested',cancellation_requested_at=coalesce(cancellation_requested_at,now()),updated_at=now() where id=p_job_id returning state into s; elsif s='recovering' then update public.compute_jobs set cancellation_requested_at=coalesce(cancellation_requested_at,now()),updated_at=now() where id=p_job_id; s:='cancel_requested'; end if; return next s; end$$;

create function public.authorize_compute_dispatch(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_estimated_cost_micros bigint) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare pol public.compute_spend_policies; sched public.compute_scheduler_policies; j public.compute_jobs; a public.compute_job_attempts; daily_spent bigint; monthly_spent bigint; threshold_value smallint; denial text;
begin
 if p_estimated_cost_micros<=0 then raise exception 'INVALID_COST'; end if; select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or j.lease_token is distinct from p_lease_token or a.lease_token<>p_lease_token or a.finished_at is not null or j.lease_expires_at<=clock_timestamp() or j.state not in ('claimed','running') then raise exception 'LEASE_MISMATCH'; end if;
 if a.provider_dispatched_at is not null then raise exception 'ALREADY_DISPATCHED'; end if;
 if a.reserved_cost_micros is not null then if a.reserved_cost_micros=p_estimated_cost_micros then return true; else raise exception 'RESERVATION_CONFLICT'; end if; end if;
 select * into sched from public.compute_scheduler_policies where workload=j.workload and enabled; if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
 select * into pol from public.compute_spend_policies where enabled and effective_from<=now() and (effective_until is null or effective_until>now()) order by version desc limit 1;
 if not found then denial:='SPEND_POLICY_UNCONFIGURED'; else
  select coalesce(sum(amount_micros),0) into daily_spent from public.compute_cost_ledger where occurred_at>=date_trunc('day',now()); select coalesce(sum(amount_micros),0) into monthly_spent from public.compute_cost_ledger where occurred_at>=date_trunc('month',now());
  if j.workload='video' and p_estimated_cost_micros>pol.video_job_limit_micros then denial:='VIDEO_COST_HOLD'; elsif daily_spent+p_estimated_cost_micros>pol.daily_limit_micros then denial:='DAILY_SPEND_HOLD'; elsif monthly_spent+p_estimated_cost_micros>pol.monthly_limit_micros then denial:='MONTHLY_SPEND_HOLD'; end if;
 end if;
 if denial is not null then update public.compute_job_attempts set finished_at=now(),outcome_class='dispatch_held' where id=a.id; update public.compute_jobs set state='queued',available_at=now()+sched.spend_hold_seconds*interval '1 second',lease_token=null,lease_expires_at=null,internal_hold_code=denial,updated_at=now() where id=j.id; return false; end if;

 insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(j.id,a.id,'reservation',p_estimated_cost_micros); update public.compute_job_attempts set reserved_cost_micros=p_estimated_cost_micros,spend_policy_id=pol.id where id=a.id; perform public.emit_compute_spend_thresholds(pol.id); return true;
end$$;

create function public.record_compute_actual_cost(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_actual_cost_micros bigint,p_runtime_ms bigint,p_telemetry jsonb default '{}') returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts;
begin
 if p_actual_cost_micros<=0 or p_runtime_ms<0 then raise exception 'INVALID_COST'; end if; select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or j.lease_token is distinct from p_lease_token or a.lease_token<>p_lease_token or j.lease_expires_at<=clock_timestamp() then raise exception 'LEASE_MISMATCH'; end if;
 if a.provider_dispatched_at is null or a.provider_operation_ref is null then raise exception 'EXECUTION_EVIDENCE_REQUIRED'; end if;
 if a.actual_cost_micros is not null then if a.actual_cost_micros=p_actual_cost_micros and a.runtime_ms=p_runtime_ms then return; else raise exception 'ACTUAL_COST_CONFLICT'; end if; end if;
 if a.reserved_cost_micros is not null then insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(j.id,a.id,'release',-a.reserved_cost_micros); end if;
 insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(j.id,a.id,'actual',p_actual_cost_micros); update public.compute_job_attempts set actual_cost_micros=p_actual_cost_micros,runtime_ms=p_runtime_ms,internal_telemetry=p_telemetry where id=a.id; perform public.emit_compute_spend_thresholds(a.spend_policy_id);
end$$;


create function public.record_compute_cost_correction(p_job_id uuid,p_correction_key text,p_delta_micros bigint,p_reason_code text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare existing public.compute_cost_ledger; policy_id uuid; inserted_id uuid;
begin
 if p_delta_micros=0 or length(p_correction_key) not between 1 and 128 or p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then raise exception 'INVALID_COST_CORRECTION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_job_id::text||':'||p_correction_key,0));
 select * into existing from public.compute_cost_ledger where job_id=p_job_id and correction_key=p_correction_key and kind='correction';
 if found then if existing.amount_micros<>p_delta_micros or existing.reason_code<>p_reason_code then raise exception 'COST_CORRECTION_CONFLICT'; end if; return existing.id; end if;
 if not exists(select 1 from public.compute_cost_ledger where job_id=p_job_id and kind='actual') then raise exception 'ACTUAL_COST_REQUIRED'; end if;
 insert into public.compute_cost_ledger(job_id,kind,amount_micros,correction_key,reason_code) values(p_job_id,'correction',p_delta_micros,p_correction_key,p_reason_code) returning id into inserted_id;
 select a.spend_policy_id into policy_id from public.compute_job_attempts a join public.compute_cost_ledger l on l.attempt_id=a.id where l.job_id=p_job_id and l.kind='actual' limit 1;
 if p_delta_micros>0 and policy_id is not null then perform public.emit_compute_spend_thresholds(policy_id); end if; return inserted_id;
end$$;

revoke all on function public.compute_safe_error(text),public.compute_creator_result(jsonb),public.emit_compute_spend_thresholds(uuid),public.submit_compute_job(uuid,public.compute_workload,text,text,jsonb,text),public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text),public.claim_compute_job(public.compute_workload,text),public.heartbeat_compute_job(uuid,uuid,uuid),public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb),public.mark_compute_provider_dispatch(uuid,uuid,uuid,text),public.retry_compute_pre_dispatch(uuid,uuid,uuid,text,integer),public.recover_stale_compute_jobs(),public.reconcile_compute_recovery(uuid,uuid,uuid,text,boolean,text,jsonb),public.creator_compute_status(uuid,uuid),public.cancel_compute_job(uuid,uuid),public.authorize_compute_dispatch(uuid,uuid,uuid,bigint),public.record_compute_actual_cost(uuid,uuid,uuid,bigint,bigint,jsonb),public.record_compute_cost_correction(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.submit_compute_job(uuid,public.compute_workload,text,text,jsonb,text),public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text),public.claim_compute_job(public.compute_workload,text),public.heartbeat_compute_job(uuid,uuid,uuid),public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb),public.mark_compute_provider_dispatch(uuid,uuid,uuid,text),public.retry_compute_pre_dispatch(uuid,uuid,uuid,text,integer),public.recover_stale_compute_jobs(),public.reconcile_compute_recovery(uuid,uuid,uuid,text,boolean,text,jsonb),public.creator_compute_status(uuid,uuid),public.cancel_compute_job(uuid,uuid),public.authorize_compute_dispatch(uuid,uuid,uuid,bigint),public.record_compute_actual_cost(uuid,uuid,uuid,bigint,bigint,jsonb),public.record_compute_cost_correction(uuid,text,bigint,text) to service_role;
commit;
