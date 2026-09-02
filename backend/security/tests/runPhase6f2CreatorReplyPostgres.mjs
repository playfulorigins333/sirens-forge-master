import { spawnSync } from "node:child_process"
const url=process.env.CREATOR_REPLY_DATABASE_URL||process.env.DATABASE_URL
if(!url){console.error("CREATOR_REPLY_DATABASE_URL or DATABASE_URL is required");process.exit(2)}
for(const file of ["backend/security/tests/phase6f2CreatorReplyPostgresSetup.sql","supabase/migrations/20260902120000_creator_reply_durable_workspace.sql","supabase/migrations/20260902130000_creator_reply_atomic_operations.sql","supabase/migrations/20260902140000_creator_reply_transactional_lifecycle.sql","supabase/migrations/20260902150000_creator_reply_service_role_table_grants.sql","backend/security/tests/phase6f2CreatorReplyPostgresIntegration.sql"]){const r=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1","-f",file],{encoding:"utf8"});if(r.status){process.stderr.write(r.stderr);process.stdout.write(r.stdout);process.exit(r.status??1)}}
console.log("Phase 6F.2 Creator Reply PostgreSQL integration passed.")
