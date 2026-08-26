-- Pass 4C-A: durable Video Project and Stitch foundation. Applying is separately authorized.
begin;

-- This semantic cutover cannot safely adopt jobs created without a Video Project root.
do $$ begin
 if exists(select 1 from public.compute_jobs where workload in ('video','stitch')) then
  raise exception 'PASS4C_PREEXISTING_VIDEO_STITCH_JOBS';
 end if;
end $$;

alter table public.private_storage_objects drop constraint private_storage_objects_mime_type_check;
alter table public.private_storage_objects drop constraint private_storage_objects_size_bytes_check;
alter table public.private_storage_objects add constraint private_storage_objects_mime_type_check check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4'));
alter table public.private_storage_objects add constraint private_storage_objects_size_bytes_check check (
 (mime_type in ('image/jpeg','image/png','image/webp') and size_bytes>0 and size_bytes<=52428800)
 or (mime_type='video/mp4' and size_bytes>0 and size_bytes<=104857600));

create table public.video_projects(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete restrict,
 identity_id uuid not null references public.user_loras(id) on delete restrict,
 source_generation_asset_id uuid references public.generation_assets(id) on delete restrict,
 idempotency_key text not null check(length(idempotency_key) between 1 and 128),
 request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
 request_payload jsonb not null check(jsonb_typeof(request_payload)='object'),
 priority_class text not null check(priority_class in ('og','standard')),
 mode text not null check(mode in ('text_to_video','image_to_video')),
 requested_duration_seconds integer not null, segment_count smallint not null,
 target_fps smallint not null default 30 check(target_fps=30),
 target_min_short_edge integer not null default 1080 check(target_min_short_edge>=1080),
 video_job_id uuid not null unique references public.compute_jobs(id) on delete restrict,
 stitch_job_id uuid not null unique references public.compute_jobs(id) on delete restrict,
 storage_bucket text check(storage_bucket=btrim(storage_bucket) and length(storage_bucket) between 3 and 63),
 cancellation_requested_at timestamptz, completed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(owner_id,idempotency_key),
 check((priority_class='standard' and requested_duration_seconds between 10 and 15 and segment_count=2)
    or (priority_class='og' and requested_duration_seconds between 20 and 25 and segment_count=3)),
 check((mode='text_to_video' and source_generation_asset_id is null) or (mode='image_to_video' and source_generation_asset_id is not null))
);
create table public.video_project_segments(
 project_id uuid not null references public.video_projects(id) on delete restrict,
 ordinal smallint not null check(ordinal>=0), storage_object_id uuid not null unique references public.private_storage_objects(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), primary key(project_id,ordinal)
);
create function public.video_project_segment_consistent() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.video_projects; o public.private_storage_objects;
begin
 select * into p from public.video_projects where id=new.project_id; select * into o from public.private_storage_objects where id=new.storage_object_id;
 if not found or new.ordinal<0 or new.ordinal>=p.segment_count or o.owner_id<>p.owner_id or o.mime_type<>'video/mp4'
   or o.object_key !~ ('^creator-video-projects/'||p.id::text||'/segments/'||new.ordinal::text||'/[^/]+$') then raise exception 'VIDEO_PROJECT_SEGMENT_INVALID'; end if;
 return new;
end$$;
create trigger video_project_segment_consistent before insert or update on public.video_project_segments for each row execute function public.video_project_segment_consistent();
alter table public.video_projects enable row level security; alter table public.video_projects force row level security;
alter table public.video_project_segments enable row level security; alter table public.video_project_segments force row level security;
revoke all on table public.video_projects,public.video_project_segments from public,anon,authenticated,service_role;

create or replace function public.submit_compute_job(p_owner_id uuid,p_workload public.compute_workload,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text)
returns table(job_id uuid, workload public.compute_workload, creator_status text, queued_at timestamptz, started_at timestamptz, completed_at timestamptz, result_reference jsonb, safe_error_code text, can_cancel boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; policy public.compute_scheduler_policies;
begin
 if p_workload in ('video','stitch') then raise exception 'WORKLOAD_SUBMISSION_REQUIRED'; end if;
 if p_owner_id is null or length(p_idempotency_key) not between 1 and 128 or p_request_fingerprint!~'^[0-9a-f]{64}$' or jsonb_typeof(p_request_payload)<>'object' or p_priority_class not in ('og','standard') then raise exception 'INVALID_COMPUTE_SUBMISSION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_workload::text||':'||p_idempotency_key,0));
 select * into j from public.compute_jobs x where x.owner_id=p_owner_id and x.workload=p_workload and x.idempotency_key=p_idempotency_key;
 if found then if j.request_fingerprint<>p_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; else
  select * into policy from public.compute_scheduler_policies p where p.workload=p_workload and p.enabled; if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
  insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts)
  values(p_owner_id,p_workload,p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class,policy.max_attempts) returning * into j;
 end if;
 return query select j.id,j.workload,case when j.state='recovering' and j.cancellation_requested_at is not null then 'cancelling' else case j.state when 'claimed' then 'running' when 'succeeded' then 'completed' when 'cancel_requested' then 'cancelling' else j.state::text end end,j.queued_at,j.started_at,j.terminal_at,public.compute_creator_result(j.result_reference),j.safe_error_code,j.state not in ('succeeded','failed','cancelled');
end$$;

