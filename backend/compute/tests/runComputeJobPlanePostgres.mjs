import { spawn, spawnSync } from "node:child_process";
const url=process.env.COMPUTE_JOB_PLANE_DATABASE_URL;
if(!url){console.error("COMPUTE_JOB_PLANE_DATABASE_URL is required");process.exit(2)}
const run=(args,stdio="inherit")=>{const r=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1",...args],{stdio});if(r.status)process.exit(r.status??1)};
run(["-f","backend/compute/tests/computeJobPlanePostgresSetup.sql"]);
run(["-f","supabase/migrations/20260825090000_durable_compute_job_plane.sql"]);
run(["-f","backend/compute/tests/computeJobPlaneConcurrentSeed.sql"]);
const sql="select job_id from public.submit_compute_job('10000000-0000-4000-8000-000000000001','stitch','concurrent',repeat('a',64),'{}','standard')";
await Promise.all([1,2].map(()=>new Promise((resolve,reject)=>{const p=spawn("psql",[url,"-v","ON_ERROR_STOP=1","-c",sql],{stdio:"inherit"});p.on("exit",c=>c===0?resolve():reject(new Error(`concurrent psql exit ${c}`)))})));
run(["-f","backend/compute/tests/computeJobPlanePostgresIntegration.sql"]);
console.log("Compute job plane PostgreSQL integration passed.");
