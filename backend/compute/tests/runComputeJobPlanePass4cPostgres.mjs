import { spawnSync } from "node:child_process";
const url=process.env.COMPUTE_JOB_PLANE_DATABASE_URL;
if(!url){console.error("COMPUTE_JOB_PLANE_DATABASE_URL is required");process.exit(2)}
const run=(args,expectFailure=false)=>{const r=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1",...args],{encoding:"utf8"});if(expectFailure){if(r.status===0)throw new Error("expected SQL failure");return r}if(r.status){process.stderr.write(r.stderr);process.stdout.write(r.stdout);process.exit(r.status??1)}return r};
for(const file of ["backend/compute/tests/computeJobPlanePostgresSetup.sql","supabase/migrations/20260824090000_private_creator_generation_media.sql","supabase/migrations/20260825090000_durable_compute_job_plane.sql","supabase/migrations/20260826004344_durable_compute_pass_4a_finalization.sql"]){run(["-f",file])}
run(["-c",`create table public.pass4c_predefinition_sentinel(signature text primary key,definition text not null); insert into public.pass4c_predefinition_sentinel values
 ('submit_compute_job',pg_get_functiondef('public.submit_compute_job(uuid,public.compute_workload,text,text,jsonb,text)'::regprocedure)),
 ('claim_compute_job',pg_get_functiondef('public.claim_compute_job(public.compute_workload,text)'::regprocedure)),
 ('compute_worker_transition',pg_get_functiondef('public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb)'::regprocedure)),
 ('reconcile_compute_recovery',pg_get_functiondef('public.reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text)'::regprocedure));
 create table public.pass4c_preconstraint_sentinel(name text primary key,definition text not null); insert into public.pass4c_preconstraint_sentinel select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.private_storage_objects'::regclass and conname in ('private_storage_objects_mime_type_check','private_storage_objects_size_bytes_check');`]);
run(["-c",`insert into auth.users values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002'); insert into public.user_loras(id,user_id,status) values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','draft');`]);
run(["-f","supabase/migrations/20260826120000_durable_compute_pass_4c_video_stitch_foundation.sql"]);
run(["-f","backend/compute/tests/computeJobPlanePass4cPostgresIntegration.sql"]);
const refused=run(["-f","supabase/manual/durable_compute_pass_4c_video_stitch_foundation_emergency_rollback.sql"],true);if(!refused.stderr.includes("PASS4C_ROLLBACK_REFUSED_VIDEO_PROJECT_DATA"))throw new Error(`rollback did not refuse data: ${refused.stderr}`);
run(["-c",`delete from public.generation_assets where generation_id in(select id from public.video_projects); delete from public.generations where id in(select id from public.video_projects); delete from public.video_project_segments; delete from public.private_storage_objects where source_reference ? 'video_project_id'; delete from public.video_projects; delete from public.compute_job_attempts where job_id in(select id from public.compute_jobs where workload in('video','stitch')); delete from public.compute_cost_ledger where job_id in(select id from public.compute_jobs where workload in('video','stitch')); delete from public.compute_jobs where workload in('video','stitch');`]);
run(["-f","supabase/manual/durable_compute_pass_4c_video_stitch_foundation_emergency_rollback.sql"]);
run(["-c",`do $$ begin
 assert to_regclass('public.video_projects') is null; assert to_regclass('public.video_project_segments') is null;
 assert pg_get_functiondef('public.submit_compute_job(uuid,public.compute_workload,text,text,jsonb,text)'::regprocedure)=(select definition from public.pass4c_predefinition_sentinel where signature='submit_compute_job');
 assert pg_get_functiondef('public.claim_compute_job(public.compute_workload,text)'::regprocedure)=(select definition from public.pass4c_predefinition_sentinel where signature='claim_compute_job');
 assert pg_get_functiondef('public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb)'::regprocedure)=(select definition from public.pass4c_predefinition_sentinel where signature='compute_worker_transition');
 assert pg_get_functiondef('public.reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text)'::regprocedure)=(select definition from public.pass4c_predefinition_sentinel where signature='reconcile_compute_recovery');
 assert not exists(select 1 from public.pass4c_preconstraint_sentinel s where s.definition<>(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.private_storage_objects'::regclass and conname=s.name));
 assert to_regprocedure('public.finalize_image_compute_job(uuid,uuid,uuid,jsonb)') is not null; assert to_regprocedure('public.finalize_trainer_compute_job(uuid,uuid,uuid,text,text)') is not null;
end$$;`]);
console.log("Compute job plane Pass 4C-A PostgreSQL integration and exact rollback passed.");
