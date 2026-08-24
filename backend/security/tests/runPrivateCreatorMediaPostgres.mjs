import { spawnSync } from "node:child_process";
const url=process.env.PRIVATE_CREATOR_MEDIA_DATABASE_URL;
if(!url){console.error("PRIVATE_CREATOR_MEDIA_DATABASE_URL is required");process.exit(2)}
const psql=(args)=>{const r=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1",...args],{stdio:"inherit"});if(r.status!==0)process.exit(r.status??1)};
psql(["-f","backend/security/tests/privateCreatorMediaPostgresSetup.sql"]);
psql(["-f","supabase/migrations/20260710000600_creator_publishing_generated_media_association.sql"]);
psql(["-f","supabase/migrations/20260817040000_cpq_fanvue_generated_media_attachment.sql"]);
psql(["-f","supabase/migrations/20260824090000_private_creator_generation_media.sql"]);
psql(["-f","supabase/migrations/20260824100000_private_generation_asset_publishing.sql"]);
psql(["-f","backend/security/tests/privateCreatorMediaPostgresIntegration.sql"]);
psql(["-c","insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'); insert into public.generations(id,user_id) values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');","-f","supabase/manual/private_generation_asset_publishing_rollback.sql","-f","supabase/manual/private_creator_generation_media_rollback.sql","-c","select 1 from public.generations where id='30000000-0000-4000-8000-000000000001'; select to_regprocedure('public.creator_publishing_attach_generated_media(uuid,uuid,uuid,text,text,bigint,text,text,timestamptz,text)') is not null as legacy_rpc_survives; select to_regprocedure('public.creator_publishing_attach_generated_media(uuid,uuid,uuid,text,text,bigint,text,text,timestamptz,text,uuid,smallint)') is null as correction_rpc_removed;"]);
console.log("Private creator media PostgreSQL integration passed.");
