\set ON_ERROR_STOP on
-- Structural, security, boundary, and submission truth on the disposable Pass 4C database.
do $$ begin
 assert to_regclass('public.video_projects') is not null;
 assert to_regclass('public.video_project_segments') is not null;
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.video_projects'::regclass);
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.video_project_segments'::regclass);
 assert not has_table_privilege('service_role','public.video_projects','select');
 assert not has_table_privilege('service_role','public.video_project_segments','select');
 assert has_function_privilege('service_role','public.submit_video_project_compute_jobs(uuid,uuid,uuid,text,text,jsonb,text)','execute');
 assert not has_function_privilege('authenticated','public.submit_video_project_compute_jobs(uuid,uuid,uuid,text,text,jsonb,text)','execute');
 assert not has_function_privilege('service_role','public.finalize_video_segments(public.compute_jobs,public.compute_job_attempts,jsonb)','execute');
 assert pg_get_functiondef('public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb)'::regprocedure) like '%image%trainer%video%stitch%WORKLOAD_FINALIZATION_REQUIRED%';
 assert pg_get_functiondef('public.reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text)'::regprocedure) like '%image%trainer%video%stitch%WORKLOAD_FINALIZATION_REQUIRED%';
end$$;

do $$ begin
 begin perform public.submit_compute_job('10000000-0000-4000-8000-000000000001','video','blocked',repeat('a',64),'{}','standard'); raise exception 'generic Video accepted'; exception when others then assert sqlerrm like '%WORKLOAD_SUBMISSION_REQUIRED%'; end;
 begin perform public.submit_compute_job('10000000-0000-4000-8000-000000000001','stitch','blocked',repeat('a',64),'{}','standard'); raise exception 'generic Stitch accepted'; exception when others then assert sqlerrm like '%WORKLOAD_SUBMISSION_REQUIRED%'; end;
end$$;

update public.user_loras set status='completed',artifact_r2_bucket='private-bucket',artifact_r2_key='loras/20000000-0000-4000-8000-000000000001/final.safetensors' where id='20000000-0000-4000-8000-000000000001';
insert into public.compute_scheduler_policies(workload,max_global_active,lease_seconds,stale_seconds,max_attempts,og_priority_seconds,spend_hold_seconds,enabled) values
 ('video',2,60,120,3,120,60,true),('stitch',2,60,120,4,0,60,true) on conflict(workload) do update set max_attempts=excluded.max_attempts,enabled=true;
create temporary table submitted as select project_id from public.submit_video_project_compute_jobs('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',null,'video-project-a',repeat('a',64),'{"identity_id":"20000000-0000-4000-8000-000000000001","mode":"text_to_video","requested_duration_seconds":10,"fps":30,"prompt":"test","body_type":"default"}','standard') \gset

do $$ begin
 assert (select segment_count=2 and target_fps=30 and target_min_short_edge=1080 from public.video_projects where id=(select project_id from submitted));
 assert (select count(*)=1 from public.compute_jobs where workload='video' and request_payload->>'project_id'=(select project_id::text from submitted));
 assert (select count(*)=1 from public.compute_jobs where workload='stitch' and request_payload->>'project_id'=(select project_id::text from submitted));
 assert (select max_attempts=3 from public.compute_jobs where workload='video' and request_payload->>'project_id'=(select project_id::text from submitted));
 assert (select max_attempts=4 from public.compute_jobs where workload='stitch' and request_payload->>'project_id'=(select project_id::text from submitted));
 assert not exists(select 1 from public.claim_compute_job('stitch','worker'));
end$$;
-- Exercise normal authority, contiguous segment persistence, Stitch dependency, and canonical product.
update public.compute_jobs set state='running',attempt_count=1,lease_token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lease_expires_at=clock_timestamp()+interval '5 minutes',started_at=clock_timestamp()
 where id=(select video_job_id from public.video_projects where id=(select project_id from submitted));
