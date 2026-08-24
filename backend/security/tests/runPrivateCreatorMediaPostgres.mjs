import { spawnSync } from "node:child_process";
const url=process.env.PRIVATE_CREATOR_MEDIA_DATABASE_URL;
if(!url){console.error("PRIVATE_CREATOR_MEDIA_DATABASE_URL is required");process.exit(2)}
const psql=(args)=>{const r=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1",...args],{stdio:"inherit"});if(r.status!==0)process.exit(r.status??1)};
psql(["-c","create schema auth; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key); create table public.generations(id uuid primary key default gen_random_uuid(),user_id uuid not null,prompt text,image_url text,lora_used text,job_type text,body_type text,mode text,status text,negative_prompt text,steps integer,cfg_scale numeric,seed bigint,width integer,height integer,runpod_job_id text,processing_time_ms integer,completed_at timestamptz,metadata jsonb,r2_bucket text,r2_key text,updated_at timestamptz,created_at timestamptz default now());"]);
psql(["-f","supabase/migrations/20260824090000_private_creator_generation_media.sql"]);
psql(["-f","backend/security/tests/privateCreatorMediaPostgresIntegration.sql"]);
psql(["-c","insert into public.generations(id,user_id) values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');","-f","supabase/manual/private_creator_generation_media_rollback.sql","-c","select 1 from public.generations where id='30000000-0000-4000-8000-000000000001';"]);
console.log("Private creator media PostgreSQL integration passed.");