create function public.submit_video_project_compute_jobs(p_owner_id uuid,p_identity_id uuid,p_source_generation_asset_id uuid,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text)
returns table(project_id uuid,creator_status text,created_at timestamptz,completed_at timestamptz,can_cancel boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.video_projects; vj public.compute_jobs; sj public.compute_jobs; vp public.compute_scheduler_policies; sp public.compute_scheduler_policies; duration integer; segments integer; v_mode text; source public.generation_assets;
begin
 if p_owner_id is null or p_identity_id is null or length(p_idempotency_key) not between 1 and 128 or p_request_fingerprint!~'^[0-9a-f]{64}$'
  or jsonb_typeof(p_request_payload)<>'object' or p_priority_class not in ('og','standard')
  or p_request_payload ?| array['identity_ids','cast','muses','bucket','object_key','url','data_url','base64','provider','signed_url','raw_response']
  or p_request_payload->>'identity_id' is distinct from p_identity_id::text then raise exception 'INVALID_VIDEO_PROJECT_SUBMISSION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':video-project:'||p_idempotency_key,0));
 select * into p from public.video_projects x where x.owner_id=p_owner_id and x.idempotency_key=p_idempotency_key;
 if found then if p.request_fingerprint<>p_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return query select p.id,case when p.completed_at is null then 'queued' else 'completed' end,p.created_at,p.completed_at,p.completed_at is null; return;
 end if;
 perform 1 from public.user_loras l where l.id=p_identity_id and l.user_id=p_owner_id and l.status='completed' and l.artifact_r2_bucket is not null and l.artifact_r2_key is not null for update;
 if not found then raise exception 'VIDEO_IDENTITY_NOT_READY'; end if;
 v_mode:=p_request_payload->>'mode';
 if v_mode not in ('text_to_video','image_to_video') or jsonb_typeof(p_request_payload->'requested_duration_seconds')<>'number' or p_request_payload->>'requested_duration_seconds'!~'^[0-9]+$'
   or (p_request_payload ? 'fps' and (jsonb_typeof(p_request_payload->'fps')<>'number' or p_request_payload->>'fps'<>'30')) then raise exception 'INVALID_VIDEO_PROJECT_REQUEST'; end if;
 duration:=(p_request_payload->>'requested_duration_seconds')::integer; segments:=case p_priority_class when 'standard' then 2 else 3 end;
 if (p_priority_class='standard' and duration not between 10 and 15) or (p_priority_class='og' and duration not between 20 and 25) then raise exception 'VIDEO_DURATION_TIER_INVALID'; end if;
 if v_mode='text_to_video' and p_source_generation_asset_id is not null then raise exception 'VIDEO_SOURCE_MODE_INVALID'; end if;
 if v_mode='image_to_video' then
  if p_source_generation_asset_id is null then raise exception 'VIDEO_SOURCE_REQUIRED'; end if;
  select ga.* into source from public.generation_assets ga join public.private_storage_objects o on o.id=ga.storage_object_id
   where ga.id=p_source_generation_asset_id and ga.owner_id=p_owner_id and ga.kind='image' and o.owner_id=p_owner_id and o.mime_type in ('image/jpeg','image/png','image/webp') for update of ga,o;
  if not found then raise exception 'VIDEO_SOURCE_INVALID'; end if;
 end if;
 select * into vp from public.compute_scheduler_policies where workload='video' and enabled for update; if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
 select * into sp from public.compute_scheduler_policies where workload='stitch' and enabled for update; if not found then raise exception 'COMPUTE_POLICY_UNCONFIGURED'; end if;
 p.id:=gen_random_uuid();
 insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts)
 values(p_owner_id,'video','project:'||p.id::text,p_request_fingerprint,p_request_payload||jsonb_build_object('project_id',p.id,'identity_id',p_identity_id,'source_generation_asset_id',p_source_generation_asset_id,'segment_count',segments,'target_fps',30,'target_min_short_edge',1080),p_priority_class,vp.max_attempts) returning * into vj;
 insert into public.compute_jobs(owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts)
 values(p_owner_id,'stitch','project:'||p.id::text,p_request_fingerprint,jsonb_build_object('project_id',p.id,'segment_count',segments,'target_fps',30,'target_min_short_edge',1080,'requested_duration_seconds',duration),p_priority_class,sp.max_attempts) returning * into sj;
 insert into public.video_projects(id,owner_id,identity_id,source_generation_asset_id,idempotency_key,request_fingerprint,request_payload,priority_class,mode,requested_duration_seconds,segment_count,video_job_id,stitch_job_id)
 values(p.id,p_owner_id,p_identity_id,p_source_generation_asset_id,p_idempotency_key,p_request_fingerprint,p_request_payload,p_priority_class,v_mode,duration,segments,vj.id,sj.id) returning * into p;
 return query select p.id,'queued',p.created_at,p.completed_at,true;
end$$;

create or replace function public.claim_compute_job(p_workload public.compute_workload,p_worker_ref text)
returns table(job_id uuid,attempt_id uuid,lease_token uuid,request_payload jsonb) language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.compute_scheduler_policies; j public.compute_jobs; a public.compute_job_attempts; active_count int;
begin
 if length(p_worker_ref) not between 1 and 200 then raise exception 'INVALID_WORKER'; end if;
 select * into p from public.compute_scheduler_policies where workload=p_workload and enabled for update; if not found then return; end if;
 select count(*) into active_count from public.compute_jobs where workload=p_workload and state in ('claimed','running','recovering','cancel_requested'); if active_count>=p.max_global_active then return; end if;
 select * into j from public.compute_jobs q where q.workload=p_workload and q.state='queued' and q.available_at<=now() and q.retry_count<q.max_attempts
 and (q.workload='stitch' or not exists(select 1 from public.compute_jobs x where x.owner_id=q.owner_id and x.workload=q.workload and x.state in ('claimed','running','recovering','cancel_requested')))
 and (q.workload<>'stitch' or exists(select 1 from public.video_projects vp where vp.stitch_job_id=q.id and vp.cancellation_requested_at is null and exists(select 1 from public.compute_jobs v where v.id=vp.video_job_id and v.state='succeeded') and (select count(*) from public.video_project_segments s where s.project_id=vp.id)=vp.segment_count and not exists(select 1 from generate_series(0,vp.segment_count-1) n where not exists(select 1 from public.video_project_segments s where s.project_id=vp.id and s.ordinal=n))))
 order by q.queued_at-(case when q.workload in ('trainer','image','video') and q.priority_class='og' then p.og_priority_seconds else 0 end)*interval '1 second',q.queued_at,q.id for update skip locked limit 1;
 if not found then return; end if;
 update public.compute_jobs set state='claimed',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=now()+p.lease_seconds*interval '1 second',internal_hold_code=null,updated_at=now() where id=j.id returning * into j;
 insert into public.compute_job_attempts(job_id,ordinal,lease_token,worker_ref,lease_expires_at) values(j.id,j.attempt_count,j.lease_token,p_worker_ref,j.lease_expires_at) returning * into a;
 return query select j.id,a.id,j.lease_token,j.request_payload;
end$$;


