-- Guarded emergency rollback for unapplied Phase 4 Video subscriber application.
-- Production execution requires separate explicit authorization.
begin;
do $$ begin
 if to_regclass('public.video_source_uploads') is not null and exists(select 1 from public.video_source_uploads) then raise exception 'PHASE4_ROLLBACK_REFUSED_SOURCE_UPLOAD_DATA'; end if;
 if exists(select 1 from public.video_projects where identity_id is null) then raise exception 'PHASE4_ROLLBACK_REFUSED_NULL_IDENTITY_PROJECTS'; end if;
 if exists(select 1 from public.generations where mode='video_source_import' or metadata->>'source_mode'='video_source_import') then raise exception 'PHASE4_ROLLBACK_REFUSED_IMPORTED_SOURCE_DATA'; end if;
 if exists(select 1 from public.compute_jobs where workload='video' and request_payload ? 'identity_reference') then raise exception 'PHASE4_ROLLBACK_REFUSED_DURABLE_DATA'; end if;
end$$;
drop function if exists public.finalize_video_source_upload(uuid,uuid,uuid,text,bigint,text);
drop function if exists public.claim_video_source_upload_finalization(uuid,uuid,uuid);
drop function if exists public.create_video_source_upload(uuid,uuid,text,text,text,text,text,bigint,timestamptz);
drop table if exists public.video_source_uploads;
alter table public.video_projects alter column identity_id set not null;
create or replace function public.submit_video_project_compute_jobs(p_owner_id uuid,p_identity_id uuid,p_source_generation_asset_id uuid,p_idempotency_key text,p_request_fingerprint text,p_request_payload jsonb,p_priority_class text)
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
  return query select p.id,x->>'creator_status',p.created_at,case when x->>'creator_status'='completed' then p.completed_at else null end,(x->>'can_cancel')::boolean from public.video_project_creator_projection(p) x; return;
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
  select ga.* into source from public.generation_assets ga join public.generations g on g.id=ga.generation_id join public.private_storage_objects o on o.id=ga.storage_object_id
   where ga.id=p_source_generation_asset_id and ga.owner_id=p_owner_id and ga.kind='image' and g.user_id=p_owner_id and g.status='completed' and g.image_url is null
     and o.owner_id=p_owner_id and o.mime_type in ('image/jpeg','image/png','image/webp') for update of ga,g,o;
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
create or replace function public.video_compute_manifest(p_job_id uuid,p_attempt_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; p public.video_projects; source jsonb;
begin
 select * into j from public.compute_jobs where id=p_job_id; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id;
 if not found or j.workload<>'video' or j.state not in ('claimed','running','cancel_requested') or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() or a.lease_token<>p_lease_token or a.ordinal<>j.attempt_count or a.finished_at is not null then raise exception 'VIDEO_MANIFEST_AUTHORITY_MISMATCH'; end if;
 select * into p from public.video_projects where video_job_id=j.id and owner_id=j.owner_id;
 if not found then raise exception 'VIDEO_PROJECT_BINDING_MISMATCH'; end if;
 if p.mode='image_to_video' then select jsonb_build_object('bucket',o.bucket,'object_key',o.object_key,'mime_type',o.mime_type,'size_bytes',o.size_bytes,'sha256',o.sha256) into source from public.generation_assets ga join public.generations g on g.id=ga.generation_id join public.private_storage_objects o on o.id=ga.storage_object_id where ga.id=p.source_generation_asset_id and ga.owner_id=p.owner_id and ga.kind='image' and g.user_id=p.owner_id and g.status='completed' and g.image_url is null and o.owner_id=p.owner_id and o.mime_type in ('image/jpeg','image/png','image/webp'); if source is null then raise exception 'VIDEO_SOURCE_INVALID'; end if; end if;
 return jsonb_strip_nulls(jsonb_build_object('project_id',p.id,'identity_id',p.identity_id,'mode',p.mode,'segment_count',p.segment_count,'requested_duration_seconds',p.requested_duration_seconds,'target_fps',p.target_fps,'target_min_short_edge',p.target_min_short_edge,'source',source));
end$$;
create or replace function public.recovered_video_compute_manifest(p_job_id uuid,p_attempt_id uuid,p_recovery_token uuid,p_recovery_lease_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.compute_jobs; a public.compute_job_attempts; p public.video_projects; source jsonb;
begin
 select * into j from public.compute_jobs where id=p_job_id; select * into a from public.compute_job_attempts where id=p_attempt_id and job_id=j.id;
 if not found or j.workload<>'video' or j.state<>'recovering' or a.finished_at is not null or a.recovery_token is distinct from p_recovery_token or a.recovery_lease_token is distinct from p_recovery_lease_token or a.recovery_lease_expires_at<=clock_timestamp() or a.ordinal<>j.attempt_count then raise exception 'VIDEO_RECOVERY_AUTHORITY_MISMATCH'; end if;
 select * into p from public.video_projects where video_job_id=j.id and owner_id=j.owner_id; if not found then raise exception 'VIDEO_PROJECT_BINDING_MISMATCH'; end if;
 if p.mode='image_to_video' then select jsonb_build_object('bucket',o.bucket,'object_key',o.object_key,'mime_type',o.mime_type,'size_bytes',o.size_bytes,'sha256',o.sha256) into source from public.generation_assets ga join public.generations g on g.id=ga.generation_id join public.private_storage_objects o on o.id=ga.storage_object_id where ga.id=p.source_generation_asset_id and ga.owner_id=p.owner_id and ga.kind='image' and g.user_id=p.owner_id and g.status='completed' and g.image_url is null and o.owner_id=p.owner_id and o.mime_type in ('image/jpeg','image/png','image/webp'); if source is null then raise exception 'VIDEO_SOURCE_INVALID'; end if; end if;
 return jsonb_strip_nulls(jsonb_build_object('project_id',p.id,'identity_id',p.identity_id,'mode',p.mode,'segment_count',p.segment_count,'requested_duration_seconds',p.requested_duration_seconds,'target_fps',p.target_fps,'target_min_short_edge',p.target_min_short_edge,'source',source));
end$$;
revoke all on function public.submit_video_project_compute_jobs(uuid,uuid,uuid,text,text,jsonb,text),public.video_compute_manifest(uuid,uuid,uuid),public.recovered_video_compute_manifest(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.submit_video_project_compute_jobs(uuid,uuid,uuid,text,text,jsonb,text),public.video_compute_manifest(uuid,uuid,uuid),public.recovered_video_compute_manifest(uuid,uuid,uuid,uuid) to service_role;
commit;
