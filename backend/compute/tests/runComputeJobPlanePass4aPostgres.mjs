import { spawn, spawnSync } from "node:child_process";
const url=process.env.COMPUTE_JOB_PLANE_DATABASE_URL;
if(!url){console.error("COMPUTE_JOB_PLANE_DATABASE_URL is required");process.exit(2)}
const run=(args,stdio="inherit")=>{const r=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1",...args],{stdio});if(r.status)process.exit(r.status??1)};
for(const file of ["backend/compute/tests/computeJobPlanePostgresSetup.sql","supabase/migrations/20260824090000_private_creator_generation_media.sql","supabase/migrations/20260825090000_durable_compute_job_plane.sql","supabase/migrations/20260826004344_durable_compute_pass_4a_finalization.sql","backend/compute/tests/computeJobPlaneConcurrentSeed.sql"]){run(["-f",file])}
const sql=(key)=>`select job_id from public.submit_trainer_compute_job('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','${key}',repeat('${key.endsWith("a")?"a":"b"}',64),'{"identity_id":"20000000-0000-4000-8000-000000000001"}','standard','datasets','approved/path')`;
const submit=(key)=>new Promise(resolve=>{const p=spawn("psql",[url,"-v","ON_ERROR_STOP=1","-At","-c",sql(key)],{stdio:["ignore","pipe","pipe"]});let out="",err="";p.stdout.on("data",c=>out+=c);p.stderr.on("data",c=>err+=c);p.on("close",code=>resolve({code,out,err}))});
const concurrent=await Promise.all([submit("race-a"),submit("race-b")]);
if(concurrent.filter(x=>x.code===0).length!==1||concurrent.filter(x=>x.err.includes("TRAINER_ALREADY_ACTIVE")).length!==1) throw new Error(`same-Twin concurrency invariant failed: ${JSON.stringify(concurrent)}`);
const acceptedKey=concurrent[0].code===0?"race-a":"race-b";
const replay=await submit(acceptedKey); if(replay.code!==0||replay.out.trim()!==concurrent.find(x=>x.code===0).out.trim()) throw new Error("accepted Trainer submission did not replay idempotently");
run(["-c","update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where state not in ('succeeded','failed','cancelled'); update public.compute_job_attempts set finished_at=coalesce(finished_at,now()),outcome_class=coalesce(outcome_class,'test_cleanup') where finished_at is null; delete from public.compute_cost_ledger; update public.user_loras set training_job_id=null,status='draft';"]);
const differentTwinSql=(lora,key,hex)=>`select job_id from public.submit_trainer_compute_job('${lora.endsWith("1")?"10000000-0000-4000-8000-000000000001":"10000000-0000-4000-8000-000000000002"}','${lora}','${key}',repeat('${hex}',64),'{"identity_id":"${lora}"}','standard','datasets','approved/path')`;
const raw=(statement)=>new Promise(resolve=>{const p=spawn("psql",[url,"-v","ON_ERROR_STOP=1","-At","-c",statement],{stdio:["ignore","pipe","pipe"]});let err="";p.stderr.on("data",c=>err+=c);p.on("close",code=>resolve({code,err}))});
const distinct=await Promise.all([raw(differentTwinSql("20000000-0000-4000-8000-000000000001","distinct-a","c")),raw(differentTwinSql("20000000-0000-4000-8000-000000000002","distinct-b","d"))]);
if(distinct.some(x=>x.code!==0)) throw new Error(`different-Twin concurrency failed: ${JSON.stringify(distinct)}`);
run(["-c","update public.compute_jobs set state='cancelled',terminal_at=now(),lease_token=null,lease_expires_at=null where state not in ('succeeded','failed','cancelled'); update public.user_loras set training_job_id=null,status='draft';"]);
run(["-f","backend/compute/tests/computeJobPlanePass4aPostgresIntegration.sql"]);
run(["-f","supabase/manual/durable_compute_pass_4a_emergency_rollback.sql"]);
run(["-At","-c","select to_regclass('public.compute_jobs') is not null and to_regclass('public.private_storage_objects') is not null and to_regclass('public.generations') is not null and to_regclass('public.user_loras') is not null and to_regprocedure('public.finalize_image_compute_job(uuid,uuid,uuid,uuid,jsonb,jsonb)') is null"]);
console.log("Compute job plane Pass 4A PostgreSQL integration and rollback passed.");