create or replace function public.compute_worker_transition(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_action text,p_safe_error_code text default null,p_result_reference jsonb default null)
returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; safe_code text; expected_outcome text;
begin
 select * into j from public.compute_jobs where id=p_job_id for update; if not found then raise exception 'JOB_NOT_FOUND'; end if;
 if p_action='success' and j.workload in ('image','trainer','video','stitch') then raise exception 'WORKLOAD_FINALIZATION_REQUIRED'; end if;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or a.lease_token<>p_lease_token then raise exception 'LEASE_MISMATCH'; end if;
 expected_outcome:=case p_action when 'success' then 'succeeded' when 'failure' then 'failed' when 'cancelled' then 'cancelled' end;
 if j.state in ('succeeded','failed','cancelled') then
  if expected_outcome is not null and j.state::text=expected_outcome and a.finished_at is not null and a.outcome_class=expected_outcome then return j.state; end if;
  raise exception 'TERMINAL_TRANSITION_CONFLICT';
 end if;
 if j.lease_token is distinct from p_lease_token or a.finished_at is not null or j.lease_expires_at<=clock_timestamp() then raise exception 'LEASE_MISMATCH'; end if;
 safe_code:=public.compute_safe_error(p_safe_error_code);
 if p_action='start' and j.state='claimed' then
  update public.compute_jobs set state='running',started_at=coalesce(started_at,now()),updated_at=now() where id=j.id;
  update public.compute_job_attempts set started_at=coalesce(started_at,now()) where id=a.id;
 elsif p_action='start' and j.state='running' and a.started_at is not null then
  return j.state;
 elsif p_action='success' and j.state in ('running','cancel_requested') then
  if a.provider_dispatch_intent_at is null or a.provider_dispatched_at is null or a.provider_operation_ref is null then raise exception 'EXECUTION_EVIDENCE_REQUIRED'; end if;
  if a.actual_cost_micros is null then raise exception 'ACTUAL_COST_REQUIRED'; end if;
  update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=public.compute_creator_result(p_result_reference),lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
  update public.compute_job_attempts set finished_at=now(),outcome_class='succeeded' where id=a.id;
 elsif p_action in ('failure','cancelled') and ((p_action='failure' and j.state in ('claimed','running')) or (p_action='cancelled' and j.state='cancel_requested')) then
  if a.provider_dispatch_intent_at is not null and a.actual_cost_micros is null then raise exception 'ACTUAL_COST_REQUIRED'; end if;
  if a.provider_dispatch_intent_at is null then perform public.release_compute_reservation(a.id); end if;
  update public.compute_jobs set state=expected_outcome::public.compute_job_state,terminal_at=now(),safe_error_code=case when p_action='failure' then safe_code else safe_error_code end,lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
  update public.compute_job_attempts set finished_at=now(),outcome_class=expected_outcome,safe_error_code=case when p_action='failure' then safe_code else safe_error_code end where id=a.id;
 else raise exception 'ILLEGAL_COMPUTE_TRANSITION'; end if;
 select state into j.state from public.compute_jobs where id=j.id; return j.state;
end$$;


create or replace function public.reconcile_compute_recovery(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid,p_outcome text,p_provider_nonexecution_proven boolean default false,p_safe_error_code text default null,p_result_reference jsonb default null,p_actual_cost_micros bigint default null,p_runtime_ms bigint default 0,p_provider_operation_ref text default null) returns public.compute_job_state language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; safe_code text; fingerprint text; final_state public.compute_job_state; pol public.compute_spend_policies;
begin
 safe_code:=public.compute_safe_error(p_safe_error_code);
 fingerprint:=encode(digest(jsonb_build_array(p_outcome,p_provider_nonexecution_proven,safe_code,public.compute_creator_result(p_result_reference),p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref)::text,'sha256'),'hex');
 select * into j from public.compute_jobs where id=p_job_id for update; if not found then raise exception 'RECOVERY_AUTHORITY_MISMATCH'; end if;
 if p_outcome='succeeded' and j.workload in ('image','trainer','video','stitch') then raise exception 'WORKLOAD_FINALIZATION_REQUIRED'; end if;
 select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=p_job_id for update;
 if not found or a.recovery_token is distinct from p_recovery_token then raise exception 'RECOVERY_AUTHORITY_MISMATCH'; end if;
 if a.recovery_fingerprint is not null then
  if a.recovery_fingerprint=fingerprint then return a.recovery_state; end if;
  raise exception 'RECOVERY_REPLAY_CONFLICT';
 end if;
 if j.state<>'recovering' or a.finished_at is not null or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'RECOVERY_AUTHORITY_MISMATCH'; end if;
 if p_outcome='requeue' then
  if not p_provider_nonexecution_proven or p_actual_cost_micros is not null then raise exception 'PROVIDER_NONEXECUTION_EVIDENCE_REQUIRED'; end if;
  perform public.release_compute_reservation(a.id);
  if j.cancellation_requested_at is not null then final_state:='cancelled';
  elsif j.retry_count+1<j.max_attempts then final_state:='queued';
  else final_state:='failed'; end if;
  update public.compute_jobs set state=final_state,retry_count=case when cancellation_requested_at is null then retry_count+1 else retry_count end,
   available_at=case when final_state='queued' then now() else available_at end,terminal_at=case when final_state in ('failed','cancelled') then now() else terminal_at end,
   safe_error_code=case when final_state='failed' then 'RETRY_LIMIT_REACHED' else safe_error_code end,updated_at=now() where id=j.id;
  update public.compute_job_attempts set finished_at=now(),outcome_class=case when final_state='cancelled' then 'cancelled_provider_nonexecution_proven' else 'provider_nonexecution_proven' end,
   recovery_fingerprint=fingerprint,recovery_state=final_state,recovery_lease_token=null,recovery_worker_ref=null,recovery_heartbeat_at=null,recovery_lease_expires_at=null where id=a.id;
 elsif p_outcome in ('succeeded','failed','cancelled') then
  if p_actual_cost_micros is null or p_actual_cost_micros<0 or p_runtime_ms<0 or a.provider_dispatch_intent_at is null then raise exception 'RECOVERY_EXECUTION_EVIDENCE_REQUIRED'; end if;
  if p_provider_operation_ref is not null then
   if length(p_provider_operation_ref) not between 1 and 500 then raise exception 'INVALID_OPERATION_REFERENCE'; end if;
   if a.provider_operation_ref is not null and a.provider_operation_ref<>p_provider_operation_ref then raise exception 'PROVIDER_OPERATION_CONFLICT'; end if;
   update public.compute_job_attempts set provider_operation_ref=coalesce(provider_operation_ref,p_provider_operation_ref),provider_dispatched_at=coalesce(provider_dispatched_at,now()) where id=a.id returning * into a;
  end if;
  if a.actual_cost_micros is not null and (a.actual_cost_micros<>p_actual_cost_micros or a.runtime_ms<>p_runtime_ms) then raise exception 'ACTUAL_COST_CONFLICT'; end if;
  if a.actual_cost_micros is null then
   select * into pol from public.compute_spend_policies where id=a.spend_policy_id for update; if not found then raise exception 'SPEND_POLICY_NOT_FOUND'; end if;
   perform public.release_compute_reservation(a.id);
   insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(j.id,a.id,'actual',p_actual_cost_micros);
   update public.compute_job_attempts set actual_cost_micros=p_actual_cost_micros,runtime_ms=p_runtime_ms where id=a.id returning * into a;
   perform public.emit_compute_spend_thresholds(a.spend_policy_id);
  end if;
  final_state:=p_outcome::public.compute_job_state;
  update public.compute_jobs set state=final_state,terminal_at=now(),result_reference=case when p_outcome='succeeded' then public.compute_creator_result(p_result_reference) else result_reference end,
   safe_error_code=case when p_outcome='failed' then safe_code else safe_error_code end,updated_at=now() where id=j.id;
  update public.compute_job_attempts set finished_at=now(),outcome_class='reconciled_'||p_outcome,safe_error_code=case when p_outcome='failed' then safe_code else safe_error_code end,
   recovery_fingerprint=fingerprint,recovery_state=final_state,recovery_lease_token=null,recovery_worker_ref=null,recovery_heartbeat_at=null,recovery_lease_expires_at=null where id=a.id;
 else raise exception 'INVALID_RECOVERY_OUTCOME'; end if;
 return final_state;
