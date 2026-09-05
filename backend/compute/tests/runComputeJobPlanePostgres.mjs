import { spawn, spawnSync } from "node:child_process";
const url=process.env.COMPUTE_JOB_PLANE_DATABASE_URL;
if(!url){console.error("COMPUTE_JOB_PLANE_DATABASE_URL is required");process.exit(2)}
const run=(args,stdio="inherit")=>{const r=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1",...args],{stdio});if(r.status)process.exit(r.status??1)};
run(["-f","backend/compute/tests/computeJobPlanePostgresSetup.sql"]);
run(["-f","supabase/migrations/20260825090000_durable_compute_job_plane.sql"]);
run(["-f","backend/compute/tests/computeJobPlaneConcurrentSeed.sql"]);
const sql="select job_id from public.submit_compute_job('10000000-0000-4000-8000-000000000001','stitch','concurrent',repeat('a',64),'{}','standard')";
await Promise.all([1,2].map(()=>new Promise((resolve,reject)=>{const p=spawn("psql",[url,"-v","ON_ERROR_STOP=1","-c",sql],{stdio:"inherit"});p.on("exit",c=>c===0?resolve():reject(new Error(`concurrent psql exit ${c}`)))})));
const authorize = (key) => new Promise((resolve, reject) => {
  const statement = `select public.authorize_compute_dispatch(j.id,a.id,a.lease_token,600) from public.compute_jobs j join public.compute_job_attempts a on a.job_id=j.id where j.idempotency_key='${key}'`;
  const child = spawn("psql", [url, "-v", "ON_ERROR_STOP=1", "-At", "-c", statement], { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  child.stdout.on("data", (chunk) => output += chunk);
  child.once("error", reject);
  // Wait for stdio to close before reading the captured result. Node's `exit`
  // event can fire while stdout is still open, which made the expected `f` flaky.
  child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`concurrent authorization exit ${code}`)));
});
const spendResults = await Promise.all([authorize("concurrent-spend-image"), authorize("concurrent-spend-trainer")]);
if (spendResults.filter((value) => value === "t").length !== 1 || spendResults.filter((value) => value === "f").length !== 1) {
  throw new Error(`expected one authorized and one held dispatch, received ${JSON.stringify(spendResults)}`);
}
run(["-f","backend/compute/tests/computeJobPlanePostgresIntegration.sql"]);
console.log("Compute job plane PostgreSQL integration passed.");
