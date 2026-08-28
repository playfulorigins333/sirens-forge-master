import { spawnSync } from "node:child_process";
const url=process.env.COMPUTE_JOB_PLANE_DATABASE_URL;
if(!url){console.error("COMPUTE_JOB_PLANE_DATABASE_URL is required");process.exit(2)}
const run=(args)=>{const result=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1",...args],{stdio:"inherit"});if(result.status)process.exit(result.status??1)};
run(["-f","backend/compute/tests/computeJobPlanePostgresSetup.sql"]);
run(["-f","supabase/migrations/20260825090000_durable_compute_job_plane.sql"]);
run(["-f","backend/compute/tests/trainerOrphanCleanupPostgresIntegration.sql"]);
console.log("Trainer orphan cleanup PostgreSQL integration passed.");