end$$;


create function public.video_compute_manifest(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; p public.video_projects; source jsonb;
begin
 select * into j from public.compute_jobs where id=p_job_id; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id;
 if not found or j.workload<>'video' or j.state not in ('claimed','running','cancel_requested') or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() or a.lease_token<>p_lease_token or a.finished_at is not null then raise exception 'VIDEO_MANIFEST_AUTHORITY_MISMATCH'; end if;
 select * into p from public.video_projects where video_job_id=j.id and owner_id=j.owner_id;
 if not found then raise exception 'VIDEO_PROJECT_BINDING_MISMATCH'; end if;
 if p.mode='image_to_video' then select jsonb_build_object('bucket',o.bucket,'object_key',o.object_key,'mime_type',o.mime_type,'size_bytes',o.size_bytes,'sha256',o.sha256) into source from public.generation_assets ga join public.private_storage_objects o on o.id=ga.storage_object_id where ga.id=p.source_generation_asset_id and ga.owner_id=p.owner_id and ga.kind='image'; if source is null then raise exception 'VIDEO_SOURCE_INVALID'; end if; end if;
 return jsonb_strip_nulls(jsonb_build_object('project_id',p.id,'identity_id',p.identity_id,'mode',p.mode,'segment_count',p.segment_count,'requested_duration_seconds',p.requested_duration_seconds,'target_fps',p.target_fps,'target_min_short_edge',p.target_min_short_edge,'source',source));
end$$;
create function public.recovered_video_compute_manifest(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; p public.video_projects; source jsonb;
begin
 select * into j from public.compute_jobs where id=p_job_id; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id;
 if not found or j.workload<>'video' or j.state<>'recovering' or a.finished_at is not null or a.recovery_token is distinct from p_recovery_token or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'VIDEO_RECOVERY_AUTHORITY_MISMATCH'; end if;
 select * into p from public.video_projects where video_job_id=j.id and owner_id=j.owner_id; if not found then raise exception 'VIDEO_PROJECT_BINDING_MISMATCH'; end if;
 if p.mode='image_to_video' then select jsonb_build_object('bucket',o.bucket,'object_key',o.object_key,'mime_type',o.mime_type,'size_bytes',o.size_bytes,'sha256',o.sha256) into source from public.generation_assets ga join public.private_storage_objects o on o.id=ga.storage_object_id where ga.id=p.source_generation_asset_id and ga.owner_id=p.owner_id and ga.kind='image'; end if;
 return jsonb_strip_nulls(jsonb_build_object('project_id',p.id,'identity_id',p.identity_id,'mode',p.mode,'segment_count',p.segment_count,'requested_duration_seconds',p.requested_duration_seconds,'target_fps',p.target_fps,'target_min_short_edge',p.target_min_short_edge,'source',source));
end$$;
create function public.stitch_compute_manifest(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; p public.video_projects; segments jsonb;
begin
 select * into j from public.compute_jobs where id=p_job_id; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id;
 if not found or j.workload<>'stitch' or j.state not in ('claimed','running','cancel_requested') or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() or a.lease_token<>p_lease_token or a.finished_at is not null then raise exception 'STITCH_MANIFEST_AUTHORITY_MISMATCH'; end if;
 select * into p from public.video_projects where stitch_job_id=j.id and owner_id=j.owner_id; if not found or p.cancellation_requested_at is not null or not exists(select 1 from public.compute_jobs where id=p.video_job_id and state='succeeded') then raise exception 'STITCH_DEPENDENCY_UNSATISFIED'; end if;
 select jsonb_agg(jsonb_build_object('ordinal',s.ordinal,'bucket',o.bucket,'object_key',o.object_key,'mime_type',o.mime_type,'size_bytes',o.size_bytes,'sha256',o.sha256) order by s.ordinal) into segments from public.video_project_segments s join public.private_storage_objects o on o.id=s.storage_object_id where s.project_id=p.id;
 if jsonb_array_length(coalesce(segments,'[]'))<>p.segment_count then raise exception 'STITCH_SEGMENTS_INCOMPLETE'; end if;
 return jsonb_build_object('project_id',p.id,'segment_count',p.segment_count,'requested_duration_seconds',p.requested_duration_seconds,'target_fps',p.target_fps,'target_min_short_edge',p.target_min_short_edge,'segments',segments);
end$$;
create function public.recovered_stitch_compute_manifest(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; p public.video_projects; segments jsonb;
begin
 select * into j from public.compute_jobs where id=p_job_id; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id;
 if not found or j.workload<>'stitch' or j.state<>'recovering' or a.finished_at is not null or a.recovery_token is distinct from p_recovery_token or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'STITCH_RECOVERY_AUTHORITY_MISMATCH'; end if;
 select * into p from public.video_projects where stitch_job_id=j.id and exists(select 1 from public.compute_jobs where id=p.video_job_id and state='succeeded');
 select jsonb_agg(jsonb_build_object('ordinal',s.ordinal,'bucket',o.bucket,'object_key',o.object_key,'mime_type',o.mime_type,'size_bytes',o.size_bytes,'sha256',o.sha256) order by s.ordinal) into segments from public.video_project_segments s join public.private_storage_objects o on o.id=s.storage_object_id where s.project_id=p.id;
 if not found or jsonb_array_length(coalesce(segments,'[]'))<>p.segment_count then raise exception 'STITCH_DEPENDENCY_UNSATISFIED'; end if;
 return jsonb_build_object('project_id',p.id,'segment_count',p.segment_count,'requested_duration_seconds',p.requested_duration_seconds,'target_fps',p.target_fps,'target_min_short_edge',p.target_min_short_edge,'segments',segments);
end$$;

create function public.finalize_video_segments(p_job public.compute_jobs,p_attempt public.compute_job_attempts,p_assets jsonb) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare p public.video_projects; e jsonb; o public.private_storage_objects; oid uuid; fingerprint text; result jsonb; expected text;
begin
 select * into p from public.video_projects where video_job_id=p_job.id and owner_id=p_job.owner_id for update; if not found then raise exception 'VIDEO_PROJECT_BINDING_MISMATCH'; end if;
 if jsonb_typeof(p_assets)<>'array' or jsonb_array_length(p_assets)<>p.segment_count then raise exception 'VIDEO_SEGMENT_COUNT_MISMATCH'; end if;
 if exists(select 1 from jsonb_array_elements(p_assets) x where jsonb_typeof(x)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(x) k)<>array['bucket','mime_type','object_key','ordinal','sha256','size_bytes']::text[] or jsonb_typeof(x->'ordinal')<>'number' or x->>'ordinal'!~'^[0-9]+$' or jsonb_typeof(x->'size_bytes')<>'number' or x->>'size_bytes'!~'^[1-9][0-9]*$' or (x->>'size_bytes')::bigint>104857600 or x->>'mime_type'<>'video/mp4' or x->>'sha256'!~'^[0-9a-f]{64}$' or x->>'bucket'<>btrim(x->>'bucket') or length(x->>'bucket') not between 3 and 63) then raise exception 'VIDEO_SEGMENT_EVIDENCE_INVALID'; end if;
 if exists(select 1 from generate_series(0,p.segment_count-1) n where not exists(select 1 from jsonb_array_elements(p_assets) x where (x->>'ordinal')::integer=n)) or (select count(distinct x->>'ordinal') from jsonb_array_elements(p_assets)x)<>p.segment_count then raise exception 'VIDEO_SEGMENT_ORDINALS_INVALID'; end if;
 if (select count(distinct x->>'bucket') from jsonb_array_elements(p_assets)x)<>1 then raise exception 'VIDEO_BUCKET_CONFLICT'; end if;
 fingerprint:=encode(digest(jsonb_build_array(p.id,p_assets)::text,'sha256'),'hex'); result:=jsonb_build_object('project_id',p.id);
 if p_attempt.internal_telemetry->>'workload_finalization_fingerprint' is not null and p_attempt.internal_telemetry->>'workload_finalization_fingerprint'<>fingerprint then raise exception 'VIDEO_FINALIZATION_REPLAY_CONFLICT'; end if;
 for e in select value from jsonb_array_elements(p_assets) order by (value->>'ordinal')::integer loop
  expected:='creator-video-projects/'||p.id::text||'/segments/'||(e->>'ordinal')||'/';
  if left(e->>'object_key',length(expected))<>expected or substring(e->>'object_key' from length(expected)+1)='' or substring(e->>'object_key' from length(expected)+1) like '%/%' or e->>'object_key' like '%..%' then raise exception 'VIDEO_OBJECT_NAMESPACE_INVALID'; end if;
  if p.storage_bucket is not null and p.storage_bucket<>e->>'bucket' then raise exception 'VIDEO_BUCKET_CONFLICT'; end if;
  select * into o from public.private_storage_objects where bucket=e->>'bucket' and object_key=e->>'object_key' for update;
  if found then if row(o.owner_id,o.mime_type,o.size_bytes,o.sha256) is distinct from row(p.owner_id,'video/mp4'::text,(e->>'size_bytes')::bigint,e->>'sha256') then raise exception 'PRIVATE_STORAGE_OBJECT_CONFLICT'; end if; oid:=o.id;
  else insert into public.private_storage_objects(owner_id,storage_class,bucket,object_key,mime_type,size_bytes,sha256,source_reference) values(p.owner_id,'creator_generation',e->>'bucket',e->>'object_key','video/mp4',(e->>'size_bytes')::bigint,e->>'sha256',jsonb_build_object('video_project_id',p.id,'segment_ordinal',(e->>'ordinal')::integer)) returning id into oid; end if;
  insert into public.video_project_segments(project_id,ordinal,storage_object_id) values(p.id,(e->>'ordinal')::smallint,oid) on conflict(project_id,ordinal) do nothing;
  if not exists(select 1 from public.video_project_segments where project_id=p.id and ordinal=(e->>'ordinal')::smallint and storage_object_id=oid) then raise exception 'VIDEO_SEGMENT_CONFLICT'; end if;
 end loop;
 update public.video_projects set storage_bucket=coalesce(storage_bucket,(p_assets->0)->>'bucket'),updated_at=clock_timestamp() where id=p.id;
 update public.compute_job_attempts set internal_telemetry=jsonb_set(internal_telemetry,'{workload_finalization_fingerprint}',to_jsonb(fingerprint)) where id=p_attempt.id;
 return result;
end$$;
create function public.finalize_video_compute_job(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_assets jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs;a public.compute_job_attempts;result jsonb;
begin select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id for update;
 if not found or j.workload<>'video' or a.lease_token<>p_lease_token or a.ordinal<>j.attempt_count then raise exception 'VIDEO_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if j.state='succeeded' then result:=public.finalize_video_segments(j,a,p_assets); if a.finished_at is not null and a.outcome_class='succeeded' and j.result_reference=result then return result; end if; raise exception 'VIDEO_FINALIZATION_REPLAY_CONFLICT'; end if;
 if j.state not in ('running','cancel_requested') or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() then raise exception 'VIDEO_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if a.provider_dispatch_intent_at is null or a.provider_dispatched_at is null or a.provider_operation_ref is null then raise exception 'VIDEO_EXECUTION_EVIDENCE_REQUIRED'; end if; if a.actual_cost_micros is null then raise exception 'ACTUAL_COST_REQUIRED'; end if;
 result:=public.finalize_video_segments(j,a,p_assets); update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=result,lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='succeeded' where id=a.id; return result; end$$;

create function public.settle_recovered_video_attempt(p_job public.compute_jobs,p_attempt public.compute_job_attempts,p_actual_cost_micros bigint,p_runtime_ms bigint,p_provider_operation_ref text) returns public.compute_job_attempts language plpgsql set search_path=pg_catalog,public as $$
declare a public.compute_job_attempts:=p_attempt;pol public.compute_spend_policies;
begin if p_actual_cost_micros is null or p_actual_cost_micros<0 or p_runtime_ms<0 or a.provider_dispatch_intent_at is null then raise exception 'RECOVERY_EXECUTION_EVIDENCE_REQUIRED'; end if;
 if p_provider_operation_ref is not null then if length(p_provider_operation_ref) not between 1 and 500 then raise exception 'INVALID_OPERATION_REFERENCE'; end if; if a.provider_operation_ref is not null and a.provider_operation_ref<>p_provider_operation_ref then raise exception 'PROVIDER_OPERATION_CONFLICT'; end if; update public.compute_job_attempts set provider_operation_ref=coalesce(provider_operation_ref,p_provider_operation_ref),provider_dispatched_at=coalesce(provider_dispatched_at,now()) where id=a.id returning * into a; end if;
 if a.actual_cost_micros is not null and (a.actual_cost_micros<>p_actual_cost_micros or a.runtime_ms<>p_runtime_ms) then raise exception 'ACTUAL_COST_CONFLICT'; end if;
 if a.actual_cost_micros is null then select * into pol from public.compute_spend_policies where id=a.spend_policy_id for update; if not found then raise exception 'SPEND_POLICY_NOT_FOUND'; end if; perform public.release_compute_reservation(a.id); insert into public.compute_cost_ledger(job_id,attempt_id,kind,amount_micros) values(p_job.id,a.id,'actual',p_actual_cost_micros); update public.compute_job_attempts set actual_cost_micros=p_actual_cost_micros,runtime_ms=p_runtime_ms where id=a.id returning * into a; perform public.emit_compute_spend_thresholds(a.spend_policy_id); end if; return a; end$$;

create function public.finalize_recovered_video_compute_job(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid,p_assets jsonb,p_actual_cost_micros bigint,p_runtime_ms bigint,p_provider_operation_ref text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs;a public.compute_job_attempts;result jsonb;rf text;
begin select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id for update;
 if not found or j.workload<>'video' or a.recovery_token is distinct from p_recovery_token then raise exception 'VIDEO_RECOVERY_AUTHORITY_MISMATCH'; end if;
 result:=public.finalize_video_segments(j,a,p_assets); rf:=encode(digest(jsonb_build_array('succeeded',false,null,result,p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref)::text,'sha256'),'hex');
 if a.recovery_fingerprint is not null then if j.state='succeeded' and a.recovery_fingerprint=rf and j.result_reference=result then return result; end if; raise exception 'VIDEO_FINALIZATION_REPLAY_CONFLICT'; end if;
 if j.state<>'recovering' or a.finished_at is not null or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'VIDEO_RECOVERY_AUTHORITY_MISMATCH'; end if;
 a:=public.settle_recovered_video_attempt(j,a,p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref); update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=result,updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='reconciled_succeeded',recovery_fingerprint=rf,recovery_state='succeeded',recovery_lease_token=null,recovery_worker_ref=null,recovery_heartbeat_at=null,recovery_lease_expires_at=null where id=a.id; return result; end$$;

create function public.finalize_stitch_product(p_job public.compute_jobs,p_attempt public.compute_job_attempts,p_evidence jsonb,p_runtime_ms bigint) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare p public.video_projects;asset jsonb;o public.private_storage_objects;oid uuid;aid uuid;g public.generations;fingerprint text;result jsonb;metadata jsonb;expected text;
begin select * into p from public.video_projects where stitch_job_id=p_job.id and owner_id=p_job.owner_id for update; if not found then raise exception 'STITCH_PROJECT_BINDING_MISMATCH'; end if;
 if not exists(select 1 from public.compute_jobs where id=p.video_job_id and state='succeeded') or (select count(*) from public.video_project_segments where project_id=p.id)<>p.segment_count then raise exception 'STITCH_DEPENDENCY_UNSATISFIED'; end if;
 if jsonb_typeof(p_evidence)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(p_evidence)k)<>array['asset','duration_ms','fps_millihz','height','width']::text[] or jsonb_typeof(p_evidence->'asset')<>'object' or (select array_agg(k order by k) from jsonb_object_keys(p_evidence->'asset')k)<>array['bucket','mime_type','object_key','sha256','size_bytes']::text[] then raise exception 'STITCH_EVIDENCE_INVALID'; end if; asset:=p_evidence->'asset';
 if asset->>'mime_type'<>'video/mp4' or asset->>'sha256'!~'^[0-9a-f]{64}$' or jsonb_typeof(asset->'size_bytes')<>'number' or asset->>'size_bytes'!~'^[1-9][0-9]*$' or (asset->>'size_bytes')::bigint>104857600 or asset->>'bucket' is distinct from p.storage_bucket
  or p_evidence->>'duration_ms'!~'^[1-9][0-9]*$' or p_evidence->>'width'!~'^[1-9][0-9]*$' or p_evidence->>'height'!~'^[1-9][0-9]*$' or p_evidence->>'fps_millihz'!~'^[1-9][0-9]*$'
  or least((p_evidence->>'width')::integer,(p_evidence->>'height')::integer)<1080 or (p_evidence->>'fps_millihz')::integer not between 29900 and 30100
  or (p_evidence->>'duration_ms')::integer not between (case p.priority_class when 'standard' then 10000 else 20000 end) and (case p.priority_class when 'standard' then 15000 else 25000 end)
  or abs((p_evidence->>'duration_ms')::integer-p.requested_duration_seconds*1000)>1000 then raise exception 'STITCH_OUTPUT_INVALID'; end if;
 expected:='creator-video-projects/'||p.id::text||'/final/'; if left(asset->>'object_key',length(expected))<>expected or substring(asset->>'object_key' from length(expected)+1)='' or substring(asset->>'object_key' from length(expected)+1) like '%/%' or asset->>'object_key' like '%..%' then raise exception 'STITCH_OBJECT_NAMESPACE_INVALID'; end if;
 metadata:=jsonb_strip_nulls(jsonb_build_object('private_creator_media',true,'kind','video','video_project_id',p.id,'segment_count',p.segment_count,'requested_duration_seconds',p.requested_duration_seconds,'actual_duration_ms',(p_evidence->>'duration_ms')::integer,'fps_millihz',(p_evidence->>'fps_millihz')::integer,'target_min_short_edge',p.target_min_short_edge,'source_generation_asset_id',p.source_generation_asset_id,'policy_version',1));
 fingerprint:=encode(digest(jsonb_build_array(p.id,p_evidence,metadata,p_runtime_ms)::text,'sha256'),'hex'); if p_attempt.internal_telemetry->>'workload_finalization_fingerprint' is not null and p_attempt.internal_telemetry->>'workload_finalization_fingerprint'<>fingerprint then raise exception 'STITCH_FINALIZATION_REPLAY_CONFLICT'; end if;
 select * into o from public.private_storage_objects where bucket=asset->>'bucket' and object_key=asset->>'object_key' for update; if found then if row(o.owner_id,o.mime_type,o.size_bytes,o.sha256) is distinct from row(p.owner_id,'video/mp4'::text,(asset->>'size_bytes')::bigint,asset->>'sha256') then raise exception 'PRIVATE_STORAGE_OBJECT_CONFLICT'; end if; oid:=o.id; else insert into public.private_storage_objects(owner_id,storage_class,bucket,object_key,mime_type,size_bytes,sha256,source_reference) values(p.owner_id,'creator_generation',asset->>'bucket',asset->>'object_key','video/mp4',(asset->>'size_bytes')::bigint,asset->>'sha256',jsonb_build_object('video_project_id',p.id,'kind','final')) returning id into oid; end if;
 select * into g from public.generations where id=p.id for update; if not found then insert into public.generations(id,user_id,prompt,image_url,lora_used,job_type,body_type,mode,status,negative_prompt,steps,cfg_scale,seed,width,height,runpod_job_id,processing_time_ms,completed_at,metadata,r2_bucket,r2_key,updated_at) values(p.id,p.owner_id,p.request_payload->>'prompt',null,p.identity_id::text,'video',p.request_payload->>'body_type',p.mode,'completed',p.request_payload->>'negative_prompt',null,null,null,(p_evidence->>'width')::integer,(p_evidence->>'height')::integer,null,p_runtime_ms::integer,clock_timestamp(),metadata,null,null,clock_timestamp()); else if row(g.user_id,g.prompt,g.negative_prompt,g.lora_used,g.job_type,g.mode,g.status,g.image_url,g.width,g.height,g.processing_time_ms,g.metadata,g.runpod_job_id,g.r2_bucket,g.r2_key) is distinct from row(p.owner_id,p.request_payload->>'prompt',p.request_payload->>'negative_prompt',p.identity_id::text,'video'::text,p.mode,'completed'::text,null::text,(p_evidence->>'width')::integer,(p_evidence->>'height')::integer,p_runtime_ms::integer,metadata,null::text,null::text,null::text) then raise exception 'VIDEO_GENERATION_CONFLICT'; end if; end if;
 insert into public.generation_assets(generation_id,storage_object_id,owner_id,ordinal,kind) values(p.id,oid,p.owner_id,0,'video') on conflict(generation_id,ordinal) do nothing; select id into aid from public.generation_assets where generation_id=p.id and ordinal=0 and storage_object_id=oid and owner_id=p.owner_id and kind='video'; if aid is null or (select count(*) from public.generation_assets where generation_id=p.id)<>1 then raise exception 'VIDEO_FINAL_ASSET_CONFLICT'; end if;
 result:=jsonb_build_object('project_id',p.id,'generation_id',p.id,'asset_ids',jsonb_build_array(aid)); update public.compute_job_attempts set internal_telemetry=jsonb_set(internal_telemetry,'{workload_finalization_fingerprint}',to_jsonb(fingerprint)) where id=p_attempt.id; return result; end$$;
create function public.finalize_stitch_compute_job(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid,p_evidence jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs;a public.compute_job_attempts;p public.video_projects;result jsonb;
begin select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id for update; if not found or j.workload<>'stitch' or a.lease_token<>p_lease_token or a.ordinal<>j.attempt_count then raise exception 'STITCH_FINALIZATION_AUTHORITY_MISMATCH'; end if;
 if j.state='succeeded' then result:=public.finalize_stitch_product(j,a,p_evidence,a.runtime_ms); if a.finished_at is not null and a.outcome_class='succeeded' and j.result_reference=result and exists(select 1 from public.video_projects where stitch_job_id=j.id and completed_at is not null) then return result; end if; raise exception 'STITCH_FINALIZATION_REPLAY_CONFLICT'; end if;
 if j.state not in ('running','cancel_requested') or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() then raise exception 'STITCH_FINALIZATION_AUTHORITY_MISMATCH'; end if; if a.provider_dispatch_intent_at is null or a.provider_dispatched_at is null or a.provider_operation_ref is null then raise exception 'STITCH_EXECUTION_EVIDENCE_REQUIRED'; end if; if a.actual_cost_micros is null then raise exception 'ACTUAL_COST_REQUIRED'; end if;
 result:=public.finalize_stitch_product(j,a,p_evidence,a.runtime_ms); update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=result,lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='succeeded' where id=a.id; update public.video_projects set completed_at=clock_timestamp(),updated_at=clock_timestamp() where stitch_job_id=j.id; return result; end$$;
create function public.finalize_recovered_stitch_compute_job(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid,p_evidence jsonb,p_actual_cost_micros bigint,p_runtime_ms bigint,p_provider_operation_ref text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs;a public.compute_job_attempts;result jsonb;rf text;
begin select * into j from public.compute_jobs where id=p_job_id for update; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id for update; if not found or j.workload<>'stitch' or a.recovery_token is distinct from p_recovery_token then raise exception 'STITCH_RECOVERY_AUTHORITY_MISMATCH'; end if;
 result:=public.finalize_stitch_product(j,a,p_evidence,p_runtime_ms); rf:=encode(digest(jsonb_build_array('succeeded',false,null,result,p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref)::text,'sha256'),'hex'); if a.recovery_fingerprint is not null then if j.state='succeeded' and a.recovery_fingerprint=rf and j.result_reference=result and exists(select 1 from public.video_projects where stitch_job_id=j.id and completed_at is not null) then return result; end if; raise exception 'STITCH_FINALIZATION_REPLAY_CONFLICT'; end if;
 if j.state<>'recovering' or a.finished_at is not null or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() then raise exception 'STITCH_RECOVERY_AUTHORITY_MISMATCH'; end if; a:=public.settle_recovered_video_attempt(j,a,p_actual_cost_micros,p_runtime_ms,p_provider_operation_ref); update public.compute_jobs set state='succeeded',terminal_at=now(),result_reference=result,updated_at=now() where id=j.id; update public.compute_job_attempts set finished_at=now(),outcome_class='reconciled_succeeded',recovery_fingerprint=rf,recovery_state='succeeded',recovery_lease_token=null,recovery_worker_ref=null,recovery_heartbeat_at=null,recovery_lease_expires_at=null where id=a.id; update public.video_projects set completed_at=clock_timestamp(),updated_at=clock_timestamp() where stitch_job_id=j.id; return result; end$$;

create function public.propagate_video_project_terminal_state() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.video_projects;
begin if new.workload<>'video' or new.state not in ('failed','cancelled') or old.state=new.state then return new; end if; select * into p from public.video_projects where video_job_id=new.id; if found then update public.compute_jobs set state=case new.state when 'failed' then 'failed'::public.compute_job_state else 'cancelled'::public.compute_job_state end,terminal_at=clock_timestamp(),safe_error_code=case new.state when 'failed' then 'VIDEO_GENERATION_STAGE_FAILED' else safe_error_code end,updated_at=clock_timestamp() where id=p.stitch_job_id and state='queued'; end if; return new; end$$;
create trigger propagate_video_project_terminal_state after update of state on public.compute_jobs for each row execute function public.propagate_video_project_terminal_state();

create function public.creator_video_project_status(p_owner_id uuid,p_project_id uuid) returns table(project_id uuid,creator_status text,created_at timestamptz,started_at timestamptz,completed_at timestamptz,safe_result jsonb,safe_error_code text,can_cancel boolean) language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.video_projects;v public.compute_jobs;s public.compute_jobs;status text;
begin select * into p from public.video_projects where id=p_project_id and owner_id=p_owner_id; if not found then raise exception 'VIDEO_PROJECT_NOT_FOUND'; end if; select * into v from public.compute_jobs where id=p.video_job_id; select * into s from public.compute_jobs where id=p.stitch_job_id;
 status:=case when p.completed_at is not null and s.state='succeeded' and exists(select 1 from public.generations g join public.generation_assets a on a.generation_id=g.id where g.id=p.id and g.status='completed' and g.job_type='video' and a.kind='video') then 'completed' when p.cancellation_requested_at is not null and (v.state not in ('cancelled','succeeded') or s.state not in ('cancelled','succeeded')) then 'cancelling' when v.state='cancelled' or s.state='cancelled' then 'cancelled' when v.state='failed' or s.state='failed' then 'failed' when v.state<>'succeeded' then case when v.state='queued' then 'queued' else 'generating' end when s.state='queued' then 'stitching' else 'stitching' end;
 return query select p.id,status,p.created_at,coalesce(v.started_at,s.started_at),p.completed_at,case when status='completed' then public.compute_creator_result(s.result_reference) else null end,case when status='failed' then coalesce(s.safe_error_code,v.safe_error_code) else null end,status in ('queued','generating','stitching','cancelling'); end$$;
create function public.cancel_video_project(p_owner_id uuid,p_project_id uuid) returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.video_projects;j public.compute_jobs;
begin select * into p from public.video_projects where id=p_project_id and owner_id=p_owner_id for update; if not found then raise exception 'VIDEO_PROJECT_NOT_FOUND'; end if; if p.completed_at is not null or exists(select 1 from public.compute_jobs where id in(p.video_job_id,p.stitch_job_id) and state='failed') then return (select creator_status from public.creator_video_project_status(p_owner_id,p_project_id)); end if;
 update public.video_projects set cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()),updated_at=clock_timestamp() where id=p.id;
 update public.compute_jobs set state=case when state='queued' then 'cancelled'::public.compute_job_state when state in ('claimed','running') then 'cancel_requested'::public.compute_job_state else state end,cancellation_requested_at=case when state in ('queued','claimed','running','recovering','cancel_requested') then coalesce(cancellation_requested_at,clock_timestamp()) else cancellation_requested_at end,terminal_at=case when state='queued' then clock_timestamp() else terminal_at end,updated_at=clock_timestamp() where id in(p.video_job_id,p.stitch_job_id) and state not in('succeeded','failed','cancelled'); return (select creator_status from public.creator_video_project_status(p_owner_id,p_project_id)); end$$;

revoke all on function public.video_project_segment_consistent(),public.finalize_video_segments(public.compute_jobs,public.compute_job_attempts,jsonb),public.finalize_stitch_product(public.compute_jobs,public.compute_job_attempts,jsonb,bigint),public.settle_recovered_video_attempt(public.compute_jobs,public.compute_job_attempts,bigint,bigint,text),public.propagate_video_project_terminal_state() from public,anon,authenticated,service_role;
revoke all on function public.submit_video_project_compute_jobs(uuid,uuid,uuid,text,text,jsonb,text),public.video_compute_manifest(uuid,uuid,uuid),public.recovered_video_compute_manifest(uuid,uuid,uuid,uuid),public.stitch_compute_manifest(uuid,uuid,uuid),public.recovered_stitch_compute_manifest(uuid,uuid,uuid,uuid),public.finalize_video_compute_job(uuid,uuid,uuid,jsonb),public.finalize_recovered_video_compute_job(uuid,uuid,uuid,uuid,jsonb,bigint,bigint,text),public.finalize_stitch_compute_job(uuid,uuid,uuid,jsonb),public.finalize_recovered_stitch_compute_job(uuid,uuid,uuid,uuid,jsonb,bigint,bigint,text),public.creator_video_project_status(uuid,uuid),public.cancel_video_project(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.submit_video_project_compute_jobs(uuid,uuid,uuid,text,text,jsonb,text),public.video_compute_manifest(uuid,uuid,uuid),public.recovered_video_compute_manifest(uuid,uuid,uuid,uuid),public.stitch_compute_manifest(uuid,uuid,uuid),public.recovered_stitch_compute_manifest(uuid,uuid,uuid,uuid),public.finalize_video_compute_job(uuid,uuid,uuid,jsonb),public.finalize_recovered_video_compute_job(uuid,uuid,uuid,uuid,jsonb,bigint,bigint,text),public.finalize_stitch_compute_job(uuid,uuid,uuid,jsonb),public.finalize_recovered_stitch_compute_job(uuid,uuid,uuid,uuid,jsonb,bigint,bigint,text),public.creator_video_project_status(uuid,uuid),public.cancel_video_project(uuid,uuid) to service_role;
revoke all on function public.submit_compute_job(uuid,public.compute_workload,text,text,jsonb,text),public.claim_compute_job(public.compute_workload,text),public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb),public.reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_compute_job(uuid,public.compute_workload,text,text,jsonb,text),public.claim_compute_job(public.compute_workload,text),public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb),public.reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text) to service_role;
commit;
