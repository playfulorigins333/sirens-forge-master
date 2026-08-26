import { spawn, spawnSync } from "node:child_process";
const url=process.env.COMPUTE_JOB_PLANE_DATABASE_URL;
if(!url){console.error("COMPUTE_JOB_PLANE_DATABASE_URL is required");process.exit(2)}
const run=(args,stdio="inherit")=>{const r=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1",...args],{stdio});if(r.status)process.exit(r.status??1)};
for(const file of ["backend/compute/tests/computeJobPlanePostgresSetup.sql","supabase/migrations/20260824090000_private_creator_generation_media.sql","supabase/migrations/20260825090000_durable_compute_job_plane.sql"]){run(["-f",file])}
run(["-c",`create table public.pass4a_predefinition_sentinel(signature text primary key,definition text not null); insert into public.pass4a_predefinition_sentinel values
 ('submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text)',pg_get_functiondef('public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text)'::regprocedure)),
 ('compute_worker_transition(uuid,uuid,uuid,text,text,jsonb)',pg_get_functiondef('public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb)'::regprocedure)),
 ('reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text)',pg_get_functiondef('public.reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text)'::regprocedure));`]);
run(["-f","supabase/migrations/20260826004344_durable_compute_pass_4a_finalization.sql"]);
run(["-f","backend/compute/tests/computeJobPlaneConcurrentSeed.sql"]);
const sql=(key,hex)=>`select job_id from public.submit_trainer_compute_job('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','${key}',repeat('${hex}',64),'{"identity_id":"20000000-0000-4000-8000-000000000001"}','standard','datasets','approved/path')`;
const submit=(statement)=>new Promise(resolve=>{const p=spawn("psql",[url,"-v","ON_ERROR_STOP=1","-At","-c",statement],{stdio:["ignore","pipe","pipe"]});let out="",err="";p.stdout.on("data",c=>out+=c);p.stderr.on("data",c=>err+=c);p.on("close",code=>resolve({code,out,err}))});
const concurrent=await Promise.all([submit(sql("race-a","a")),submit(sql("race-b","b"))]);
if(concurrent.filter(x=>x.code===0).length!==1||concurrent.filter(x=>x.err.includes("TRAINER_ALREADY_ACTIVE")).length!==1) throw new Error(`same-Twin concurrency invariant failed: ${JSON.stringify(concurrent)}`);
run(["-c","do $$ begin assert (select count(*)=1 from public.compute_jobs where idempotency_key in ('race-a','race-b')); end $$;"]);
const accepted=concurrent.find(x=>x.code===0); const acceptedKey=concurrent[0].code===0?"race-a":"race-b"; const acceptedHex=acceptedKey.endsWith("a")?"a":"b";
const replay=await submit(sql(acceptedKey,acceptedHex)); if(replay.code!==0||replay.out.trim()!==accepted.out.trim()) throw new Error("accepted Trainer submission did not replay idempotently");
const conflict=await submit(sql(acceptedKey,acceptedHex==="a"?"b":"a")); if(conflict.code===0||!conflict.err.includes("IDEMPOTENCY_CONFLICT")) throw new Error("conflicting Trainer replay was not rejected");
run(["-c","update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where state not in ('succeeded','failed','cancelled'); update public.compute_job_attempts set finished_at=coalesce(finished_at,now()),outcome_class=coalesce(outcome_class,'test_cleanup') where finished_at is null; delete from public.compute_cost_ledger; update public.user_loras set training_job_id=null,status='draft';"]);
const twin=(owner,lora,key,hex)=>`select job_id from public.submit_trainer_compute_job('${owner}','${lora}','${key}',repeat('${hex}',64),'{"identity_id":"${lora}"}','standard','datasets','approved/path')`;
const distinct=await Promise.all([submit(twin('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','distinct-a','c')),submit(twin('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','distinct-b','d'))]);
if(distinct.some(x=>x.code!==0)) throw new Error(`different-Twin concurrency failed: ${JSON.stringify(distinct)}`);
run(["-c","update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where state not in ('succeeded','failed','cancelled'); update public.user_loras set training_job_id=null,status='draft';"]);
const later=await submit(twin('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','after-terminal','e')); if(later.code!==0) throw new Error(`terminal Twin did not accept later training: ${JSON.stringify(later)}`);
run(["-c","update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where state not in ('succeeded','failed','cancelled'); update public.user_loras set training_job_id=null,status='draft';"]);
run(["-f","backend/compute/tests/computeJobPlanePass4aPostgresIntegration.sql"]);
run(["-f","supabase/manual/durable_compute_pass_4a_emergency_rollback.sql"]);
run(["-c",`do $$ begin
 assert to_regclass('public.compute_jobs') is not null; assert to_regclass('public.compute_job_attempts') is not null; assert to_regclass('public.compute_cost_ledger') is not null;
 assert to_regclass('public.private_storage_objects') is not null; assert to_regclass('public.generation_assets') is not null; assert to_regclass('public.generations') is not null; assert to_regclass('public.user_loras') is not null;
 assert to_regprocedure('public.finalize_image_compute_job(uuid,uuid,uuid,jsonb)') is null; assert to_regprocedure('public.finalize_recovered_image_compute_job(uuid,uuid,uuid,uuid,jsonb,bigint,bigint,text)') is null;
 assert to_regprocedure('public.finalize_trainer_compute_job(uuid,uuid,uuid,text,text)') is null; assert to_regprocedure('public.finalize_recovered_trainer_compute_job(uuid,uuid,uuid,uuid,text,text,bigint,bigint,text)') is null;
 assert to_regprocedure('public.project_trainer_compute_state()') is null; assert not exists(select 1 from pg_trigger where tgname='project_trainer_compute_state' and not tgisinternal);
 assert pg_get_functiondef('public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text)'::regprocedure)=(select definition from public.pass4a_predefinition_sentinel where signature='submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text)');
 assert pg_get_functiondef('public.compute_worker_transition(uuid,uuid,uuid,text,text,jsonb)'::regprocedure)=(select definition from public.pass4a_predefinition_sentinel where signature='compute_worker_transition(uuid,uuid,uuid,text,text,jsonb)');
 assert pg_get_functiondef('public.reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text)'::regprocedure)=(select definition from public.pass4a_predefinition_sentinel where signature='reconcile_compute_recovery(uuid,uuid,uuid,uuid,text,boolean,text,jsonb,bigint,bigint,text)');
end $$; drop table public.pass4a_predefinition_sentinel;`]);
console.log("Compute job plane Pass 4A PostgreSQL integration and exact rollback passed.");
