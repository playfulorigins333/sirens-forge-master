import { spawnSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const logPath = "fanvue-launch-execution-postgres-diagnostics.log"
writeFileSync(logPath, `CPQ Fanvue accounts/packages PostgreSQL integration\nstarted_at=${new Date().toISOString()}\n`)
function localUrl(name, database) { const raw=process.env[name]; if(!raw)throw new Error(`${name} is required`); const url=new URL(raw); if(!["postgres:","postgresql:"].includes(url.protocol)||!["127.0.0.1","localhost","[::1]","::1"].includes(url.hostname)||url.port!=="5432"||url.pathname!==`/${database}`||url.search||url.hash)throw new Error(`${name} must target loopback PostgreSQL port 5432 database ${database}`); return raw }
const adminUrl=localUrl("DATABASE_URL","postgres"), testUrl=localUrl("CPQ_FANVUE_DATABASE_URL","cpq_fanvue_ci")
function runCommand(label,command,args){appendFileSync(logPath,`\n## ${label}: ${command} ${args.join(" ")}\n`);const result=spawnSync(command,args,{encoding:"utf8"});appendFileSync(logPath,result.stdout||"");appendFileSync(logPath,result.stderr||"");if(result.error)appendFileSync(logPath,`spawn_error=${result.error.message}\n`);if(result.status!==0)throw new Error(`${label} failed with status ${result.status}`)}
function runFile(label,file,url=testUrl){appendFileSync(logPath,`\n## ${label}: ${file}\n`);const result=spawnSync("psql",[url,"-v","ON_ERROR_STOP=1","-f",file],{encoding:"utf8"});appendFileSync(logPath,result.stdout||"");appendFileSync(logPath,result.stderr||"");if(result.error)appendFileSync(logPath,`spawn_error=${result.error.message}\n`);if(result.status!==0)throw new Error(`${label} failed with status ${result.status}`)}
function runSql(label,sql,url=testUrl){const dir=mkdtempSync(join(tmpdir(),"cpq-fanvue-postgres-"));const file=join(dir,`${label}.sql`);writeFileSync(file,sql);runFile(label,file,url)}
const bootstrap=`
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists auth; create schema if not exists extensions; create schema if not exists storage;
create extension if not exists pgcrypto with schema extensions;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table if not exists auth.users(id uuid primary key,email text,created_at timestamptz default now());
create table if not exists public.profiles(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),created_at timestamptz default now());
create table if not exists public.generations(id uuid primary key default gen_random_uuid(),user_id uuid,status text,prompt text,image_url text,mode text,body_type text,job_type text,r2_bucket text,r2_key text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz default now());
`
const migrations=["20251222_autopost_v1.sql","20260625193000_autopost_x_text_mvp_foundation.sql","20260710000100_creator_publishing_queue_foundation.sql","20260710000200_creator_publishing_compliance_manual_review_outcome.sql","20260710000300_creator_publishing_manual_review_workflow.sql","20260710000400_creator_publishing_creator_approval_queue.sql","20260710000500_creator_publishing_media_upload_intents.sql","20260710000600_creator_publishing_generated_media_association.sql","20260710000700_creator_publishing_platform_account_setup.sql","20260710000800_creator_publishing_package_composer.sql","20260710000900_creator_publishing_trusted_verification.sql","20260710001000_creator_publishing_ai_twin_consent.sql","20260710001100_creator_publishing_trusted_compliance_submission.sql","20260711001200_creator_publishing_autopost_orchestration.sql","20260711001300_creator_publishing_scheduler_due_state.sql","20260712001400_creator_publishing_onlyfans_operator_queue.sql","20260716001500_creator_publishing_onlyfans_manual_completion.sql","20260718001700_creator_publishing_onlyfans_history_timeline.sql","20260721001800_creator_publishing_verified_destination_guards.sql","20260721001900_creator_publishing_scheduler_retry_exhaustion.sql","20260721002000_creator_publishing_scheduler_retry_exhaustion_recovery.sql","20260813035247_fanvue_oauth_cpq_account_bridge.sql"]
try{
 runCommand("public-activation-source-contract","npx",["tsx","backend/creator-publishing-queue/tests/fanvuePublicActivation.test.ts"])
 runSql("recreate","drop database if exists cpq_fanvue_ci with (force); create database cpq_fanvue_ci;",adminUrl)
 runSql("bootstrap",bootstrap)
 for(const migration of migrations)runFile(`migration-${migration}`,`supabase/migrations/${migration}`)
 runSql("pre-gate-snapshot","create table public.cpq_fanvue_pre_gate_snapshot as select id,to_jsonb(a) row_data from public.creator_platform_accounts a where platform='fanvue';")
 runFile("gate-migration","supabase/migrations/20260814022245_cpq_fanvue_accounts_packages_nonrunnable.sql")
 runFile("behavior","backend/creator-publishing-queue/tests/cpqFanvueAccountsPackagesPostgresIntegration.sql")
 runFile("launch-migration","supabase/migrations/20260814090000_cpq_fanvue_launch_execution_foundation.sql")
 runFile("generated-media-migration","supabase/migrations/20260817040000_cpq_fanvue_generated_media_attachment.sql")
 runFile("generated-media-behavior","backend/creator-publishing-queue/tests/fanvueGeneratedMediaAttachmentPostgresIntegration.sql")
 runFile("launch-behavior","backend/creator-publishing-queue/tests/fanvueLaunchExecutionPostgresIntegration.sql")
 runSql("activation-prep",`
   update public.autopost_accounts set scopes='["openid","offline_access","offline","read:self","read:creator","read:post","write:post","read:media","write:media","write:creator"]'::jsonb where user_id='11111111-1111-4111-8111-111111111111' and platform='fanvue';
   insert into public.autopost_accounts(id,user_id,platform,provider_account_id,provider_username,connection_status,encrypted_access_token,encrypted_refresh_token,token_key_version,token_expires_at,scopes,metadata)
   values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','22222222-2222-4222-8222-222222222222','fanvue','provider-prebridge','prebridge_creator','CONNECTED','activation-access-fixture','activation-refresh-fixture',1,clock_timestamp()+interval '1 hour','["write:post"]'::jsonb,'{"provider":"fanvue","identity_fetched":true}'::jsonb);
   select case when exists(select 1 from public.creator_platform_accounts where oauth_account_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') then pg_catalog.current_setting('missing.setting') else 'activation prep ok' end;
 `)
 runFile("public-activation-migration","supabase/migrations/20260817170000_cpq_fanvue_public_activation.sql")
 runFile("direct-compliance-facts-migration","supabase/migrations/20260817170050_cpq_fanvue_direct_compliance_facts.sql")
 runFile("direct-compliance-approval-migration","supabase/migrations/20260817170100_cpq_fanvue_direct_compliance_approval.sql")
 runFile("direct-preparation-hardening-migration","supabase/migrations/20260817170200_cpq_fanvue_direct_preparation_hardening.sql")
 runFile("public-activation-behavior","backend/creator-publishing-queue/tests/fanvuePublicActivationPostgresIntegration.sql")
 appendFileSync(logPath,"\nFANVUE_LAUNCH_EXECUTION_POSTGRES_INTEGRATION_PASSED\n");console.log("FANVUE_LAUNCH_EXECUTION_POSTGRES_INTEGRATION_PASSED")
}catch(error){appendFileSync(logPath,`\nFAILED: ${error?.stack||error}\n`);try{console.error(readFileSync(logPath,"utf8").split(/\n/).slice(-260).join("\n"))}catch{}process.exit(1)}