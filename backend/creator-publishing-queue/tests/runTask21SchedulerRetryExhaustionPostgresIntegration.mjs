import { spawnSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const logPath = "task21-scheduler-retry-exhaustion-postgres-diagnostics.log"
writeFileSync(logPath, `Gate 21C-4 PostgreSQL integration diagnostics\nstarted_at=${new Date().toISOString()}\n`)
function parseLocal(name, expectedDb) {
  const raw = process.env[name]
  if (!raw) throw new Error(`${name} is required`)
  const url = new URL(raw)
  if (![/^postgres:$/.test(url.protocol), /^postgresql:$/.test(url.protocol)].some(Boolean)) throw new Error(`${name} must use PostgreSQL`)
  if (!new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(url.hostname)) throw new Error(`${name} must use a loopback host`)
  if (url.port !== "5432" || url.search || url.hash || url.pathname !== `/${expectedDb}`) throw new Error(`${name} must target loopback port 5432 database ${expectedDb} without query or fragment`)
  return raw
}
const adminUrl = parseLocal("DATABASE_URL", "postgres")
const taskUrl = parseLocal("TASK21_SCHEDULER_RETRY_EXHAUSTION_DATABASE_URL", "task21_scheduler_retry_exhaustion_ci")
const probe = spawnSync("psql", ["--version"], { encoding: "utf8" })
if (probe.status !== 0) { appendFileSync(logPath, `psql_unavailable=${probe.error?.message || probe.stderr || probe.status}\n`); process.exit(127) }
function runFile(label, file, url = taskUrl) {
  appendFileSync(logPath, `\n## ${label}: ${file}\n`)
  const r = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8" })
  appendFileSync(logPath, r.stdout || ""); appendFileSync(logPath, r.stderr || "")
  if (r.error) appendFileSync(logPath, `spawn_error=${r.error.message}\n`)
  if (r.status !== 0) throw new Error(`${label} failed with status ${r.status}`)
}
function runSql(label, sql, url = taskUrl) {
  const file = join(mkdtempSync(join(tmpdir(), "task21-retry-exhaustion-")), `${label.replace(/[^A-Za-z0-9_-]/g, "_")}.sql`)
  writeFileSync(file, sql); runFile(label, file, url)
}
const bootstrap = `
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists auth; create schema if not exists extensions; create schema if not exists storage;
create extension if not exists pgcrypto with schema extensions;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
create table public.profiles(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),created_at timestamptz default now());
create table public.generations(id uuid primary key default gen_random_uuid(),user_id uuid,status text,prompt text,image_url text,mode text,body_type text,job_type text,r2_bucket text,r2_key text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz default now());`
const migrations = ["20260710000100_creator_publishing_queue_foundation.sql","20260710000200_creator_publishing_compliance_manual_review_outcome.sql","20260710000300_creator_publishing_manual_review_workflow.sql","20260710000400_creator_publishing_creator_approval_queue.sql","20260710000500_creator_publishing_media_upload_intents.sql","20260710000600_creator_publishing_generated_media_association.sql","20260710000700_creator_publishing_platform_account_setup.sql","20260710000800_creator_publishing_package_composer.sql","20260710000900_creator_publishing_trusted_verification.sql","20260710001000_creator_publishing_ai_twin_consent.sql","20260710001100_creator_publishing_trusted_compliance_submission.sql","20260711001200_creator_publishing_autopost_orchestration.sql","20260711001300_creator_publishing_scheduler_due_state.sql","20260712001400_creator_publishing_onlyfans_operator_queue.sql","20260716001500_creator_publishing_onlyfans_manual_completion.sql","20260718001700_creator_publishing_onlyfans_history_timeline.sql","20260721001800_creator_publishing_verified_destination_guards.sql"]
const seed = `
insert into auth.users(id,email) values('21100000-0000-4000-8000-000000000101','snapshot@example.test');
insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_attested_at) values('21100000-0000-4000-8000-000000000401','21100000-0000-4000-8000-000000000101','onlyfans','snapshot','creator_attested',transaction_timestamp());
insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,ai_flag,ai_detail,second_person_present,compliance_status,compliance_policy_version,creator_approval_status,platform_meta) values('21100000-0000-4000-8000-000000000501','21100000-0000-4000-8000-000000000101','21100000-0000-4000-8000-000000000401','onlyfans','snapshot','snapshot','none','{}',false,'pending','unassigned','pending','{}');
insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version) values('21100000-0000-4000-8000-000000000001','21100000-0000-4000-8000-000000000101','scheduled','snapshot-plan-key-0001',repeat('1',64),'task14.20260711.001');
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,schedule_revision,intended_publish_at,schedule_timezone,operator_due_at,scheduled_at,scheduled_by) values('21100000-0000-4000-8000-000000000201','21100000-0000-4000-8000-000000000001','21100000-0000-4000-8000-000000000101','21100000-0000-4000-8000-000000000501','21100000-0000-4000-8000-000000000401','onlyfans','assisted','scheduled_internally',transaction_timestamp(),repeat('2',64),'task14.20260711.001',repeat('3',64),1,transaction_timestamp()+interval '2 hours','UTC',transaction_timestamp()+interval '1 hour',transaction_timestamp(),'21100000-0000-4000-8000-000000000101');
insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,created_at,updated_at) values('21100000-0000-4000-8000-000000000601','21100000-0000-4000-8000-000000000501','21100000-0000-4000-8000-000000000101','onlyfans','21100000-0000-4000-8000-000000000401','ready_for_handoff',transaction_timestamp(),transaction_timestamp());
insert into public.creator_publishing_scheduler_idempotency(creator_id,publishing_plan_id,action_type,idempotency_key,request_fingerprint,result,created_at) values('21100000-0000-4000-8000-000000000101','21100000-0000-4000-8000-000000000001','schedule','snapshot-scheduler-key-0001',repeat('4',64),'{}',transaction_timestamp());
insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,processing_attempts,lock_token,locked_at,processed_at,superseded_at,cancelled_at,safe_error_code) values
('21100000-0000-4000-8000-000000000701','21100000-0000-4000-8000-000000000101','21100000-0000-4000-8000-000000000001','21100000-0000-4000-8000-000000000201','operator_due','processed',transaction_timestamp()-interval '6 hours',10,1,null,null,transaction_timestamp()-interval '5 hours',null,null,null),
('21100000-0000-4000-8000-000000000702','21100000-0000-4000-8000-000000000101','21100000-0000-4000-8000-000000000001','21100000-0000-4000-8000-000000000201','publish_due','blocked',transaction_timestamp()-interval '5 hours',11,1,null,null,transaction_timestamp()-interval '4 hours',null,null,'EXISTING_BLOCK'),
('21100000-0000-4000-8000-000000000703','21100000-0000-4000-8000-000000000101','21100000-0000-4000-8000-000000000001','21100000-0000-4000-8000-000000000201','operator_due','superseded',transaction_timestamp()-interval '4 hours',12,0,null,null,null,transaction_timestamp()-interval '3 hours',null,null),
('21100000-0000-4000-8000-000000000704','21100000-0000-4000-8000-000000000101','21100000-0000-4000-8000-000000000001','21100000-0000-4000-8000-000000000201','publish_due','cancelled',transaction_timestamp()-interval '3 hours',13,0,null,null,null,null,transaction_timestamp()-interval '2 hours',null);
create table public.task21_retry_pre_data_snapshot(entity_type text,entity_id text,row_data jsonb,primary key(entity_type,entity_id));
insert into public.task21_retry_pre_data_snapshot select 'account',id::text,to_jsonb(x) from public.creator_platform_accounts x union all select 'package',id::text,to_jsonb(x) from public.creator_publishing_content_packages x union all select 'plan',id::text,to_jsonb(x) from public.creator_publishing_plans x union all select 'job',id::text,to_jsonb(x) from public.creator_publishing_platform_jobs x union all select 'queue',id::text,to_jsonb(x) from public.creator_publishing_queue_tasks x union all select 'event',id::text,to_jsonb(x) from public.creator_publishing_scheduler_events x union all select 'audit',id::text,to_jsonb(x) from public.creator_publishing_audit_events x union all select 'idempotency',creator_id::text||':'||action_type||':'||idempotency_key,to_jsonb(x) from public.creator_publishing_scheduler_idempotency x;
create table public.task21_retry_pre_function_snapshot(signature text primary key,definition text not null);
insert into public.task21_retry_pre_function_snapshot select p.oid::regprocedure::text,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';`
try {
 runSql("recreate", "drop database if exists task21_scheduler_retry_exhaustion_ci with (force); create database task21_scheduler_retry_exhaustion_ci;", adminUrl)
 runSql("bootstrap", bootstrap)
 for (const migration of migrations) runFile(`migration-${migration}`, `supabase/migrations/${migration}`)
 runSql("pre-01900-fixtures-and-snapshots", seed)
 runFile("migration-01900", "supabase/migrations/20260721001900_creator_publishing_scheduler_retry_exhaustion.sql")
 runSql("uuid-min-test-helper", "create or replace function public.task21_uuid_min(a uuid,b uuid) returns uuid language sql immutable as $$ select case when a is null then b when b is null then a when a<b then a else b end $$; create aggregate public.min(uuid)(sfunc=public.task21_uuid_min,stype=uuid);")
 runFile("gate-21c-4-assertions", "backend/creator-publishing-queue/tests/task21SchedulerRetryExhaustionPostgresIntegration.sql")
 appendFileSync(logPath, `\nTASK21_SCHEDULER_RETRY_EXHAUSTION_POSTGRES_INTEGRATION_PASSED\ncompleted_at=${new Date().toISOString()}\n`)
 console.log("TASK21_SCHEDULER_RETRY_EXHAUSTION_POSTGRES_INTEGRATION_PASSED")
} catch (error) {
 appendFileSync(logPath, `\nFAILED: ${error?.stack || error}\ncompleted_at=${new Date().toISOString()}\n`)
 try { console.error(readFileSync(logPath,"utf8").split(/\n/).slice(-180).join("\n")) } catch {}
 process.exit(1)
}