insert into public.compute_job_attempts(job_id,ordinal,lease_token,worker_ref,lease_expires_at,started_at,provider_dispatch_intent_at,provider_dispatched_at,provider_operation_ref,actual_cost_micros,runtime_ms)
 select video_job_id,1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','video-test',clock_timestamp()+interval '5 minutes',clock_timestamp(),clock_timestamp(),clock_timestamp(),'opaque-video-operation',0,5000 from public.video_projects where id=(select project_id from submitted);
select public.finalize_video_compute_job(v.video_job_id,a.id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',jsonb_build_array(
 jsonb_build_object('ordinal',0,'bucket','video-private','object_key','creator-video-projects/'||v.id||'/segments/0/segment-0.mp4','mime_type','video/mp4','size_bytes',1000,'sha256',repeat('1',64)),
 jsonb_build_object('ordinal',1,'bucket','video-private','object_key','creator-video-projects/'||v.id||'/segments/1/segment-1.mp4','mime_type','video/mp4','size_bytes',1001,'sha256',repeat('2',64))))
 from public.video_projects v join public.compute_job_attempts a on a.job_id=v.video_job_id where v.id=(select project_id from submitted);
do $$ begin assert (select count(*)=2 from public.video_project_segments where project_id=(select project_id from submitted)); assert not exists(select 1 from public.generation_assets where generation_id=(select project_id from submitted)); end$$;
create temporary table stitch_claim as select * from public.claim_compute_job('stitch','stitch-test');
update public.compute_jobs set state='running',started_at=clock_timestamp() where id=(select job_id from stitch_claim);
update public.compute_job_attempts set started_at=clock_timestamp(),provider_dispatch_intent_at=clock_timestamp(),provider_dispatched_at=clock_timestamp(),provider_operation_ref='opaque-stitch-operation',actual_cost_micros=0,runtime_ms=6000 where id=(select attempt_id from stitch_claim);
select public.finalize_stitch_compute_job((select job_id from stitch_claim),(select attempt_id from stitch_claim),(select lease_token from stitch_claim),jsonb_build_object('asset',jsonb_build_object('bucket','video-private','object_key','creator-video-projects/'||(select project_id from submitted)||'/final/final.mp4','mime_type','video/mp4','size_bytes',2000,'sha256',repeat('3',64)),'duration_ms',10000,'width',1920,'height',1080,'fps_millihz',30000));
do $$ begin
 assert (select completed_at is not null from public.video_projects where id=(select project_id from submitted));
 assert (select count(*)=1 from public.generations where id=(select project_id from submitted) and job_type='video' and status='completed' and image_url is null and r2_bucket is null and r2_key is null and runpod_job_id is null);
 assert (select count(*)=1 from public.generation_assets where generation_id=(select project_id from submitted) and kind='video' and ordinal=0);
 assert (select count(*)=2 from public.video_project_segments where project_id=(select project_id from submitted));
 assert (select result_reference=jsonb_build_object('project_id',video_projects.id,'generation_id',video_projects.id,'asset_ids',compute_jobs.result_reference->'asset_ids') from public.compute_jobs join public.video_projects on stitch_job_id=compute_jobs.id where video_projects.id=(select project_id from submitted));
end$$;

-- Identical submission replays the same safe project; changed fingerprints conflict.
select project_id from public.submit_video_project_compute_jobs('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',null,'video-project-a',repeat('a',64),'{"identity_id":"20000000-0000-4000-8000-000000000001","mode":"text_to_video","requested_duration_seconds":10,"fps":30,"prompt":"test","body_type":"default"}','standard');
do $$ begin begin perform public.submit_video_project_compute_jobs('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',null,'video-project-a',repeat('b',64),'{"identity_id":"20000000-0000-4000-8000-000000000001","mode":"text_to_video","requested_duration_seconds":10}','standard'); raise exception 'conflict accepted'; exception when others then assert sqlerrm like '%IDEMPOTENCY_CONFLICT%'; end; end$$;
